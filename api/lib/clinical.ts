// ============================================================================
// Prontuário eletrônico, odontograma, planos de tratamento e documentos.
//
// INTEGRIDADE: registros clínicos são append-only. Correção = novo registro
// com `amends_record_id`; exclusão = `voided_at` + motivo + autor. Toda ação
// gera linha em clinical_record_events (rastreabilidade exigida para
// documentação odontológica).
// ============================================================================
import { sha256hex } from "./crypto";
import { nowIso } from "./utils";
import type { SessionUser } from "../types";

// ── Dentição / odontograma ─────────────────────────────────────────────────
export const PERMANENT_TEETH = [
  "18", "17", "16", "15", "14", "13", "12", "11",
  "21", "22", "23", "24", "25", "26", "27", "28",
  "38", "37", "36", "35", "34", "33", "32", "31",
  "41", "42", "43", "44", "45", "46", "47", "48",
];
export const DECIDUOUS_TEETH = [
  "55", "54", "53", "52", "51", "61", "62", "63", "64", "65",
  "75", "74", "73", "72", "71", "81", "82", "83", "84", "85",
];
export const FACES = ["geral", "mesial", "distal", "oclusal", "vestibular", "lingual", "palatina", "incisal", "cervical"] as const;
export const CONDITIONS = [
  "carie", "restauracao", "ausente", "extracao", "coroa", "endodontia", "implante",
  "fratura", "provisorio", "selante", "limpeza", "planejado", "observacao",
] as const;

export type Face = (typeof FACES)[number];
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABEL: Record<Condition, string> = {
  carie: "Cárie",
  restauracao: "Restauração",
  ausente: "Dente ausente",
  extracao: "Extração",
  coroa: "Coroa",
  endodontia: "Endodontia",
  implante: "Implante",
  fratura: "Fratura",
  provisorio: "Provisório",
  selante: "Selante",
  limpeza: "Limpeza",
  planejado: "Tratamento planejado",
  observacao: "Observação",
};

export function isValidTooth(dentition: "permanente" | "decidua", code: string): boolean {
  const list = dentition === "decidua" ? DECIDUOUS_TEETH : PERMANENT_TEETH;
  return list.includes(String(code));
}

export interface OdontogramEntry {
  id: number;
  dentition: string;
  tooth_code: string;
  face: string;
  condition: Condition;
  status: string;
  notes: string;
  professional_id: number;
  professional_name?: string;
  created_at: string;
  superseded_at: string | null;
}

export async function listOdontogram(
  db: D1Database,
  clinicId: number,
  patientId: number,
  dentition?: "permanente" | "decidua",
  opts: { includeHistory?: boolean } = {}
): Promise<OdontogramEntry[]> {
  const binds: unknown[] = [clinicId, patientId];
  let sql = `SELECT o.id, o.dentition, o.tooth_code, o.face, o.condition, o.status, o.notes,
                    o.professional_id, pr.name AS professional_name, o.created_at, o.superseded_at
               FROM odontogram_entries o
               LEFT JOIN professionals pr ON pr.id = o.professional_id
              WHERE o.clinic_id = ?1 AND o.patient_id = ?2`;
  if (dentition) { sql += ` AND o.dentition = ?3`; binds.push(dentition); }
  if (!opts.includeHistory) sql += ` AND o.superseded_at IS NULL`;
  sql += ` ORDER BY o.tooth_code, o.face, o.created_at DESC`;
  const res = await db.prepare(sql).bind(...binds).all<OdontogramEntry>();
  return res.results ?? [];
}

