// ============================================================================
// Painel do dentista (/api/c/:slug/pro/*) e registros clínicos.
// Acesso a prontuário exige papel autorizado (clinic_admin/dentist ou
// recepção explicitamente liberada). O dentista só acessa pacientes que
// tenham vínculo assistencial com ele (consulta registrada).
// ============================================================================
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { tenantMiddleware, cid } from "../lib/tenant";
import { audit } from "../lib/audit";
import { err, nowIso } from "../lib/utils";
import { addDays, todayLocal } from "../lib/time";
import {
  addOdontogramEntry, addPlanItem, amendClinicalRecord, createClinicalRecord, createTextDocument,
  createTreatmentPlan, getAnamnesis, listClinicalRecords, listDocuments, listOdontogram,
  saveAnamnesis, updatePlanItemStatus, voidClinicalRecord, FACES, CONDITIONS,
} from "../lib/clinical";
import { getPatientOverview } from "../lib/patients";

export const proRouter = new Hono<{ Bindings: Env }>();
const guard = tenantMiddleware({ auth: "records" });

async function clinicTz(env: Env, clinicId: number): Promise<string> {
  const row = await env.DB.prepare(`SELECT timezone FROM clinics WHERE id = ?1`).bind(clinicId).first<{ timezone: string }>();
  return row?.timezone || "America/Sao_Paulo";
}

/** Dentista: só pacientes com consulta na própria agenda. Admin: todos. */
async function patientAccessible(
  env: Env, clinicId: number, patientId: number, role: string, professionalId: number | null
): Promise<boolean> {
  const patient = await env.DB.prepare(`SELECT id FROM patients WHERE id=?1 AND clinic_id=?2 AND anonymized_at IS NULL`)
    .bind(patientId, clinicId).first();
  if (!patient) return false;
  if (role !== "dentist") return true;
  if (!professionalId) return false;
  const link = await env.DB.prepare(
    `SELECT 1 AS ok FROM appointments WHERE clinic_id=?1 AND patient_id=?2 AND professional_id=?3 LIMIT 1`
  ).bind(clinicId, patientId, professionalId).first();
  return Boolean(link);
}

proRouter.use("*", guard);

// ── Minha agenda ──────────────────────────────────────────────────────────
proRouter.get("/agenda", async (c) => {
  const clinicId = cid(c);
  const clinic = c.get("clinic");
  const tz = await clinicTz(c.env, clinicId);
  const day = c.req.query("day") || todayLocal(tz);
  const professionalId = clinic.role === "dentist" ? clinic.professional_id : Number(c.req.query("professional_id") || 0) || null;
  const { listAppointments } = await import("../lib/appointments");
  const appointments = await listAppointments(c.env.DB, clinicId, {
    day, professionalId: professionalId ?? undefined, limit: 200,
  });
  return c.json({ day, timezone: tz, appointments });
});

proRouter.get("/today", async (c) => {
  const clinicId = cid(c);
  const clinic = c.get("clinic");
  const tz = await clinicTz(c.env, clinicId);
  const today = todayLocal(tz);
  const { listAppointments } = await import("../lib/appointments");
  const professionalId = clinic.role === "dentist" ? clinic.professional_id ?? undefined : undefined;
  const appointments = await listAppointments(c.env.DB, clinicId, { day: today, professionalId, limit: 200 });
  const next = appointments.find((a) =>
    ["agendado", "aguardando_confirmacao", "confirmado", "chegou", "em_atendimento"].includes(a.status)
  );
  return c.json({ today, timezone: tz, appointments, next: next ?? null });
});

