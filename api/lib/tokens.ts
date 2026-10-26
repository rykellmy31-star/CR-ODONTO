// ============================================================================
// Tokens de ação de uso único (links seguros de confirmar/reagendar).
// Guardamos apenas o hash sha256; o token em claro só existe na URL enviada.
// Idempotência: `used_at` é gravado com UPDATE condicional (uso único real).
// ============================================================================
import { sha256hex } from "./crypto";
import { nowIso, randomHex } from "./utils";

export type TokenPurpose = "confirmar" | "reagendar" | "portal" | "documento";

export async function createActionToken(
  db: D1Database,
  input: { clinicId: number; appointmentId?: number | null; patientId?: number | null; purpose: TokenPurpose; ttlMinutes?: number }
): Promise<{ token: string; expiresAt: string }> {
  const token = randomHex(24);
  const tokenHash = await sha256hex(`cr-action:${token}`);
  const expiresAt = nowIso(new Date(Date.now() + (input.ttlMinutes ?? 72 * 60) * 60_000));
  await db
    .prepare(
      `INSERT INTO action_tokens (clinic_id, appointment_id, patient_id, purpose, token_hash, expires_at)
       VALUES (?1,?2,?3,?4,?5,?6)`
    )
    .bind(input.clinicId, input.appointmentId ?? null, input.patientId ?? null, input.purpose, tokenHash, expiresAt)
    .run();
  return { token, expiresAt };
}

export interface ActionTokenRow {
  id: number;
  clinic_id: number;
  appointment_id: number | null;
  patient_id: number | null;
  purpose: TokenPurpose;
  expires_at: string;
  used_at: string | null;
  used_action: string;
}

export async function loadActionToken(db: D1Database, token: string): Promise<ActionTokenRow | null> {
  if (!token || token.length < 16 || token.length > 128) return null;
  const tokenHash = await sha256hex(`cr-action:${token}`);
  return db
    .prepare(`SELECT id, clinic_id, appointment_id, patient_id, purpose, expires_at, used_at, used_action FROM action_tokens WHERE token_hash = ?1`)
    .bind(tokenHash)
    .first<ActionTokenRow>();
}

export function tokenIsUsable(row: ActionTokenRow | null, now = new Date()): row is ActionTokenRow {
  if (!row) return false;
  if (row.used_at) return false;
  return new Date(row.expires_at).getTime() > now.getTime();
}

/**
 * Consome o token de forma atômica. Retorna false se já foi usado/expirado —
 * isso é o que impede duplo clique e reutilização indevida do link.
 */
export async function consumeActionToken(db: D1Database, tokenRowId: number, action: string): Promise<boolean> {
  const res = await db
    .prepare(`UPDATE action_tokens SET used_at = ?2, used_action = ?3 WHERE id = ?1 AND used_at IS NULL AND expires_at > ?2`)
    .bind(tokenRowId, nowIso(), action)
    .run();
  return (res.meta?.changes ?? 0) === 1;
}

/** Invalida tokens pendentes de um agendamento (após reagendar/cancelar). */
export async function invalidateAppointmentTokens(db: D1Database, appointmentId: number): Promise<void> {
  await db
    .prepare(`UPDATE action_tokens SET used_at = ?2, used_action = 'invalidado' WHERE appointment_id = ?1 AND used_at IS NULL`)
    .bind(appointmentId, nowIso())
    .run();
}
