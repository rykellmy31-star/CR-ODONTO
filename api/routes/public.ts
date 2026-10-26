// ============================================================================
// API pública da clínica (/api/c/:slug/*)
//  - página de agendamento: informações, profissionais, procedimentos, horários
//  - agendamento online com consentimento e prevenção de duplicidade
//  - links seguros de uso único: confirmar / reagendar
//  - portal do paciente: código por WhatsApp, histórico, reagendamento, documentos
// Nenhuma rota pública expõe dados clínicos ou de outros pacientes.
// ============================================================================
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { tenantMiddleware, cid } from "../lib/tenant";
import { err, normalizePhone, nowIso, formatPhoneBr } from "../lib/utils";
import { addDays, formatDayPtBr, todayLocal, utcToLocal, formatHHMM } from "../lib/time";
import { dayAvailability, slotToInstants, findPatientDuplicates } from "../lib/scheduling";
import { rateLimit } from "../lib/auth";
import { createActionToken, loadActionToken, tokenIsUsable, consumeActionToken, invalidateAppointmentTokens } from "../lib/tokens";
import {
  currentPatient, createPatientSession, destroyPatientSession, createPortalCode,
  findPatientForPortal, verifyPortalCode,
} from "../lib/patient-auth";
import { audit } from "../lib/audit";

export const publicRouter = new Hono<{ Bindings: Env }>();
const pub = tenantMiddleware({ auth: "none", writeGuard: false });

async function clinicInfo(env: Env, clinicId: number) {
  const clinic = await env.DB.prepare(
    `SELECT id, slug, name, timezone, phone, whatsapp, logo_url FROM clinics WHERE id = ?1`
  ).bind(clinicId).first<{ id: number; slug: string; name: string; timezone: string; phone: string; whatsapp: string; logo_url: string }>();
  return clinic;
}

// ── Informações públicas ──────────────────────────────────────────────────
publicRouter.get("/info", pub, async (c) => {
  const clinicId = cid(c);
  const settings = c.get("settings");
  const clinic = await clinicInfo(c.env, clinicId);
  if (!clinic) return err(c, "Clínica não encontrada.", 404);
  const [units, professionals, procedures, specialties] = await Promise.all([
    c.env.DB.prepare(`SELECT id, name, address, city, state, phone, whatsapp FROM units WHERE clinic_id=?1 AND active=1 ORDER BY is_primary DESC, sort`)
      .bind(clinicId).all(),
    c.env.DB.prepare(
      `SELECT p.id, p.name, p.slug, p.cro, p.cro_uf, p.photo_url, p.bio, p.color,
              (SELECT GROUP_CONCAT(s.name, ', ') FROM professional_specialties ps
                 JOIN specialties s ON s.id=ps.specialty_id WHERE ps.professional_id=p.id) AS specialties
         FROM professionals p WHERE p.clinic_id=?1 AND p.active=1 AND p.show_in_booking=1 ORDER BY p.sort, p.name`
    ).bind(clinicId).all(),
    c.env.DB.prepare(
      `SELECT p.id, p.name, p.slug, p.duration_min, p.price_cents, p.description, p.specialty_id,
              s.name AS specialty_name FROM procedures p
         LEFT JOIN specialties s ON s.id=p.specialty_id
        WHERE p.clinic_id=?1 AND p.active=1 AND p.show_in_booking=1 ORDER BY p.sort, p.name`
    ).bind(clinicId).all(),
    c.env.DB.prepare(`SELECT id, name, color FROM specialties WHERE clinic_id=?1 AND active=1 ORDER BY sort`)
      .bind(clinicId).all(),
  ]);
  return c.json({
    clinic: {
      slug: clinic.slug,
      name: clinic.name,
      timezone: clinic.timezone,
      logo_url: settings.branding.logo_url || clinic.logo_url,
      colors: { primary: settings.branding.primary_color, accent: settings.branding.accent_color },
      tagline: settings.branding.tagline,
      about: settings.branding.about,
      address: settings.branding.address_public,
      phone: settings.branding.phone_public || clinic.phone,
      whatsapp: settings.branding.whatsapp_public || clinic.whatsapp,
      instagram: settings.branding.instagram,
    },
    booking: {
      online_enabled: settings.booking.online_enabled,
      max_days_ahead: settings.booking.max_days_ahead,
      show_prices: settings.booking.show_prices,
      show_professional_choice: settings.booking.show_professional_choice,
      require_cpf: settings.booking.require_cpf,
      require_optin: settings.booking.require_optin,
    },
    units: units.results ?? [],
    professionals: professionals.results ?? [],
    procedures: procedures.results ?? [],
    specialties: specialties.results ?? [],
  });
});

/** Horários livres reais (escala + férias + bloqueios + duração do procedimento). */
publicRouter.get("/availability", pub, async (c) => {
  const clinicId = cid(c);
  const settings = c.get("settings");
  const tz = (await clinicInfo(c.env, clinicId))?.timezone || "America/Sao_Paulo";
  const professionalId = Number(c.req.query("professional_id"));
  const procedureId = Number(c.req.query("procedure_id") || 0) || null;
  const day = c.req.query("day") || addDays(todayLocal(tz), 1);
  if (!professionalId) return err(c, "Selecione o profissional.", 422);
  if (!settings.booking.online_enabled) return err(c, "O agendamento online está desativado nesta clínica.", 403);

  const pro = await c.env.DB.prepare(
    `SELECT id, slot_min FROM professionals WHERE id=?1 AND clinic_id=?2 AND active=1 AND show_in_booking=1`
  ).bind(professionalId, clinicId).first<{ id: number; slot_min: number }>();
  if (!pro) return err(c, "Profissional indisponível para agendamento online.", 404);

  let duration = settings.scheduling.slot_min;
  if (procedureId) {
    const proc = await c.env.DB.prepare(
      `SELECT duration_min FROM procedures WHERE id=?1 AND clinic_id=?2 AND active=1 AND show_in_booking=1`
    ).bind(procedureId, clinicId).first<{ duration_min: number }>();
    if (!proc) return err(c, "Procedimento indisponível.", 404);
    duration = proc.duration_min;
  }

  // Limite de antecedência mínima (ex.: 60 min) — nunca oferece horário colado.
  const now = new Date(Date.now() + settings.booking.min_lead_min * 60_000);
  const avail = await dayAvailability({
    db: c.env.DB, clinicId, timezone: tz, professionalId, day, durationMin: duration,
    slotMin: pro.slot_min, now,
  });
  return c.json({
    day,
    duration_min: duration,
    slots: avail.slots,
    reason: avail.reason ?? null,
    weekday: avail.weekday,
  });
});

