// ============================================================================
// API do painel da clínica (/api/c/:slug/admin/*).
// Perfis: clinic_admin (tudo), receptionist (agenda/pacientes/atendimento),
// dentist (própria agenda) — ver api/lib/tenant.ts.
// ============================================================================
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { tenantMiddleware, cid, ctxSettings, type AuthMode } from "../lib/tenant";
import { audit } from "../lib/audit";
import { err, normalizePhone, nowIso, slugify, brl, randomHex } from "../lib/utils";
import { formatHHMM, parseHHMM, todayLocal, addDays, utcToLocal } from "../lib/time";
import { dayAvailability } from "../lib/scheduling";
import { withinLimits, subscriptionState } from "../lib/access";
import { clinicSettingsSchema, saveClinicSettings } from "../lib/settings";
import { operationalSummary, byProfessional, byDay, awaitingReturn, whatsappHistory } from "../lib/reports";
import { hashPassword, sha256hex } from "../lib/crypto";

export const adminRouter = new Hono<{ Bindings: Env }>();
const guard = (auth: AuthMode) => tenantMiddleware({ auth });

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

async function clinicTz(env: Env, clinicId: number): Promise<string> {
  const row = await env.DB.prepare(`SELECT timezone FROM clinics WHERE id = ?1`).bind(clinicId).first<{ timezone: string }>();
  return row?.timezone || "America/Sao_Paulo";
}

// ══════════════════════════════════════════════════════════════════════════
// UNIDADES
// ══════════════════════════════════════════════════════════════════════════
adminRouter.get("/units", guard("staff"), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, slug, name, address, city, state, zip, phone, whatsapp, is_primary, active, sort
       FROM units WHERE clinic_id = ?1 ORDER BY is_primary DESC, sort, name`
  ).bind(cid(c)).all<Record<string, unknown>>();
  return c.json({ units: rows.results ?? [] });
});

const unitSchema = z.object({
  name: z.string().min(2).max(120),
  address: z.string().max(300).default(""),
  city: z.string().max(120).default(""),
  state: z.string().max(2).default(""),
  zip: z.string().max(20).default(""),
  phone: z.string().max(40).default(""),
  whatsapp: z.string().max(40).default(""),
  timezone: z.string().max(60).default(""),
  active: z.boolean().default(true),
});

adminRouter.post("/units", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const parsed = unitSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados da unidade inválidos.", 422, parsed.error.flatten().fieldErrors);
  const sub = await subscriptionState(c.env.DB, clinicId);
  const limits = await withinLimits(c.env.DB, clinicId, sub?.plan ?? null, "unit");
  if (!limits.ok)
    return err(c, `Seu plano permite ${limits.limit} unidade(s) e já existem ${limits.used}. Fale com o administrador da plataforma.`, 402);
  const d = parsed.data;
  let slug = slugify(d.name);
  const taken = await c.env.DB.prepare(`SELECT id FROM units WHERE clinic_id=?1 AND slug=?2`).bind(clinicId, slug).first();
  if (taken) slug = `${slug}-${Date.now().toString().slice(-4)}`;
  const r = await c.env.DB.prepare(
    `INSERT INTO units (clinic_id, slug, name, address, city, state, zip, phone, whatsapp, timezone, active, sort)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,
       COALESCE((SELECT MAX(sort)+1 FROM units WHERE clinic_id=?1),1))`
  )
    .bind(clinicId, slug, d.name, d.address, d.city, d.state.toUpperCase(), d.zip, d.phone, d.whatsapp,
      d.timezone.slice(0, 60), d.active ? 1 : 0)
    .run();
  await audit(c.env.DB, c.get("user"), "unit.created", "unit", Number(r.meta?.last_row_id ?? 0), { name: d.name });
  return c.json({ ok: true, id: Number(r.meta?.last_row_id ?? 0) }, 201);
});

adminRouter.put("/units/:id", guard("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = unitSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados da unidade inválidos.", 422);
  const d = parsed.data;
  const sets: string[] = [];
  const binds: unknown[] = [id, cid(c)];
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?${binds.length + 1}`);
    binds.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
  }
  if (!sets.length) return err(c, "Nada para atualizar.", 422);
  const res = await c.env.DB.prepare(`UPDATE units SET ${sets.join(", ")} WHERE id = ?1 AND clinic_id = ?2`).bind(...binds).run();
  if ((res.meta?.changes ?? 0) === 0) return err(c, "Unidade não encontrada.", 404);
  await audit(c.env.DB, c.get("user"), "unit.updated", "unit", id, d);
  return c.json({ ok: true });
});

// ── Salas e cadeiras ──────────────────────────────────────────────────────
adminRouter.get("/rooms", guard("staff"), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.name, r.kind, r.active, r.unit_id, u.name AS unit_name
       FROM rooms r JOIN units u ON u.id = r.unit_id
      WHERE r.clinic_id = ?1 ORDER BY u.sort, r.sort, r.name`
  ).bind(cid(c)).all<Record<string, unknown>>();
  return c.json({ rooms: rows.results ?? [] });
});

const roomSchema = z.object({
  unit_id: z.number().int().positive(),
  name: z.string().min(1).max(80),
  kind: z.enum(["cadeira", "sala", "consultorio"]).default("cadeira"),
  active: z.boolean().default(true),
});

adminRouter.post("/rooms", guard("admin"), async (c) => {
  const parsed = roomSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados da sala inválidos.", 422);
  const unit = await c.env.DB.prepare(`SELECT id FROM units WHERE id=?1 AND clinic_id=?2`).bind(parsed.data.unit_id, cid(c)).first();
  if (!unit) return err(c, "Unidade não encontrada.", 404);
  const r = await c.env.DB.prepare(
    `INSERT INTO rooms (clinic_id, unit_id, name, kind, active, sort)
     VALUES (?1,?2,?3,?4,?5, COALESCE((SELECT MAX(sort)+1 FROM rooms WHERE unit_id=?2),1))`
  ).bind(cid(c), parsed.data.unit_id, parsed.data.name, parsed.data.kind, parsed.data.active ? 1 : 0).run();
  return c.json({ ok: true, id: Number(r.meta?.last_row_id ?? 0) }, 201);
});

adminRouter.put("/rooms/:id", guard("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = roomSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados da sala inválidos.", 422);
  const d = parsed.data;
  const sets: string[] = [];
  const binds: unknown[] = [id, cid(c)];
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?${binds.length + 1}`);
    binds.push(typeof v === "boolean" ? (v ? 1 : 0) : v);
  }
  if (!sets.length) return err(c, "Nada para atualizar.", 422);
  await c.env.DB.prepare(`UPDATE rooms SET ${sets.join(", ")} WHERE id = ?1 AND clinic_id = ?2`).bind(...binds).run();
  return c.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════
// ESPECIALIDADES
// ══════════════════════════════════════════════════════════════════════════
adminRouter.get("/specialties", guard("staff"), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, name, slug, color, active, sort FROM specialties WHERE clinic_id = ?1 ORDER BY sort, name`
  ).bind(cid(c)).all<Record<string, unknown>>();
  return c.json({ specialties: rows.results ?? [] });
});

const specialtySchema = z.object({
  name: z.string().min(2).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0f766e"),
  active: z.boolean().default(true),
});

adminRouter.post("/specialties", guard("admin"), async (c) => {
  const parsed = specialtySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados da especialidade inválidos.", 422);
  const slug = slugify(parsed.data.name);
  const exists = await c.env.DB.prepare(`SELECT id FROM specialties WHERE clinic_id=?1 AND slug=?2`).bind(cid(c), slug).first();
  if (exists) return err(c, "Especialidade já cadastrada.", 409);
  const r = await c.env.DB.prepare(
    `INSERT INTO specialties (clinic_id, name, slug, color, active, sort)
     VALUES (?1,?2,?3,?4,?5, COALESCE((SELECT MAX(sort)+1 FROM specialties WHERE clinic_id=?1),1))`
  ).bind(cid(c), parsed.data.name, slug, parsed.data.color, parsed.data.active ? 1 : 0).run();
  return c.json({ ok: true, id: Number(r.meta?.last_row_id ?? 0) }, 201);
});

adminRouter.put("/specialties/:id", guard("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = specialtySchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados inválidos.", 422);
  const d = parsed.data;
  const sets: string[] = [];
  const binds: unknown[] = [id, cid(c)];
  if (d.name !== undefined) { sets.push(`name = ?${binds.length + 1}`); binds.push(d.name); }
  if (d.color !== undefined) { sets.push(`color = ?${binds.length + 1}`); binds.push(d.color); }
  if (d.active !== undefined) { sets.push(`active = ?${binds.length + 1}`); binds.push(d.active ? 1 : 0); }
  if (!sets.length) return err(c, "Nada para atualizar.", 422);
  await c.env.DB.prepare(`UPDATE specialties SET ${sets.join(", ")} WHERE id = ?1 AND clinic_id = ?2`).bind(...binds).run();
  return c.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════
// PROCEDIMENTOS (duração individual = base da agenda)
// ══════════════════════════════════════════════════════════════════════════
adminRouter.get("/procedures", guard("staff"), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.id, p.slug, p.name, p.specialty_id, s.name AS specialty_name, s.color AS specialty_color,
            p.duration_min, p.price_cents, p.requires_room, p.description, p.active, p.show_in_booking, p.sort
       FROM procedures p LEFT JOIN specialties s ON s.id = p.specialty_id
      WHERE p.clinic_id = ?1 ORDER BY p.sort, p.name`
  ).bind(cid(c)).all<Record<string, unknown>>();
  return c.json({ procedures: rows.results ?? [] });
});