// ── Prontuário completo do paciente ───────────────────────────────────────
proRouter.get("/patients/:id/clinical", async (c) => {
  const clinicId = cid(c);
  const clinic = c.get("clinic");
  const patientId = Number(c.req.param("id"));
  if (!(await patientAccessible(c.env, clinicId, patientId, clinic.role, clinic.professional_id)))
    return err(c, "Paciente não vinculado à sua agenda.", 403);

  const settings = c.get("settings");
  const [overview, anamnesis, records, odontogram, plans, documents] = await Promise.all([
    getPatientOverview(c.env.DB, clinicId, patientId),
    getAnamnesis(c.env.DB, clinicId, patientId),
    listClinicalRecords(c.env.DB, clinicId, patientId, { limit: 100 }),
    listOdontogram(c.env.DB, clinicId, patientId, undefined, { includeHistory: false }),
    c.env.DB.prepare(
      `SELECT tp.id, tp.title, tp.status, tp.total_cents, tp.created_at, tp.closed_at, pr.name AS professional_name,
              (SELECT COUNT(*) FROM treatment_plan_items i WHERE i.plan_id=tp.id) AS items,
              (SELECT COUNT(*) FROM treatment_plan_items i WHERE i.plan_id=tp.id AND i.status='concluido') AS done
         FROM treatment_plans tp JOIN professionals pr ON pr.id = tp.professional_id
        WHERE tp.clinic_id=?1 AND tp.patient_id=?2 ORDER BY tp.created_at DESC`
    ).bind(clinicId, patientId).all(),
    listDocuments(c.env.DB, clinicId, patientId),
  ]);
  if (!overview) return err(c, "Paciente não encontrado.", 404);

  // Auditoria de acesso a dados clínicos (LGPD).
  await audit(c.env.DB, c.get("user"), "clinical.record_viewed", "patient", patientId, {});
  return c.json({
    overview,
    anamnesis,
    records,
    odontogram,
    plans: plans.results ?? [],
    documents,
    settings: {
      require_anamnesis_before_first_visit: settings.clinical.require_anamnesis_before_first_visit,
      require_record_on_finish: settings.clinical.require_record_on_finish,
      odontogram_default_dentition: settings.clinical.odontogram_default_dentition,
    },
  });
});

proRouter.post("/patients/:id/anamnesis", async (c) => {
  const clinicId = cid(c);
  const clinic = c.get("clinic");
  const patientId = Number(c.req.param("id"));
  if (!(await patientAccessible(c.env, clinicId, patientId, clinic.role, clinic.professional_id)))
    return err(c, "Paciente não vinculado à sua agenda.", 403);
  const schema = z.object({
    allergies: z.string().max(1000).default(""),
    medications: z.string().max(1000).default(""),
    systemic_conditions: z.array(z.string().max(120)).max(30).default([]),
    surgeries: z.string().max(1000).default(""),
    smoker: z.enum(["nao", "sim", "ex"]).default("nao"),
    pregnant: z.enum(["nao", "sim", "na_se_aplica"]).default("nao"),
    bleeding_disorder: z.boolean().default(false),
    heart_condition: z.boolean().default(false),
    diabetes: z.boolean().default(false),
    hypertension: z.boolean().default(false),
    notes: z.string().max(2000).default(""),
  });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados da anamnese inválidos.", 422);
  await saveAnamnesis(c.env.DB, clinicId, patientId, parsed.data, c.get("user"));
  await audit(c.env.DB, c.get("user"), "clinical.anamnesis_saved", "patient", patientId, {});
  return c.json({ ok: true });
});

const recordSchema = z.object({
  kind: z.enum(["avaliacao", "evolucao", "diagnostico", "observacao", "retorno", "procedimento"]),
  chief_complaint: z.string().max(1000).default(""),
  history: z.string().max(2000).default(""),
  diagnosis: z.string().max(2000).default(""),
  evolution: z.string().max(5000).default(""),
  procedure_done: z.string().max(1000).default(""),
  tooth_codes: z.array(z.string().max(4)).max(32).default([]),
  notes: z.string().max(2000).default(""),
  appointment_id: z.number().int().positive().nullable().optional(),
});