export async function addOdontogramEntry(
  db: D1Database,
  input: {
    clinicId: number;
    patientId: number;
    professionalId: number;
    userId?: number | null;
    dentition: "permanente" | "decidua";
    toothCode: string;
    face: Face;
    condition: Condition;
    status?: "existente" | "planejado" | "concluido";
    notes?: string;
    planItemId?: number | null;
    recordId?: number | null;
  }
): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  if (!isValidTooth(input.dentition, input.toothCode))
    return { ok: false, message: `Dente ${input.toothCode} não pertence à dentição ${input.dentition}.` };
  if (!FACES.includes(input.face)) return { ok: false, message: "Face dentária inválida." };
  if (!CONDITIONS.includes(input.condition)) return { ok: false, message: "Condição inválida." };

  // Supersede a marcação anterior do mesmo dente+face (histórico preservado).
  await db
    .prepare(
      `UPDATE odontogram_entries SET superseded_at = ?4
        WHERE clinic_id = ?1 AND patient_id = ?2 AND dentition = ?3
          AND tooth_code = ?5 AND face = ?6 AND superseded_at IS NULL`
    )
    .bind(input.clinicId, input.patientId, input.dentition, nowIso(), input.toothCode, input.face)
    .run();

  const res = await db
    .prepare(
      `INSERT INTO odontogram_entries (clinic_id, patient_id, professional_id, author_user_id, dentition,
        tooth_code, face, condition, status, notes, treatment_plan_item_id, record_id)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`
    )
    .bind(
      input.clinicId, input.patientId, input.professionalId, input.userId ?? null, input.dentition,
      input.toothCode, input.face, input.condition, input.status ?? "existente",
      input.notes ?? "", input.planItemId ?? null, input.recordId ?? null
    )
    .run();
  return { ok: true, id: Number(res.meta?.last_row_id ?? 0) };
}

// ── Anamnese ───────────────────────────────────────────────────────────────
export interface AnamnesisInput {
  allergies?: string;
  medications?: string;
  systemic_conditions?: string[];
  surgeries?: string;
  smoker?: "nao" | "sim" | "ex";
  pregnant?: "nao" | "sim" | "na_se_aplica";
  bleeding_disorder?: boolean;
  heart_condition?: boolean;
  diabetes?: boolean;
  hypertension?: boolean;
  notes?: string;
}

export async function saveAnamnesis(
  db: D1Database,
  clinicId: number,
  patientId: number,
  data: AnamnesisInput,
  user: SessionUser | null
) {
  await db
    .prepare(
      `INSERT INTO anamneses (clinic_id, patient_id, allergies, medications, systemic_conditions,
          surgeries, smoker, pregnant, bleeding_disorder, heart_condition, diabetes, hypertension,
          notes, updated_by, updated_by_name, updated_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
       ON CONFLICT(patient_id) DO UPDATE SET
         allergies=?3, medications=?4, systemic_conditions=?5, surgeries=?6, smoker=?7, pregnant=?8,
         bleeding_disorder=?9, heart_condition=?10, diabetes=?11, hypertension=?12, notes=?13,
         updated_by=?14, updated_by_name=?15, updated_at=?16`
    )
    .bind(
      clinicId, patientId, data.allergies ?? "", data.medications ?? "",
      JSON.stringify(data.systemic_conditions ?? []), data.surgeries ?? "",
      data.smoker ?? "nao", data.pregnant ?? "nao",
      data.bleeding_disorder ? 1 : 0, data.heart_condition ? 1 : 0,
      data.diabetes ? 1 : 0, data.hypertension ? 1 : 0,
      data.notes ?? "", user?.id ?? null, user?.name ?? "", nowIso()
    )
    .run();
}

export async function getAnamnesis(db: D1Database, clinicId: number, patientId: number) {
  const row = await db
    .prepare(`SELECT * FROM anamneses WHERE clinic_id = ?1 AND patient_id = ?2`)
    .bind(clinicId, patientId)
    .first<Record<string, unknown> & { systemic_conditions: string }>();
  if (!row) return null;
  return { ...row, systemic_conditions: (() => { try { return JSON.parse(row.systemic_conditions) as string[]; } catch { return []; } })() };
}

// ── Registros clínicos (append-only) ──────────────────────────────────────
export interface ClinicalRecordInput {
  kind: "avaliacao" | "evolucao" | "diagnostico" | "observacao" | "retorno" | "procedimento";
  chief_complaint?: string;
  history?: string;
  diagnosis?: string;
  evolution?: string;
  procedure_done?: string;
  tooth_codes?: string[];
  notes?: string;
  appointment_id?: number | null;
}