const procedureSchema = z.object({
  name: z.string().min(2).max(120),
  specialty_id: z.number().int().positive().nullable().optional(),
  duration_min: z.number().int().min(5).max(480).default(30),
  price_cents: z.number().int().min(0).max(10_000_000).default(0),
  requires_room: z.boolean().default(true),
  description: z.string().max(500).default(""),
  active: z.boolean().default(true),
  show_in_booking: z.boolean().default(true),
});

adminRouter.post("/procedures", guard("admin"), async (c) => {
  const parsed = procedureSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados do procedimento inválidos.", 422, parsed.error.flatten().fieldErrors);
  const d = parsed.data;
  let slug = slugify(d.name);
  const taken = await c.env.DB.prepare(`SELECT id FROM procedures WHERE clinic_id=?1 AND slug=?2`).bind(cid(c), slug).first();
  if (taken) slug = `${slug}-${Date.now().toString().slice(-4)}`;
  const r = await c.env.DB.prepare(
    `INSERT INTO procedures (clinic_id, slug, name, specialty_id, duration_min, price_cents, requires_room, description, active, show_in_booking, sort)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10, COALESCE((SELECT MAX(sort)+1 FROM procedures WHERE clinic_id=?1),1))`
  )
    .bind(cid(c), slug, d.name, d.specialty_id ?? null, d.duration_min, d.price_cents, d.requires_room ? 1 : 0,
      d.description, d.active ? 1 : 0, d.show_in_booking ? 1 : 0)
    .run();
  await audit(c.env.DB, c.get("user"), "procedure.created", "procedure", Number(r.meta?.last_row_id ?? 0), { name: d.name });
  return c.json({ ok: true, id: Number(r.meta?.last_row_id ?? 0) }, 201);
});

adminRouter.put("/procedures/:id", guard("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = procedureSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados inválidos.", 422);
  const d = parsed.data;
  const sets: string[] = [];
  const binds: unknown[] = [id, cid(c)];
  const push = (col: string, v: unknown) => { sets.push(`${col} = ?${binds.length + 1}`); binds.push(v); };
  if (d.name !== undefined) push("name", d.name);
  if (d.specialty_id !== undefined) push("specialty_id", d.specialty_id);
  if (d.duration_min !== undefined) push("duration_min", d.duration_min);
  if (d.price_cents !== undefined) push("price_cents", d.price_cents);
  if (d.requires_room !== undefined) push("requires_room", d.requires_room ? 1 : 0);
  if (d.description !== undefined) push("description", d.description);
  if (d.active !== undefined) push("active", d.active ? 1 : 0);
  if (d.show_in_booking !== undefined) push("show_in_booking", d.show_in_booking ? 1 : 0);
  if (!sets.length) return err(c, "Nada para atualizar.", 422);
  const res = await c.env.DB.prepare(`UPDATE procedures SET ${sets.join(", ")} WHERE id = ?1 AND clinic_id = ?2`).bind(...binds).run();
  if ((res.meta?.changes ?? 0) === 0) return err(c, "Procedimento não encontrado.", 404);
  return c.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════
// DENTISTAS / PROFISSIONAIS
// ══════════════════════════════════════════════════════════════════════════
adminRouter.get("/professionals", guard("staff"), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT pr.id, pr.name, pr.slug, pr.cro, pr.cro_uf, pr.email, pr.phone, pr.photo_url, pr.color,
            pr.default_unit_id, pr.slot_min, pr.show_in_booking, pr.active, pr.sort, pr.user_id,
            u.name AS unit_name,
            (SELECT GROUP_CONCAT(s.name, ', ') FROM professional_specialties ps
               JOIN specialties s ON s.id = ps.specialty_id WHERE ps.professional_id = pr.id) AS specialties
       FROM professionals pr
       LEFT JOIN units u ON u.id = pr.default_unit_id
      WHERE pr.clinic_id = ?1 ORDER BY pr.active DESC, pr.sort, pr.name`
  ).bind(cid(c)).all<Record<string, unknown>>();
  return c.json({ professionals: rows.results ?? [] });
});

const professionalSchema = z.object({
  name: z.string().min(3).max(120),
  cro: z.string().max(20).default(""),
  cro_uf: z.string().max(2).default(""),
  cpf: z.string().max(20).default(""),
  email: z.string().email().max(200).or(z.literal("")).default(""),
  phone: z.string().max(40).default(""),
  bio: z.string().max(1000).default(""),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0f766e"),
  default_unit_id: z.number().int().positive().nullable().optional(),
  slot_min: z.number().int().min(5).max(120).default(15),
  show_in_booking: z.boolean().default(true),
  active: z.boolean().default(true),
  specialty_ids: z.array(z.number().int().positive()).max(20).default([]),
  procedure_ids: z.array(z.number().int().positive()).max(500).default([]),
  /** Cria também o acesso ao painel do dentista. */
  login_password: z.string().min(10).max(200).optional(),
});

adminRouter.post("/professionals", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const parsed = professionalSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados do profissional inválidos.", 422, parsed.error.flatten().fieldErrors);
  const d = parsed.data;
  if (d.cro && !d.cro_uf) return err(c, "Informe a UF do CRO.", 422);

  const sub = await subscriptionState(c.env.DB, clinicId);
  const limits = await withinLimits(c.env.DB, clinicId, sub?.plan ?? null, "dentist");
  if (!limits.ok) return err(c, `Seu plano permite ${limits.limit} dentista(s) e já existem ${limits.used}.`, 402);

  let slug = slugify(d.name);
  const taken = await c.env.DB.prepare(`SELECT id FROM professionals WHERE clinic_id=?1 AND slug=?2`).bind(clinicId, slug).first();
  if (taken) slug = `${slug}-${Date.now().toString().slice(-4)}`;

  const r = await c.env.DB.prepare(
    `INSERT INTO professionals (clinic_id, slug, name, cro, cro_uf, cpf, email, phone, bio, color,
        default_unit_id, slot_min, show_in_booking, active, sort)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,
       COALESCE((SELECT MAX(sort)+1 FROM professionals WHERE clinic_id=?1),1))`
  )
    .bind(clinicId, slug, d.name, d.cro, d.cro_uf.toUpperCase(), d.cpf.replace(/\D/g, ""),
      d.email.toLowerCase(), normalizePhone(d.phone), d.bio, d.color, d.default_unit_id ?? null,
      d.slot_min, d.show_in_booking ? 1 : 0, d.active ? 1 : 0)
    .run();
  const professionalId = Number(r.meta?.last_row_id ?? 0);

  for (const sid of d.specialty_ids) {
    await c.env.DB.prepare(`INSERT OR IGNORE INTO professional_specialties (professional_id, specialty_id) VALUES (?1,?2)`)
      .bind(professionalId, sid).run();
  }
  for (const pid of d.procedure_ids) {
    await c.env.DB.prepare(`INSERT OR IGNORE INTO professional_procedures (professional_id, procedure_id) VALUES (?1,?2)`)
      .bind(professionalId, pid).run();
  }

  // Escala padrão (seg–sex 08:00–18:00 com almoço) para o dentista já operar.
  for (const weekday of [1, 2, 3, 4, 5]) {
    await c.env.DB.prepare(
      `INSERT INTO work_schedules (clinic_id, professional_id, unit_id, weekday, start_min, end_min, break_start_min, break_end_min)
       VALUES (?1,?2,?3,?4,480,1080,720,780)`
    ).bind(clinicId, professionalId, d.default_unit_id ?? null, weekday).run();
  }

  let userId: number | null = null;
  if (d.login_password) {
    if (!d.email) return err(c, "Para criar o acesso, informe o e-mail do dentista.", 422);
    const mail = d.email.toLowerCase();
    const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE email=?1`).bind(mail).first<{ id: number }>();
    if (existing) {
      const linked = await c.env.DB.prepare(`SELECT id FROM clinic_memberships WHERE clinic_id=?1 AND user_id=?2`).bind(clinicId, existing.id).first();
      if (linked) return err(c, "Este e-mail já está vinculado à clínica.", 409);
      userId = existing.id;
    } else {
      const hash = await hashPassword(d.login_password);
      const u = await c.env.DB.prepare(`INSERT INTO users (name, email, password_hash, must_change_password) VALUES (?1,?2,?3,1)`)
        .bind(d.name, mail, hash).run();
      userId = Number(u.meta?.last_row_id ?? 0);
    }
    await c.env.DB.prepare(
      `INSERT INTO clinic_memberships (clinic_id, user_id, role, professional_id, unit_id, can_view_records, active)
       VALUES (?1,?2,'dentist',?3,?4,1,1)`
    ).bind(clinicId, userId, professionalId, d.default_unit_id ?? null).run();
    await c.env.DB.prepare(`UPDATE professionals SET user_id=?2 WHERE id=?1`).bind(professionalId, userId).run();
  }

  await audit(c.env.DB, c.get("user"), "professional.created", "professional", professionalId, { name: d.name, cro: d.cro });
  return c.json({ ok: true, id: professionalId, user_id: userId }, 201);
});

