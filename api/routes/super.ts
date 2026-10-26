// ============================================================================
// Superadministrador da plataforma.
// Gerencia consultórios, planos, assinaturas (controle MANUAL, sem gateway),
// avaliação gratuita, administradores, logs e indicadores.
//
// LGPD: o superadmin NÃO acessa prontuários. Em modo suporte o acesso
// administrativo é somente leitura e auditado.
// ============================================================================
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { requireSuper } from "../lib/auth";
import { audit } from "../lib/audit";
import { hashPassword } from "../lib/crypto";
import { err, nowIso, randomHex, slugify } from "../lib/utils";
import { DEFAULT_PROCEDURES, DEFAULT_SPECIALTIES, defaultClinicSettings, saveClinicSettings } from "../lib/settings";
import { sha256hex } from "../lib/crypto";
import { trialExpired, subscriptionState } from "../lib/access";

export const superRouter = new Hono<{ Bindings: Env }>();
superRouter.use("*", requireSuper);

// ── Indicadores ────────────────────────────────────────────────────────────
superRouter.get("/overview", async (c) => {
  const [clinics, users, appts, messages, plans] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS ativos,
         SUM(CASE WHEN status='suspended' THEN 1 ELSE 0 END) AS suspensos,
         SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END) AS bloqueados,
         SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS excluidos
       FROM clinics`
    ).first<Record<string, number>>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN platform_role='superadmin' THEN 1 ELSE 0 END) AS supers FROM users`).first<Record<string, number>>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN local_day = date('now') THEN 1 ELSE 0 END) AS hoje,
              SUM(CASE WHEN status='concluido' THEN 1 ELSE 0 END) AS concluidos
         FROM appointments`
    ).first<Record<string, number>>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status='falhou' THEN 1 ELSE 0 END) AS falhas,
              SUM(CASE WHEN status='enviado' THEN 1 ELSE 0 END) AS enviados
         FROM message_jobs`
    ).first<Record<string, number>>(),
    c.env.DB.prepare(`SELECT COUNT(*) AS n FROM plans WHERE active=1`).first<{ n: number }>(),
  ]);
  const subs = await c.env.DB.prepare(
    `SELECT s.status, COUNT(*) AS n FROM subscriptions s GROUP BY s.status`
  ).all<{ status: string; n: number }>();
  return c.json({
    clinics: clinics ?? {},
    users: users ?? {},
    appointments: appts ?? {},
    messages: messages ?? {},
    plans: plans?.n ?? 0,
    subscriptions: subs.results ?? [],
  });
});

