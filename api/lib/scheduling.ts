// ============================================================================
// Motor de disponibilidade e reserva (CR ODONTO)
// Adaptado do TIGU (api/lib/availability.ts), reescrito para odontologia:
//   - escalas individuais por dia da semana (work_schedules)
//   - exceções: férias, folgas, feriados, ausências, bloqueios, horário especial
//   - duração individual do procedimento
//   - sala/cadeira obrigatória por procedimento
//   - encaixes (fit-in) autorizados que ignoram conflito COM alerta
//
// CONCORRÊNCIA: a reserva é um único INSERT ... SELECT ... WHERE NOT EXISTS,
// atômico no SQLite/D1, complementado por índices únicos parciais. Dois pedidos
// simultâneos nunca conseguem ocupar o mesmo horário.
// ============================================================================
import { addDays, formatHHMM, localToUtc, overlaps, parseHHMM, todayLocal, utcToLocal } from "./time";
import { normalizePhone, nowIso, readableCode } from "./utils";

export const ACTIVE_STATUSES = ["agendado", "aguardando_confirmacao", "confirmado", "chegou", "em_atendimento"] as const;
export const INACTIVE_STATUSES = ["cancelado", "reagendado", "nao_compareceu"] as const;
export const ACTIVE_SQL = `('agendado','aguardando_confirmacao','confirmado','chegou','em_atendimento')`;

export interface Interval {
  start: number; // minutos locais desde 00:00
  end: number;
}

export interface AvailabilityInput {
  db: D1Database;
  clinicId: number;
  timezone: string;
  professionalId: number;
  day: string;                 // YYYY-MM-DD local
  durationMin: number;
  slotMin?: number;
  unitId?: number | null;
  excludeAppointmentId?: number | null;
  /** Ignora bloqueios de agenda curtos (usado apenas para exibir encaixe). */
  ignoreBlocks?: boolean;
  /** Inclui horários que já passaram (painel da recepção). */
  allowPast?: boolean;
  now?: Date;
}

export interface DayAvailability {
  day: string;
  weekday: number;
  windows: Interval[];
  busy: Interval[];
  slots: string[];               // "HH:MM"
  slotsDetailed: { time: string; minutes: number; free: boolean }[];
  reason?: string;               // quando não há janela (folga/feriado/férias)
  hasSchedule: boolean;
}

/** Janelas de trabalho do dentista naquele dia (escala + exceções). */
export async function professionalWindows(
  input: Pick<AvailabilityInput, "db" | "clinicId" | "professionalId" | "day" | "unitId">
): Promise<{ windows: Interval[]; reason?: string; hasSchedule: boolean }> {
  const { db, clinicId, professionalId, day } = input;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();

  const schedules = await db
    .prepare(
      `SELECT unit_id, start_min, end_min, break_start_min, break_end_min
         FROM work_schedules
        WHERE professional_id = ?1 AND clinic_id = ?2 AND weekday = ?3 AND active = 1
        ORDER BY start_min`
    )
    .bind(professionalId, clinicId, weekday)
    .all<{ unit_id: number | null; start_min: number; end_min: number; break_start_min: number | null; break_end_min: number | null }>();

  const rows = (schedules.results ?? []).filter(
    (r) => !input.unitId || r.unit_id === null || r.unit_id === input.unitId
  );
  if (rows.length === 0) return { windows: [], hasSchedule: false, reason: "fora_da_escala" };

  let windows: Interval[] = [];
  for (const r of rows) {
    // Divide a janela em torno do intervalo de almoço.
    if (r.break_start_min != null && r.break_end_min != null && r.break_end_min > r.break_start_min) {
      if (r.break_start_min > r.start_min) windows.push({ start: r.start_min, end: r.break_start_min });
      if (r.end_min > r.break_end_min) windows.push({ start: r.break_end_min, end: r.end_min });
    } else {
      windows.push({ start: r.start_min, end: r.end_min });
    }
  }

  // Exceções do dia (do dentista ou da clínica inteira).
  const exceptions = await db
    .prepare(
      `SELECT kind, start_min, end_min FROM schedule_exceptions
        WHERE clinic_id = ?1 AND date = ?2 AND (professional_id = ?3 OR professional_id IS NULL)
          AND (unit_id IS NULL ${input.unitId ? "OR unit_id = ?4" : ""})`
    )
    .bind(...(input.unitId ? [clinicId, day, professionalId, input.unitId] : [clinicId, day, professionalId]))
    .all<{ kind: string; start_min: number | null; end_min: number | null }>();

  let reason: string | undefined;
  for (const ex of exceptions.results ?? []) {
    if (["vacation", "dayoff", "holiday", "absence"].includes(ex.kind) && ex.start_min == null) {
      return { windows: [], hasSchedule: true, reason: ex.kind };
    }
    if (ex.kind === "custom_hours" && ex.start_min != null && ex.end_min != null) {
      windows = [{ start: ex.start_min, end: ex.end_min }];
    }
    if (ex.kind === "block" && ex.start_min != null && ex.end_min != null) {
      windows = subtract(windows, { start: ex.start_min, end: ex.end_min });
      if (windows.length === 0) reason = "bloqueado";
    }
  }
  windows.sort((a, b) => a.start - b.start);
  return { windows, hasSchedule: true, reason };
}