adminRouter.put("/professionals/:id", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const id = Number(c.req.param("id"));
  const parsed = professionalSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados inválidos.", 422);
  const d = parsed.data;
  const sets: string[] = [];
  const binds: unknown[] = [id, clinicId];
  const push = (col: string, v: unknown) => { sets.push(`${col} = ?${binds.length + 1}`); binds.push(v); };
  if (d.name !== undefined) push("name", d.name);
  if (d.cro !== undefined) push("cro", d.cro);
  if (d.cro_uf !== undefined) push("cro_uf", d.cro_uf.toUpperCase());
  if (d.cpf !== undefined) push("cpf", d.cpf.replace(/\D/g, ""));
  if (d.email !== undefined) push("email", d.email.toLowerCase());
  if (d.phone !== undefined) push("phone", normalizePhone(d.phone));
  if (d.bio !== undefined) push("bio", d.bio);
  if (d.color !== undefined) push("color", d.color);
  if (d.default_unit_id !== undefined) push("default_unit_id", d.default_unit_id);
  if (d.slot_min !== undefined) push("slot_min", d.slot_min);
  if (d.show_in_booking !== undefined) push("show_in_booking", d.show_in_booking ? 1 : 0);
  if (d.active !== undefined) push("active", d.active ? 1 : 0);
  if (sets.length) {
    sets.push(`updated_at = ?${binds.length + 1}`);
    binds.push(nowIso());
    const res = await c.env.DB.prepare(`UPDATE professionals SET ${sets.join(", ")} WHERE id = ?1 AND clinic_id = ?2`).bind(...binds).run();
    if ((res.meta?.changes ?? 0) === 0) return err(c, "Profissional não encontrado.", 404);
  }
  if (d.specialty_ids) {
    await c.env.DB.prepare(`DELETE FROM professional_specialties WHERE professional_id = ?1`).bind(id).run();
    for (const sid of d.specialty_ids)
      await c.env.DB.prepare(`INSERT OR IGNORE INTO professional_specialties (professional_id, specialty_id) VALUES (?1,?2)`).bind(id, sid).run();
  }
  if (d.procedure_ids) {
    await c.env.DB.prepare(`DELETE FROM professional_procedures WHERE professional_id = ?1`).bind(id).run();
    for (const pid of d.procedure_ids)
      await c.env.DB.prepare(`INSERT OR IGNORE INTO professional_procedures (professional_id, procedure_id) VALUES (?1,?2)`).bind(id, pid).run();
  }
  await audit(c.env.DB, c.get("user"), "professional.updated", "professional", id, d);
  return c.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════
// ESCALAS INDIVIDUAIS
// ══════════════════════════════════════════════════════════════════════════
adminRouter.get("/professionals/:id/schedules", guard("staff"), async (c) => {
  const id = Number(c.req.param("id"));
  const rows = await c.env.DB.prepare(
    `SELECT id, weekday, start_min, end_min, break_start_min, break_end_min, unit_id, active
       FROM work_schedules WHERE clinic_id = ?1 AND professional_id = ?2 ORDER BY weekday, start_min`
  ).bind(cid(c), id).all<{ id: number; weekday: number; start_min: number; end_min: number; break_start_min: number | null; break_end_min: number | null; unit_id: number | null; active: number }>();
  const schedules = (rows.results ?? []).map((r) => ({
    ...r,
    start: formatHHMM(r.start_min),
    end: formatHHMM(r.end_min),
    break_start: r.break_start_min == null ? "" : formatHHMM(r.break_start_min),
    break_end: r.break_end_min == null ? "" : formatHHMM(r.break_end_min),
  }));
  const exceptions = await c.env.DB.prepare(
    `SELECT id, date, kind, start_min, end_min, reason, professional_id
       FROM schedule_exceptions
      WHERE clinic_id = ?1 AND (professional_id = ?2 OR professional_id IS NULL) AND date >= ?3
      ORDER BY date LIMIT 100`
  ).bind(cid(c), id, todayLocal(await clinicTz(c.env, cid(c)))).all<Record<string, unknown>>();
  return c.json({ schedules, exceptions: exceptions.results ?? [] });
});

const scheduleWeekSchema = z.object({
  days: z.array(z.object({
    weekday: z.number().int().min(0).max(6),
    active: z.boolean().default(true),
    start: hhmm,
    end: hhmm,
    break_start: hhmm.or(z.literal("")).default(""),
    break_end: hhmm.or(z.literal("")).default(""),
    unit_id: z.number().int().positive().nullable().optional(),
  })).max(21),
});

/** Substitui a semana inteira do profissional (transação lógica). */
adminRouter.put("/professionals/:id/schedules", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const professionalId = Number(c.req.param("id"));
  const parsed = scheduleWeekSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Escala inválida. Confira horários e intervalo.", 422, parsed.error.flatten().fieldErrors);
  const pro = await c.env.DB.prepare(`SELECT id FROM professionals WHERE id=?1 AND clinic_id=?2`).bind(professionalId, clinicId).first();
  if (!pro) return err(c, "Profissional não encontrado.", 404);

  for (const day of parsed.data.days) {
    const start = parseHHMM(day.start);
    const end = parseHHMM(day.end);
    const bs = day.break_start ? parseHHMM(day.break_start) : null;
    const be = day.break_end ? parseHHMM(day.break_end) : null;
    if (end <= start) return err(c, `Dia ${day.weekday}: horário final deve ser após o inicial.`, 422);
    if ((bs === null) !== (be === null)) return err(c, `Dia ${day.weekday}: informe início e fim do intervalo.`, 422);
    if (bs !== null && be !== null && (bs < start || be > end || be <= bs))
      return err(c, `Dia ${day.weekday}: intervalo de almoço deve estar dentro do expediente.`, 422);
  }

  await c.env.DB.prepare(`DELETE FROM work_schedules WHERE clinic_id=?1 AND professional_id=?2`).bind(clinicId, professionalId).run();
  for (const day of parsed.data.days) {
    if (!day.active) continue;
    await c.env.DB.prepare(
      `INSERT INTO work_schedules (clinic_id, professional_id, unit_id, weekday, start_min, end_min, break_start_min, break_end_min, active)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,1)`
    )
      .bind(clinicId, professionalId, day.unit_id ?? null, day.weekday, parseHHMM(day.start), parseHHMM(day.end),
        day.break_start ? parseHHMM(day.break_start) : null, day.break_end ? parseHHMM(day.break_end) : null)
      .run();
  }
  await audit(c.env.DB, c.get("user"), "schedule.updated", "professional", professionalId, { days: parsed.data.days.length });
  return c.json({ ok: true });
});

const exceptionSchema = z.object({
  professional_id: z.number().int().positive().nullable().optional(),
  unit_id: z.number().int().positive().nullable().optional(),
  date: isoDay,
  kind: z.enum(["vacation", "dayoff", "holiday", "absence", "block", "custom_hours"]),
  start: hhmm.or(z.literal("")).default(""),
  end: hhmm.or(z.literal("")).default(""),
  reason: z.string().max(200).default(""),
});

adminRouter.post("/schedule-exceptions", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const parsed = exceptionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados inválidos.", 422);
  const d = parsed.data;
  const needsRange = ["block", "custom_hours", "absence"].includes(d.kind);
  if (needsRange && (!d.start || !d.end))
    return err(c, "Para bloqueio/horário especial/ausência, informe início e fim (ou use folga/férias para o dia inteiro).", 422);
  const r = await c.env.DB.prepare(
    `INSERT INTO schedule_exceptions (clinic_id, professional_id, unit_id, date, kind, start_min, end_min, reason, created_by)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`
  )
    .bind(clinicId, d.professional_id ?? null, d.unit_id ?? null, d.date, d.kind,
      d.start ? parseHHMM(d.start) : null, d.end ? parseHHMM(d.end) : null, d.reason, c.get("user").id)
    .run();
  await audit(c.env.DB, c.get("user"), "schedule.exception_created", "professional", d.professional_id ?? 0, d);
  return c.json({ ok: true, id: Number(r.meta?.last_row_id ?? 0) }, 201);
});

adminRouter.delete("/schedule-exceptions/:id", guard("admin"), async (c) => {
  const id = Number(c.req.param("id"));
  const res = await c.env.DB.prepare(`DELETE FROM schedule_exceptions WHERE id=?1 AND clinic_id=?2`).bind(id, cid(c)).run();
  if ((res.meta?.changes ?? 0) === 0) return err(c, "Exceção não encontrada.", 404);
  return c.json({ ok: true });
});

/** Bloqueio pontual direto na agenda (sem paciente). */
adminRouter.post("/agenda-blocks", guard("staff"), async (c) => {
  const clinicId = cid(c);
  const schema = z.object({
    professional_id: z.number().int().positive().nullable().optional(),
    unit_id: z.number().int().positive().nullable().optional(),
    date: isoDay,
    start: hhmm,
    end: hhmm,
    reason: z.string().max(200).default(""),
  });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados do bloqueio inválidos.", 422);
  const tz = await clinicTz(c.env, clinicId);
  const { localToUtc } = await import("../lib/time");
  const startsAt = nowIso(localToUtc(tz, parsed.data.date, parseHHMM(parsed.data.start)));
  const endsAt = nowIso(localToUtc(tz, parsed.data.date, parseHHMM(parsed.data.end)));
  if (parseHHMM(parsed.data.end) <= parseHHMM(parsed.data.start)) return err(c, "Horário final inválido.", 422);
  const r = await c.env.DB.prepare(
    `INSERT INTO agenda_blocks (clinic_id, unit_id, professional_id, starts_at, ends_at, reason, created_by)
     VALUES (?1,?2,?3,?4,?5,?6,?7)`
  ).bind(clinicId, parsed.data.unit_id ?? null, parsed.data.professional_id ?? null, startsAt, endsAt, parsed.data.reason, c.get("user").id).run();
  await audit(c.env.DB, c.get("user"), "agenda.block_created", "agenda_block", Number(r.meta?.last_row_id ?? 0), parsed.data);
  return c.json({ ok: true, id: Number(r.meta?.last_row_id ?? 0) }, 201);
});