/** Calendário de dias com disponibilidade (próximos N dias). */
publicRouter.get("/availability/days", pub, async (c) => {
  const clinicId = cid(c);
  const settings = c.get("settings");
  const tz = (await clinicInfo(c.env, clinicId))?.timezone || "America/Sao_Paulo";
  const professionalId = Number(c.req.query("professional_id"));
  const procedureId = Number(c.req.query("procedure_id") || 0) || null;
  const days = Math.min(Number(c.req.query("days") || 21), settings.booking.max_days_ahead);
  if (!professionalId) return err(c, "Selecione o profissional.", 422);
  const pro = await c.env.DB.prepare(`SELECT slot_min FROM professionals WHERE id=?1 AND clinic_id=?2 AND active=1`)
    .bind(professionalId, clinicId).first<{ slot_min: number }>();
  if (!pro) return err(c, "Profissional indisponível.", 404);
  let duration = settings.scheduling.slot_min;
  if (procedureId) {
    const proc = await c.env.DB.prepare(`SELECT duration_min FROM procedures WHERE id=?1 AND clinic_id=?2`)
      .bind(procedureId, clinicId).first<{ duration_min: number }>();
    if (proc) duration = proc.duration_min;
  }
  const today = todayLocal(tz);
  const now = new Date(Date.now() + settings.booking.min_lead_min * 60_000);
  const out: { day: string; label: string; free: number }[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    const avail = await dayAvailability({
      db: c.env.DB, clinicId, timezone: tz, professionalId, day, durationMin: duration, slotMin: pro.slot_min, now,
    });
    out.push({ day, label: formatDayPtBr(tz, day), free: avail.slots.length });
  }
  return c.json({ days: out });
});

// ── Agendamento online ────────────────────────────────────────────────────
const bookSchema = z.object({
  professional_id: z.number().int().positive(),
  procedure_id: z.number().int().positive().nullable().optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  name: z.string().min(3).max(160),
  phone: z.string().min(10).max(30),
  email: z.string().max(200).default(""),
  cpf: z.string().max(20).default(""),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(500).default(""),
  optin: z.boolean().default(false),
  accept_terms: z.literal(true),
});

publicRouter.post("/book", pub, async (c) => {
  const clinicId = cid(c);
  const settings = c.get("settings");
  const clinic = await clinicInfo(c.env, clinicId);
  if (!clinic) return err(c, "Clínica não encontrada.", 404);
  if (!settings.booking.online_enabled) return err(c, "O agendamento online está desativado.", 403);

  const ip = c.req.header("cf-connecting-ip") || "local";
  if (!(await rateLimit(c.env, `book:${clinicId}:${ip}`, 8, 60 * 60_000)))
    return err(c, "Muitas solicitações de agendamento. Tente novamente mais tarde.", 429);

  const parsed = bookSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Confira os dados do agendamento.", 422, parsed.error.flatten().fieldErrors);
  const d = parsed.data;
  if (settings.booking.require_cpf && !d.cpf) return err(c, "Informe o CPF.", 422);
  if (settings.booking.require_optin && !d.optin)
    return err(c, "Para agendar, autorize o contato por WhatsApp sobre esta consulta.", 422);

  const pro = await c.env.DB.prepare(`SELECT id, slot_min FROM professionals WHERE id=?1 AND clinic_id=?2 AND active=1 AND show_in_booking=1`)
    .bind(d.professional_id, clinicId).first<{ id: number; slot_min: number }>();
  if (!pro) return err(c, "Profissional indisponível.", 404);

  let duration = settings.scheduling.slot_min;
  let priceCents = 0;
  if (d.procedure_id) {
    const proc = await c.env.DB.prepare(`SELECT duration_min, price_cents FROM procedures WHERE id=?1 AND clinic_id=?2 AND active=1`)
      .bind(d.procedure_id, clinicId).first<{ duration_min: number; price_cents: number }>();
    if (!proc) return err(c, "Procedimento indisponível.", 404);
    duration = proc.duration_min;
    priceCents = proc.price_cents;
  }

  const avail = await dayAvailability({
    db: c.env.DB, clinicId, timezone: clinic.timezone, professionalId: d.professional_id, day: d.day,
    durationMin: duration, slotMin: pro.slot_min, now: new Date(Date.now() + settings.booking.min_lead_min * 60_000),
  });
  if (!avail.slots.includes(d.time)) return err(c, "Este horário não está mais disponível. Escolha outro.", 409);

  // Paciente: reaproveita cadastro existente pelo telefone (evita duplicidade).
  const phone = normalizePhone(d.phone);
  let patient = await c.env.DB.prepare(
    `SELECT id, name FROM patients WHERE clinic_id=?1 AND phone=?2 AND anonymized_at IS NULL AND active=1 ORDER BY id DESC LIMIT 1`
  ).bind(clinicId, phone).first<{ id: number; name: string }>();
  if (!patient) {
    const dups = await findPatientDuplicates(c.env.DB, clinicId, { name: d.name, phone, cpf: d.cpf });
    if (dups.length > 0)
      return err(c, "Já existe um cadastro com estes dados. Use o portal do paciente para agendar, ou confirme seus dados no telefone da clínica.", 409);
    const { createPatient } = await import("../lib/patients");
    const created = await createPatient(c.env.DB, clinicId, {
      name: d.name, phone, cpf: d.cpf, email: d.email, birth_date: d.birth_date ?? null,
      notes: d.notes, whatsapp_optin: d.optin, force_create: true,
    });
    if (!created.ok) return err(c, created.message, 422);
    patient = { id: created.id, name: d.name };
  } else if (d.optin) {
    await c.env.DB.prepare(`UPDATE patients SET whatsapp_optin=1, optin_at=?2 WHERE id=?1`).bind(patient.id, nowIso()).run();
  }

  const instants = slotToInstants(clinic.timezone, d.day, d.time, duration);
  if (!instants) return err(c, "Horário inválido.", 422);

  const { createAppointmentGuarded } = await import("../lib/scheduling");
  const created = await createAppointmentGuarded({
    db: c.env.DB, clinicId, timezone: clinic.timezone,
    professionalId: d.professional_id, patientId: patient.id,
    procedureId: d.procedure_id ?? null,
    startsAt: instants.startsAt, endsAt: instants.endsAt,
    kind: "consulta", source: "online", status: "aguardando_confirmacao",
    patientNotes: d.notes, priceCents, createdBy: null,
  });
  if (!created.ok) return err(c, created.detail, 409);

  // Tokens de confirmação e reagendamento (links no e-mail/WhatsApp).
  const confirm = await createActionToken(c.env.DB, { clinicId, appointmentId: created.id, patientId: patient.id, purpose: "confirmar" });
  const resched = await createActionToken(c.env.DB, { clinicId, appointmentId: created.id, patientId: patient.id, purpose: "reagendar" });

  const { scheduleAppointmentReminders, enqueueConfirmationMessage } = await import("../lib/messaging/jobs");
  await scheduleAppointmentReminders(c.env, clinicId, created.id);
  await enqueueConfirmationMessage(c.env, clinicId, created.id, "confirmacao", {
    confirmToken: confirm.token, rescheduleToken: resched.token,
  });
  await audit(c.env.DB, null, "appointment.online_created", "appointment", created.id, { day: d.day, time: d.time }, { clinicId });

  return c.json({
    ok: true,
    code: created.code,
    appointment_id: created.id,
    day: d.day,
    time: d.time,
    duration_min: duration,
    professional: pro.id,
    links: {
      confirm: `/c/${c.get("clinic").slug}/confirmar/${confirm.token}`,
      reschedule: `/c/${c.get("clinic").slug}/reagendar/${resched.token}`,
    },
    message: "Consulta solicitada! Você receberá a confirmação pelo WhatsApp.",
  }, 201);
});

