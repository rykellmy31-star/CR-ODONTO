// ============================================================================
// Fila de lembretes/confirmações (idempotente, com lease no D1).
// Adaptado do TIGU (api/lib/messaging/jobs.ts) — sem cobrança por mensagem.
//
// Regras de negócio:
//  - dois avisos por padrão: 24h e 5h antes (configurável por clínica)
//  - consulta marcada em prazo menor que o menor intervalo: envia UM aviso
//    imediato (se ainda houver folga mínima) e NUNCA lembretes vencidos
//  - nada é enviado para consultas canceladas, concluídas ou já iniciadas
//  - falha do provedor nunca bloqueia a agenda: jobs viram 'falhou' com motivo
//  - chave idempotente (clinic_id + key) impede duplicidade por webhook/cron
// ============================================================================
import type { Env } from "../../types";
import { loadClinicSettings } from "../settings";
import { localToUtc, formatHHMM, utcToLocal, parseHHMM, addDays } from "../time";
import { jsonParse, nowIso } from "../utils";
import { actionLinks, buildVars, loadTemplate, reminderButtons, renderTemplate, type TemplateCode } from "./templates";
import { loadWhatsAppConfig, sendWhatsApp, withinSendWindow, type WhatsAppSettingsRow } from "./provider";

export type JobKind = TemplateCode;

export async function loadWhatsAppRow(db: D1Database, clinicId: number): Promise<WhatsAppSettingsRow | null> {
  return db
    .prepare(
      `SELECT enabled, provider, waba_id, phone_number_id, display_phone, access_token_enc,
              max_per_day, require_optin, send_window_start, send_window_end
         FROM whatsapp_settings WHERE clinic_id = ?1`
    )
    .bind(clinicId)
    .first<WhatsAppSettingsRow>();
}

export async function enqueueJob(
  db: D1Database,
  input: {
    clinicId: number;
    appointmentId?: number | null;
    patientId?: number | null;
    kind: JobKind;
    scheduledAt: string;
    body: string;
    toPhone: string;
    idempotencyKey: string;
    payload?: Record<string, unknown>;
    maxAttempts?: number;
  }
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO message_jobs (clinic_id, appointment_id, patient_id, kind, scheduled_at, body, to_phone,
                                payload, idempotency_key, max_attempts)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
       ON CONFLICT(clinic_id, idempotency_key) DO NOTHING`
    )
    .bind(
      input.clinicId, input.appointmentId ?? null, input.patientId ?? null, input.kind,
      input.scheduledAt, input.body, input.toPhone, JSON.stringify(input.payload ?? {}),
      input.idempotencyKey, input.maxAttempts ?? 3
    )
    .run();
  return (res.meta?.changes ?? 0) === 1;
}

/** Cancela lembretes pendentes de um agendamento (cancelou/reagendou/concluiu). */
export async function cancelAppointmentJobs(db: D1Database, appointmentId: number, reason = ""): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE message_jobs SET status='cancelado', last_error=?2, updated_at=?3
        WHERE appointment_id = ?1 AND status IN ('pendente','enviando')`
    )
    .bind(appointmentId, reason || "agendamento alterado", nowIso())
    .run();
  return res.meta?.changes ?? 0;
}

function clampToWindow(timezone: string, at: Date, startHHMM: string, endHHMM: string): Date {
  const local = utcToLocal(timezone, at);
  const start = parseHHMM(startHHMM);
  const end = parseHHMM(endHHMM);
  if (local.minutes < start) return localToUtc(timezone, local.day, start);
  if (local.minutes > end) return localToUtc(timezone, local.day, end);
  return at;
}

export interface ReminderPlanItem {
  kind: JobKind;
  scheduledAt: string;
  skipped?: string;
}

/**
 * Calcula o plano de lembretes de uma consulta.
 * Exportado para testes automatizados (sem tocar no banco).
 */