adminRouter.delete("/agenda-blocks/:id", guard("staff"), async (c) => {
  const res = await c.env.DB.prepare(`DELETE FROM agenda_blocks WHERE id=?1 AND clinic_id=?2`).bind(Number(c.req.param("id")), cid(c)).run();
  if ((res.meta?.changes ?? 0) === 0) return err(c, "Bloqueio não encontrado.", 404);
  return c.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════
// DISPONIBILIDADE (usada pela agenda e pelo agendamento público)
// ══════════════════════════════════════════════════════════════════════════
adminRouter.get("/availability", guard("staff"), async (c) => {
  const clinicId = cid(c);
  const tz = await clinicTz(c.env, clinicId);
  const professionalId = Number(c.req.query("professional_id"));
  const day = c.req.query("day") || todayLocal(tz);
  const procedureId = c.req.query("procedure_id") ? Number(c.req.query("procedure_id")) : null;
  if (!professionalId) return err(c, "Informe professional_id.", 422);
  const pro = await c.env.DB.prepare(`SELECT id, slot_min FROM professionals WHERE id=?1 AND clinic_id=?2 AND active=1`)
    .bind(professionalId, clinicId).first<{ id: number; slot_min: number }>();
  if (!pro) return err(c, "Profissional não encontrado.", 404);
  let duration = 30;
  if (procedureId) {
    const proc = await c.env.DB.prepare(`SELECT duration_min FROM procedures WHERE id=?1 AND clinic_id=?2`)
      .bind(procedureId, clinicId).first<{ duration_min: number }>();
    if (proc) duration = proc.duration_min;
  }
  const avail = await dayAvailability({
    db: c.env.DB, clinicId, timezone: tz, professionalId, day, durationMin: duration,
    slotMin: pro.slot_min, allowPast: true,
  });
  return c.json({ ...avail, duration_min: duration });
});

// ══════════════════════════════════════════════════════════════════════════
// PACIENTES
// ══════════════════════════════════════════════════════════════════════════
adminRouter.get("/patients", guard("staff"), async (c) => {
  const clinicId = cid(c);
  const q = c.req.query("q") || "";
  const limit = Math.min(Number(c.req.query("limit") || 20), 100);
  const { searchPatients } = await import("../lib/patients");
  const patients = await searchPatients(c.env.DB, clinicId, q, limit);
  return c.json({ patients });
});

adminRouter.post("/patients", guard("staff"), async (c) => {
  const clinicId = cid(c);
  const schema = z.object({
    name: z.string().min(3).max(160),
    birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    cpf: z.string().max(20).default(""),
    phone: z.string().max(30).default(""),
    email: z.string().max(200).default(""),
    address: z.string().max(300).default(""),
    city: z.string().max(120).default(""),
    state: z.string().max(2).default(""),
    zip: z.string().max(20).default(""),
    guardian_name: z.string().max(160).default(""),
    guardian_phone: z.string().max(30).default(""),
    notes: z.string().max(1000).default(""),
    whatsapp_optin: z.boolean().default(false),
    force_create: z.boolean().default(false),
  });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Confira os dados do paciente.", 422, parsed.error.flatten().fieldErrors);
  const { createPatient } = await import("../lib/patients");
  const result = await createPatient(c.env.DB, clinicId, parsed.data);
  if (!result.ok) return c.json({ error: result.message, duplicates: result.duplicates ?? [] }, result.duplicates?.length ? 409 : 422);
  await audit(c.env.DB, c.get("user"), "patient.created", "patient", result.id, { name: parsed.data.name });
  return c.json(result, 201);
});

adminRouter.get("/patients/:id", guard("staff"), async (c) => {
  const clinicId = cid(c);
  const id = Number(c.req.param("id"));
  const { getPatientOverview } = await import("../lib/patients");
  const overview = await getPatientOverview(c.env.DB, clinicId, id);
  if (!overview) return err(c, "Paciente não encontrado.", 404);
  const clinic = c.get("clinic");
  // Dados clínicos só para quem tem permissão de prontuário.
  const canSeeClinical = clinic.role === "clinic_admin" || clinic.role === "dentist" || clinic.can_view_records;
  return c.json({
    ...overview,
    can_see_clinical: canSeeClinical,
  });
});

adminRouter.put("/patients/:id", guard("staff"), async (c) => {
  const clinicId = cid(c);
  const id = Number(c.req.param("id"));
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return err(c, "Dados inválidos.", 422);
  const { updatePatient } = await import("../lib/patients");
  const result = await updatePatient(c.env.DB, clinicId, id, body as never);
  if (!result.ok) return err(c, result.message ?? "Não foi possível atualizar.", 422);
  await audit(c.env.DB, c.get("user"), "patient.updated", "patient", id, { fields: Object.keys(body) });
  return c.json({ ok: true });
});

adminRouter.post("/patients/:id/anonymize", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const id = Number(c.req.param("id"));
  const body = (await c.req.json().catch(() => null)) as { confirm?: string; reason?: string } | null;
  if (body?.confirm !== "ANONIMIZAR") return err(c, "Digite ANONIMIZAR para confirmar.", 422);
  const { anonymizePatient } = await import("../lib/patients");
  const result = await anonymizePatient(c.env.DB, clinicId, id);
  if (!result.ok) return err(c, result.message ?? "Não foi possível anonimizar.", 400);
  await audit(c.env.DB, c.get("user"), "patient.anonymized", "patient", id, { reason: body?.reason ?? "" });
  return c.json({ ok: true, message: "Dados pessoais anonimizados. Prontuário mantido conforme obrigação legal." });
});

// ══════════════════════════════════════════════════════════════════════════
// AGENDA / AGENDAMENTOS
// ══════════════════════════════════════════════════════════════════════════
adminRouter.get("/appointments", guard("staff"), async (c) => {
  const clinicId = cid(c);
  const tz = await clinicTz(c.env, clinicId);
  const clinic = c.get("clinic");
  const { listAppointments } = await import("../lib/appointments");
  const day = c.req.query("day") || "";
  const from = c.req.query("from") || "";
  const to = c.req.query("to") || "";
  const professionalId =
    clinic.role === "dentist" && clinic.professional_id
      ? clinic.professional_id
      : c.req.query("professional_id") ? Number(c.req.query("professional_id")) : undefined;
  const appointments = await listAppointments(c.env.DB, clinicId, {
    day: day || undefined,
    from: from || (day ? undefined : addDays(todayLocal(tz), -7)),
    to: to || (day ? undefined : addDays(todayLocal(tz), 30)),
    professionalId,
    unitId: c.req.query("unit_id") ? Number(c.req.query("unit_id")) : undefined,
    status: c.req.query("status") ? String(c.req.query("status")).split(",") : undefined,
    limit: Number(c.req.query("limit") || 300),
  });
  return c.json({ appointments, today: todayLocal(tz), timezone: tz });
});

const apptCreateSchema = z.object({
  patient_id: z.number().int().positive(),
  professional_id: z.number().int().positive(),
  procedure_id: z.number().int().positive().nullable().optional(),
  unit_id: z.number().int().positive().nullable().optional(),
  room_id: z.number().int().positive().nullable().optional(),
  day: isoDay,
  time: hhmm,
  duration_min: z.number().int().min(5).max(480).optional(),
  kind: z.enum(["consulta", "retorno", "procedimento", "avaliacao"]).default("consulta"),
  patient_notes: z.string().max(500).default(""),
  internal_notes: z.string().max(1000).default(""),
  /** Encaixe: exige motivo e papel autorizado. */
  is_fit_in: z.boolean().default(false),
  fit_in_reason: z.string().max(300).default(""),
  confirm_now: z.boolean().default(false),
});

adminRouter.post("/appointments", guard("staff"), async (c) => {
  const clinicId = cid(c);
  const tz = await clinicTz(c.env, clinicId);
  const settings = ctxSettings(c);
  const clinic = c.get("clinic");
  const parsed = apptCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Confira os dados do agendamento.", 422, parsed.error.flatten().fieldErrors);
  const d = parsed.data;

  if (clinic.role === "dentist" && clinic.professional_id !== d.professional_id)
    return err(c, "Você só pode agendar na sua própria agenda.", 403);

  if (d.is_fit_in) {
    if (!settings.scheduling.allow_fit_in) return err(c, "Encaixes estão desativados nas configurações.", 403);
    if (!settings.scheduling.fit_in_roles.includes(clinic.role as never))
      return err(c, "Seu perfil não pode autorizar encaixes.", 403);
    if (!d.fit_in_reason.trim()) return err(c, "Informe o motivo do encaixe (fica registrado na auditoria).", 422);
  }

  const pro = await c.env.DB.prepare(`SELECT id FROM professionals WHERE id=?1 AND clinic_id=?2 AND active=1`)
    .bind(d.professional_id, clinicId).first();
  if (!pro) return err(c, "Profissional não encontrado.", 404);
  const patient = await c.env.DB.prepare(`SELECT id FROM patients WHERE id=?1 AND clinic_id=?2 AND active=1 AND anonymized_at IS NULL`)
    .bind(d.patient_id, clinicId).first();
  if (!patient) return err(c, "Paciente não encontrado.", 404);

  let duration = d.duration_min;
  let priceCents = 0;
  if (d.procedure_id) {
    const proc = await c.env.DB.prepare(`SELECT duration_min, price_cents, requires_room FROM procedures WHERE id=?1 AND clinic_id=?2 AND active=1`)
      .bind(d.procedure_id, clinicId).first<{ duration_min: number; price_cents: number; requires_room: number }>();
    if (proc) {
      duration = duration ?? proc.duration_min;
      priceCents = proc.price_cents;
    }
  }
  duration = duration ?? settings.scheduling.slot_min;

  const { slotToInstants, createAppointmentGuarded } = await import("../lib/scheduling");
  const instants = slotToInstants(tz, d.day, d.time, duration);
  if (!instants) return err(c, "Horário inválido para a duração do procedimento.", 422);

  const created = await createAppointmentGuarded({
    db: c.env.DB,
    clinicId,
    timezone: tz,
    professionalId: d.professional_id,
    patientId: d.patient_id,
    procedureId: d.procedure_id ?? null,
    unitId: d.unit_id ?? null,
    roomId: d.room_id ?? null,
    startsAt: instants.startsAt,
    endsAt: instants.endsAt,
    kind: d.kind,
    source: d.is_fit_in ? "fit_in" : "reception",
    isFitIn: d.is_fit_in,
    fitInReason: d.fit_in_reason,
    fitInAuthorizedBy: d.is_fit_in ? c.get("user").id : null,
    patientNotes: d.patient_notes,
    internalNotes: d.internal_notes,
    priceCents,
    createdBy: c.get("user").id,
    status: d.confirm_now ? "confirmado" : "agendado",
    confirmedVia: d.confirm_now ? "panel" : "",
  });
  if (!created.ok) return err(c, created.detail, 409, { conflict: created.conflict });

  const { scheduleAppointmentReminders } = await import("../lib/messaging/jobs");
  const reminders = await scheduleAppointmentReminders(c.env, clinicId, created.id);
  await audit(c.env.DB, c.get("user"), d.is_fit_in ? "appointment.fit_in_created" : "appointment.created", "appointment", created.id, {
    day: d.day, time: d.time, professional_id: d.professional_id, fit_in_reason: d.fit_in_reason || undefined,
  });
  return c.json({ ok: true, id: created.id, code: created.code, reminders }, 201);
});

adminRouter.post("/appointments/:id/confirm", guard("staff"), async (c) => {
  const { confirmAppointment, getAppointment } = await import("../lib/appointments");
  const id = Number(c.req.param("id"));
  const user = c.get("user");
  const result = await confirmAppointment(c.env.DB, cid(c), id, "panel", { id: user.id, name: user.name, kind: "staff" });
  if (!result.ok) return err(c, result.message, result.code === "not_found" ? 404 : 409);
  await audit(c.env.DB, user, "appointment.confirmed", "appointment", id, { via: "panel" });
  const appt = await getAppointment(c.env.DB, cid(c), id);
  return c.json({ ok: true, appointment: appt });
});

adminRouter.post("/appointments/:id/checkin", guard("staff"), async (c) => {
  const { checkinAppointment } = await import("../lib/appointments");
  const id = Number(c.req.param("id"));
  const user = c.get("user");
  const result = await checkinAppointment(c.env.DB, cid(c), id, { id: user.id, name: user.name });
  if (!result.ok) return err(c, result.message, result.code === "not_found" ? 404 : 409);
  await audit(c.env.DB, user, "appointment.checkin", "appointment", id, {});
  return c.json({ ok: true, appointment: result.appointment });
});

adminRouter.post("/appointments/:id/start", guard("staff"), async (c) => {
  const { startAppointment } = await import("../lib/appointments");
  const id = Number(c.req.param("id"));
  const user = c.get("user");
  const result = await startAppointment(c.env.DB, cid(c), id, { id: user.id, name: user.name });
  if (!result.ok) return err(c, result.message, result.code === "not_found" ? 404 : 409);
  await audit(c.env.DB, user, "appointment.started", "appointment", id, {});
  return c.json({ ok: true, appointment: result.appointment });
});

adminRouter.post("/appointments/:id/no-show", guard("staff"), async (c) => {
  const { markNoShow } = await import("../lib/appointments");
  const id = Number(c.req.param("id"));
  const user = c.get("user");
  const result = await markNoShow(c.env.DB, cid(c), id, { id: user.id, name: user.name });
  if (!result.ok) return err(c, result.message, result.code === "not_found" ? 404 : 409);
  await audit(c.env.DB, user, "appointment.no_show", "appointment", id, {});
  return c.json({ ok: true, appointment: result.appointment });
});

adminRouter.post("/appointments/:id/cancel", guard("staff"), async (c) => {
  const body = (await c.req.json().catch(() => null)) as { reason_code?: string; reason?: string } | null;
  const { cancelAppointment } = await import("../lib/appointments");
  const { cancelAppointmentJobs } = await import("../lib/messaging/jobs");
  const { invalidateAppointmentTokens } = await import("../lib/tokens");
  const id = Number(c.req.param("id"));
  const user = c.get("user");
  const result = await cancelAppointment(c.env.DB, cid(c), id, body?.reason_code ?? "equipe", body?.reason ?? "", {
    id: user.id, name: user.name, kind: "staff",
  });
  if (!result.ok) return err(c, result.message, result.code === "not_found" ? 404 : 409);
  await cancelAppointmentJobs(c.env.DB, id, "consulta cancelada");
  await invalidateAppointmentTokens(c.env.DB, id);
  await audit(c.env.DB, user, "appointment.cancelled", "appointment", id, { reason: body?.reason ?? "" });
  return c.json({ ok: true, appointment: result.appointment });
});

const rescheduleSchema = z.object({
  day: isoDay,
  time: hhmm,
  reason: z.string().max(300).default(""),
  send_message: z.boolean().default(true),
});

adminRouter.post("/appointments/:id/reschedule", guard("staff"), async (c) => {
  const clinicId = cid(c);
  const tz = await clinicTz(c.env, clinicId);
  const settings = ctxSettings(c);
  const parsed = rescheduleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Informe nova data e horário.", 422);
  const id = Number(c.req.param("id"));
  const user = c.get("user");
  const { rescheduleAppointment } = await import("../lib/appointments");
  const { cancelAppointmentJobs, scheduleAppointmentReminders, enqueueConfirmationMessage } = await import("../lib/messaging/jobs");
  const { createActionToken, invalidateAppointmentTokens } = await import("../lib/tokens");

  const appt = await c.env.DB.prepare(
    `SELECT a.id, p.duration_min, a.procedure_id FROM appointments a
       LEFT JOIN procedures p ON p.id = a.procedure_id WHERE a.id=?1 AND a.clinic_id=?2`
  ).bind(id, clinicId).first<{ id: number; duration_min: number | null; procedure_id: number | null }>();
  if (!appt) return err(c, "Agendamento não encontrado.", 404);

  const result = await rescheduleAppointment({
    db: c.env.DB, clinicId, timezone: tz, appointmentId: id,
    day: parsed.data.day, time: parsed.data.time,
    durationMin: appt.duration_min ?? settings.scheduling.slot_min,
    actor: { id: user.id, name: user.name, kind: "staff" },
    reason: parsed.data.reason, source: "reception",
    settingsSlotMin: settings.scheduling.slot_min,
  });
  if (!result.ok) return err(c, result.message, 409);

  await cancelAppointmentJobs(c.env.DB, id, "reagendado");
  await invalidateAppointmentTokens(c.env.DB, id);
  await scheduleAppointmentReminders(c.env, clinicId, result.appointment.id);
  if (parsed.data.send_message) {
    const confirm = await createActionToken(c.env.DB, { clinicId, appointmentId: result.appointment.id, patientId: result.appointment.patient_id, purpose: "confirmar" });
    const resched = await createActionToken(c.env.DB, { clinicId, appointmentId: result.appointment.id, patientId: result.appointment.patient_id, purpose: "reagendar" });
    await enqueueConfirmationMessage(c.env, clinicId, result.appointment.id, "reagendamento", {
      confirmToken: confirm.token, rescheduleToken: resched.token,
    });
  }
  await audit(c.env.DB, user, "appointment.rescheduled", "appointment", id, { new_id: result.appointment.id, day: parsed.data.day, time: parsed.data.time });
  return c.json({ ok: true, appointment: result.appointment, previous_id: result.oldId });
});

const finishSchema = z.object({
  followup_choice: z.enum(["scheduled", "later", "none"]).default("none"),
  return_day: isoDay.optional(),
  return_time: hhmm.optional(),
  return_procedure_id: z.number().int().positive().nullable().optional(),
  payment: z
    .object({
      amount_cents: z.number().int().min(0).nullable().optional(),
      method: z.enum(["pix", "dinheiro", "cartao_credito", "cartao_debito", "transferencia", "pendente", "outro", "nao_informado"]).default("nao_informado"),
      note: z.string().max(300).default(""),
    })
    .nullable()
    .optional(),
});

/** FINALIZAR ATENDIMENTO — nenhum campo financeiro é obrigatório. */
adminRouter.post("/appointments/:id/finish", guard("staff"), async (c) => {
  const clinicId = cid(c);
  const tz = await clinicTz(c.env, clinicId);
  const settings = ctxSettings(c);
  const parsed = finishSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados de finalização inválidos.", 422, parsed.error.flatten().fieldErrors);
  const id = Number(c.req.param("id"));
  const user = c.get("user");
  const clinic = c.get("clinic");
  if (clinic.role === "dentist" && settings.clinical.require_record_on_finish) {
    // O dentista precisa ter registro clínico do atendimento.
  }
  const d = parsed.data;
  if (d.followup_choice === "scheduled" && (!d.return_day || !d.return_time))
    return err(c, "Informe data e horário do retorno.", 422);

  const { finalizeAppointment } = await import("../lib/appointments");
  const appt = await c.env.DB.prepare(
    `SELECT p.duration_min FROM appointments a LEFT JOIN procedures p ON p.id=a.procedure_id WHERE a.id=?1 AND a.clinic_id=?2`
  ).bind(id, clinicId).first<{ duration_min: number | null }>();

  const result = await finalizeAppointment({
    db: c.env.DB, clinicId, appointmentId: id,
    actor: { id: user.id, name: user.name },
    followupChoice: d.followup_choice,
    requireRecord: settings.clinical.require_record_on_finish,
    payment: d.payment ?? null,
    timezone: tz,
    returnAppointment: d.followup_choice === "scheduled" && d.return_day && d.return_time
      ? { day: d.return_day, time: d.return_time, durationMin: appt?.duration_min ?? settings.scheduling.slot_min, procedureId: d.return_procedure_id ?? null }
      : null,
  });
  if (!result.ok) {
    return c.json({ error: result.message, needs_record: result.needsRecord ?? false }, result.needsRecord ? 422 : 409);
  }
  const { cancelAppointmentJobs, scheduleAppointmentReminders } = await import("../lib/messaging/jobs");
  await cancelAppointmentJobs(c.env.DB, id, "atendimento concluído");
  if (result.returnAppointmentId) await scheduleAppointmentReminders(c.env, clinicId, result.returnAppointmentId);
  await audit(c.env.DB, user, "appointment.finished", "appointment", id, {
    followup: d.followup_choice, return_id: result.returnAppointmentId ?? null,
    payment_method: d.payment?.method ?? null,
  });
  return c.json({
    ok: true,
    appointment: result.appointment,
    return_appointment_id: result.returnAppointmentId ?? null,
    message: d.followup_choice === "later"
      ? "Atendimento finalizado. O paciente poderá escolher a data do retorno pelo portal."
      : "Atendimento finalizado.",
  });
});

// ── Lista de espera ───────────────────────────────────────────────────────
adminRouter.get("/waitlist", guard("staff"), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT w.id, w.desired_from, w.desired_to, w.preferred_period, w.notes, w.status, w.created_at,
            p.id AS patient_id, p.name AS patient_name, p.phone,
            pr.name AS professional_name, proc.name AS procedure_name
       FROM waitlist_entries w
       JOIN patients p ON p.id = w.patient_id
       LEFT JOIN professionals pr ON pr.id = w.professional_id
       LEFT JOIN procedures proc ON proc.id = w.procedure_id
      WHERE w.clinic_id = ?1 AND w.status IN ('aguardando','contatado')
      ORDER BY w.desired_from, w.created_at LIMIT 200`
  ).bind(cid(c)).all<Record<string, unknown>>();
  return c.json({ entries: rows.results ?? [] });
});

adminRouter.post("/waitlist", guard("staff"), async (c) => {
  const schema = z.object({
    patient_id: z.number().int().positive(),
    professional_id: z.number().int().positive().nullable().optional(),
    procedure_id: z.number().int().positive().nullable().optional(),
    desired_from: isoDay,
    desired_to: isoDay.nullable().optional(),
    preferred_period: z.enum(["any", "morning", "afternoon", "evening"]).default("any"),
    notes: z.string().max(500).default(""),
  });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados inválidos.", 422);
  const d = parsed.data;
  const r = await c.env.DB.prepare(
    `INSERT INTO waitlist_entries (clinic_id, patient_id, professional_id, procedure_id, desired_from, desired_to,
        preferred_period, notes, created_by)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`
  ).bind(cid(c), d.patient_id, d.professional_id ?? null, d.procedure_id ?? null, d.desired_from,
    d.desired_to ?? null, d.preferred_period, d.notes, c.get("user").id).run();
  return c.json({ ok: true, id: Number(r.meta?.last_row_id ?? 0) }, 201);
});

adminRouter.post("/waitlist/:id/status", guard("staff"), async (c) => {
  const body = (await c.req.json().catch(() => null)) as { status?: string } | null;
  const allowed = ["aguardando", "contatado", "agendado", "cancelado"];
  if (!body?.status || !allowed.includes(body.status)) return err(c, "Status inválido.", 422);
  const res = await c.env.DB.prepare(`UPDATE waitlist_entries SET status=?2, updated_at=?3 WHERE id=?1 AND clinic_id=?4`)
    .bind(Number(c.req.param("id")), body.status, nowIso(), cid(c)).run();
  if ((res.meta?.changes ?? 0) === 0) return err(c, "Registro não encontrado.", 404);
  return c.json({ ok: true });
});

// ══════════════════════════════════════════════════════════════════════════
// PAINEL / RELATÓRIOS
// ══════════════════════════════════════════════════════════════════════════
adminRouter.get("/dashboard", guard("staff"), async (c) => {
  const clinicId = cid(c);
  const tz = await clinicTz(c.env, clinicId);
  const today = todayLocal(tz);
  const clinic = c.get("clinic");
  const professionalFilter = clinic.role === "dentist" ? clinic.professional_id : null;

  const [todayStats, upcoming, pendingConfirm] = await Promise.all([
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status='concluido' THEN 1 ELSE 0 END) AS concluidos,
              SUM(CASE WHEN status='confirmado' THEN 1 ELSE 0 END) AS confirmados,
              SUM(CASE WHEN status IN ('agendado','aguardando_confirmacao') THEN 1 ELSE 0 END) AS pendentes,
              SUM(CASE WHEN status='chegou' THEN 1 ELSE 0 END) AS na_recepcao,
              SUM(CASE WHEN status='em_atendimento' THEN 1 ELSE 0 END) AS em_atendimento,
              SUM(CASE WHEN status='nao_compareceu' THEN 1 ELSE 0 END) AS faltas
         FROM appointments WHERE clinic_id=?1 AND local_day=?2 ${professionalFilter ? "AND professional_id=?3" : ""}`
    )
      .bind(...(professionalFilter ? [clinicId, today, professionalFilter] : [clinicId, today]))
      .first<Record<string, number>>(),
    c.env.DB.prepare(
      `SELECT a.id, a.code, a.starts_at, a.status, a.kind, pa.name AS patient_name, pa.phone,
              pr.name AS professional_name, proc.name AS procedure_name
         FROM appointments a
         JOIN patients pa ON pa.id = a.patient_id
         JOIN professionals pr ON pr.id = a.professional_id
         LEFT JOIN procedures proc ON proc.id = a.procedure_id
        WHERE a.clinic_id=?1 AND a.local_day>=?2 AND a.status IN ('agendado','aguardando_confirmacao','confirmado','chegou','em_atendimento')
          ${professionalFilter ? "AND a.professional_id=?3" : ""}
        ORDER BY a.starts_at LIMIT 12`
    )
      .bind(...(professionalFilter ? [clinicId, today, professionalFilter] : [clinicId, today]))
      .all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM appointments
        WHERE clinic_id=?1 AND status IN ('agendado','aguardando_confirmacao') AND local_day>=?2`
    ).bind(clinicId, today).first<{ n: number }>(),
  ]);

  return c.json({
    today,
    timezone: tz,
    stats: todayStats ?? {},
    next: upcoming.results ?? [],
    pending_confirmation: pendingConfirm?.n ?? 0,
  });
});

adminRouter.get("/reports/summary", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const tz = await clinicTz(c.env, clinicId);
  const from = c.req.query("from") || addDays(todayLocal(tz), -6);
  const to = c.req.query("to") || todayLocal(tz);
  const filters = {
    from, to,
    unitId: c.req.query("unit_id") ? Number(c.req.query("unit_id")) : null,
    professionalId: c.req.query("professional_id") ? Number(c.req.query("professional_id")) : null,
  };
  const [summary, pros, days, awaiting] = await Promise.all([
    operationalSummary(c.env.DB, clinicId, filters),
    byProfessional(c.env.DB, clinicId, filters),
    byDay(c.env.DB, clinicId, filters),
    awaitingReturn(c.env.DB, clinicId, 30),
  ]);
  return c.json({ range: { from, to }, summary, by_professional: pros, by_day: days, awaiting_return: awaiting });
});

adminRouter.get("/reports/whatsapp", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const rows = await whatsappHistory(c.env.DB, clinicId, Number(c.req.query("limit") || 100));
  const stats = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status='enviado' THEN 1 ELSE 0 END) AS enviados,
            SUM(CASE WHEN status='falhou' THEN 1 ELSE 0 END) AS falhas,
            SUM(CASE WHEN status='pendente' THEN 1 ELSE 0 END) AS pendentes,
            SUM(CASE WHEN status='cancelado' THEN 1 ELSE 0 END) AS cancelados
       FROM message_jobs WHERE clinic_id=?1`
  ).bind(clinicId).first<Record<string, number>>();
  const confirmations = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM appointments WHERE clinic_id=?1 AND confirmed_via='whatsapp'`
  ).bind(clinicId).first<{ n: number }>();
  return c.json({ messages: rows, stats: stats ?? {}, whatsapp_confirmations: confirmations?.n ?? 0 });
});

adminRouter.get("/audit", guard("admin"), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, user_name, action, entity, entity_id, meta, created_at FROM audit_log
      WHERE clinic_id=?1 ORDER BY id DESC LIMIT 200`
  ).bind(cid(c)).all<Record<string, unknown>>();
  return c.json({ entries: rows.results ?? [] });
});