export async function createClinicalRecord(
  db: D1Database,
  input: {
    clinicId: number;
    patientId: number;
    professionalId: number;
    user: SessionUser | null;
    data: ClinicalRecordInput;
  }
): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  const d = input.data;
  const hasContent = [d.chief_complaint, d.history, d.diagnosis, d.evolution, d.procedure_done, d.notes]
    .some((v) => (v ?? "").trim().length > 0);
  if (!hasContent) return { ok: false, message: "Preencha ao menos um campo clínico do registro." };

  const res = await db
    .prepare(
      `INSERT INTO clinical_records (clinic_id, patient_id, appointment_id, professional_id, author_user_id,
        author_name, kind, chief_complaint, history, diagnosis, evolution, procedure_done, tooth_codes, notes)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`
    )
    .bind(
      input.clinicId, input.patientId, d.appointment_id ?? null, input.professionalId,
      input.user?.id ?? null, input.user?.name ?? "", d.kind,
      d.chief_complaint ?? "", d.history ?? "", d.diagnosis ?? "", d.evolution ?? "",
      d.procedure_done ?? "", (d.tooth_codes ?? []).join(","), d.notes ?? ""
    )
    .run();
  const id = Number(res.meta?.last_row_id ?? 0);
  await db
    .prepare(`INSERT INTO clinical_record_events (clinic_id, record_id, action, actor_user_id, actor_name) VALUES (?1,?2,'created',?3,?4)`)
    .bind(input.clinicId, id, input.user?.id ?? null, input.user?.name ?? "")
    .run();
  return { ok: true, id };
}

export async function amendClinicalRecord(
  db: D1Database,
  input: { clinicId: number; recordId: number; user: SessionUser | null; reason: string; data: ClinicalRecordInput }
): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
  const origin = await db
    .prepare(`SELECT * FROM clinical_records WHERE id = ?1 AND clinic_id = ?2`)
    .bind(input.recordId, input.clinicId)
    .first<{ id: number; patient_id: number; professional_id: number; appointment_id: number | null; voided_at: string | null }>();
  if (!origin) return { ok: false, message: "Registro não encontrado." };
  if (origin.voided_at) return { ok: false, message: "Registro anulado não pode ser corrigido." };
  if (!input.reason.trim()) return { ok: false, message: "Informe o motivo da correção." };

  const created = await createClinicalRecord(db, {
    clinicId: input.clinicId,
    patientId: origin.patient_id,
    professionalId: origin.professional_id,
    user: input.user,
    data: { ...input.data, appointment_id: input.data.appointment_id ?? origin.appointment_id },
  });
  if (!created.ok) return created;
  await db.prepare(`UPDATE clinical_records SET amends_record_id = ?2 WHERE id = ?1`).bind(created.id, origin.id).run();
  await db
    .prepare(`INSERT INTO clinical_record_events (clinic_id, record_id, action, actor_user_id, actor_name, meta) VALUES (?1,?2,'amended',?3,?4,?5)`)
    .bind(input.clinicId, origin.id, input.user?.id ?? null, input.user?.name ?? "", JSON.stringify({ new_record: created.id, reason: input.reason }))
    .run();
  return created;
}

export async function voidClinicalRecord(
  db: D1Database,
  input: { clinicId: number; recordId: number; user: SessionUser | null; reason: string }
): Promise<{ ok: boolean; message?: string }> {
  if (!input.reason.trim()) return { ok: false, message: "Informe o motivo da anulação." };
  const res = await db
    .prepare(
      `UPDATE clinical_records SET voided_at = ?3, voided_by = ?4, void_reason = ?5
        WHERE id = ?1 AND clinic_id = ?2 AND voided_at IS NULL`
    )
    .bind(input.recordId, input.clinicId, nowIso(), input.user?.id ?? null, input.reason)
    .run();
  if ((res.meta?.changes ?? 0) === 0) return { ok: false, message: "Registro não encontrado ou já anulado." };
  await db
    .prepare(`INSERT INTO clinical_record_events (clinic_id, record_id, action, actor_user_id, actor_name, meta) VALUES (?1,?2,'voided',?3,?4,?5)`)
    .bind(input.clinicId, input.recordId, input.user?.id ?? null, input.user?.name ?? "", JSON.stringify({ reason: input.reason }))
    .run();
  return { ok: true };
}

