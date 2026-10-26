// ============================================================================
// Ciclo de vida do agendamento (máquina de estados) — CR ODONTO
// Estados: agendado → aguardando_confirmacao → confirmado → chegou →
//          em_atendimento → concluido | cancelado | reagendado | nao_compareceu
//
// Todas as transições são ATÔMICAS (UPDATE ... WHERE status = esperado), o que
// impede dupla confirmação, dupla finalização e condições de corrida.
// ============================================================================
import { audit } from "./audit";
import { createAppointmentGuarded, slotToInstants, type AvailabilityInput } from "./scheduling";
import { dayAvailability } from "./scheduling";
import { nowIso } from "./utils";
import type { SessionUser } from "../types";

export type ApptStatus =
  | "agendado" | "aguardando_confirmacao" | "confirmado" | "chegou"
  | "em_atendimento" | "concluido" | "cancelado" | "reagendado" | "nao_compareceu";

export const STATUS_LABEL: Record<ApptStatus, string> = {
  agendado: "Agendado",
  aguardando_confirmacao: "Aguardando confirmação",
  confirmado: "Confirmado",
  chegou: "Paciente chegou",
  em_atendimento: "Em atendimento",
  concluido: "Concluído",
  cancelado: "Cancelado",
  reagendado: "Reagendado",
  nao_compareceu: "Não compareceu",
};

/** Transições permitidas. Qualquer outra é rejeitada com 409. */
export const TRANSITIONS: Record<ApptStatus, ApptStatus[]> = {
  agendado: ["aguardando_confirmacao", "confirmado", "chegou", "em_atendimento", "cancelado", "nao_compareceu", "reagendado"],
  aguardando_confirmacao: ["confirmado", "chegou", "em_atendimento", "cancelado", "nao_compareceu", "reagendado"],
  confirmado: ["chegou", "em_atendimento", "cancelado", "nao_compareceu", "reagendado"],
  chegou: ["em_atendimento", "concluido", "cancelado", "nao_compareceu"],
  em_atendimento: ["concluido", "cancelado"],
  concluido: [],
  cancelado: [],
  reagendado: [],
  nao_compareceu: [],
};

export const TERMINAL: ApptStatus[] = ["concluido", "cancelado", "reagendado", "nao_compareceu"];