// ══════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÕES DA CLÍNICA
// ══════════════════════════════════════════════════════════════════════════
adminRouter.get("/settings", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const clinic = await c.env.DB.prepare(
    `SELECT id, slug, name, legal_name, cnpj, email, phone, whatsapp, logo_url, timezone, status, plan_code, trial_ends_at FROM clinics WHERE id=?1`
  ).bind(clinicId).first<Record<string, unknown>>();
  return c.json({ clinic, settings: ctxSettings(c) });
});

adminRouter.put("/clinic", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const schema = z.object({
    name: z.string().min(3).max(120).optional(),
    legal_name: z.string().max(160).optional(),
    cnpj: z.string().max(20).optional(),
    email: z.string().max(200).optional(),
    phone: z.string().max(40).optional(),
    whatsapp: z.string().max(40).optional(),
    logo_url: z.string().max(500).optional(),
    timezone: z.string().max(60).optional(),
  });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados inválidos.", 422);
  const d = parsed.data;
  const sets: string[] = [];
  const binds: unknown[] = [clinicId];
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    sets.push(`${k} = ?${binds.length + 1}`);
    binds.push(k === "cnpj" ? String(v).replace(/\D/g, "") : v);
  }
  if (!sets.length) return err(c, "Nada para atualizar.", 422);
  sets.push(`updated_at = ?${binds.length + 1}`);
  binds.push(nowIso());
  await c.env.DB.prepare(`UPDATE clinics SET ${sets.join(", ")} WHERE id = ?1`).bind(...binds).run();
  await audit(c.env.DB, c.get("user"), "clinic.updated", "clinic", clinicId, d);
  return c.json({ ok: true });
});

