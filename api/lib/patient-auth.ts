// ============================================================================
// Portal do paciente — sessão separada da equipe.
// Acesso: telefone + data de nascimento → código de 6 dígitos (enviado por
// WhatsApp quando a integração está ativa). O código é guardado com hash e
// tem uso único e validade curta.
// ============================================================================
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env, PatientSession } from "../types";
import { sha256hex } from "./crypto";
import { normalizePhone, nowIso, randomHex } from "./utils";

export const PATIENT_COOKIE = "cr_patient";
const SESSION_HOURS = 8;

function secretOf(env: Env): string {
  const s = env.SESSION_SECRET;
  if (!s || s.length < 32) {
    if (env.APP_ENV === "production") throw new Error("SESSION_SECRET ausente/curto");
    return "dev-only-session-secret-nao-use-em-producao";
  }
  return s;
}

export function generatePortalCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

export async function createPortalCode(
  db: D1Database,
  clinicId: number,
  patientId: number
): Promise<{ code: string; expiresAt: string }> {
  // Invalida códigos anteriores do paciente (evita acúmulo e reuso).
  await db
    .prepare(`UPDATE portal_codes SET used_at = ?2 WHERE patient_id = ?1 AND used_at IS NULL`)
    .bind(patientId, nowIso())
    .run();
  const code = generatePortalCode();
  const codeHash = await sha256hex(`cr-portal:${patientId}:${code}`);
  const expiresAt = nowIso(new Date(Date.now() + 15 * 60_000));
  await db
    .prepare(`INSERT INTO portal_codes (clinic_id, patient_id, code_hash, expires_at) VALUES (?1,?2,?3,?4)`)
    .bind(clinicId, patientId, codeHash, expiresAt)
    .run();
  return { code, expiresAt };
}

export async function verifyPortalCode(
  db: D1Database,
  clinicId: number,
  patientId: number,
  code: string
): Promise<{ ok: boolean; message?: string }> {
  const row = await db
    .prepare(
      `SELECT id, attempts FROM portal_codes
        WHERE clinic_id = ?1 AND patient_id = ?2 AND used_at IS NULL AND expires_at > ?3
        ORDER BY id DESC LIMIT 1`
    )
    .bind(clinicId, patientId, nowIso())
    .first<{ id: number; attempts: number }>();
  if (!row) return { ok: false, message: "Código expirado. Solicite um novo." };
  if (row.attempts >= 5) return { ok: false, message: "Muitas tentativas. Solicite um novo código." };

  const expected = await sha256hex(`cr-portal:${patientId}:${code}`);
  const stored = await db.prepare(`SELECT code_hash FROM portal_codes WHERE id = ?1`).bind(row.id).first<{ code_hash: string }>();
  if (!stored || stored.code_hash !== expected) {
    await db.prepare(`UPDATE portal_codes SET attempts = attempts + 1 WHERE id = ?1`).bind(row.id).run();
    return { ok: false, message: "Código inválido." };
  }
  const used = await db
    .prepare(`UPDATE portal_codes SET used_at = ?2 WHERE id = ?1 AND used_at IS NULL`)
    .bind(row.id, nowIso())
    .run();
  if ((used.meta?.changes ?? 0) !== 1) return { ok: false, message: "Código já utilizado. Solicite um novo." };
  return { ok: true };
}

export async function createPatientSession(c: Context<{ Bindings: Env }>, clinicSlug: string, clinicId: number, patientId: number) {
  const token = randomHex(32);
  const tokenHash = await sha256hex(`${token}:${secretOf(c.env)}:${patientId}`);
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await c.env.DB.prepare(
    `INSERT INTO patient_sessions (token_hash, clinic_id, patient_id, expires_at) VALUES (?1,?2,?3,?4)`
  )
    .bind(tokenHash, clinicId, patientId, nowIso(expires))
    .run();
  setCookie(c, PATIENT_COOKIE, `pid.${patientId}.${token}`, {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  return clinicSlug;
}

export async function currentPatient(c: Context<{ Bindings: Env }>): Promise<PatientSession | null> {
  const v = getCookie(c, PATIENT_COOKIE);
  if (!v) return null;
  const parts = v.split(".");
  if (parts.length !== 3 || parts[0] !== "pid" || !/^\d+$/.test(parts[1])) return null;
  const patientId = parseInt(parts[1], 10);
  const tokenHash = await sha256hex(`${parts[2]}:${secretOf(c.env)}:${patientId}`);
  const row = await c.env.DB.prepare(
    `SELECT s.patient_id, s.clinic_id, c.slug AS clinic_slug, p.name
       FROM patient_sessions s
       JOIN patients p ON p.id = s.patient_id
       JOIN clinics c ON c.id = s.clinic_id
      WHERE s.token_hash = ?1 AND s.patient_id = ?2 AND s.expires_at > ?3 AND p.anonymized_at IS NULL`
  )
    .bind(tokenHash, patientId, nowIso())
    .first<{ patient_id: number; clinic_id: number; clinic_slug: string; name: string }>();
  if (!row) return null;
  return { patient_id: row.patient_id, clinic_id: row.clinic_id, clinic_slug: row.clinic_slug, name: row.name };
}

export async function destroyPatientSession(c: Context<{ Bindings: Env }>) {
  const v = getCookie(c, PATIENT_COOKIE);
  if (v) {
    const parts = v.split(".");
    if (parts.length === 3 && /^\d+$/.test(parts[1])) {
      const patientId = parseInt(parts[1], 10);
      const tokenHash = await sha256hex(`${parts[2]}:${secretOf(c.env)}:${patientId}`);
      await c.env.DB.prepare(`DELETE FROM patient_sessions WHERE token_hash = ?1`).bind(tokenHash).run();
    }
  }
  deleteCookie(c, PATIENT_COOKIE, { path: "/" });
}

/** Localiza paciente por telefone + nascimento (usado no login do portal). */
export async function findPatientForPortal(
  db: D1Database,
  clinicId: number,
  phone: string,
  birthDate: string
): Promise<{ id: number; name: string; phone: string } | null> {
  const normalized = normalizePhone(phone);
  if (normalized.length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  return db
    .prepare(
      `SELECT id, name, phone FROM patients
        WHERE clinic_id = ?1 AND phone = ?2 AND birth_date = ?3 AND anonymized_at IS NULL AND active = 1`
    )
    .bind(clinicId, normalized, birthDate)
    .first<{ id: number; name: string; phone: string }>();
}