export function planReminders(input: {
  startsAt: string;
  timezone: string;
  offsetsMin: number[];
  now: Date;
  sendWindowStart: string;
  sendWindowEnd: string;
  shortNoticeMin: number;
}): ReminderPlanItem[] {
  const starts = new Date(input.startsAt);
  const startMs = starts.getTime();
  const nowMs = input.now.getTime();
  if (startMs <= nowMs) return [{ kind: "lembrete", scheduledAt: nowIso(input.now), skipped: "consulta_no_passado" }];

  const offsets = [...new Set(input.offsetsMin.filter((o) => Number.isFinite(o) && o > 0))].sort((a, b) => b - a);
  const plan: ReminderPlanItem[] = [];
  const minOffset = offsets.length ? Math.min(...offsets) : 60;
  const leadMin = (startMs - nowMs) / 60_000;

  for (const offset of offsets) {
    const at = new Date(startMs - offset * 60_000);
    if (at.getTime() <= nowMs) {
      plan.push({ kind: "lembrete", scheduledAt: nowIso(at), skipped: "intervalo_vencido" });
      continue;
    }
    const clamped = clampToWindow(input.timezone, at, input.sendWindowStart, input.sendWindowEnd);
    if (clamped.getTime() >= startMs) {
      plan.push({ kind: "lembrete", scheduledAt: nowIso(at), skipped: "fora_da_janela_de_envio" });
      continue;
    }
    plan.push({ kind: "lembrete", scheduledAt: nowIso(clamped) });
  }

  const usable = plan.filter((p) => !p.skipped);
  // Consulta marcada em cima da hora: se ainda há folga mínima, envia UM aviso
  // imediato; se estiver muito próxima, não envia lembretes vencidos.
  if (usable.length === 0) {
    if (leadMin > input.shortNoticeMin) {
      const at = new Date(nowMs + 2 * 60_000);
      const clamped = clampToWindow(input.timezone, at, input.sendWindowStart, input.sendWindowEnd);
      if (clamped.getTime() < startMs) plan.push({ kind: "lembrete", scheduledAt: nowIso(clamped) });
      else plan.push({ kind: "lembrete", scheduledAt: nowIso(at), skipped: "sem_janela_antes_da_consulta" });
    } else {
      plan.push({ kind: "lembrete", scheduledAt: nowIso(new Date(startMs - minOffset * 60_000)), skipped: "prazo_curto" });
    }
  }
  return plan;
}

const MONTH_LABEL = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Cria os jobs de lembrete de uma consulta (idempotente). */
export async function scheduleAppointmentReminders(
  env: Env,
  clinicId: number,
  appointmentId: number
): Promise<{ created: number; skipped: number; reason?: string }> {
  const db = env.DB;
  const appt = await db
    .prepare(
      `SELECT a.id, a.starts_at, a.status, a.patient_id, a.clinic_id,
              p.name AS patient_name, p.phone AS patient_phone, p.whatsapp_optin,
              pr.name AS professional_name, u.name AS unit_name, c.name AS clinic_name,
              c.timezone, proc.name AS procedure_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN professionals pr ON pr.id = a.professional_id
         JOIN clinics c ON c.id = a.clinic_id
         LEFT JOIN units u ON u.id = a.unit_id
         LEFT JOIN procedures proc ON proc.id = a.procedure_id
        WHERE a.id = ?1 AND a.clinic_id = ?2`
    )
    .bind(appointmentId, clinicId)
    .first<{
      id: number; starts_at: string; status: string; patient_id: number; clinic_id: number;
      patient_name: string; patient_phone: string; whatsapp_optin: number;
      professional_name: string; unit_name: string | null; clinic_name: string; timezone: string;
      procedure_name: string | null;
    }>();
  if (!appt) return { created: 0, skipped: 0, reason: "agendamento_inexistente" };

  const wa = await loadWhatsAppRow(db, clinicId);
  if (!wa || wa.enabled !== 1) return { created: 0, skipped: 0, reason: "whatsapp_desativado" };
  if (wa.require_optin === 1 && appt.whatsapp_optin !== 1) return { created: 0, skipped: 0, reason: "sem_consentimento" };
  if (["cancelado", "concluido", "reagendado", "nao_compareceu"].includes(appt.status))
    return { created: 0, skipped: 0, reason: "status_sem_lembrete" };

  const settings = await loadClinicSettings(db, clinicId);
  const offsets = jsonParse<number[]>(String(JSON.stringify(settings.reminders.offsets_min)), settings.reminders.offsets_min);

  const plan = planReminders({
    startsAt: appt.starts_at,
    timezone: appt.timezone,
    offsetsMin: offsets,
    now: new Date(),
    sendWindowStart: wa.send_window_start || settings.reminders.send_window_start,
    sendWindowEnd: wa.send_window_end || settings.reminders.send_window_end,
    shortNoticeMin: settings.reminders.short_notice_min,
  });

  // Recria o plano do zero para este agendamento.
  await cancelAppointmentJobs(db, appointmentId, "reprogramado");

  const template = await loadTemplate(db, clinicId, "lembrete");
  const publicUrl = env.PUBLIC_URL || "";
  let created = 0;
  let skipped = 0;
  for (const item of plan) {
    if (item.skipped) {
      skipped++;
      continue;
    }
    const stamp = item.scheduledAt;
    const body = renderTemplate(template, buildVars({
      patientName: appt.patient_name,
      timezone: appt.timezone,
      startsAt: appt.starts_at,
      professionalName: appt.professional_name,
      unitName: appt.unit_name,
      clinicName: appt.clinic_name,
      procedureName: appt.procedure_name,
      link: publicUrl,
    }));
    const ok = await enqueueJob(db, {
      clinicId,
      appointmentId,
      patientId: appt.patient_id,
      kind: "lembrete",
      scheduledAt: stamp,
      body,
      toPhone: appt.patient_phone,
      idempotencyKey: `rem:${appointmentId}:${stamp}`,
      maxAttempts: 3,
    });
    if (ok) created++;
    else skipped++;
  }
  return { created, skipped };
}