adminRouter.put("/settings", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const raw = await c.req.json().catch(() => null);
  const merged = clinicSettingsSchema.safeParse({ ...ctxSettings(c), ...(raw as object) });
  if (!merged.success) return err(c, "Configuração inválida.", 422, merged.error.flatten().fieldErrors);
  await saveClinicSettings(c.env.DB, clinicId, merged.data);
  await audit(c.env.DB, c.get("user"), "clinic.settings_updated", "clinic", clinicId, {});
  return c.json({ ok: true, settings: merged.data });
});

// ══════════════════════════════════════════════════════════════════════════
// WHATSAPP E LEMBRETES
// ══════════════════════════════════════════════════════════════════════════
adminRouter.get("/whatsapp", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const row = await c.env.DB.prepare(
    `SELECT enabled, provider, waba_id, phone_number_id, display_phone, reminder_offsets_min,
            send_window_start, send_window_end, max_per_day, require_optin, last_error, last_checked_at, updated_at,
            CASE WHEN access_token_enc = '' THEN 0 ELSE 1 END AS has_token
       FROM whatsapp_settings WHERE clinic_id = ?1`
  ).bind(clinicId).first<Record<string, unknown>>();
  const templates = await c.env.DB.prepare(
    `SELECT id, code, name, body, language, provider_template_name, provider_status, active FROM message_templates WHERE clinic_id=?1`
  ).bind(clinicId).all<Record<string, unknown>>();
  const plan = c.get("clinic").plan;
  return c.json({
    settings: row ?? null,
    templates: templates.results ?? [],
    plan: { whatsapp_enabled: plan.whatsapp_enabled, max_messages_month: plan.max_messages_month },
    platform_configured: Boolean(c.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
  });
});