proRouter.post("/patients/:id/records", async (c) => {
  const clinicId = cid(c);
  const clinic = c.get("clinic");
  const patientId = Number(c.req.param("id"));
  if (!(await patientAccessible(c.env, clinicId, patientId, clinic.role, clinic.professional_id)))
    return err(c, "Paciente não vinculado à sua agenda.", 403);
  const parsed = recordSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Registro inválido.", 422, parsed.error.flatten().fieldErrors);

  let professionalId = clinic.professional_id;
  if (!professionalId) {
    if (parsed.data.appointment_id) {
      const appt = await c.env.DB.prepare(`SELECT professional_id FROM appointments WHERE id=?1 AND clinic_id=?2 AND patient_id=?3`)
        .bind(parsed.data.appointment_id, clinicId, patientId).first<{ professional_id: number }>();
      professionalId = appt?.professional_id ?? null;
    }
    if (!professionalId)
      return err(c, "Selecione o atendimento vinculado ou entre com o perfil do dentista responsável.", 422);
  }

  const result = await createClinicalRecord(c.env.DB, {
    clinicId, patientId, professionalId, user: c.get("user"), data: parsed.data,
  });
  if (!result.ok) return err(c, result.message, 422);
  await audit(c.env.DB, c.get("user"), "clinical.record_created", "clinical_record", result.id, { kind: parsed.data.kind });
  return c.json({ ok: true, id: result.id }, 201);
});

proRouter.post("/records/:id/amend", async (c) => {
  const clinicId = cid(c);
  const schema = z.object({ reason: z.string().min(5).max(500), data: recordSchema });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Informe o motivo (mín. 5 caracteres) e os dados corrigidos.", 422);
  const result = await amendClinicalRecord(c.env.DB, {
    clinicId, recordId: Number(c.req.param("id")), user: c.get("user"),
    reason: parsed.data.reason, data: parsed.data.data,
  });
  if (!result.ok) return err(c, result.message, 422);
  await audit(c.env.DB, c.get("user"), "clinical.record_amended", "clinical_record", Number(c.req.param("id")), { new_id: result.id });
  return c.json({ ok: true, id: result.id });
});

proRouter.post("/records/:id/void", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { reason?: string } | null;
  const result = await voidClinicalRecord(c.env.DB, {
    clinicId: cid(c), recordId: Number(c.req.param("id")), user: c.get("user"), reason: body?.reason ?? "",
  });
  if (!result.ok) return err(c, result.message ?? "Não foi possível anular.", 422);
  await audit(c.env.DB, c.get("user"), "clinical.record_voided", "clinical_record", Number(c.req.param("id")), { reason: body?.reason });
  return c.json({ ok: true });
});

// ── Odontograma ───────────────────────────────────────────────────────────
proRouter.get("/patients/:id/odontogram", async (c) => {
  const clinicId = cid(c);
  const clinic = c.get("clinic");
  const patientId = Number(c.req.param("id"));
  if (!(await patientAccessible(c.env, clinicId, patientId, clinic.role, clinic.professional_id)))
    return err(c, "Paciente não vinculado à sua agenda.", 403);
  const dentition = c.req.query("dentition") === "decidua" ? "decidua" : undefined;
  const entries = await listOdontogram(c.env.DB, clinicId, patientId, dentition, {
    includeHistory: c.req.query("history") === "1",
  });
  return c.json({ entries, faces: FACES, conditions: CONDITIONS });
});

const odontoSchema = z.object({
  dentition: z.enum(["permanente", "decidua"]).default("permanente"),
  tooth_code: z.string().min(2).max(2),
  face: z.enum(FACES),
  condition: z.enum(CONDITIONS),
  status: z.enum(["existente", "planejado", "concluido"]).default("existente"),
  notes: z.string().max(500).default(""),
  plan_item_id: z.number().int().positive().nullable().optional(),
  record_id: z.number().int().positive().nullable().optional(),
});

