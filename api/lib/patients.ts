// ============================================================================
// Cadastro de pacientes — busca rápida, prevenção de duplicidade e LGPD.
// ============================================================================
import { findPatientDuplicates } from "./scheduling";
import { isValidCpf, normalizePhone, nowIso, patientCode } from "./utils";

export interface PatientInput {
  name: string;
  birth_date?: string | null;
  cpf?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  guardian_name?: string;
  guardian_phone?: string;
  notes?: string;
  whatsapp_optin?: boolean;
  force_create?: boolean;
}

export async function createPatient(
  db: D1Database,
  clinicId: number,
  input: PatientInput
): Promise<
  | { ok: true; id: number; code: string }
  | { ok: false; message: string; duplicates?: { id: number; name: string; phone: string; reason: string }[] }
> {
  const name = (input.name || "").trim();
  if (name.length < 3) return { ok: false, message: "Informe o nome completo do paciente." };
  const phone = normalizePhone(input.phone || "");
  const cpf = (input.cpf || "").replace(/\D/g, "");
  if (cpf && !isValidCpf(cpf)) return { ok: false, message: "CPF inválido." };
  if (input.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(input.birth_date))
    return { ok: false, message: "Data de nascimento deve estar no formato AAAA-MM-DD." };
  if (input.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email))
    return { ok: false, message: "E-mail inválido." };

  if (!input.force_create) {
    const dups = await findPatientDuplicates(db, clinicId, { name, phone, cpf, birth_date: input.birth_date ?? "" });
    if (dups.length > 0)
      return {
        ok: false,
        message: "Já existe paciente com estes dados. Confirme para cadastrar mesmo assim.",
        duplicates: dups,
      };
  }

  const res = await db
    .prepare(
      `INSERT INTO patients (clinic_id, code, name, birth_date, cpf, phone, email, address, city, state, zip,
         guardian_name, guardian_phone, notes, whatsapp_optin, optin_at)
       VALUES (?1,'PENDENTE',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`
    )
    .bind(
      clinicId, name, input.birth_date || null, cpf, phone, (input.email || "").trim().toLowerCase(),
      input.address ?? "", input.city ?? "", (input.state ?? "").toUpperCase().slice(0, 2), input.zip ?? "",
      input.guardian_name ?? "", normalizePhone(input.guardian_phone ?? ""), input.notes ?? "",
      input.whatsapp_optin ? 1 : 0, input.whatsapp_optin ? nowIso() : null
    )
    .run();
  const id = Number(res.meta?.last_row_id ?? 0);
  const code = patientCode(id);
  await db.prepare(`UPDATE patients SET code = ?2 WHERE id = ?1`).bind(id, code).run();
  if (input.whatsapp_optin) {
    await db
      .prepare(`INSERT INTO consents (clinic_id, patient_id, kind, granted, source) VALUES (?1,?2,'whatsapp_lembretes',1,'panel')`)
      .bind(clinicId, id)
      .run();
  }
  return { ok: true, id, code };
}

export async function updatePatient(
  db: D1Database,
  clinicId: number,
  patientId: number,
  input: Partial<PatientInput>
): Promise<{ ok: boolean; message?: string }> {
  const current = await db
    .prepare(`SELECT id, whatsapp_optin FROM patients WHERE id = ?1 AND clinic_id = ?2`)
    .bind(patientId, clinicId)
    .first<{ id: number; whatsapp_optin: number }>();
  if (!current) return { ok: false, message: "Paciente não encontrado." };
  if (input.cpf && !isValidCpf(input.cpf)) return { ok: false, message: "CPF inválido." };

  const sets: string[] = [];
  const binds: unknown[] = [patientId, clinicId];
  const push = (col: string, value: unknown) => {
    sets.push(`${col} = ?${binds.length + 1}`);
    binds.push(value);
  };
  if (input.name !== undefined) push("name", input.name.trim());
  if (input.birth_date !== undefined) push("birth_date", input.birth_date || null);
  if (input.cpf !== undefined) push("cpf", (input.cpf || "").replace(/\D/g, ""));
  if (input.phone !== undefined) push("phone", normalizePhone(input.phone));
  if (input.email !== undefined) push("email", (input.email || "").trim().toLowerCase());
  if (input.address !== undefined) push("address", input.address);
  if (input.city !== undefined) push("city", input.city);
  if (input.state !== undefined) push("state", (input.state || "").toUpperCase().slice(0, 2));
  if (input.zip !== undefined) push("zip", input.zip);
  if (input.guardian_name !== undefined) push("guardian_name", input.guardian_name);
  if (input.guardian_phone !== undefined) push("guardian_phone", normalizePhone(input.guardian_phone));
  if (input.notes !== undefined) push("notes", input.notes);
  if (input.whatsapp_optin !== undefined) {
    push("whatsapp_optin", input.whatsapp_optin ? 1 : 0);
    push("optin_at", input.whatsapp_optin ? nowIso() : null);
    await db
      .prepare(`INSERT INTO consents (clinic_id, patient_id, kind, granted, source) VALUES (?1,?2,'whatsapp_lembretes',?3,'panel')`)
      .bind(clinicId, patientId, input.whatsapp_optin ? 1 : 0)
      .run();
  }
  if (sets.length === 0) return { ok: true };
  sets.push(`updated_at = ?${binds.length + 1}`);
  binds.push(nowIso());
  const res = await db
    .prepare(`UPDATE patients SET ${sets.join(", ")} WHERE id = ?1 AND clinic_id = ?2`)
    .bind(...binds)
    .run();
  return { ok: (res.meta?.changes ?? 0) > 0 };
}