export async function listClinicalRecords(
  db: D1Database,
  clinicId: number,
  patientId: number,
  opts: { limit?: number; includeVoided?: boolean } = {}
) {
  const limit = Math.min(opts.limit ?? 100, 500);
  const res = await db
    .prepare(
      `SELECT r.*, pr.name AS professional_name, pr.cro AS professional_cro, pr.cro_uf AS professional_cro_uf
         FROM clinical_records r
         JOIN professionals pr ON pr.id = r.professional_id
        WHERE r.clinic_id = ?1 AND r.patient_id = ?2 ${opts.includeVoided ? "" : "AND r.voided_at IS NULL"}
        ORDER BY r.created_at DESC LIMIT ${limit}`
    )
    .bind(clinicId, patientId)
    .all<Record<string, unknown>>();
  return res.results ?? [];
}

// ── Planos de tratamento ──────────────────────────────────────────────────
export async function createTreatmentPlan(
  db: D1Database,
  input: { clinicId: number; patientId: number; professionalId: number; title: string; notes?: string; userId?: number | null }
) {
  const res = await db
    .prepare(
      `INSERT INTO treatment_plans (clinic_id, patient_id, professional_id, title, notes, created_by)
       VALUES (?1,?2,?3,?4,?5,?6)`
    )
    .bind(input.clinicId, input.patientId, input.professionalId, input.title, input.notes ?? "", input.userId ?? null)
    .run();
  return Number(res.meta?.last_row_id ?? 0);
}

export async function addPlanItem(
  db: D1Database,
  input: {
    clinicId: number; planId: number; procedureId?: number | null; professionalId?: number | null;
    description?: string; toothCode?: string; face?: string; sessions?: number; priceCents?: number; notes?: string;
  }
) {
  const owner = await db
    .prepare(`SELECT id FROM treatment_plans WHERE id = ?1 AND clinic_id = ?2`)
    .bind(input.planId, input.clinicId)
    .first();
  if (!owner) return null;
  let description = input.description ?? "";
  let priceCents = input.priceCents ?? 0;
  if (input.procedureId) {
    const proc = await db
      .prepare(`SELECT name, price_cents FROM procedures WHERE id = ?1 AND clinic_id = ?2`)
      .bind(input.procedureId, input.clinicId)
      .first<{ name: string; price_cents: number }>();
    if (proc) {
      if (!description) description = proc.name;
      if (input.priceCents == null) priceCents = proc.price_cents;
    }
  }
  const res = await db
    .prepare(
      `INSERT INTO treatment_plan_items (clinic_id, plan_id, procedure_id, professional_id, description,
         tooth_code, face, sessions_planned, price_cents, notes, sort)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,
         COALESCE((SELECT MAX(sort)+1 FROM treatment_plan_items WHERE plan_id = ?2), 0))`
    )
    .bind(
      input.clinicId, input.planId, input.procedureId ?? null, input.professionalId ?? null,
      description, input.toothCode ?? "", input.face ?? "", input.sessions ?? 1, priceCents, input.notes ?? ""
    )
    .run();
  await recalcPlanTotal(db, input.clinicId, input.planId);
  return Number(res.meta?.last_row_id ?? 0);
}