proRouter.post("/patients/:id/odontogram", async (c) => {
  const clinicId = cid(c);
  const clinic = c.get("clinic");
  const patientId = Number(c.req.param("id"));
  if (!(await patientAccessible(c.env, clinicId, patientId, clinic.role, clinic.professional_id)))
    return err(c, "Paciente não vinculado à sua agenda.", 403);
  const parsed = odontoSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Marcação do odontograma inválida.", 422, parsed.error.flatten().fieldErrors);
  const d = parsed.data;
  const professionalId = clinic.professional_id ?? (await c.env.DB
    .prepare(`SELECT professional_id FROM appointments WHERE clinic_id=?1 AND patient_id=?2 ORDER BY starts_at DESC LIMIT 1`)
    .bind(clinicId, patientId).first<{ professional_id: number }>())?.professional_id;
  if (!professionalId) return err(c, "É necessário um dentista responsável para registrar o odontograma.", 422);
  const result = await addOdontogramEntry(c.env.DB, {
    clinicId, patientId, professionalId, userId: c.get("user").id,
    dentition: d.dentition, toothCode: d.tooth_code, face: d.face, condition: d.condition,
    status: d.status, notes: d.notes, planItemId: d.plan_item_id ?? null, recordId: d.record_id ?? null,
  });
  if (!result.ok) return err(c, result.message, 422);
  await audit(c.env.DB, c.get("user"), "clinical.odontogram_updated", "patient", patientId, {
    tooth: d.tooth_code, face: d.face, condition: d.condition,
  });
  return c.json({ ok: true, id: result.id }, 201);
});

// ── Planos de tratamento ──────────────────────────────────────────────────
proRouter.get("/patients/:id/plans", async (c) => {
  const clinicId = cid(c);
  const clinic = c.get("clinic");
  const patientId = Number(c.req.param("id"));
  if (!(await patientAccessible(c.env, clinicId, patientId, clinic.role, clinic.professional_id)))
    return err(c, "Paciente não vinculado à sua agenda.", 403);
  const plans = await c.env.DB.prepare(
    `SELECT tp.*, pr.name AS professional_name FROM treatment_plans tp
       JOIN professionals pr ON pr.id = tp.professional_id
      WHERE tp.clinic_id=?1 AND tp.patient_id=?2 ORDER BY tp.created_at DESC`
  ).bind(clinicId, patientId).all<Record<string, unknown>>();
  const items = await c.env.DB.prepare(
    `SELECT i.*, proc.name AS procedure_name, pr.name AS professional_name
       FROM treatment_plan_items i
       LEFT JOIN procedures proc ON proc.id = i.procedure_id
       LEFT JOIN professionals pr ON pr.id = i.professional_id
      WHERE i.clinic_id=?1 AND i.plan_id IN (SELECT id FROM treatment_plans WHERE clinic_id=?1 AND patient_id=?2)
      ORDER BY i.plan_id, i.sort`
  ).bind(clinicId, patientId).all<Record<string, unknown>>();
  return c.json({ plans: plans.results ?? [], items: items.results ?? [] });
});

proRouter.post("/patients/:id/plans", async (c) => {
  const clinicId = cid(c);
  const clinic = c.get("clinic");
  const patientId = Number(c.req.param("id"));
  if (!(await patientAccessible(c.env, clinicId, patientId, clinic.role, clinic.professional_id)))
    return err(c, "Paciente não vinculado à sua agenda.", 403);
  const schema = z.object({ title: z.string().min(3).max(160), notes: z.string().max(2000).default("") });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Informe o título do plano.", 422);
  const professionalId = clinic.professional_id ?? (await c.env.DB
    .prepare(`SELECT professional_id FROM appointments WHERE clinic_id=?1 AND patient_id=?2 ORDER BY starts_at DESC LIMIT 1`)
    .bind(clinicId, patientId).first<{ professional_id: number }>())?.professional_id;
  if (!professionalId) return err(c, "É necessário um dentista responsável.", 422);
  const id = await createTreatmentPlan(c.env.DB, {
    clinicId, patientId, professionalId, title: parsed.data.title, notes: parsed.data.notes, userId: c.get("user").id,
  });
  await c.env.DB.prepare(`UPDATE treatment_plans SET status='ativo' WHERE id=?1 AND clinic_id=?2`).bind(id, clinicId).run();
  await audit(c.env.DB, c.get("user"), "treatment.plan_created", "treatment_plan", id, { patient: patientId });
  return c.json({ ok: true, id }, 201);
});