// ── Planos ─────────────────────────────────────────────────────────────────
superRouter.get("/plans", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT code, name, price_cents_month, max_units, max_dentists, max_staff, max_messages_month,
            whatsapp_enabled, clinical_enabled, active, sort
       FROM plans ORDER BY sort, code`
  ).all<Record<string, unknown>>();
  return c.json({ plans: rows.results ?? [] });
});

const planSchema = z.object({
  code: z.string().min(2).max(30).regex(/^[a-z0-9_-]+$/),
  name: z.string().min(2).max(80),
  price_cents_month: z.number().int().min(0).max(10_000_000).default(0),
  max_units: z.number().int().min(-1).max(999).default(1),
  max_dentists: z.number().int().min(-1).max(999).default(1),
  max_staff: z.number().int().min(-1).max(999).default(1),
  max_messages_month: z.number().int().min(-1).max(1_000_000).default(100),
  whatsapp_enabled: z.boolean().default(false),
  clinical_enabled: z.boolean().default(true),
  active: z.boolean().default(true),
  sort: z.number().int().min(0).max(999).default(10),
});

superRouter.post("/plans", async (c) => {
  const parsed = planSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados do plano inválidos.", 422, parsed.error.flatten().fieldErrors);
  const p = parsed.data;
  const exists = await c.env.DB.prepare(`SELECT code FROM plans WHERE code=?1`).bind(p.code).first();
  if (exists) return err(c, "Já existe um plano com este código.", 409);
  await c.env.DB.prepare(
    `INSERT INTO plans (code,name,price_cents_month,max_units,max_dentists,max_staff,max_messages_month,
       whatsapp_enabled,clinical_enabled,active,sort)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`
  )
    .bind(p.code, p.name, p.price_cents_month, p.max_units, p.max_dentists, p.max_staff, p.max_messages_month,
      p.whatsapp_enabled ? 1 : 0, p.clinical_enabled ? 1 : 0, p.active ? 1 : 0, p.sort)
    .run();
  await audit(c.env.DB, c.get("user"), "plan.created", "plan", p.code, p, { scope: "platform" });
  return c.json({ ok: true }, 201);
});

superRouter.put("/plans/:code", async (c) => {
  const code = c.req.param("code");
  const parsed = planSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados do plano inválidos.", 422);
  const p = parsed.data;
  const sets: string[] = [];
  const binds: unknown[] = [code];
  const map: Record<string, unknown> = {
    name: p.name, price_cents_month: p.price_cents_month, max_units: p.max_units,
    max_dentists: p.max_dentists, max_staff: p.max_staff, max_messages_month: p.max_messages_month,
  };
  for (const [k, v] of Object.entries(map)) {
    if (v !== undefined) { sets.push(`${k} = ?${binds.length + 1}`); binds.push(v); }
  }
  if (p.whatsapp_enabled !== undefined) { sets.push(`whatsapp_enabled = ?${binds.length + 1}`); binds.push(p.whatsapp_enabled ? 1 : 0); }
  if (p.clinical_enabled !== undefined) { sets.push(`clinical_enabled = ?${binds.length + 1}`); binds.push(p.clinical_enabled ? 1 : 0); }
  if (p.active !== undefined) { sets.push(`active = ?${binds.length + 1}`); binds.push(p.active ? 1 : 0); }
  if (p.sort !== undefined) { sets.push(`sort = ?${binds.length + 1}`); binds.push(p.sort); }
  if (sets.length === 0) return err(c, "Nada para atualizar.", 422);
  sets.push(`updated_at = ?${binds.length + 1}`);
  binds.push(nowIso());
  const res = await c.env.DB.prepare(`UPDATE plans SET ${sets.join(", ")} WHERE code = ?1`).bind(...binds).run();
  if ((res.meta?.changes ?? 0) === 0) return err(c, "Plano não encontrado.", 404);
  await audit(c.env.DB, c.get("user"), "plan.updated", "plan", code, p, { scope: "platform" });
  return c.json({ ok: true });
});

// ── Clínicas ───────────────────────────────────────────────────────────────
superRouter.get("/clinics", async (c) => {
  const q = (c.req.query("q") || "").trim();
  const status = c.req.query("status") || "";
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.slug, c.name, c.legal_name, c.cnpj, c.email, c.phone, c.whatsapp, c.status, c.plan_code,
            c.trial_ends_at, c.created_at, c.deleted_at, s.status AS subscription_status,
            (SELECT COUNT(*) FROM professionals p WHERE p.clinic_id = c.id AND p.active = 1) AS dentists,
            (SELECT COUNT(*) FROM patients pt WHERE pt.clinic_id = c.id) AS patients,
            (SELECT COUNT(*) FROM appointments a WHERE a.clinic_id = c.id AND a.local_day = date('now')) AS today_appointments
       FROM clinics c LEFT JOIN subscriptions s ON s.clinic_id = c.id
      WHERE (?1 = '' OR lower(c.name) LIKE ?2 OR c.slug LIKE ?2 OR c.cnpj LIKE ?3)
        AND (?4 = '' OR c.status = ?4)
      ORDER BY c.created_at DESC LIMIT 200`
  )
    .bind(q, `%${q.toLowerCase()}%`, `%${q.replace(/\D/g, "")}%`, status)
    .all<Record<string, unknown>>();
  return c.json({ clinics: rows.results ?? [] });
});

