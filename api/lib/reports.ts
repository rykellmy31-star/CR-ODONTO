// ============================================================================
// Relatórios operacionais simples (sem módulos financeiros avançados).
// Respeita unidade, profissional e período; o filtro de dentista é forçado no
// servidor quando quem consulta é um dentista.
// ============================================================================
import { todayLocal, addDays } from "./time";

export interface ReportFilters {
  from: string;
  to: string;
  unitId?: number | null;
  professionalId?: number | null;
}

function whereFor(clinicId: number, f: ReportFilters) {
  const where = ["a.clinic_id = ?1", "a.local_day >= ?2", "a.local_day <= ?3"];
  const binds: unknown[] = [clinicId, f.from, f.to];
  if (f.unitId) { where.push(`a.unit_id = ?${binds.length + 1}`); binds.push(f.unitId); }
  if (f.professionalId) { where.push(`a.professional_id = ?${binds.length + 1}`); binds.push(f.professionalId); }
  return { where: where.join(" AND "), binds };
}

export async function operationalSummary(db: D1Database, clinicId: number, f: ReportFilters) {
  const { where, binds } = whereFor(clinicId, f);
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN a.status='agendado' THEN 1 ELSE 0 END) AS agendados,
         SUM(CASE WHEN a.status='aguardando_confirmacao' THEN 1 ELSE 0 END) AS aguardando,
         SUM(CASE WHEN a.status='confirmado' THEN 1 ELSE 0 END) AS confirmados,
         SUM(CASE WHEN a.status='chegou' THEN 1 ELSE 0 END) AS chegaram,
         SUM(CASE WHEN a.status='em_atendimento' THEN 1 ELSE 0 END) AS em_atendimento,
         SUM(CASE WHEN a.status='concluido' THEN 1 ELSE 0 END) AS concluidos,
         SUM(CASE WHEN a.status='cancelado' THEN 1 ELSE 0 END) AS cancelados,
         SUM(CASE WHEN a.status='nao_compareceu' THEN 1 ELSE 0 END) AS faltas,
         SUM(CASE WHEN a.status='reagendado' THEN 1 ELSE 0 END) AS reagendados,
         SUM(CASE WHEN a.is_fit_in=1 THEN 1 ELSE 0 END) AS encaixes,
         SUM(CASE WHEN a.confirmed_via='whatsapp' THEN 1 ELSE 0 END) AS confirmados_whatsapp
       FROM appointments a WHERE ${where}`
    )
    .bind(...binds)
    .first<Record<string, number>>();
  return row ?? {};
}

export async function byProfessional(db: D1Database, clinicId: number, f: ReportFilters) {
  const { where, binds } = whereFor(clinicId, f);
  const res = await db
    .prepare(
      `SELECT a.professional_id, pr.name AS professional_name,
              COUNT(*) AS total,
              SUM(CASE WHEN a.status='concluido' THEN 1 ELSE 0 END) AS concluidos,
              SUM(CASE WHEN a.status='nao_compareceu' THEN 1 ELSE 0 END) AS faltas,
              SUM(CASE WHEN a.status='cancelado' THEN 1 ELSE 0 END) AS cancelados
         FROM appointments a JOIN professionals pr ON pr.id = a.professional_id
        WHERE ${where}
        GROUP BY a.professional_id, pr.name
        ORDER BY concluidos DESC, pr.name ASC`
    )
    .bind(...binds)
    .all<{ professional_id: number; professional_name: string; total: number; concluidos: number; faltas: number; cancelados: number }>();
  return res.results ?? [];
}

export async function byDay(db: D1Database, clinicId: number, f: ReportFilters) {
  const { where, binds } = whereFor(clinicId, f);
  const res = await db
    .prepare(
      `SELECT a.local_day AS day,
              COUNT(*) AS total,
              SUM(CASE WHEN a.status='concluido' THEN 1 ELSE 0 END) AS concluidos,
              SUM(CASE WHEN a.status='nao_compareceu' THEN 1 ELSE 0 END) AS faltas
         FROM appointments a WHERE ${where}
        GROUP BY a.local_day ORDER BY a.local_day ASC`
    )
    .bind(...binds)
    .all<{ day: string; total: number; concluidos: number; faltas: number }>();
  return res.results ?? [];
}

/** Pacientes aguardando retorno: concluídos com followup_choice='later'. */
export async function awaitingReturn(db: D1Database, clinicId: number, limit = 50) {
  const res = await db
    .prepare(
      `SELECT a.id, a.code, a.completed_at, a.followup_choice, p.id AS patient_id, p.name AS patient_name, p.phone,
              pr.name AS professional_name,
              (SELECT COUNT(*) FROM appointments nx WHERE nx.parent_appointment_id = a.id AND nx.status NOT IN ('cancelado','reagendado')) AS returns
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN professionals pr ON pr.id = a.professional_id
        WHERE a.clinic_id = ?1 AND a.status='concluido' AND a.followup_choice='later'
        ORDER BY a.completed_at DESC LIMIT ?2`
    )
    .bind(clinicId, Math.min(limit, 200))
    .all<Record<string, unknown>>();
  return res.results ?? [];
}

/** Histórico de confirmações por WhatsApp (para o painel de mensagens). */
export async function whatsappHistory(db: D1Database, clinicId: number, limit = 100) {
  const res = await db
    .prepare(
      `SELECT j.id, j.kind, j.status, j.scheduled_at, j.sent_at, j.last_error, j.attempts,
              p.name AS patient_name, a.code AS appointment_code, a.starts_at
         FROM message_jobs j
         LEFT JOIN patients p ON p.id = j.patient_id
         LEFT JOIN appointments a ON a.id = j.appointment_id
        WHERE j.clinic_id = ?1
        ORDER BY j.created_at DESC LIMIT ?2`
    )
    .bind(clinicId, Math.min(limit, 500))
    .all<Record<string, unknown>>();
  return res.results ?? [];
}

export function defaultRange(timezone: string): { from: string; to: string } {
  const today = todayLocal(timezone);
  return { from: addDays(today, -6), to: today };
}