export async function updatePlanItemStatus(
  db: D1Database,
  input: { clinicId: number; itemId: number; status: "pendente" | "em_andamento" | "concluido" | "cancelado"; userId?: number | null }
) {
  const res = await db
    .prepare(
      `UPDATE treatment_plan_items
          SET status = ?3,
              sessions_done = CASE WHEN ?3='concluido' THEN sessions_planned ELSE sessions_done END,
              completed_at = CASE WHEN ?3='concluido' THEN ?4 ELSE NULL END,
              completed_by = CASE WHEN ?3='concluido' THEN ?5 ELSE NULL END
        WHERE id = ?1 AND clinic_id = ?2`
    )
    .bind(input.itemId, input.clinicId, input.status, nowIso(), input.userId ?? null)
    .run();
  if ((res.meta?.changes ?? 0) === 0) return false;
  const plan = await db
    .prepare(`SELECT plan_id FROM treatment_plan_items WHERE id = ?1 AND clinic_id = ?2`)
    .bind(input.itemId, input.clinicId)
    .first<{ plan_id: number }>();
  if (plan) await maybeClosePlan(db, input.clinicId, plan.plan_id);
  return true;
}

async function recalcPlanTotal(db: D1Database, clinicId: number, planId: number) {
  await db
    .prepare(
      `UPDATE treatment_plans
          SET total_cents = COALESCE((SELECT SUM(price_cents) FROM treatment_plan_items
                                       WHERE plan_id = ?1 AND status <> 'cancelado'), 0),
              updated_at = ?3
        WHERE id = ?1 AND clinic_id = ?2`
    )
    .bind(planId, clinicId, nowIso())
    .run();
}

async function maybeClosePlan(db: D1Database, clinicId: number, planId: number) {
  const pending = await db
    .prepare(`SELECT COUNT(*) AS n FROM treatment_plan_items WHERE plan_id = ?1 AND status IN ('pendente','em_andamento')`)
    .bind(planId)
    .first<{ n: number }>();
  if ((pending?.n ?? 0) === 0) {
    await db
      .prepare(`UPDATE treatment_plans SET status='concluido', closed_at=?3, updated_at=?3 WHERE id=?1 AND clinic_id=?2 AND status='ativo'`)
      .bind(planId, clinicId, nowIso())
      .run();
  }
}

// ── Documentos clínicos ───────────────────────────────────────────────────
export async function createTextDocument(
  db: D1Database,
  input: {
    clinicId: number; patientId: number; appointmentId?: number | null; professionalId?: number | null;
    kind: string; title: string; body: string; visibleToPatient?: boolean; userId?: number | null;
    professionalName?: string; cro?: string; sign?: boolean;
  }
): Promise<number> {
  // Assinatura INTERNA: hash do conteúdo + identificação do profissional.
  // Não é certificação ICP-Brasil; a UI informa isso explicitamente.
  const signature = input.sign
    ? await sha256hex(`${input.clinicId}|${input.patientId}|${input.title}|${input.body}|${input.professionalName ?? ""}|${input.cro ?? ""}`)
    : "";
  const res = await db
    .prepare(
      `INSERT INTO clinical_documents (clinic_id, patient_id, appointment_id, professional_id, kind, title, body,
         visible_to_patient, issued_by_name, cro, signature_hash, signature_kind, created_by)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`
    )
    .bind(
      input.clinicId, input.patientId, input.appointmentId ?? null, input.professionalId ?? null,
      input.kind, input.title, input.body, input.visibleToPatient ? 1 : 0,
      input.professionalName ?? "", input.cro ?? "", signature, input.sign ? "interna" : "",
      input.userId ?? null
    )
    .run();
  return Number(res.meta?.last_row_id ?? 0);
}

export async function listDocuments(db: D1Database, clinicId: number, patientId: number) {
  const res = await db
    .prepare(
      `SELECT d.id, d.kind, d.title, d.body, d.r2_key, d.mime, d.size_bytes, d.issued_at, d.issued_by_name,
              d.cro, d.signature_kind, d.visible_to_patient, d.voided_at, d.created_at
         FROM clinical_documents d
        WHERE d.clinic_id = ?1 AND d.patient_id = ?2
        ORDER BY d.created_at DESC LIMIT 200`
    )
    .bind(clinicId, patientId)
    .all<Record<string, unknown>>();
  return res.results ?? [];
}