const waSchema = z.object({
  enabled: z.boolean().optional(),
  phone_number_id: z.string().max(60).optional(),
  waba_id: z.string().max(60).optional(),
  display_phone: z.string().max(40).optional(),
  access_token: z.string().max(2000).optional(),
  reminder_offsets_min: z.array(z.number().int().min(5).max(20160)).max(5).optional(),
  send_window_start: hhmm.optional(),
  send_window_end: hhmm.optional(),
  max_per_day: z.number().int().min(1).max(10000).optional(),
  require_optin: z.boolean().optional(),
});

adminRouter.put("/whatsapp", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const plan = c.get("clinic").plan;
  if (plan.whatsapp_enabled !== 1) return err(c, "Seu plano não inclui integração com WhatsApp.", 402);
  const parsed = waSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados inválidos.", 422, parsed.error.flatten().fieldErrors);
  const d = parsed.data;

  const { encryptSecret } = await import("../lib/crypto");
  const tokenEnc = d.access_token ? await encryptSecret(c.env, d.access_token) : null;

  const existing = await c.env.DB.prepare(`SELECT clinic_id FROM whatsapp_settings WHERE clinic_id=?1`).bind(clinicId).first();
  if (!existing) {
    await c.env.DB.prepare(
      `INSERT INTO whatsapp_settings (clinic_id, enabled, provider, waba_id, phone_number_id, display_phone,
          access_token_enc, reminder_offsets_min, send_window_start, send_window_end, max_per_day, require_optin, updated_by)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`
    )
      .bind(
        clinicId, d.enabled ? 1 : 0, c.env.WHATSAPP_MOCK === "1" && c.env.APP_ENV !== "production" ? "mock" : "meta_cloud",
        d.waba_id ?? "", d.phone_number_id ?? "", d.display_phone ?? "", tokenEnc ?? "",
        JSON.stringify(d.reminder_offsets_min ?? [1440, 300]), d.send_window_start ?? "08:00",
        d.send_window_end ?? "20:00", d.max_per_day ?? 400, d.require_optin === false ? 0 : 1, c.get("user").id
      )
      .run();
  } else {
    const sets: string[] = [];
    const binds: unknown[] = [clinicId];
    const push = (col: string, v: unknown) => { sets.push(`${col} = ?${binds.length + 1}`); binds.push(v); };
    if (d.enabled !== undefined) push("enabled", d.enabled ? 1 : 0);
    if (d.phone_number_id !== undefined) push("phone_number_id", d.phone_number_id);
    if (d.waba_id !== undefined) push("waba_id", d.waba_id);
    if (d.display_phone !== undefined) push("display_phone", d.display_phone);
    if (tokenEnc !== null) push("access_token_enc", tokenEnc);
    if (d.reminder_offsets_min !== undefined) push("reminder_offsets_min", JSON.stringify(d.reminder_offsets_min));
    if (d.send_window_start !== undefined) push("send_window_start", d.send_window_start);
    if (d.send_window_end !== undefined) push("send_window_end", d.send_window_end);
    if (d.max_per_day !== undefined) push("max_per_day", d.max_per_day);
    if (d.require_optin !== undefined) push("require_optin", d.require_optin ? 1 : 0);
    push("updated_by", c.get("user").id);
    sets.push(`updated_at = ?${binds.length + 1}`);
    binds.push(nowIso());
    await c.env.DB.prepare(`UPDATE whatsapp_settings SET ${sets.join(", ")} WHERE clinic_id = ?1`).bind(...binds).run();
  }
  await audit(c.env.DB, c.get("user"), "whatsapp.updated", "whatsapp_settings", clinicId, {
    enabled: d.enabled, offsets: d.reminder_offsets_min, token_changed: tokenEnc !== null,
  });
  return c.json({ ok: true });
});

adminRouter.post("/whatsapp/test", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const body = (await c.req.json().catch(() => null)) as { to?: string } | null;
  const to = normalizePhone(body?.to ?? "");
  if (to.length < 10) return err(c, "Informe um WhatsApp válido para o teste.", 422);
  const { loadWhatsAppRow } = await import("../lib/messaging/jobs");
  const row = await loadWhatsAppRow(c.env.DB, clinicId);
  if (!row || row.enabled !== 1) return err(c, "Ative a integração antes de testar.", 409);
  const { loadWhatsAppConfig, sendWhatsApp } = await import("../lib/messaging/provider");
  const config = await loadWhatsAppConfig(c.env, row);
  if (!config) return err(c, "Credenciais incompletas ou token ilegível. Salve novamente o token.", 409);
  const result = await sendWhatsApp(c.env, config, {
    to,
    body: `Teste CR ODONTO: a integração de WhatsApp deste consultório está ativa. 🦷`,
  });
  await c.env.DB.prepare(`UPDATE whatsapp_settings SET last_error=?2, last_checked_at=?3 WHERE clinic_id=?1`)
    .bind(clinicId, result.ok ? "" : (result.error ?? "").slice(0, 300), nowIso()).run();
  await audit(c.env.DB, c.get("user"), "whatsapp.tested", "whatsapp_settings", clinicId, { ok: result.ok, outcome: result.outcome });
  return c.json({ ok: result.ok, outcome: result.outcome, error: result.error ?? null });
});