/** Consulta por protocolo + telefone (sem sessão). */
publicRouter.get("/appointment/:code", pub, async (c) => {
  const clinicId = cid(c);
  const code = c.req.param("code");
  const phone = normalizePhone(c.req.query("phone") || "");
  if (phone.length < 10) return err(c, "Informe o telefone usado no agendamento.", 422);
  const row = await c.env.DB.prepare(
    `SELECT a.id, a.code, a.starts_at, a.status, a.kind, p.name AS patient_name, p.phone,
            pr.name AS professional_name, u.name AS unit_name, proc.name AS procedure_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN professionals pr ON pr.id = a.professional_id
       LEFT JOIN units u ON u.id = a.unit_id
       LEFT JOIN procedures proc ON proc.id = a.procedure_id
      WHERE a.clinic_id=?1 AND a.code=?2 AND p.phone=?3`
  ).bind(clinicId, code.toUpperCase(), phone).first<Record<string, unknown> & { id: number; starts_at: string }>();
  if (!row) return err(c, "Agendamento não encontrado para este telefone.", 404);
  const clinic = await clinicInfo(c.env, clinicId);
  const local = utcToLocal(clinic?.timezone || "America/Sao_Paulo", row.starts_at);
  return c.json({
    appointment: {
      code: row.code, status: row.status, kind: row.kind, day: local.day,
      time: formatHHMM(local.minutes), patient_name: row.patient_name,
      professional_name: row.professional_name, unit_name: row.unit_name, procedure_name: row.procedure_name,
    },
  });
});

// ══════════════════════════════════════════════════════════════════════════
// LINKS SEGUROS DE AÇÃO (uso único)
// ══════════════════════════════════════════════════════════════════════════
publicRouter.get("/action/:token", pub, async (c) => {
  const clinicId = cid(c);
  const token = c.req.param("token");
  const row = await loadActionToken(c.env.DB, token);
  if (!row || row.clinic_id !== clinicId) return err(c, "Link inválido.", 404);
  if (row.used_at) return err(c, "Este link já foi utilizado. Se precisar, fale com a clínica.", 410);
  if (!tokenIsUsable(row)) return err(c, "Este link expirou. Fale com a clínica para receber um novo.", 410);

  const clinic = await clinicInfo(c.env, clinicId);
  const appt = row.appointment_id
    ? await c.env.DB.prepare(
        `SELECT a.id, a.code, a.starts_at, a.status, a.professional_id, a.procedure_id, a.patient_id,
                p.name AS patient_name, pr.name AS professional_name, u.name AS unit_name,
                proc.name AS procedure_name, proc.duration_min
           FROM appointments a
           JOIN patients p ON p.id=a.patient_id
           JOIN professionals pr ON pr.id=a.professional_id
           LEFT JOIN units u ON u.id=a.unit_id
           LEFT JOIN procedures proc ON proc.id=a.procedure_id
          WHERE a.id=?1 AND a.clinic_id=?2`
      ).bind(row.appointment_id, clinicId).first<Record<string, unknown> & { starts_at: string; status: string; professional_id: number; procedure_id: number | null; patient_id: number; duration_min: number | null }>()
    : null;
  if (!appt) return err(c, "Consulta não encontrada.", 404);
  const tz = clinic?.timezone || "America/Sao_Paulo";
  const local = utcToLocal(tz, appt.starts_at);
  return c.json({
    purpose: row.purpose,
    clinic: { name: clinic?.name ?? "", timezone: tz, phone: clinic?.phone ?? "", whatsapp: clinic?.whatsapp ?? "" },
    appointment: {
      code: appt.code,
      patient_first_name: String(appt.patient_name).split(" ")[0],
      professional_name: appt.professional_name,
      procedure_name: appt.procedure_name,
      unit_name: appt.unit_name,
      day: local.day,
      time: formatHHMM(local.minutes),
      label: `${formatDayPtBr(tz, local.day)} · ${formatHHMM(local.minutes)}`,
      status: appt.status,
      duration_min: appt.duration_min ?? 30,
    },
  });
});