proRouter.post("/plans/:id/items", async (c) => {
  const clinicId = cid(c);
  const planId = Number(c.req.param("id"));
  const schema = z.object({
    procedure_id: z.number().int().positive().nullable().optional(),
    description: z.string().max(300).default(""),
    tooth_code: z.string().max(4).default(""),
    face: z.string().max(20).default(""),
    sessions: z.number().int().min(1).max(60).default(1),
    price_cents: z.number().int().min(0).nullable().optional(),
    notes: z.string().max(500).default(""),
  });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Item do plano inválido.", 422);
  const d = parsed.data;
  if (!d.procedure_id && !d.description.trim()) return err(c, "Informe o procedimento ou a descrição.", 422);
  const id = await addPlanItem(c.env.DB, {
    clinicId, planId, procedureId: d.procedure_id ?? null, description: d.description,
    toothCode: d.tooth_code, face: d.face, sessions: d.sessions,
    priceCents: d.price_cents ?? undefined, notes: d.notes,
  });
  if (!id) return err(c, "Plano não encontrado.", 404);
  await audit(c.env.DB, c.get("user"), "treatment.item_added", "treatment_plan_item", id, { plan: planId });
  return c.json({ ok: true, id }, 201);
});

proRouter.post("/plan-items/:id/status", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { status?: string } | null;
  const allowed = ["pendente", "em_andamento", "concluido", "cancelado"];
  if (!body?.status || !allowed.includes(body.status)) return err(c, "Status inválido.", 422);
  const ok = await updatePlanItemStatus(c.env.DB, {
    clinicId: cid(c), itemId: Number(c.req.param("id")),
    status: body.status as never, userId: c.get("user").id,
  });
  if (!ok) return err(c, "Item não encontrado.", 404);
  return c.json({ ok: true });
});

// ── Documentos clínicos ───────────────────────────────────────────────────
proRouter.post("/patients/:id/documents", async (c) => {
  const clinicId = cid(c);
  const clinic = c.get("clinic");
  const patientId = Number(c.req.param("id"));
  if (!(await patientAccessible(c.env, clinicId, patientId, clinic.role, clinic.professional_id)))
    return err(c, "Paciente não vinculado à sua agenda.", 403);
  const schema = z.object({
    kind: z.enum(["atestado", "declaracao", "receita", "encaminhamento", "termo", "plano_tratamento", "exame", "radiografia", "foto", "arquivo"]),
    title: z.string().min(3).max(160),
    body: z.string().min(5).max(20000),
    sign: z.boolean().default(false),
    visible_to_patient: z.boolean().default(false),
    professional_id: z.number().int().positive().nullable().optional(),
  });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Documento inválido.", 422, parsed.error.flatten().fieldErrors);
  const d = parsed.data;
  const proId = d.professional_id ?? clinic.professional_id;
  const pro = proId
    ? await c.env.DB.prepare(`SELECT name, cro, cro_uf FROM professionals WHERE id=?1 AND clinic_id=?2`)
        .bind(proId, clinicId).first<{ name: string; cro: string; cro_uf: string }>()
    : null;
  const id = await createTextDocument(c.env.DB, {
    clinicId, patientId, kind: d.kind, title: d.title, body: d.body,
    visibleToPatient: d.visible_to_patient, userId: c.get("user").id,
    professionalId: proId ?? null,
    professionalName: pro?.name ?? c.get("user").name,
    cro: pro ? `${pro.cro}${pro.cro_uf ? `/${pro.cro_uf}` : ""}` : "",
    sign: d.sign,
  });
  await audit(c.env.DB, c.get("user"), "clinical.document_created", "clinical_document", id, { kind: d.kind });
  return c.json({ ok: true, id }, 201);
});