const clinicSchema = z.object({
  name: z.string().min(3).max(120),
  slug: z.string().min(3).max(80).regex(/^[a-z0-9-]+$/).optional(),
  legal_name: z.string().max(160).default(""),
  cnpj: z.string().max(20).default(""),
  email: z.string().email().max(200).or(z.literal("")).default(""),
  phone: z.string().max(40).default(""),
  whatsapp: z.string().max(40).default(""),
  timezone: z.string().max(60).default("America/Sao_Paulo"),
  plan_code: z.string().max(30).default("trial"),
  trial_days: z.number().int().min(0).max(365).default(14),
  admin_name: z.string().min(3).max(120),
  admin_email: z.string().email().max(200),
  admin_password: z.string().min(10).max(200),
  unit_name: z.string().max(120).default("Unidade principal"),
});

/** Cria clínica + unidade + administrador + especialidades/procedimentos padrão. */
superRouter.post("/clinics", async (c) => {
  const parsed = clinicSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Confira os dados da clínica e do administrador.", 422, parsed.error.flatten().fieldErrors);
  const d = parsed.data;
  const slug = slugify(d.slug || d.name);
  if (!slug || slug.length < 3) return err(c, "Não foi possível gerar o endereço (slug) da clínica.", 422);
  const slugTaken = await c.env.DB.prepare(`SELECT id FROM clinics WHERE slug = ?1`).bind(slug).first();
  if (slugTaken) return err(c, "Já existe uma clínica com este endereço.", 409);
  const emailTaken = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?1`).bind(d.admin_email.toLowerCase()).first();
  if (emailTaken) return err(c, "Já existe um usuário com o e-mail do administrador.", 409);
  const plan = await c.env.DB.prepare(`SELECT code FROM plans WHERE code = ?1 AND active = 1`).bind(d.plan_code).first();
  if (!plan) return err(c, "Plano inválido.", 422);

  const trialEnds = d.trial_days > 0 ? nowIso(new Date(Date.now() + d.trial_days * 86400_000)) : null;
  const clinicRes = await c.env.DB.prepare(
    `INSERT INTO clinics (slug, name, legal_name, cnpj, email, phone, whatsapp, timezone, plan_code, trial_ends_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`
  )
    .bind(slug, d.name, d.legal_name, d.cnpj.replace(/\D/g, ""), d.email, d.phone, d.whatsapp, d.timezone, d.plan_code, trialEnds)
    .run();
  const clinicId = Number(clinicRes.meta?.last_row_id ?? 0);

  await c.env.DB.prepare(
    `INSERT INTO subscriptions (clinic_id, plan_code, status, trial_ends_at) VALUES (?1, ?2, ?3, ?4)`
  )
    .bind(clinicId, d.plan_code, d.trial_days > 0 ? "trial" : "active", trialEnds)
    .run();

  const unitRes = await c.env.DB.prepare(
    `INSERT INTO units (clinic_id, slug, name, phone, whatsapp, is_primary, sort) VALUES (?1, ?2, ?3, ?4, ?5, 1, 0)`
  )
    .bind(clinicId, "principal", d.unit_name || "Unidade principal", d.phone, d.whatsapp)
    .run();
  const unitId = Number(unitRes.meta?.last_row_id ?? 0);

  const specialtyIds = new Map<string, number>();
  for (const [i, s] of DEFAULT_SPECIALTIES.entries()) {
    const r = await c.env.DB.prepare(
      `INSERT INTO specialties (clinic_id, name, slug, color, sort) VALUES (?1,?2,?3,?4,?5)`
    ).bind(clinicId, s.name, s.slug, s.color, i).run();
    specialtyIds.set(s.slug, Number(r.meta?.last_row_id ?? 0));
  }
  for (const [i, p] of DEFAULT_PROCEDURES.entries()) {
    await c.env.DB.prepare(
      `INSERT INTO procedures (clinic_id, slug, name, specialty_id, duration_min, price_cents, sort)
       VALUES (?1,?2,?3,?4,?5,?6,?7)`
    ).bind(clinicId, p.slug, p.name, specialtyIds.get(p.specialty) ?? null, p.duration, p.price_cents, i).run();
  }
  await saveClinicSettings(c.env.DB, clinicId, defaultClinicSettings());

  // Administrador da clínica (senha provisória → troca obrigatória).
  const hash = await hashPassword(d.admin_password);
  const userRes = await c.env.DB.prepare(
    `INSERT INTO users (name, email, password_hash, must_change_password) VALUES (?1,?2,?3,1)`
  )
    .bind(d.admin_name, d.admin_email.toLowerCase(), hash)
    .run();
  const userId = Number(userRes.meta?.last_row_id ?? 0);
  await c.env.DB.prepare(
    `INSERT INTO clinic_memberships (clinic_id, user_id, role, unit_id, can_view_records, active) VALUES (?1,?2,'clinic_admin',?3,1,1)`
  ).bind(clinicId, userId, unitId).run();

  await audit(c.env.DB, c.get("user"), "clinic.created", "clinic", clinicId, { slug, plan: d.plan_code, admin: d.admin_email }, { scope: "platform" });
  return c.json({ ok: true, clinic: { id: clinicId, slug }, admin: { id: userId } }, 201);
});

superRouter.get("/clinics/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const clinic = await c.env.DB.prepare(`SELECT * FROM clinics WHERE id = ?1`).bind(id).first<Record<string, unknown>>();
  if (!clinic) return err(c, "Clínica não encontrada.", 404);
  const [subscription, units, members, counts] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM subscriptions WHERE clinic_id = ?1`).bind(id).first(),
    c.env.DB.prepare(`SELECT id, name, city, state, active FROM units WHERE clinic_id = ?1 ORDER BY sort`).bind(id).all(),
    c.env.DB.prepare(
      `SELECT m.id, m.role, m.active, m.can_view_records, u.id AS user_id, u.name, u.email, u.must_change_password, u.last_login_at
         FROM clinic_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.clinic_id = ?1 ORDER BY m.role, u.name`
    ).bind(id).all(),
    c.env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM patients WHERE clinic_id=?1) AS patients,
              (SELECT COUNT(*) FROM professionals WHERE clinic_id=?1 AND active=1) AS dentists,
              (SELECT COUNT(*) FROM appointments WHERE clinic_id=?1) AS appointments,
              (SELECT COUNT(*) FROM appointments WHERE clinic_id=?1 AND local_day=date('now')) AS today,
              (SELECT COUNT(*) FROM message_jobs WHERE clinic_id=?1 AND status='falhou') AS message_failures`
    ).bind(id).first(),
  ]);
  return c.json({ clinic, subscription, units: units.results ?? [], members: members.results ?? [], counts: counts ?? {} });
});

/** Ativa / suspende / bloqueia e controla a assinatura manualmente. */
const statusSchema = z.object({
  action: z.enum(["activate", "suspend", "block"]),
  reason: z.string().max(300).default(""),
});

superRouter.post("/clinics/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = statusSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Ação inválida.", 422);
  const status = parsed.data.action === "activate" ? "active" : parsed.data.action === "suspend" ? "suspended" : "blocked";
  const res = await c.env.DB.prepare(`UPDATE clinics SET status = ?2, suspend_reason = ?3, updated_at = ?4 WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(id, status, parsed.data.action === "activate" ? "" : parsed.data.reason, nowIso())
    .run();
  if ((res.meta?.changes ?? 0) === 0) return err(c, "Clínica não encontrada.", 404);
  if (status !== "active") {
    // Cancela lembretes pendentes de clínicas suspensas (evita mensagens).
    await c.env.DB.prepare(`UPDATE message_jobs SET status='cancelado', last_error='clínica suspensa' WHERE clinic_id=?1 AND status='pendente'`).bind(id).run();
  }
  await audit(c.env.DB, c.get("user"), `clinic.${parsed.data.action}`, "clinic", id, { reason: parsed.data.reason }, { scope: "platform" });
  return c.json({ ok: true, status });
});