/** Intervalos ocupados: consultas ativas + bloqueios pontuais de agenda. */
export async function professionalBusy(
  input: Pick<AvailabilityInput, "db" | "clinicId" | "professionalId" | "day" | "timezone" | "excludeAppointmentId" | "ignoreBlocks">
): Promise<Interval[]> {
  const { db, clinicId, professionalId, day, timezone } = input;
  const busy: Interval[] = [];

  const appts = await db
    .prepare(
      `SELECT id, starts_at, ends_at FROM appointments
        WHERE professional_id = ?1 AND clinic_id = ?2 AND local_day = ?3
          AND status IN ${ACTIVE_SQL} ${input.excludeAppointmentId ? "AND id <> ?4" : ""}`
    )
    .bind(...(input.excludeAppointmentId ? [professionalId, clinicId, day, input.excludeAppointmentId] : [professionalId, clinicId, day]))
    .all<{ id: number; starts_at: string; ends_at: string }>();

  for (const a of appts.results ?? []) {
    const s = utcToLocal(timezone, a.starts_at);
    const e = utcToLocal(timezone, a.ends_at);
    // Consulta que atravessa a meia-noite: limita ao dia consultado.
    const startMin = s.day === day ? s.minutes : 0;
    const endMin = e.day === day ? e.minutes : 1440;
    if (endMin > startMin) busy.push({ start: startMin, end: endMin });
  }

  if (!input.ignoreBlocks) {
    const blocks = await db
      .prepare(
        `SELECT starts_at, ends_at FROM agenda_blocks
          WHERE clinic_id = ?1 AND (professional_id = ?2 OR professional_id IS NULL)`
      )
      .bind(clinicId, professionalId)
      .all<{ starts_at: string; ends_at: string }>();
    for (const b of blocks.results ?? []) {
      const s = utcToLocal(timezone, b.starts_at);
      const e = utcToLocal(timezone, b.ends_at);
      if (s.day !== day && e.day !== day) continue;
      const startMin = s.day === day ? s.minutes : 0;
      const endMin = e.day === day ? e.minutes : 1440;
      if (endMin > startMin) busy.push({ start: startMin, end: endMin });
    }
  }
  return busy;
}

export function subtract(windows: Interval[], block: Interval): Interval[] {
  const out: Interval[] = [];
  for (const w of windows) {
    if (!overlaps(w.start, w.end, block.start, block.end)) {
      out.push(w);
      continue;
    }
    if (block.start > w.start) out.push({ start: w.start, end: Math.min(block.start, w.end) });
    if (block.end < w.end) out.push({ start: Math.max(block.end, w.start), end: w.end });
  }
  return out.filter((w) => w.end > w.start);
}