export interface ProcessResult {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Processa jobs vencidos. Chamado pelo cron (a cada 5 min) e manualmente pelo
 * painel ("enviar agora"). Lease de 5 minutos impede processamento duplo.
 */
export async function processDueJobs(env: Env, opts: { limit?: number; clinicId?: number } = {}): Promise<ProcessResult> {
  const db = env.DB;
  const limit = Math.min(opts.limit ?? 40, 100);
  const now = nowIso();

  const claimed = await db
    .prepare(
      `UPDATE message_jobs
          SET status='enviando', claimed_at=?1, updated_at=?1
        WHERE id IN (
          SELECT id FROM message_jobs
           WHERE status='pendente' AND scheduled_at <= ?1
             AND (claimed_at IS NULL OR claimed_at < ?2)
             ${opts.clinicId ? "AND clinic_id = ?4" : ""}
           ORDER BY scheduled_at ASC LIMIT ?3)
      RETURNING id, clinic_id, appointment_id, patient_id, kind, body, to_phone, attempts, max_attempts, payload`
    )
    .bind(...(opts.clinicId ? [now, nowIso(new Date(Date.now() - 5 * 60_000)), limit, opts.clinicId] : [now, nowIso(new Date(Date.now() - 5 * 60_000)), limit]))
    .run<{ id: number; clinic_id: number; appointment_id: number | null; patient_id: number | null; kind: string; body: string; to_phone: string; attempts: number; max_attempts: number; payload: string }>();

  const jobs = claimed.results ?? [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of jobs) {
    const config = await loadWhatsAppConfig(env, await loadWhatsAppRow(db, job.clinic_id));
    if (!config) {
      await finishJob(db, job.id, "falhou", "Integração WhatsApp não configurada/ativa");
      failed++;
      continue;
    }

    // Não enviar para consultas canceladas/concluídas (verificação no envio).
    if (job.appointment_id) {
      const appt = await db
        .prepare(`SELECT status, starts_at FROM appointments WHERE id = ?1`)
        .bind(job.appointment_id)
        .first<{ status: string; starts_at: string }>();
      if (!appt || ["cancelado", "concluido", "reagendado", "nao_compareceu"].includes(appt.status)) {
        await finishJob(db, job.id, "cancelado", "Consulta cancelada/concluída antes do envio");
        skipped++;
        continue;
      }
      if (new Date(appt.starts_at).getTime() <= Date.now()) {
        await finishJob(db, job.id, "expirado", "Consulta já iniciada");
        skipped++;
        continue;
      }
    }

    // Janela de envio no fuso da clínica
    const clinicTz = await db
      .prepare(`SELECT timezone FROM clinics WHERE id = ?1`)
      .bind(job.clinic_id)
      .first<{ timezone: string }>();
    const timezone = clinicTz?.timezone || "America/Sao_Paulo";
    const localNow = utcToLocal(timezone, new Date());
    const waRow = await loadWhatsAppRow(db, job.clinic_id);
    const winStart = waRow?.send_window_start || "08:00";
    const winEnd = waRow?.send_window_end || "20:00";
    if (!withinSendWindow(winStart, winEnd, localNow.minutes)) {
      // Reagenda para o início da próxima janela em vez de perder o lembrete.
      const next = localNow.minutes > parseHHMM(winEnd)
        ? localToUtc(timezone, addDays(localNow.day, 1), parseHHMM(winStart))
        : localToUtc(timezone, localNow.day, parseHHMM(winStart));
      await db
        .prepare(`UPDATE message_jobs SET status='pendente', scheduled_at=?2, claimed_at=NULL, updated_at=?3 WHERE id=?1`)
        .bind(job.id, nowIso(next), nowIso())
        .run();
      skipped++;
      continue;
    }

    const payload = jsonParse<{ confirm_token?: string; reschedule_token?: string }>(job.payload, {});
    let buttons: { type: string; reply: { id: string; title: string } }[] | undefined;
    if (payload.confirm_token && payload.reschedule_token) {
      buttons = reminderButtons(env.PUBLIC_URL || "", payload.confirm_token, payload.reschedule_token);
    }

    const result = await sendWhatsApp(env, config, { to: job.to_phone, body: job.body, buttons });
    await db
      .prepare(`INSERT INTO message_attempts (job_id, n, outcome, http_status, error) VALUES (?1,?2,?3,?4,?5)`)
      .bind(job.id, job.attempts + 1, result.outcome, result.httpStatus ?? null, result.error ?? "")
      .run();

    if (result.ok) {
      await db
        .prepare(
          `UPDATE message_jobs SET status='enviado', sent_at=?2, provider_msg_id=?3, attempts=attempts+1,
                  last_error='', claimed_at=NULL, updated_at=?2 WHERE id=?1`
        )
        .bind(job.id, nowIso(), result.providerMessageId ?? "")
        .run();
      sent++;
    } else if (result.outcome === "erro_temporario" && job.attempts + 1 < job.max_attempts) {
      const backoff = 120 * Math.pow(2, job.attempts) * 1000;
      await db
        .prepare(
          `UPDATE message_jobs SET status='pendente', attempts=attempts+1, next_attempt_at=?2,
                  scheduled_at=?2, claimed_at=NULL, last_error=?3, updated_at=?4 WHERE id=?1`
        )
        .bind(job.id, nowIso(new Date(Date.now() + backoff)), (result.error ?? "").slice(0, 300), nowIso())
        .run();
      failed++;
    } else {
      await finishJob(db, job.id, "falhou", (result.error ?? "falha no envio").slice(0, 300));
      failed++;
    }
  }

  return { processed: jobs.length, sent, failed, skipped };
}

async function finishJob(db: D1Database, id: number, status: string, error: string) {
  await db
    .prepare(`UPDATE message_jobs SET status=?2, last_error=?3, claimed_at=NULL, attempts=attempts+1, updated_at=?4 WHERE id=?1`)
    .bind(id, status, error, nowIso())
    .run();
}

/** Enfileira confirmação/reagendamento (envio imediato) de uma consulta. */
export async function enqueueConfirmationMessage(
  env: Env,
  clinicId: number,
  appointmentId: number,
  kind: "confirmacao" | "reagendamento" | "conclusao" | "retorno",
  extra?: { confirmToken?: string; rescheduleToken?: string }
): Promise<boolean> {
  const db = env.DB;
  const appt = await db
    .prepare(
      `SELECT a.starts_at, a.patient_id, p.name AS patient_name, p.phone AS patient_phone, p.whatsapp_optin,
              pr.name AS professional_name, u.name AS unit_name, c.name AS clinic_name, c.slug AS clinic_slug,
              c.timezone, proc.name AS procedure_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN professionals pr ON pr.id = a.professional_id
         JOIN clinics c ON c.id = a.clinic_id
         LEFT JOIN units u ON u.id = a.unit_id
         LEFT JOIN procedures proc ON proc.id = a.procedure_id
        WHERE a.id = ?1 AND a.clinic_id = ?2`
    )
    .bind(appointmentId, clinicId)
    .first<{
      starts_at: string; patient_id: number; patient_name: string; patient_phone: string; whatsapp_optin: number;
      professional_name: string; unit_name: string | null; clinic_name: string; clinic_slug: string; timezone: string; procedure_name: string | null;
    }>();
  if (!appt) return false;
  const wa = await loadWhatsAppRow(db, clinicId);
  if (!wa || wa.enabled !== 1) return false;
  if (wa.require_optin === 1 && appt.whatsapp_optin !== 1) return false;

  const links = extra?.confirmToken && extra?.rescheduleToken
    ? actionLinks(env.PUBLIC_URL || "", appt.clinic_slug, extra.confirmToken, extra.rescheduleToken)
    : { confirm: "", reschedule: "" };

  const template = await loadTemplate(db, clinicId, kind);
  const body = renderTemplate(
    template,
    buildVars({
      patientName: appt.patient_name,
      timezone: appt.timezone,
      startsAt: appt.starts_at,
      professionalName: appt.professional_name,
      unitName: appt.unit_name,
      clinicName: appt.clinic_name,
      procedureName: appt.procedure_name,
      link: kind === "reagendamento" ? links.reschedule : links.confirm,
    })
  );
  return enqueueJob(db, {
    clinicId,
    appointmentId,
    patientId: appt.patient_id,
    kind,
    scheduledAt: nowIso(),
    body,
    toPhone: appt.patient_phone,
    idempotencyKey: `${kind}:${appointmentId}:${Date.now()}`,
    payload: { confirm_token: extra?.confirmToken ?? "", reschedule_token: extra?.rescheduleToken ?? "" },
  });
}

/** Contagem de mensagens do mês (limite do plano). */
export async function monthlyMessageCount(db: D1Database, clinicId: number): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM message_jobs WHERE clinic_id=?1 AND status='enviado' AND sent_at >= date('now','start of month')`)
    .bind(clinicId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export { formatHHMM };