const subscriptionSchema = z.object({
  plan_code: z.string().min(2).max(30),
  status: z.enum(["trial", "active", "past_due", "cancelled", "blocked"]),
  trial_days: z.number().int().min(0).max(365).optional(),
  period_end: z.string().max(40).nullable().optional(),
  notes: z.string().max(500).default(""),
});

superRouter.post("/clinics/:id/subscription", async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = subscriptionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados da assinatura inválidos.", 422);
  const plan = await c.env.DB.prepare(`SELECT code FROM plans WHERE code=?1`).bind(parsed.data.plan_code).first();
  if (!plan) return err(c, "Plano inválido.", 422);
  const trialEnds = parsed.data.trial_days != null && parsed.data.trial_days > 0
    ? nowIso(new Date(Date.now() + parsed.data.trial_days * 86400_000))
    : null;
  await c.env.DB.prepare(
    `UPDATE subscriptions SET plan_code=?2, status=?3, trial_ends_at=COALESCE(?4, trial_ends_at),
            period_end=?5, notes=?6, updated_at=?7 WHERE clinic_id=?1`
  )
    .bind(id, parsed.data.plan_code, parsed.data.status, trialEnds, parsed.data.period_end ?? null, parsed.data.notes, nowIso())
    .run();
  await c.env.DB.prepare(`UPDATE clinics SET plan_code=?2, trial_ends_at=COALESCE(?3, trial_ends_at), updated_at=?4 WHERE id=?1`)
    .bind(id, parsed.data.plan_code, trialEnds, nowIso())
    .run();
  await audit(c.env.DB, c.get("user"), "clinic.subscription_updated", "clinic", id, parsed.data, { scope: "platform" });
  return c.json({ ok: true });
});