/** Grade completa do dia com marcação de livre/ocupado. */
export async function dayAvailability(input: AvailabilityInput): Promise<DayAvailability> {
  const weekday = new Date(`${input.day}T12:00:00Z`).getUTCDay();
  const { windows, reason, hasSchedule } = await professionalWindows(input);
  const busy = await professionalBusy(input);
  const slotMin = input.slotMin && input.slotMin >= 5 ? input.slotMin : 15;
  const nowMinutes = input.now ? utcToLocal(input.timezone, input.now).minutes : null;
  const isToday = input.now ? utcToLocal(input.timezone, input.now).day === input.day : false;

  const slotsDetailed: { time: string; minutes: number; free: boolean }[] = [];
  for (const w of windows) {
    // Alinha ao slot_min a partir do início da janela.
    for (let m = w.start; m + input.durationMin <= w.end; m += slotMin) {
      const free = !busy.some((b) => overlaps(m, m + input.durationMin, b.start, b.end))
        && (!isToday || input.allowPast || nowMinutes === null || m >= nowMinutes);
      slotsDetailed.push({ time: formatHHMM(m), minutes: m, free });
    }
  }
  // Remove duplicatas (janelas que se sobrepõem por configuração equivocada).
  const seen = new Set<number>();
  const unique = slotsDetailed.filter((s) => (seen.has(s.minutes) ? false : (seen.add(s.minutes), true)));

  return {
    day: input.day,
    weekday,
    windows,
    busy,
    slots: unique.filter((s) => s.free).map((s) => s.time),
    slotsDetailed: unique,
    reason: unique.length === 0 ? reason ?? (hasSchedule ? "sem_horario_livre" : "fora_da_escala") : undefined,
    hasSchedule,
  };
}

export interface CreateAppointmentInput {
  db: D1Database;
  clinicId: number;
  timezone: string;
  professionalId: number;
  patientId: number;
  procedureId?: number | null;
  unitId?: number | null;
  roomId?: number | null;
  startsAt: string;              // UTC ISO
  endsAt: string;                // UTC ISO
  status?: string;
  kind?: string;
  source?: string;
  isFitIn?: boolean;
  fitInReason?: string;
  fitInAuthorizedBy?: number | null;
  parentAppointmentId?: number | null;
  rescheduledFromId?: number | null;
  patientNotes?: string;
  internalNotes?: string;
  priceCents?: number;
  createdBy?: number | null;
  confirmedVia?: string;
}

/**
 * Reserva ATÔMICA. Retorna { ok:false, conflict } quando outro registro já
 * ocupa o intervalo (inclusive em requisições simultâneas).
 * Encaixe (isFitIn) é permitido: grava o alerta, o motivo e o responsável,
 * mas NUNCA desloca consultas existentes.
 */
export async function createAppointmentGuarded(
  input: CreateAppointmentInput
): Promise<{ ok: true; id: number; code: string } | { ok: false; conflict: "professional" | "room"; detail: string }> {
  const {
    db, clinicId, timezone, professionalId, patientId, startsAt, endsAt,
    procedureId = null, unitId = null, roomId = null, isFitIn = false,
  } = input;

  if (!(new Date(endsAt).getTime() > new Date(startsAt).getTime()))
    return { ok: false, conflict: "professional", detail: "Horário final deve ser posterior ao inicial." };

  const local = utcToLocal(timezone, startsAt);
  const code = readableCode("CRO");

  // Conflito com bloqueio de agenda
  const block = await db
    .prepare(
      `SELECT id FROM agenda_blocks
        WHERE clinic_id = ?1 AND (professional_id = ?2 OR professional_id IS NULL)
          AND starts_at < ?4 AND ends_at > ?3 LIMIT 1`
    )
    .bind(clinicId, professionalId, startsAt, endsAt)
    .first<{ id: number }>();
  if (block && !isFitIn) {
    // Mesmo com encaixe, um bloqueio explícito exige decisão da equipe:
    // permitimos apenas quando o motivo foi informado (registro de exceção).
    if (!input.fitInReason) return { ok: false, conflict: "professional", detail: "Horário bloqueado na agenda." };
  }

  const stmt = db.prepare(
    `INSERT INTO appointments (
        clinic_id, unit_id, professional_id, patient_id, procedure_id, room_id, code, kind,
        starts_at, ends_at, local_day, status, source, is_fit_in, fit_in_reason, fit_in_authorized_by,
        parent_appointment_id, rescheduled_from_id, patient_notes, internal_notes, price_cents,
        confirmed_via, created_by
     )
     SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23
      WHERE NOT EXISTS (
        SELECT 1 FROM appointments
         WHERE professional_id = ?3 AND clinic_id = ?1
           AND status IN ${ACTIVE_SQL}
           AND starts_at < ?10 AND ends_at > ?9)
        AND (?6 IS NULL OR NOT EXISTS (
        SELECT 1 FROM appointments
         WHERE room_id = ?6 AND clinic_id = ?1
           AND status IN ${ACTIVE_SQL}
           AND starts_at < ?10 AND ends_at > ?9))`
  );

  const result = await stmt
    .bind(
      clinicId, unitId, professionalId, patientId, procedureId, roomId, code,
      input.kind ?? "consulta", startsAt, endsAt, local.day,
      input.status ?? "agendado", input.source ?? "reception",
      isFitIn ? 1 : 0, input.fitInReason ?? "", input.fitInAuthorizedBy ?? null,
      input.parentAppointmentId ?? null, input.rescheduledFromId ?? null,
      input.patientNotes ?? "", input.internalNotes ?? "", input.priceCents ?? 0,
      input.confirmedVia ?? "", input.createdBy ?? null
    )
    .run();

  if ((result.meta?.changes ?? 0) === 0) {
    // Diagnóstico do conflito (a mensagem final é decidida pelo chamador).
    const profBusyRow = await db
      .prepare(
        `SELECT code FROM appointments
          WHERE professional_id = ?1 AND clinic_id = ?2 AND status IN ${ACTIVE_SQL}
            AND starts_at < ?4 AND ends_at > ?3 LIMIT 1`
      )
      .bind(professionalId, clinicId, startsAt, endsAt)
      .first<{ code: string }>();
    if (profBusyRow)
      return { ok: false, conflict: "professional", detail: `O profissional já possui a consulta ${profBusyRow.code} nesse horário.` };
    return { ok: false, conflict: "room", detail: "A sala/cadeira selecionada já está ocupada nesse horário." };
  }

  const row = await db
    .prepare(`SELECT id FROM appointments WHERE clinic_id = ?1 AND code = ?2`)
    .bind(clinicId, code)
    .first<{ id: number }>();
  return { ok: true, id: row?.id ?? 0, code };
}