export async function searchPatients(
  db: D1Database,
  clinicId: number,
  q: string,
  limit = 20
): Promise<{ id: number; code: string; name: string; phone: string; birth_date: string | null; last_visit: string | null }[]> {
  const term = (q || "").trim();
  const digits = normalizePhone(term);
  const like = `%${term.toLowerCase()}%`;
  const res = await db
    .prepare(
      `SELECT p.id, p.code, p.name, p.phone, p.birth_date,
              (SELECT MAX(a.starts_at) FROM appointments a
                WHERE a.patient_id = p.id AND a.status = 'concluido') AS last_visit
         FROM patients p
        WHERE p.clinic_id = ?1 AND p.anonymized_at IS NULL AND p.active = 1
          AND (?2 = '' OR lower(p.name) LIKE ?3 OR p.code LIKE ?4 OR (p.phone <> '' AND p.phone LIKE ?5)
               OR (p.cpf <> '' AND p.cpf = ?6))
        ORDER BY p.name LIMIT ?7`
    )
    .bind(clinicId, term, like, `%${term.toUpperCase()}%`, `%${digits}%`, digits, Math.min(limit, 50))
    .all<{ id: number; code: string; name: string; phone: string; birth_date: string | null; last_visit: string | null }>();
  return res.results ?? [];
}

export async function getPatientOverview(db: D1Database, clinicId: number, patientId: number) {
  const patient = await db
    .prepare(`SELECT * FROM patients WHERE id = ?1 AND clinic_id = ?2`)
    .bind(patientId, clinicId)
    .first<Record<string, unknown>>();
  if (!patient) return null;
  const [upcoming, history, counts, plans] = await Promise.all([
    db
      .prepare(
        `SELECT a.id, a.code, a.starts_at, a.status, a.kind, pr.name AS professional_name, proc.name AS procedure_name
           FROM appointments a
           JOIN professionals pr ON pr.id = a.professional_id
           LEFT JOIN procedures proc ON proc.id = a.procedure_id
          WHERE a.patient_id = ?1 AND a.clinic_id = ?2
            AND a.status IN ('agendado','aguardando_confirmacao','confirmado','chegou','em_atendimento')
          ORDER BY a.starts_at ASC LIMIT 10`
      )
      .bind(patientId, clinicId)
      .all(),
    db
      .prepare(
        `SELECT a.id, a.code, a.starts_at, a.status, a.kind, pr.name AS professional_name, proc.name AS procedure_name
           FROM appointments a
           JOIN professionals pr ON pr.id = a.professional_id
           LEFT JOIN procedures proc ON proc.id = a.procedure_id
          WHERE a.patient_id = ?1 AND a.clinic_id = ?2
          ORDER BY a.starts_at DESC LIMIT 30`
      )
      .bind(patientId, clinicId)
      .all(),
    db
      .prepare(
        `SELECT
           SUM(CASE WHEN status='concluido' THEN 1 ELSE 0 END) AS completed,
           SUM(CASE WHEN status='nao_compareceu' THEN 1 ELSE 0 END) AS no_shows,
           SUM(CASE WHEN status='cancelado' THEN 1 ELSE 0 END) AS cancelled
         FROM appointments WHERE patient_id = ?1 AND clinic_id = ?2`
      )
      .bind(patientId, clinicId)
      .first<{ completed: number; no_shows: number; cancelled: number }>(),
    db
      .prepare(`SELECT id, title, status, total_cents, created_at FROM treatment_plans WHERE patient_id = ?1 AND clinic_id = ?2 ORDER BY created_at DESC`)
      .bind(patientId, clinicId)
      .all(),
  ]);
  return {
    patient,
    upcoming: upcoming.results ?? [],
    history: history.results ?? [],
    counts: counts ?? { completed: 0, no_shows: 0, cancelled: 0 },
    plans: plans.results ?? [],
  };
}

/**
 * LGPD: anonimização preservando o histórico estatístico/agendamentos.
 * Prontuários clínicos são mantidos pelo prazo legal (responsabilidade
 * profissional) e por isso NÃO são apagados por esta função — apenas
 * desvinculados de dados identificáveis na listagem administrativa.
 */
export async function anonymizePatient(
  db: D1Database,
  clinicId: number,
  patientId: number
): Promise<{ ok: boolean; message?: string }> {
  const patient = await db
    .prepare(`SELECT id FROM patients WHERE id = ?1 AND clinic_id = ?2 AND anonymized_at IS NULL`)
    .bind(patientId, clinicId)
    .first();
  if (!patient) return { ok: false, message: "Paciente não encontrado ou já anonimizado." };
  await db
    .prepare(
      `UPDATE patients SET name = 'Paciente anonimizado', phone = '', email = '', cpf = '', address = '',
         city = '', state = '', zip = '', guardian_name = '', guardian_phone = '', notes = '',
         birth_date = NULL, whatsapp_optin = 0, anonymized_at = ?3, active = 0, updated_at = ?3
       WHERE id = ?1 AND clinic_id = ?2`
    )
    .bind(patientId, clinicId, nowIso())
    .run();
  await db
    .prepare(`UPDATE message_jobs SET status='cancelado', last_error='paciente anonimizado' WHERE patient_id = ?1 AND status='pendente'`)
    .bind(patientId)
    .run();
  await db
    .prepare(`UPDATE action_tokens SET used_at = ?2, used_action='anonimizado' WHERE patient_id = ?1 AND used_at IS NULL`)
    .bind(patientId, nowIso())
    .run();
  return { ok: true };
}