/** Exclusão controlada: exige confirmação do slug; soft delete + anonimização. */
const deleteSchema = z.object({ confirm_slug: z.string().min(1), reason: z.string().min(5).max(300) });

superRouter.post("/clinics/:id/delete", async (c) => {
  const id = Number(c.req.param("id"));
  const parsed = deleteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Informe o motivo (mín. 5 caracteres) e confirme o endereço da clínica.", 422);
  const clinic = await c.env.DB.prepare(`SELECT slug FROM clinics WHERE id = ?1`).bind(id).first<{ slug: string }>();
  if (!clinic) return err(c, "Clínica não encontrada.", 404);
  if (parsed.data.confirm_slug !== clinic.slug) return err(c, "Confirmação incorreta: digite o endereço exato da clínica.", 422);
  await c.env.DB.prepare(
    `UPDATE clinics SET deleted_at = ?2, status = 'blocked', suspend_reason = ?3, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL`
  )
    .bind(id, nowIso(), `Excluída: ${parsed.data.reason}`)
    .run();
  await c.env.DB.prepare(`UPDATE users SET active = 0 WHERE id IN (SELECT user_id FROM clinic_memberships WHERE clinic_id = ?1) AND platform_role <> 'superadmin'`).bind(id).run();
  await c.env.DB.prepare(`UPDATE clinic_memberships SET active = 0 WHERE clinic_id = ?1`).bind(id).run();
  await c.env.DB.prepare(`UPDATE message_jobs SET status='cancelado', last_error='clínica excluída' WHERE clinic_id=?1 AND status='pendente'`).bind(id).run();
  await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE active = 0)`).run();
  await audit(c.env.DB, c.get("user"), "clinic.deleted", "clinic", id, { reason: parsed.data.reason }, { scope: "platform" });
  return c.json({ ok: true, message: "Clínica excluída (dados preservados para obrigações legais e auditoria)." });
});

// ── Administradores e equipe ───────────────────────────────────────────────
superRouter.post("/clinics/:id/admins", async (c) => {
  const clinicId = Number(c.req.param("id"));
  const schema = z.object({
    name: z.string().min(3).max(120),
    email: z.string().email().max(200),
    password: z.string().min(10).max(200),
    role: z.enum(["clinic_admin", "receptionist"]).default("clinic_admin"),
    can_view_records: z.boolean().default(false),
  });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados inválidos (senha mínima de 10 caracteres).", 422);
  const clinic = await c.env.DB.prepare(`SELECT id FROM clinics WHERE id=?1 AND deleted_at IS NULL`).bind(clinicId).first();
  if (!clinic) return err(c, "Clínica não encontrada.", 404);
  const email = parsed.data.email.toLowerCase();
  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE email=?1`).bind(email).first<{ id: number }>();
  let userId = existing?.id ?? 0;
  if (!userId) {
    const hash = await hashPassword(parsed.data.password);
    const r = await c.env.DB.prepare(`INSERT INTO users (name, email, password_hash, must_change_password) VALUES (?1,?2,?3,1)`)
      .bind(parsed.data.name, email, hash)
      .run();
    userId = Number(r.meta?.last_row_id ?? 0);
  }
  const member = await c.env.DB.prepare(`SELECT id FROM clinic_memberships WHERE clinic_id=?1 AND user_id=?2`).bind(clinicId, userId).first();
  if (member) return err(c, "Este usuário já está vinculado à clínica.", 409);
  await c.env.DB.prepare(
    `INSERT INTO clinic_memberships (clinic_id, user_id, role, can_view_records, active) VALUES (?1,?2,?3,?4,1)`
  ).bind(clinicId, userId, parsed.data.role, parsed.data.can_view_records ? 1 : 0).run();
  await audit(c.env.DB, c.get("user"), "clinic.admin_created", "user", userId, { role: parsed.data.role }, { scope: "platform" });
  return c.json({ ok: true, user_id: userId }, 201);
});