/** Primeiro horário livre a partir de uma data — usado por retorno e lista de espera. */
export async function nextFreeSlot(
  input: AvailabilityInput & { fromDay?: string; maxDays?: number }
): Promise<{ day: string; time: string } | null> {
  const startDay = input.fromDay ?? input.day;
  const maxDays = input.maxDays ?? 30;
  for (let i = 0; i < maxDays; i++) {
    const day = addDays(startDay, i);
    const avail = await dayAvailability({ ...input, day });
    if (avail.slots.length > 0) return { day, time: avail.slots[0] };
  }
  return null;
}

/** Converte (dia + HH:MM local) em instantes UTC para o procedimento. */
export function slotToInstants(
  timezone: string,
  day: string,
  hhmm: string,
  durationMin: number
): { startsAt: string; endsAt: string } | null {
  const minutes = parseHHMM(hhmm);
  if (minutes + durationMin > 1440) return null;
  const start = localToUtc(timezone, day, minutes);
  const end = localToUtc(timezone, day, minutes + durationMin);
  return { startsAt: nowIso(start), endsAt: nowIso(end) };
}

/** Detecta pacientes duplicados por telefone/CPF/nome+nascimento. */
export async function findPatientDuplicates(
  db: D1Database,
  clinicId: number,
  input: { name?: string; phone?: string; cpf?: string; birth_date?: string; excludeId?: number }
): Promise<{ id: number; name: string; phone: string; reason: string }[]> {
  const phone = normalizePhone(input.phone || "");
  const cpf = (input.cpf || "").replace(/\D/g, "");
  const name = (input.name || "").trim();
  const rows = await db
    .prepare(
      `SELECT id, name, phone, cpf, birth_date FROM patients
        WHERE clinic_id = ?1 AND anonymized_at IS NULL AND active = 1
          AND ( (phone <> '' AND phone = ?2) OR (cpf <> '' AND cpf = ?3) OR (lower(name) = lower(?4) AND birth_date = ?5) )
          ${input.excludeId ? "AND id <> ?6" : ""}
        LIMIT 10`
    )
    .bind(...(input.excludeId ? [clinicId, phone, cpf, name, input.birth_date ?? "", input.excludeId] : [clinicId, phone, cpf, name, input.birth_date ?? ""]))
    .all<{ id: number; name: string; phone: string; cpf: string; birth_date: string }>();

  return (rows.results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    reason: phone && r.phone === phone ? "telefone" : cpf && r.cpf === cpf ? "cpf" : "nome_e_nascimento",
  }));
}

/** Dia local padrão (hoje) para a clínica. */
export function clinicToday(timezone: string): string {
  return todayLocal(timezone);
}