export function canTransition(from: ApptStatus, to: ApptStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export interface AppointmentRow {
  id: number;
  clinic_id: number;
  unit_id: number | null;
  professional_id: number;
  patient_id: number;
  procedure_id: number | null;
  room_id: number | null;
  code: string;
  kind: string;
  starts_at: string;
  ends_at: string;
  local_day: string;
  status: ApptStatus;
  source: string;
  is_fit_in: number;
  patient_notes: string;
  internal_notes: string;
  price_cents: number;
  confirmed_at: string | null;
  confirmed_via: string;
  arrived_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string;
  followup_choice: string;
  patient_name?: string;
  patient_phone?: string;
  patient_code?: string;
  professional_name?: string;
  procedure_name?: string;
  procedure_duration?: number;
  unit_name?: string;
  room_name?: string;
}

const APP_SELECT = `
  SELECT a.*, pa.name AS patient_name, pa.phone AS patient_phone, pa.code AS patient_code,
         pr.name AS professional_name, pr.cro AS professional_cro, pr.cro_uf AS professional_cro_uf,
         p.name AS procedure_name, p.duration_min AS procedure_duration,
         u.name AS unit_name, r.name AS room_name
    FROM appointments a
    JOIN patients pa ON pa.id = a.patient_id
    JOIN professionals pr ON pr.id = a.professional_id
    LEFT JOIN procedures p ON p.id = a.procedure_id
    LEFT JOIN units u ON u.id = a.unit_id
    LEFT JOIN rooms r ON r.id = a.room_id`;

export async function getAppointment(db: D1Database, clinicId: number, id: number): Promise<AppointmentRow | null> {
  return db.prepare(`${APP_SELECT} WHERE a.id = ?1 AND a.clinic_id = ?2`).bind(id, clinicId).first<AppointmentRow>();
}

export async function getAppointmentByCode(db: D1Database, clinicId: number, code: string): Promise<AppointmentRow | null> {
  return db.prepare(`${APP_SELECT} WHERE a.code = ?1 AND a.clinic_id = ?2`).bind(code, clinicId).first<AppointmentRow>();
}

export async function listAppointments(
  db: D1Database,
  clinicId: number,
  filters: {
    from?: string; to?: string; day?: string; professionalId?: number; patientId?: number;
    unitId?: number; status?: string[]; limit?: number;
  }
): Promise<AppointmentRow[]> {
  const where: string[] = ["a.clinic_id = ?1"];
  const binds: unknown[] = [clinicId];
  if (filters.day) { where.push(`a.local_day = ?${binds.length + 1}`); binds.push(filters.day); }
  if (filters.from) { where.push(`a.local_day >= ?${binds.length + 1}`); binds.push(filters.from); }
  if (filters.to) { where.push(`a.local_day <= ?${binds.length + 1}`); binds.push(filters.to); }
  if (filters.professionalId) { where.push(`a.professional_id = ?${binds.length + 1}`); binds.push(filters.professionalId); }
  if (filters.patientId) { where.push(`a.patient_id = ?${binds.length + 1}`); binds.push(filters.patientId); }
  if (filters.unitId) { where.push(`a.unit_id = ?${binds.length + 1}`); binds.push(filters.unitId); }
  if (filters.status?.length) {
    where.push(`a.status IN (${filters.status.map((_, i) => `?${binds.length + 1 + i}`).join(",")})`);
    binds.push(...filters.status);
  }
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  const res = await db
    .prepare(`${APP_SELECT} WHERE ${where.join(" AND ")} ORDER BY a.starts_at ASC LIMIT ${limit}`)
    .bind(...binds)
    .all<AppointmentRow>();
  return res.results ?? [];
}

async function logEvent(
  db: D1Database,
  clinicId: number,
  appointmentId: number,
  from: string,
  to: string,
  actor: { id?: number | null; name?: string; kind?: "staff" | "patient" | "system" },
  note = ""
) {
  await db
    .prepare(
      `INSERT INTO appointment_events (clinic_id, appointment_id, from_status, to_status, actor_user_id, actor_name, actor_kind, note)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
    )
    .bind(clinicId, appointmentId, from, to, actor.id ?? null, actor.name ?? "sistema", actor.kind ?? "staff", note)
    .run();
}

export type TransitionResult =
  | { ok: true; appointment: AppointmentRow }
  | { ok: false; code: "not_found" | "invalid_transition" | "conflict"; message: string };

/**
 * Transição genérica e atômica.
 * `idempotent: true` devolve sucesso quando o status já é o desejado
 * (ex.: paciente toca CONFIRMAR duas vezes).
 */
export async function transitionAppointment(
  db: D1Database,
  clinicId: number,
  appointmentId: number,
  to: ApptStatus,
  opts: {
    actor?: { id?: number | null; name?: string; kind?: "staff" | "patient" | "system" };
    note?: string;
    patch?: Record<string, string | number | null>;
    idempotent?: boolean;
    expectStatus?: ApptStatus;
  } = {}
): Promise<TransitionResult> {
  const current = await getAppointment(db, clinicId, appointmentId);
  if (!current) return { ok: false, code: "not_found", message: "Agendamento não encontrado." };
  if (current.status === to) {
    if (opts.idempotent) return { ok: true, appointment: current };
    return { ok: false, code: "invalid_transition", message: `O agendamento já está como "${STATUS_LABEL[to]}".` };
  }
  if (opts.expectStatus && current.status !== opts.expectStatus) {
    return { ok: false, code: "conflict", message: `O agendamento mudou de estado (agora "${STATUS_LABEL[current.status]}"). Recarregue a agenda.` };
  }
  if (!canTransition(current.status, to))
    return {
      ok: false,
      code: "invalid_transition",
      message: `Não é possível mudar de "${STATUS_LABEL[current.status]}" para "${STATUS_LABEL[to]}".`,
    };

  const sets: string[] = ["status = ?3", "updated_at = ?4"];
  const binds: unknown[] = [appointmentId, clinicId, to, nowIso()];
  for (const [k, v] of Object.entries(opts.patch ?? {})) {
    sets.push(`${k} = ?${binds.length + 1}`);
    binds.push(v);
  }
  binds.push(current.status);
  const sql = `UPDATE appointments SET ${sets.join(", ")} WHERE id = ?1 AND clinic_id = ?2 AND status = ?${binds.length}`;
  const res = await db.prepare(sql).bind(...binds).run();
  if ((res.meta?.changes ?? 0) === 0) {
    return { ok: false, code: "conflict", message: "O agendamento foi alterado por outro usuário. Recarregue a agenda." };
  }
  await logEvent(db, clinicId, appointmentId, current.status, to, opts.actor ?? { kind: "system" }, opts.note ?? "");
  const updated = await getAppointment(db, clinicId, appointmentId);
  return { ok: true, appointment: updated! };
}

/** Confirmação (painel, WhatsApp ou portal). Dupla confirmação é inofensiva. */
export function confirmAppointment(
  db: D1Database, clinicId: number, id: number,
  via: "panel" | "whatsapp" | "portal" | "phone",
  actor?: { id?: number | null; name?: string; kind?: "staff" | "patient" | "system" }
) {
  return transitionAppointment(db, clinicId, id, "confirmado", {
    actor: actor ?? { kind: "system" },
    note: `Confirmação via ${via}`,
    patch: { confirmed_at: nowIso(), confirmed_via: via },
    idempotent: true,
  });
}

export function checkinAppointment(db: D1Database, clinicId: number, id: number, actor?: { id?: number; name?: string }) {
  return transitionAppointment(db, clinicId, id, "chegou", {
    actor: { ...actor, kind: "staff" },
    note: "Paciente chegou à clínica",
    patch: { arrived_at: nowIso() },
    idempotent: true,
  });
}

export function startAppointment(db: D1Database, clinicId: number, id: number, actor?: { id?: number; name?: string }) {
  return transitionAppointment(db, clinicId, id, "em_atendimento", {
    actor: { ...actor, kind: "staff" },
    note: "Atendimento iniciado",
    patch: { started_at: nowIso() },
    idempotent: true,
  });
}

export function cancelAppointment(
  db: D1Database, clinicId: number, id: number,
  reasonCode: string, reason: string,
  actor?: { id?: number | null; name?: string; kind?: "staff" | "patient" | "system" }
) {
  return transitionAppointment(db, clinicId, id, "cancelado", {
    actor: actor ?? { kind: "system" },
    note: reason ? `Cancelado: ${reason}` : `Cancelado (${reasonCode})`,
    patch: { cancelled_at: nowIso(), cancel_reason: reason, cancel_reason_code: reasonCode },
  });
}

export function markNoShow(db: D1Database, clinicId: number, id: number, actor?: { id?: number; name?: string }) {
  return transitionAppointment(db, clinicId, id, "nao_compareceu", {
    actor: { ...actor, kind: "staff" },
    note: "Paciente não compareceu",
    patch: { no_show_at: nowIso() },
  });
}

export interface FinalizeInput {
  db: D1Database;
  clinicId: number;
  appointmentId: number;
  actor: { id?: number | null; name?: string };
  followupChoice: "scheduled" | "later" | "none";
  /** Registro clínico obrigatório (quando a clínica exige). */
  requireRecord: boolean;
  payment?: {
    amount_cents?: number | null;
    method: string;
    note?: string;
  } | null;
  returnAppointment?: { day: string; time: string; durationMin: number; procedureId?: number | null; unitId?: number | null } | null;
  timezone: string;
}

export type FinalizeResult =
  | { ok: true; appointment: AppointmentRow; returnAppointmentId?: number; recordMissing: boolean }
  | { ok: false; message: string; needsRecord?: boolean; returnConflict?: string };

/**
 * FINALIZAR ATENDIMENTO — prioridade máxima de usabilidade.
 * 1 clique: conclui, registra autor/horário, atualiza histórico e agenda.
 * Nenhum campo financeiro é obrigatório.
 */
export async function finalizeAppointment(input: FinalizeInput): Promise<FinalizeResult> {
  const { db, clinicId, appointmentId, actor, requireRecord } = input;
  const appt = await getAppointment(db, clinicId, appointmentId);
  if (!appt) return { ok: false, message: "Agendamento não encontrado." };
  if (appt.status === "concluido")
    return { ok: false, message: "Este atendimento já foi finalizado." };
  if (TERMINAL.includes(appt.status))
    return { ok: false, message: `Não é possível finalizar um atendimento "${STATUS_LABEL[appt.status]}".` };

  const recordCount = await db
    .prepare(`SELECT COUNT(*) AS n FROM clinical_records WHERE appointment_id = ?1 AND voided_at IS NULL`)
    .bind(appointmentId)
    .first<{ n: number }>();
  const hasRecord = (recordCount?.n ?? 0) > 0;
  if (requireRecord && !hasRecord)
    return {
      ok: false,
      needsRecord: true,
      message: "Registre a evolução clínica do atendimento antes de finalizar (exigência configurada pela clínica).",
    };

  // Se vai agendar o retorno agora, a nova consulta é criada ANTES de concluir,
  // garantindo que o horário exista de fato.
  let returnAppointmentId: number | undefined;
  if (input.followupChoice === "scheduled") {
    const ret = input.returnAppointment;
    if (!ret) return { ok: false, message: "Informe data e horário do retorno." };
    const instants = slotToInstants(input.timezone, ret.day, ret.time, ret.durationMin);
    if (!instants) return { ok: false, message: "Horário de retorno inválido." };
    const created = await createAppointmentGuarded({
      db,
      clinicId,
      timezone: input.timezone,
      professionalId: appt.professional_id,
      patientId: appt.patient_id,
      procedureId: ret.procedureId ?? appt.procedure_id ?? null,
      unitId: ret.unitId ?? appt.unit_id ?? null,
      roomId: appt.room_id ?? null,
      startsAt: instants.startsAt,
      endsAt: instants.endsAt,
      kind: "retorno",
      source: "return",
      parentAppointmentId: appt.id,
      internalNotes: `Retorno do atendimento ${appt.code}`,
      createdBy: actor.id ?? null,
    });
    if (!created.ok) return { ok: false, message: created.detail, returnConflict: created.conflict };
    returnAppointmentId = created.id;
  }

  const result = await transitionAppointment(db, clinicId, appointmentId, "concluido", {
    actor: { ...actor, kind: "staff" },
    note: `Atendimento finalizado. Retorno: ${input.followupChoice === "scheduled" ? "agendado" : input.followupChoice}.`,
    patch: { completed_at: nowIso(), completed_by: actor.id ?? null, followup_choice: input.followupChoice },
  });
  if (!result.ok) return { ok: false, message: result.message };

  if (input.payment && input.payment.method) {
    await recordPayment(db, clinicId, appointmentId, input.payment, actor);
  }
  return { ok: true, appointment: result.appointment, returnAppointmentId, recordMissing: !hasRecord };
}

/** Registro OPCIONAL de pagamento — nunca obrigatório, nunca processa cobrança. */
export async function recordPayment(
  db: D1Database,
  clinicId: number,
  appointmentId: number,
  payment: { amount_cents?: number | null; method: string; note?: string },
  actor: { id?: number | null; name?: string }
): Promise<{ ok: boolean; message?: string }> {
  const methods = ["pix", "dinheiro", "cartao_credito", "cartao_debito", "transferencia", "pendente", "outro", "nao_informado"];
  if (!methods.includes(payment.method)) return { ok: false, message: "Forma de pagamento inválida." };
  if (payment.amount_cents != null && (!Number.isInteger(payment.amount_cents) || payment.amount_cents < 0))
    return { ok: false, message: "Valor inválido." };
  const appt = await db.prepare(`SELECT id FROM appointments WHERE id=?1 AND clinic_id=?2`).bind(appointmentId, clinicId).first();
  if (!appt) return { ok: false, message: "Agendamento não encontrado." };
  // Uso de INSERT ... ON CONFLICT mantém 1 registro por atendimento (idempotente).
  const existing = await db
    .prepare(`SELECT id FROM appointment_payments WHERE appointment_id = ?1 AND clinic_id = ?2`)
    .bind(appointmentId, clinicId)
    .first<{ id: number }>();
  if (existing) {
    await db
      .prepare(`UPDATE appointment_payments SET amount_cents=?3, method=?4, note=?5, recorded_by=?6, created_at=?7 WHERE id=?1 AND clinic_id=?2`)
      .bind(existing.id, clinicId, payment.amount_cents ?? null, payment.method, payment.note ?? "", actor.id ?? null, nowIso())
      .run();
    return { ok: true };
  }
  await db
    .prepare(
      `INSERT INTO appointment_payments (clinic_id, appointment_id, amount_cents, method, note, recorded_by)
       VALUES (?1,?2,?3,?4,?5,?6)`
    )
    .bind(clinicId, appointmentId, payment.amount_cents ?? null, payment.method, payment.note ?? "", actor.id ?? null)
    .run();
  return { ok: true };
}

export interface RescheduleInput {
  db: D1Database;
  clinicId: number;
  timezone: string;
  appointmentId: number;
  day: string;
  time: string;
  durationMin: number;
  actor: { id?: number | null; name?: string; kind?: "staff" | "patient" | "system" };
  reason?: string;
  source?: string;
  checkBookable?: boolean;
  settingsSlotMin?: number;
}

/**
 * Reagendamento seguro:
 *  - valida disponibilidade real (escala, férias, bloqueios, duração)
 *  - cria a NOVA reserva primeiro; só então marca a antiga como "reagendado"
 *  - se a nova reserva falhar, o horário original permanece intacto
 *  - os lembretes são reprocessados pelo chamador (cancelar antigos / criar novos)
 */
export async function rescheduleAppointment(
  input: RescheduleInput
): Promise<{ ok: true; appointment: AppointmentRow; oldId: number } | { ok: false; message: string }> {
  const { db, clinicId, timezone, appointmentId, day, time, durationMin, actor } = input;
  const appt = await getAppointment(db, clinicId, appointmentId);
  if (!appt) return { ok: false, message: "Agendamento não encontrado." };
  if (TERMINAL.includes(appt.status)) return { ok: false, message: "Este agendamento não pode mais ser reagendado." };

  if (input.checkBookable !== false) {
    const avail = await dayAvailability({
      db, clinicId, timezone,
      professionalId: appt.professional_id,
      day,
      durationMin,
      slotMin: input.settingsSlotMin ?? 15,
      excludeAppointmentId: appointmentId,
      allowPast: actor.kind === "staff",
    });
    if (!avail.slots.includes(time))
      return { ok: false, message: "O horário escolhido não está mais disponível. Escolha outro." };
  }

  const instants = slotToInstants(timezone, day, time, durationMin);
  if (!instants) return { ok: false, message: "Horário inválido." };

  const created = await createAppointmentGuarded({
    db, clinicId, timezone,
    professionalId: appt.professional_id,
    patientId: appt.patient_id,
    procedureId: appt.procedure_id,
    unitId: appt.unit_id,
    roomId: appt.room_id,
    startsAt: instants.startsAt,
    endsAt: instants.endsAt,
    kind: appt.kind,
    source: input.source ?? "reception",
    rescheduledFromId: appt.id,
    patientNotes: appt.patient_notes,
    internalNotes: appt.internal_notes,
    priceCents: appt.price_cents,
    createdBy: actor.id ?? null,
  });
  if (!created.ok) return { ok: false, message: created.detail };

  const marked = await transitionAppointment(db, clinicId, appt.id, "reagendado", {
    actor,
    note: input.reason ? `Reagendado: ${input.reason}` : `Reagendado para ${day} ${time}`,
    patch: { rescheduled_to_id: created.id },
  });
  if (!marked.ok) {
    // Rollback lógico: cancela a reserva nova para não deixar órfãos.
    await db.prepare(`DELETE FROM appointments WHERE id = ?1 AND clinic_id = ?2 AND status = 'agendado'`).bind(created.id, clinicId).run();
    return { ok: false, message: marked.message };
  }

  await audit(db, null, "appointment.rescheduled", "appointment", appt.id, { to: created.code, day, time }, { clinicId });
  const fresh = await getAppointment(db, clinicId, created.id);
  return { ok: true, appointment: fresh!, oldId: appt.id };
}

/** Lista de espera + encaixe: primeiro horário livre em um intervalo de dias. */
export async function findFitInCandidates(
  base: AvailabilityInput,
  days = 7
): Promise<{ day: string; freeSlots: string[] }[]> {
  const out: { day: string; freeSlots: string[] }[] = [];
  const start = base.day;
  for (let i = 0; i < days; i++) {
    const d = new Date(`${start}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const day = d.toISOString().slice(0, 10);
    const avail = await dayAvailability({ ...base, day });
    if (avail.slots.length) out.push({ day, freeSlots: avail.slots.slice(0, 6) });
  }
  return out;
}

/** Registra evento de auditoria de visualização de prontuário (LGPD). */
export async function logRecordView(db: D1Database, clinicId: number, recordId: number, user: SessionUser | null) {
  await db
    .prepare(`INSERT INTO clinical_record_events (clinic_id, record_id, action, actor_user_id, actor_name) VALUES (?1,?2,'viewed',?3,?4)`)
    .bind(clinicId, recordId, user?.id ?? null, user?.name ?? "sistema")
    .run();
}