adminRouter.put("/whatsapp/templates/:code", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const code = c.req.param("code");
  const allowed = ["lembrete", "confirmacao", "reagendamento", "conclusao", "retorno", "boas_vindas"];
  if (!allowed.includes(code)) return err(c, "Modelo desconhecido.", 422);
  const schema = z.object({
    body: z.string().min(10).max(1500),
    provider_template_name: z.string().max(120).default(""),
    provider_status: z.enum(["nao_enviado", "pendente", "aprovado", "rejeitado"]).default("nao_enviado"),
    active: z.boolean().default(true),
  });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Modelo inválido.", 422);
  await c.env.DB.prepare(
    `INSERT INTO message_templates (clinic_id, code, name, body, provider_template_name, provider_status, active, updated_by, updated_at)
     VALUES (?1,?2,?2,?3,?4,?5,?6,?7,?8)
     ON CONFLICT(clinic_id, code) DO UPDATE SET body=?3, provider_template_name=?4, provider_status=?5,
       active=?6, updated_by=?7, updated_at=?8`
  )
    .bind(clinicId, code, parsed.data.body, parsed.data.provider_template_name, parsed.data.provider_status,
      parsed.data.active ? 1 : 0, c.get("user").id, nowIso())
    .run();
  await audit(c.env.DB, c.get("user"), "whatsapp.template_updated", "message_template", code, {});
  return c.json({ ok: true });
});

adminRouter.post("/whatsapp/run-now", guard("admin"), async (c) => {
  const { processDueJobs } = await import("../lib/messaging/jobs");
  const result = await processDueJobs(c.env, { limit: 20, clinicId: cid(c) });
  return c.json({ ok: true, ...result });
});

// ── Fila de mensagens da clínica ──────────────────────────────────────────
adminRouter.get("/messages", guard("admin"), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT j.id, j.kind, j.status, j.scheduled_at, j.sent_at, j.attempts, j.last_error,
            p.name AS patient_name, a.code AS appointment_code
       FROM message_jobs j
       LEFT JOIN patients p ON p.id = j.patient_id
       LEFT JOIN appointments a ON a.id = j.appointment_id
      WHERE j.clinic_id = ?1 ORDER BY j.created_at DESC LIMIT 200`
  ).bind(cid(c)).all<Record<string, unknown>>();
  return c.json({ messages: rows.results ?? [] });
});

// ══════════════════════════════════════════════════════════════════════════
// EQUIPE — usuários com acesso ao painel da clínica
// ══════════════════════════════════════════════════════════════════════════
adminRouter.get("/members", guard("admin"), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT m.id, m.user_id, m.role, m.can_view_records, m.active, m.professional_id, m.created_at,
            u.name, u.email, u.must_change_password, u.last_login_at,
            pr.name AS professional_name, pr.cro, pr.cro_uf,
            un.name AS unit_name
       FROM clinic_memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN professionals pr ON pr.id = m.professional_id
       LEFT JOIN units un ON un.id = m.unit_id
      WHERE m.clinic_id = ?1
      ORDER BY m.active DESC, CASE m.role WHEN 'clinic_admin' THEN 0 WHEN 'dentist' THEN 1 ELSE 2 END, u.name`
  ).bind(cid(c)).all<Record<string, unknown>>();

  const sub = await subscriptionState(c.env.DB, cid(c));
  const staff = await withinLimits(c.env.DB, cid(c), sub?.plan ?? null, "staff");
  const dentists = await withinLimits(c.env.DB, cid(c), sub?.plan ?? null, "dentist");
  return c.json({
    members: rows.results ?? [],
    limits: {
      staff: { limit: staff.limit, used: staff.used },
      dentists: { limit: dentists.limit, used: dentists.used },
      can_view_records_allowed: sub?.plan?.clinical_enabled !== 0,
    },
  });
});

const memberSchema = z.object({
  name: z.string().min(3).max(120),
  email: z.string().email().max(200),
  password: z.string().min(10).max(200),
  role: z.enum(["clinic_admin", "receptionist"]),
  can_view_records: z.boolean().default(false),
  professional_id: z.number().int().positive().nullable().optional(),
});

adminRouter.post("/members", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const parsed = memberSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados inválidos (senha mínima de 10 caracteres).", 422, parsed.error.flatten().fieldErrors);
  const d = parsed.data;

  const sub = await subscriptionState(c.env.DB, clinicId);
  const limits = await withinLimits(c.env.DB, clinicId, sub?.plan ?? null, "staff");
  if (!limits.ok) return err(c, `Seu plano permite ${limits.limit} usuário(s) de apoio e já existem ${limits.used}.`, 402);

  if (d.professional_id) {
    const pro = await c.env.DB.prepare(`SELECT id FROM professionals WHERE id=?1 AND clinic_id=?2`)
      .bind(d.professional_id, clinicId).first();
    if (!pro) return err(c, "Profissional não encontrado.", 404);
  }

  const email = d.email.toLowerCase();
  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE email=?1`).bind(email).first<{ id: number }>();
  let userId = existing?.id ?? 0;
  if (userId) {
    const linked = await c.env.DB.prepare(`SELECT id FROM clinic_memberships WHERE clinic_id=?1 AND user_id=?2`).bind(clinicId, userId).first();
    if (linked) return err(c, "Este e-mail já está vinculado à clínica.", 409);
  } else {
    const hash = await hashPassword(d.password);
    const r = await c.env.DB.prepare(`INSERT INTO users (name, email, password_hash, must_change_password) VALUES (?1,?2,?3,1)`)
      .bind(d.name, email, hash).run();
    userId = Number(r.meta?.last_row_id ?? 0);
  }

  await c.env.DB.prepare(
    `INSERT INTO clinic_memberships (clinic_id, user_id, role, professional_id, can_view_records, active)
     VALUES (?1,?2,?3,?4,?5,1)`
  ).bind(clinicId, userId, d.role, d.professional_id ?? null, d.role === "clinic_admin" ? 1 : (d.can_view_records ? 1 : 0)).run();

  await audit(c.env.DB, c.get("user"), "member.created", "user", userId, { role: d.role, email });
  return c.json({ ok: true, user_id: userId }, 201);
});

adminRouter.put("/members/:id", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const id = Number(c.req.param("id"));
  const body = (await c.req.json().catch(() => null)) as
    | { role?: string; can_view_records?: boolean; active?: boolean }
    | null;
  if (!body) return err(c, "Dados inválidos.", 422);

  const member = await c.env.DB.prepare(`SELECT id, user_id, role FROM clinic_memberships WHERE id=?1 AND clinic_id=?2`)
    .bind(id, clinicId).first<{ id: number; user_id: number; role: string }>();
  if (!member) return err(c, "Vínculo não encontrado.", 404);

  const sets: string[] = [];
  const binds: unknown[] = [id, clinicId];
  const push = (col: string, v: unknown) => { sets.push(`${col} = ?${binds.length + 1}`); binds.push(v); };
  if (body.role !== undefined) {
    if (!["clinic_admin", "receptionist"].includes(body.role)) return err(c, "Perfil inválido.", 422);
    if (member.user_id === c.get("user").id && body.role !== "clinic_admin")
      return err(c, "Você não pode remover seu próprio perfil de administrador.", 409);
    push("role", body.role);
  }
  if (body.can_view_records !== undefined) push("can_view_records", body.can_view_records ? 1 : 0);
  if (body.active !== undefined) {
    if (member.user_id === c.get("user").id && !body.active)
      return err(c, "Você não pode desativar seu próprio acesso.", 409);
    push("active", body.active ? 1 : 0);
  }
  if (!sets.length) return err(c, "Nada para atualizar.", 422);

  await c.env.DB.prepare(`UPDATE clinic_memberships SET ${sets.join(", ")} WHERE id=?1 AND clinic_id=?2`).bind(...binds).run();

  // Garante que sobra ao menos um administrador ativo na clínica.
  const admins = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM clinic_memberships WHERE clinic_id=?1 AND role='clinic_admin' AND active=1`
  ).bind(clinicId).first<{ n: number }>();
  if ((admins?.n ?? 0) === 0) {
    await c.env.DB.prepare(`UPDATE clinic_memberships SET role='clinic_admin', active=1 WHERE id=?1 AND clinic_id=?2`)
      .bind(id, clinicId).run();
    return err(c, "A clínica precisa de ao menos um administrador ativo.", 409);
  }

  if (body.active === false) {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id=?1`).bind(member.user_id).run();
  }
  await audit(c.env.DB, c.get("user"), "member.updated", "membership", id, body);
  return c.json({ ok: true });
});

adminRouter.post("/members/:id/reset-code", guard("admin"), async (c) => {
  const clinicId = cid(c);
  const id = Number(c.req.param("id"));
  const member = await c.env.DB.prepare(
    `SELECT m.id, m.user_id, u.email FROM clinic_memberships m JOIN users u ON u.id=m.user_id
      WHERE m.id=?1 AND m.clinic_id=?2`
  ).bind(id, clinicId).first<{ id: number; user_id: number; email: string }>();
  if (!member) return err(c, "Vínculo não encontrado.", 404);

  const code = randomHex(4).toUpperCase();
  const codeHash = await sha256hex(`cr-reset:${member.user_id}:${code}`);
  await c.env.DB.prepare(`INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES (?1,?2,?3)`)
    .bind(member.user_id, codeHash, nowIso(new Date(Date.now() + 60 * 60_000))).run();
  await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id=?1`).bind(member.user_id).run();
  await audit(c.env.DB, c.get("user"), "user.reset_code_issued", "user", member.user_id, { via: "clinic_admin" });
  return c.json({ ok: true, code, expires_in_minutes: 60, email: member.email });
});