publicRouter.post("/action/:token/confirm", pub, async (c) => {
  const clinicId = cid(c);
  const token = c.req.param("token");
  const row = await loadActionToken(c.env.DB, token);
  if (!row || row.clinic_id !== clinicId) return err(c, "Link inválido.", 404);
  if (row.used_at) return c.json({ ok: true, already: true, message: "Esta consulta já foi confirmada." });
  if (!tokenIsUsable(row)) return err(c, "Este link expirou.", 410);

  const { confirmAppointment, getAppointment } = await import("../lib/appointments");
  const appt = row.appointment_id ? await getAppointment(c.env.DB, clinicId, row.appointment_id) : null;
  if (!appt) return err(c, "Consulta não encontrada.", 404);
  if (["cancelado", "reagendado", "concluido", "nao_compareceu"].includes(appt.status))
    return err(c, "Esta consulta não está mais ativa. Fale com a clínica.", 409);
  if (appt.status === "confirmado") {
    await consumeActionToken(c.env.DB, row.id, "confirmar");
    return c.json({ ok: true, already: true, message: "Consulta já confirmada. Até lá!" });
  }

  // Consome o token ANTES de confirmar (uso único), com rollback se falhar.
  const consumed = await consumeActionToken(c.env.DB, row.id, "confirmar");
  if (!consumed) return c.json({ ok: true, already: true, message: "Esta consulta já foi confirmada." });

  const result = await confirmAppointment(c.env.DB, clinicId, appt.id, "whatsapp", { kind: "patient", name: appt.patient_name ?? "paciente" });
  if (!result.ok) {
    await c.env.DB.prepare(`UPDATE action_tokens SET used_at=NULL WHERE id=?1`).bind(row.id).run();
    return err(c, result.message, 409);
  }
  const clinic = await clinicInfo(c.env, clinicId);
  const local = utcToLocal(clinic?.timezone || "America/Sao_Paulo", appt.starts_at);
  await audit(c.env.DB, null, "appointment.confirmed_by_patient", "appointment", appt.id, { via: "link" }, { clinicId });
  return c.json({
    ok: true,
    message: "Consulta confirmada! Obrigado. 🦷",
    appointment: { day: local.day, time: formatHHMM(local.minutes), professional_name: appt.professional_name },
  });
});

/** Opções reais de reagendamento (respeitando escala, férias, bloqueios). */
publicRouter.get("/action/:token/options", pub, async (c) => {
  const clinicId = cid(c);
  const settings = c.get("settings");
  const row = await loadActionToken(c.env.DB, c.req.param("token"));
  if (!row || row.clinic_id !== clinicId) return err(c, "Link inválido.", 404);
  if (!tokenIsUsable(row)) return err(c, "Este link expirou.", 410);
  if (row.purpose !== "reagendar") return err(c, "Este link não permite reagendamento.", 403);

  const appt = await c.env.DB.prepare(
    `SELECT a.id, a.professional_id, a.procedure_id, a.starts_at, a.status,
            COALESCE(proc.duration_min, ?3) AS duration_min
       FROM appointments a LEFT JOIN procedures proc ON proc.id=a.procedure_id
      WHERE a.id=?1 AND a.clinic_id=?2`
  ).bind(row.appointment_id, clinicId, settings.scheduling.slot_min).first<{ id: number; professional_id: number; procedure_id: number | null; starts_at: string; status: string; duration_min: number }>();
  if (!appt) return err(c, "Consulta não encontrada.", 404);
  if (!settings.booking.allow_patient_reschedule) return err(c, "Reagendamento pelo paciente está desativado. Fale com a clínica.", 403);
  if (["cancelado", "reagendado", "concluido", "nao_compareceu"].includes(appt.status)) {
    if (appt.status === "reagendado") {
      const nxt = await c.env.DB.prepare(`SELECT id FROM appointments WHERE rescheduled_from_id=?1 AND clinic_id=?2`).bind(appt.id, clinicId).first();
      if (nxt) return err(c, "Esta consulta já foi reagendada.", 409);
    }
    return err(c, "Esta consulta não está mais ativa.", 409);
  }

  const clinic = await clinicInfo(c.env, clinicId);
  const tz = clinic?.timezone || "America/Sao_Paulo";
  const pro = await c.env.DB.prepare(`SELECT slot_min FROM professionals WHERE id=?1`).bind(appt.professional_id).first<{ slot_min: number }>();
  const today = todayLocal(tz);
  const now = new Date(Date.now() + settings.booking.min_lead_min * 60_000);
  const days: { day: string; label: string; free: number }[] = [];
  for (let i = 0; i < Math.min(settings.booking.max_days_ahead, 30); i++) {
    const day = addDays(today, i);
    const avail = await dayAvailability({
      db: c.env.DB, clinicId, timezone: tz, professionalId: appt.professional_id, day,
      durationMin: appt.duration_min, slotMin: pro?.slot_min ?? 15, now,
      excludeAppointmentId: appt.id,
    });
    days.push({ day, label: formatDayPtBr(tz, day), free: avail.slots.length });
  }
  return c.json({ duration_min: appt.duration_min, days });
});