superRouter.post("/memberships/:id/active", async (c) => {
  const id = Number(c.req.param("id"));
  const body = (await c.req.json().catch(() => null)) as { active?: boolean } | null;
  if (typeof body?.active !== "boolean") return err(c, "Informe active (true/false).", 422);
  const res = await c.env.DB.prepare(`UPDATE clinic_memberships SET active=?2 WHERE id=?1`).bind(id, body.active ? 1 : 0).run();
  if ((res.meta?.changes ?? 0) === 0) return err(c, "Vínculo não encontrado.", 404);
  if (!body.active) {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = (SELECT user_id FROM clinic_memberships WHERE id=?1)`).bind(id).run();
  }
  await audit(c.env.DB, c.get("user"), "membership.toggled", "membership", id, { active: body.active }, { scope: "platform" });
  return c.json({ ok: true });
});

/** Gera código de recuperação para um usuário (entrega por canal interno). */
superRouter.post("/users/:id/reset-code", async (c) => {
  const id = Number(c.req.param("id"));
  const user = await c.env.DB.prepare(`SELECT id, email FROM users WHERE id=?1`).bind(id).first<{ id: number; email: string }>();
  if (!user) return err(c, "Usuário não encontrado.", 404);
  const code = randomHex(4).toUpperCase();
  const codeHash = await sha256hex(`cr-reset:${user.id}:${code}`);
  await c.env.DB.prepare(`INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES (?1,?2,?3)`)
    .bind(user.id, codeHash, nowIso(new Date(Date.now() + 60 * 60_000)))
    .run();
  await audit(c.env.DB, c.get("user"), "user.reset_code_issued", "user", id, {}, { scope: "platform" });
  return c.json({ ok: true, code, expires_in_minutes: 60, email: user.email });
});

// ── Logs administrativos ───────────────────────────────────────────────────
superRouter.get("/audit", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") || 100), 500);
  const clinicId = c.req.query("clinic_id");
  const rows = await c.env.DB.prepare(
    `SELECT l.id, l.scope, l.clinic_id, c.name AS clinic_name, l.user_id, l.user_name, l.action, l.entity,
            l.entity_id, l.meta, l.created_at
       FROM audit_log l LEFT JOIN clinics c ON c.id = l.clinic_id
      WHERE (?1 IS NULL OR l.clinic_id = ?1)
      ORDER BY l.id DESC LIMIT ?2`
  )
    .bind(clinicId ? Number(clinicId) : null, limit)
    .all<Record<string, unknown>>();
  return c.json({ entries: rows.results ?? [] });
});

// ── Configurações da plataforma ────────────────────────────────────────────
superRouter.get("/settings", async (c) => {
  const rows = await c.env.DB.prepare(`SELECT key, value, updated_at FROM platform_settings ORDER BY key`).all();
  return c.json({ settings: rows.results ?? [] });
});

superRouter.put("/settings", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { key?: string; value?: string } | null;
  if (!body?.key || body.value === undefined) return err(c, "Informe key e value.", 422);
  const allowed = ["trial_days", "reminder_offsets_min", "send_window_start", "send_window_end",
    "whatsapp_max_attempts", "retry_backoff_sec", "patient_sharing", "default_slot_min", "public_booking_enabled"];
  if (!allowed.includes(body.key)) return err(c, "Configuração não permitida.", 422);
  await c.env.DB.prepare(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES (?1,?2,?3)
     ON CONFLICT(key) DO UPDATE SET value=?2, updated_at=?3`
  ).bind(body.key, String(body.value).slice(0, 500), nowIso()).run();
  await audit(c.env.DB, c.get("user"), "platform.setting_updated", "setting", body.key, { value: body.value }, { scope: "platform" });
  return c.json({ ok: true });
});