publicRouter.get("/action/:token/slots", pub, async (c) => {
  const clinicId = cid(c);
  const settings = c.get("settings");
  const row = await loadActionToken(c.env.DB, c.req.param("token"));
  if (!row || row.clinic_id !== clinicId || row.purpose !== "reagendar") return err(c, "Link inválido.", 404);
  if (!tokenIsUsable(row)) return err(c, "Este link expirou.", 410);
  const day = c.req.query("day") || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return err(c, "Informe o dia (AAAA-MM-DD).", 422);
  const appt = await c.env.DB.prepare(
    `SELECT a.id, a.professional_id, COALESCE(proc.duration_min, ?3) AS duration_min
       FROM appointments a LEFT JOIN procedures proc ON proc.id=a.procedure_id
      WHERE a.id=?1 AND a.clinic_id=?2`
  ).bind(row.appointment_id, clinicId, settings.scheduling.slot_min).first<{ id: number; professional_id: number; duration_min: number }>();
  if (!appt) return err(c, "Consulta não encontrada.", 404);
  const clinic = await clinicInfo(c.env, clinicId);
  const tz = clinic?.timezone || "America/Sao_Paulo";
  const pro = await c.env.DB.prepare(`SELECT slot_min FROM professionals WHERE id=?1`).bind(appt.professional_id).first<{ slot_min: number }>();
  const avail = await dayAvailability({
    db: c.env.DB, clinicId, timezone: tz, professionalId: appt.professional_id, day,
    durationMin: appt.duration_min, slotMin: pro?.slot_min ?? 15,
    now: new Date(Date.now() + settings.booking.min_lead_min * 60_000),
    excludeAppointmentId: appt.id,
  });
  return c.json({ day, slots: avail.slots, reason: avail.reason ?? null });
});

const actionRescheduleSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

publicRouter.post("/action/:token/reschedule", pub, async (c) => {
  const clinicId = cid(c);
  const settings = c.get("settings");
  const token = c.req.param("token");
  const row = await loadActionToken(c.env.DB, token);
  if (!row || row.clinic_id !== clinicId || row.purpose !== "reagendar") return err(c, "Link inválido.", 404);
  if (row.used_at) return err(c, "Este link já foi utilizado.", 410);
  if (!tokenIsUsable(row)) return err(c, "Este link expirou.", 410);
  if (!settings.booking.allow_patient_reschedule) return err(c, "Reagendamento pelo paciente está desativado.", 403);

  const ip = c.req.header("cf-connecting-ip") || "local";
  if (!(await rateLimit(c.env, `resched:${clinicId}:${ip}`, 10, 60 * 60_000)))
    return err(c, "Muitas tentativas. Tente novamente mais tarde.", 429);

  const parsed = actionRescheduleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Informe a nova data e horário.", 422);

  const appt = await c.env.DB.prepare(
    `SELECT a.id, a.professional_id, a.unit_id, a.status, a.patient_id,
            COALESCE(proc.duration_min, ?3) AS duration_min
       FROM appointments a LEFT JOIN procedures proc ON proc.id=a.procedure_id
      WHERE a.id=?1 AND a.clinic_id=?2`
  ).bind(row.appointment_id, clinicId, settings.scheduling.slot_min).first<{ id: number; professional_id: number; unit_id: number | null; status: string; patient_id: number; duration_min: number }>();
  if (!appt) return err(c, "Consulta não encontrada.", 404);
  if (["cancelado", "reagendado", "concluido", "nao_compareceu"].includes(appt.status))
    return err(c, "Esta consulta não pode mais ser reagendada.", 409);

  const consumed = await consumeActionToken(c.env.DB, row.id, "reagendar");
  if (!consumed) return err(c, "Este link já foi utilizado.", 410);

  const clinic = await clinicInfo(c.env, clinicId);
  const tz = clinic?.timezone || "America/Sao_Paulo";
  const { rescheduleAppointment } = await import("../lib/appointments");
  const result = await rescheduleAppointment({
    db: c.env.DB, clinicId, timezone: tz, appointmentId: appt.id,
    day: parsed.data.day, time: parsed.data.time, durationMin: appt.duration_min,
    actor: { kind: "patient", name: "paciente" },
    reason: "Solicitado pelo paciente (link seguro)",
    source: "online", settingsSlotMin: settings.scheduling.slot_min,
  });
  if (!result.ok) {
    // Devolve o token para nova tentativa (nada foi alterado).
    await c.env.DB.prepare(`UPDATE action_tokens SET used_at=NULL, used_action='' WHERE id=?1`).bind(row.id).run();
    return err(c, result.message, 409);
  }

  // Cancela lembretes antigos, invalida tokens da consulta antiga e reprograma.
  const { cancelAppointmentJobs, scheduleAppointmentReminders, enqueueConfirmationMessage } = await import("../lib/messaging/jobs");
  await cancelAppointmentJobs(c.env.DB, appt.id, "reagendado pelo paciente");
  await invalidateAppointmentTokens(c.env.DB, appt.id);
  await scheduleAppointmentReminders(c.env, clinicId, result.appointment.id);
  await enqueueConfirmationMessage(c.env, clinicId, result.appointment.id, "confirmacao");

  const local = utcToLocal(tz, result.appointment.starts_at);
  await audit(c.env.DB, null, "appointment.rescheduled_by_patient", "appointment", appt.id, {
    new_id: result.appointment.id, day: parsed.data.day, time: parsed.data.time,
  }, { clinicId });
  return c.json({
    ok: true,
    message: "Consulta reagendada com sucesso!",
    appointment: {
      code: result.appointment.code,
      day: local.day,
      time: formatHHMM(local.minutes),
      professional_name: result.appointment.professional_name,
    },
  });
});