/** Monitor de mensagens de toda a plataforma (sem conteúdo clínico). */
superRouter.get("/messages", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT j.id, j.clinic_id, cl.name AS clinic_name, j.kind, j.status, j.scheduled_at, j.sent_at,
            j.attempts, j.last_error, p.name AS patient_name
       FROM message_jobs j
       JOIN clinics cl ON cl.id = j.clinic_id
       LEFT JOIN patients p ON p.id = j.patient_id
      ORDER BY j.created_at DESC LIMIT 200`
  ).all<Record<string, unknown>>();
  return c.json({ messages: rows.results ?? [] });
});

/** Clínicas com avaliação vencida (para ação manual). */
superRouter.get("/trials/expiring", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.name, c.slug, c.trial_ends_at, s.status FROM clinics c
       JOIN subscriptions s ON s.clinic_id = c.id
      WHERE c.deleted_at IS NULL AND (s.status='trial' OR c.trial_ends_at IS NOT NULL)
      ORDER BY c.trial_ends_at ASC LIMIT 100`
  ).all<{ id: number; name: string; slug: string; trial_ends_at: string | null; status: string }>();
  const now = new Date();
  return c.json({
    clinics: (rows.results ?? []).map((r) => {
      const sub = { plan_code: "", status: r.status as never, trial_ends_at: r.trial_ends_at, period_end: null, plan: null };
      return { ...r, expired: trialExpired(sub, now) };
    }),
  });
});

superRouter.get("/clinics/:id/access-check", async (c) => {
  const id = Number(c.req.param("id"));
  const sub = await subscriptionState(c.env.DB, id);
  if (!sub) return err(c, "Assinatura não encontrada.", 404);
  return c.json({ subscription: { ...sub, plan: sub.plan?.code ?? null }, trial_expired: trialExpired(sub) });
});