publicRouter.post("/action/:token/cancel", pub, async (c) => {
  const clinicId = cid(c);
  const settings = c.get("settings");
  const row = await loadActionToken(c.env.DB, c.req.param("token"));
  if (!row || row.clinic_id !== clinicId) return err(c, "Link inválido.", 404);
  if (row.used_at) return err(c, "Este link já foi utilizado.", 410);
  if (!tokenIsUsable(row)) return err(c, "Este link expirou.", 410);
  if (!settings.booking.allow_patient_cancel) return err(c, "Cancelamento pelo paciente está desativado.", 403);
  const appt = row.appointment_id ? await getApptForPatient(c.env, clinicId, row.appointment_id) : null;
  if (!appt) return err(c, "Consulta não encontrada.", 404);
  // Limite de antecedência para cancelamento (evita cancelar em cima da hora).
  const leadHours = (new Date(appt.starts_at).getTime() - Date.now()) / 3600_000;
  if (leadHours < settings.booking.cancel_limit_hours)
    return err(c, `Cancelamentos só podem ser feitos com ${settings.booking.cancel_limit_hours}h de antecedência. Ligue para a clínica.`, 409);

  const consumed = await consumeActionToken(c.env.DB, row.id, "cancelar");
  if (!consumed) return err(c, "Este link já foi utilizado.", 410);
  const { cancelAppointment } = await import("../lib/appointments");
  const { cancelAppointmentJobs } = await import("../lib/messaging/jobs");
  const result = await cancelAppointment(c.env.DB, clinicId, appt.id, "paciente", "Cancelado pelo paciente pelo link seguro", {
    kind: "patient", name: "paciente",
  });
  if (!result.ok) return err(c, result.message, 409);
  await cancelAppointmentJobs(c.env.DB, appt.id, "cancelado pelo paciente");
  await invalidateAppointmentTokens(c.env.DB, appt.id);
  await audit(c.env.DB, null, "appointment.cancelled_by_patient", "appointment", appt.id, {}, { clinicId });
  return c.json({ ok: true, message: "Consulta cancelada. Obrigado por avisar!" });
});

async function getApptForPatient(env: Env, clinicId: number, appointmentId: number) {
  return env.DB.prepare(
    `SELECT id, starts_at, status, patient_id FROM appointments WHERE id=?1 AND clinic_id=?2`
  ).bind(appointmentId, clinicId).first<{ id: number; starts_at: string; status: string; patient_id: number }>();
}

// ══════════════════════════════════════════════════════════════════════════
// PORTAL DO PACIENTE
// ══════════════════════════════════════════════════════════════════════════
publicRouter.post("/portal/request-code", pub, async (c) => {
  const clinicId = cid(c);
  const schema = z.object({
    phone: z.string().min(10).max(30),
    birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Informe telefone e data de nascimento.", 422);
  const ip = c.req.header("cf-connecting-ip") || "local";
  if (!(await rateLimit(c.env, `portal:${clinicId}:${ip}`, 6, 30 * 60_000)))
    return err(c, "Muitas tentativas. Tente novamente mais tarde.", 429);

  const patient = await findPatientForPortal(c.env.DB, clinicId, parsed.data.phone, parsed.data.birth_date);
  // Resposta uniforme: não revela se existe cadastro.
  const generic = { ok: true, message: "Se os dados conferirem, enviaremos um código de acesso por WhatsApp." };
  if (!patient) return c.json(generic);

  const { code } = await createPortalCode(c.env.DB, clinicId, patient.id);
  const { loadWhatsAppRow, enqueueJob } = await import("../lib/messaging/jobs");
  const wa = await loadWhatsAppRow(c.env.DB, clinicId);
  let delivered = false;
  if (wa && wa.enabled === 1) {
    delivered = await enqueueJob(c.env.DB, {
      clinicId, patientId: patient.id, kind: "boas_vindas",
      scheduledAt: nowIso(),
      body: `Olá, ${patient.name.split(" ")[0]}! Seu código de acesso ao portal da clínica é ${code}. Vale por 15 minutos.`,
      toPhone: patient.phone,
      idempotencyKey: `portal-code:${patient.id}:${Date.now()}`,
    });
  }
  return c.json({
    ...generic,
    ...(c.env.APP_ENV !== "production" ? { dev_code: code, delivered } : {}),
  });
});

publicRouter.post("/portal/verify", pub, async (c) => {
  const clinicId = cid(c);
  const schema = z.object({
    phone: z.string().min(10).max(30),
    birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    code: z.string().min(6).max(6),
  });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Informe telefone, nascimento e código.", 422);
  const ip = c.req.header("cf-connecting-ip") || "local";
  if (!(await rateLimit(c.env, `portal-verify:${clinicId}:${ip}`, 10, 30 * 60_000)))
    return err(c, "Muitas tentativas. Tente novamente mais tarde.", 429);
  const patient = await findPatientForPortal(c.env.DB, clinicId, parsed.data.phone, parsed.data.birth_date);
  if (!patient) return err(c, "Dados não conferem.", 401);
  const check = await verifyPortalCode(c.env.DB, clinicId, patient.id, parsed.data.code);
  if (!check.ok) return err(c, check.message ?? "Código inválido.", 401);
  const slug = c.get("clinic").slug;
  await createPatientSession(c, slug, clinicId, patient.id);
  return c.json({ ok: true, patient: { name: patient.name } });
});

publicRouter.post("/portal/logout", pub, async (c) => {
  await destroyPatientSession(c);
  return c.json({ ok: true });
});

publicRouter.get("/portal/me", pub, async (c) => {
  const clinicId = cid(c);
  const session = await currentPatient(c);
  if (!session || session.clinic_id !== clinicId) return c.json({ authenticated: false });
  const clinic = await clinicInfo(c.env, clinicId);
  const tz = clinic?.timezone || "America/Sao_Paulo";
  const appointments = await c.env.DB.prepare(
    `SELECT a.id, a.code, a.starts_at, a.status, a.kind, pr.name AS professional_name,
            u.name AS unit_name, proc.name AS procedure_name
       FROM appointments a
       JOIN professionals pr ON pr.id = a.professional_id
       LEFT JOIN units u ON u.id = a.unit_id
       LEFT JOIN procedures proc ON proc.id = a.procedure_id
      WHERE a.clinic_id=?1 AND a.patient_id=?2
      ORDER BY a.starts_at DESC LIMIT 50`
  ).bind(clinicId, session.patient_id).all<Record<string, unknown> & { starts_at: string; id: number; status: string }>();

  const documents = await c.env.DB.prepare(
    `SELECT id, kind, title, issued_at, issued_by_name FROM clinical_documents
      WHERE clinic_id=?1 AND patient_id=?2 AND visible_to_patient=1 AND voided_at IS NULL ORDER BY created_at DESC`
  ).bind(clinicId, session.patient_id).all();

  const settings = c.get("settings");
  return c.json({
    authenticated: true,
    patient: { id: session.patient_id, name: session.name },
    clinic: { name: clinic?.name ?? "", slug: clinic?.slug ?? "", phone: clinic?.phone ?? "", whatsapp: clinic?.whatsapp ?? "" },
    booking: { allow_cancel: settings.booking.allow_patient_cancel, allow_reschedule: settings.booking.allow_patient_reschedule, cancel_limit_hours: settings.booking.cancel_limit_hours },
    appointments: (appointments.results ?? []).map((a) => {
      const local = utcToLocal(tz, a.starts_at as string);
      return { ...a, day: local.day, time: formatHHMM(local.minutes) };
    }),
    documents: documents.results ?? [],
  });
});

/** Documento do paciente (somente os marcados como visíveis). */
publicRouter.get("/portal/documents/:id", pub, async (c) => {
  const clinicId = cid(c);
  const session = await currentPatient(c);
  if (!session || session.clinic_id !== clinicId) return err(c, "Faça login no portal.", 401);
  const doc = await c.env.DB.prepare(
    `SELECT id, kind, title, body, issued_at, issued_by_name, cro, signature_kind
       FROM clinical_documents
      WHERE id=?1 AND clinic_id=?2 AND patient_id=?3 AND visible_to_patient=1 AND voided_at IS NULL`
  ).bind(Number(c.req.param("id")), clinicId, session.patient_id).first<Record<string, unknown>>();
  if (!doc) return err(c, "Documento não encontrado.", 404);
  return c.json({ document: doc });
});

const portalBookSchema = z.object({
  professional_id: z.number().int().positive(),
  procedure_id: z.number().int().positive().nullable().optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  notes: z.string().max(500).default(""),
});

publicRouter.post("/portal/appointments", pub, async (c) => {
  const clinicId = cid(c);
  const session = await currentPatient(c);
  if (!session || session.clinic_id !== clinicId) return err(c, "Faça login no portal.", 401);
  const settings = c.get("settings");
  if (!settings.booking.online_enabled) return err(c, "Agendamento online desativado.", 403);
  const parsed = portalBookSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Confira os dados do agendamento.", 422);
  const d = parsed.data;
  const clinic = await clinicInfo(c.env, clinicId);
  const tz = clinic?.timezone || "America/Sao_Paulo";

  const pro = await c.env.DB.prepare(`SELECT id, slot_min FROM professionals WHERE id=?1 AND clinic_id=?2 AND active=1`)
    .bind(d.professional_id, clinicId).first<{ id: number; slot_min: number }>();
  if (!pro) return err(c, "Profissional indisponível.", 404);
  let duration = settings.scheduling.slot_min;
  let priceCents = 0;
  if (d.procedure_id) {
    const proc = await c.env.DB.prepare(`SELECT duration_min, price_cents FROM procedures WHERE id=?1 AND clinic_id=?2 AND active=1`)
      .bind(d.procedure_id, clinicId).first<{ duration_min: number; price_cents: number }>();
    if (!proc) return err(c, "Procedimento indisponível.", 404);
    duration = proc.duration_min;
    priceCents = proc.price_cents;
  }
  const avail = await dayAvailability({
    db: c.env.DB, clinicId, timezone: tz, professionalId: d.professional_id, day: d.day,
    durationMin: duration, slotMin: pro.slot_min, now: new Date(Date.now() + settings.booking.min_lead_min * 60_000),
  });
  if (!avail.slots.includes(d.time)) return err(c, "Este horário não está mais disponível.", 409);

  const instants = slotToInstants(tz, d.day, d.time, duration);
  if (!instants) return err(c, "Horário inválido.", 422);
  const { createAppointmentGuarded } = await import("../lib/scheduling");
  const created = await createAppointmentGuarded({
    db: c.env.DB, clinicId, timezone: tz, professionalId: d.professional_id,
    patientId: session.patient_id, procedureId: d.procedure_id ?? null,
    startsAt: instants.startsAt, endsAt: instants.endsAt,
    kind: "consulta", source: "online", status: "aguardando_confirmacao",
    patientNotes: d.notes, priceCents, createdBy: null,
  });
  if (!created.ok) return err(c, created.detail, 409);
  const { scheduleAppointmentReminders, enqueueConfirmationMessage } = await import("../lib/messaging/jobs");
  await scheduleAppointmentReminders(c.env, clinicId, created.id);
  await enqueueConfirmationMessage(c.env, clinicId, created.id, "confirmacao");
  await audit(c.env.DB, null, "appointment.portal_created", "appointment", created.id, { day: d.day, time: d.time }, { clinicId });
  return c.json({ ok: true, code: created.code, day: d.day, time: d.time }, 201);
});

publicRouter.post("/portal/appointments/:id/cancel", pub, async (c) => {
  const clinicId = cid(c);
  const session = await currentPatient(c);
  if (!session || session.clinic_id !== clinicId) return err(c, "Faça login no portal.", 401);
  const settings = c.get("settings");
  if (!settings.booking.allow_patient_cancel) return err(c, "Cancelamento pelo portal desativado.", 403);
  const appt = await getApptForPatient(c.env, clinicId, Number(c.req.param("id")));
  if (!appt || appt.patient_id !== session.patient_id) return err(c, "Consulta não encontrada.", 404);
  const leadHours = (new Date(appt.starts_at).getTime() - Date.now()) / 3600_000;
  if (leadHours < settings.booking.cancel_limit_hours)
    return err(c, `Cancelamentos exigem ${settings.booking.cancel_limit_hours}h de antecedência. Ligue para a clínica.`, 409);
  const { cancelAppointment } = await import("../lib/appointments");
  const { cancelAppointmentJobs } = await import("../lib/messaging/jobs");
  const result = await cancelAppointment(c.env.DB, clinicId, appt.id, "paciente", "Cancelado pelo portal do paciente", { kind: "patient", name: "paciente" });
  if (!result.ok) return err(c, result.message, 409);
  await cancelAppointmentJobs(c.env.DB, appt.id, "cancelado pelo paciente");
  await invalidateAppointmentTokens(c.env.DB, appt.id);
  await audit(c.env.DB, null, "appointment.cancelled_by_patient", "appointment", appt.id, { via: "portal" }, { clinicId });
  return c.json({ ok: true, message: "Consulta cancelada." });
});

publicRouter.post("/portal/appointments/:id/reschedule", pub, async (c) => {
  const clinicId = cid(c);
  const session = await currentPatient(c);
  if (!session || session.clinic_id !== clinicId) return err(c, "Faça login no portal.", 401);
  const settings = c.get("settings");
  if (!settings.booking.allow_patient_reschedule) return err(c, "Reagendamento pelo portal desativado.", 403);
  const parsed = actionRescheduleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Informe nova data e horário.", 422);
  const appt = await getApptForPatient(c.env, clinicId, Number(c.req.param("id")));
  if (!appt || appt.patient_id !== session.patient_id) return err(c, "Consulta não encontrada.", 404);

  const clinic = await clinicInfo(c.env, clinicId);
  const tz = clinic?.timezone || "America/Sao_Paulo";
  const duration = await c.env.DB.prepare(
    `SELECT COALESCE(proc.duration_min, ?3) AS duration_min FROM appointments a
       LEFT JOIN procedures proc ON proc.id=a.procedure_id WHERE a.id=?1 AND a.clinic_id=?2`
  ).bind(appt.id, clinicId, settings.scheduling.slot_min).first<{ duration_min: number }>();
  const { rescheduleAppointment } = await import("../lib/appointments");
  const result = await rescheduleAppointment({
    db: c.env.DB, clinicId, timezone: tz, appointmentId: appt.id,
    day: parsed.data.day, time: parsed.data.time, durationMin: duration?.duration_min ?? 30,
    actor: { kind: "patient", name: "paciente" }, reason: "Portal do paciente",
    source: "online", settingsSlotMin: settings.scheduling.slot_min,
  });
  if (!result.ok) return err(c, result.message, 409);
  const { cancelAppointmentJobs, scheduleAppointmentReminders, enqueueConfirmationMessage } = await import("../lib/messaging/jobs");
  await cancelAppointmentJobs(c.env.DB, appt.id, "reagendado pelo paciente");
  await invalidateAppointmentTokens(c.env.DB, appt.id);
  await scheduleAppointmentReminders(c.env, clinicId, result.appointment.id);
  await enqueueConfirmationMessage(c.env, clinicId, result.appointment.id, "confirmacao");
  const local = utcToLocal(tz, result.appointment.starts_at);
  return c.json({ ok: true, code: result.appointment.code, day: local.day, time: formatHHMM(local.minutes) });
});

/** Opt-in/opt-out de lembretes pelo próprio paciente (LGPD). */
publicRouter.post("/portal/consent", pub, async (c) => {
  const clinicId = cid(c);
  const session = await currentPatient(c);
  if (!session || session.clinic_id !== clinicId) return err(c, "Faça login no portal.", 401);
  const body = (await c.req.json().catch(() => null)) as { whatsapp_reminders?: boolean } | null;
  if (typeof body?.whatsapp_reminders !== "boolean") return err(c, "Informe whatsapp_reminders.", 422);
  await c.env.DB.prepare(`UPDATE patients SET whatsapp_optin=?2, optin_at=?3 WHERE id=?1 AND clinic_id=?4`)
    .bind(session.patient_id, body.whatsapp_reminders ? 1 : 0, body.whatsapp_reminders ? nowIso() : null, clinicId).run();
  await c.env.DB.prepare(
    `INSERT INTO consents (clinic_id, patient_id, kind, granted, source) VALUES (?1,?2,'whatsapp_lembretes',?3,'portal')`
  ).bind(clinicId, session.patient_id, body.whatsapp_reminders ? 1 : 0).run();
  if (!body.whatsapp_reminders) {
    await c.env.DB.prepare(`UPDATE message_jobs SET status='cancelado', last_error='consentimento revogado' WHERE patient_id=?1 AND status='pendente'`)
      .bind(session.patient_id).run();
  }
  return c.json({ ok: true });
});

/** Telefone formatado para exibição (helper público, sem dados sensíveis). */
publicRouter.get("/format-phone", pub, (c) => c.json({ formatted: formatPhoneBr(c.req.query("phone") || "") }));
