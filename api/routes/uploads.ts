// ============================================================================
// Upload/download de arquivos clínicos no R2 (bucket PRIVADO).
// - documentos: exigem permissão de prontuário; vinculados ao paciente
// - logomarca: público (usada no site de agendamento)
// - download de documento: equipe autorizada ou paciente dono (portal)
// Nunca servir arquivo por caminho arbitrário do cliente.
// ============================================================================
import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../types";
import { cid, tenantMiddleware } from "../lib/tenant";
import { currentUserOptional } from "../lib/auth";
import { currentPatient } from "../lib/patient-auth";
import { getMembership } from "../lib/tenant";
import { err, nowIso, randomHex } from "../lib/utils";
import { audit } from "../lib/audit";

export const uploadsRouter = new Hono<{ Bindings: Env }>();

const MAX_DOC_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB
const DOC_MIME = [
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic",
  "application/dicom", "text/plain",
];

function safeExt(name: string, mime: string): string {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(name || "")?.[1]?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  const map: Record<string, string> = {
    "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
    "image/webp": "webp", "image/heic": "heic", "application/dicom": "dcm", "text/plain": "txt",
  };
  return map[mime] ?? "bin";
}

/**
 * POST /api/c/:slug/uploads/document?patient_id=&kind=&title=
 * multipart/form-data com campo "file".
 */
uploadsRouter.post("/document", tenantMiddleware({ auth: "records" }), async (c) => {
  const clinicId = cid(c);
  if (!c.env.MEDIA) return err(c, "Armazenamento de arquivos não configurado (binding R2 MEDIA).", 503);
  const patientId = Number(c.req.query("patient_id"));
  const kind = c.req.query("kind") || "arquivo";
  const title = (c.req.query("title") || "").slice(0, 160);
  const allowedKinds = ["exame", "radiografia", "foto", "arquivo", "termo"];
  if (!patientId) return err(c, "Informe patient_id.", 422);
  if (!allowedKinds.includes(kind)) return err(c, "Tipo de documento inválido.", 422);

  const patient = await c.env.DB.prepare(`SELECT id, name FROM patients WHERE id=?1 AND clinic_id=?2 AND anonymized_at IS NULL`)
    .bind(patientId, clinicId).first<{ id: number; name: string }>();
  if (!patient) return err(c, "Paciente não encontrado.", 404);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return err(c, "Envie um arquivo.", 422);
  const blob = file as File;
  if (blob.size === 0) return err(c, "Arquivo vazio.", 422);
  if (blob.size > MAX_DOC_BYTES) return err(c, "Arquivo maior que 15 MB.", 413);
  const mime = blob.type || "application/octet-stream";
  if (!DOC_MIME.includes(mime)) return err(c, `Tipo de arquivo não permitido (${mime}).`, 415);

  const ext = safeExt(blob.name, mime);
  const key = `${clinicId}/patients/${patientId}/${randomHex(8)}.${ext}`;
  await c.env.MEDIA.put(key, await blob.arrayBuffer(), {
    httpMetadata: { contentType: mime, contentDisposition: `attachment; filename="${key.split("/").pop()}"` },
    customMetadata: { clinic_id: String(clinicId), patient_id: String(patientId), uploaded_by: String(c.get("user").id) },
  });

  const res = await c.env.DB.prepare(
    `INSERT INTO clinical_documents (clinic_id, patient_id, professional_id, kind, title, r2_key, mime, size_bytes,
        visible_to_patient, created_by)
     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,?9)`
  )
    .bind(clinicId, patientId, c.get("clinic").professional_id ?? null, kind,
      title || blob.name.slice(0, 120) || "Arquivo", key, mime, blob.size, c.get("user").id)
    .run();
  await audit(c.env.DB, c.get("user"), "document.uploaded", "clinical_document", Number(res.meta?.last_row_id ?? 0), {
    patient: patientId, kind, size: blob.size,
  });
  return c.json({ ok: true, id: Number(res.meta?.last_row_id ?? 0), key }, 201);
});

/** POST /api/c/:slug/uploads/logo — logomarca da clínica (imagem). */
uploadsRouter.post("/logo", tenantMiddleware({ auth: "admin" }), async (c) => {
  const clinicId = cid(c);
  if (!c.env.MEDIA) return err(c, "Armazenamento não configurado (R2 MEDIA).", 503);
  const form = await c.req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return err(c, "Envie uma imagem.", 422);
  const blob = file as File;
  if (blob.size > MAX_IMAGE_BYTES) return err(c, "Imagem maior que 3 MB.", 413);
  const mime = blob.type;
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) return err(c, "Use PNG, JPG ou WEBP.", 415);
  const key = `logo/${clinicId}/${randomHex(6)}.${safeExt(blob.name, mime)}`;
  await c.env.MEDIA.put(key, await blob.arrayBuffer(), { httpMetadata: { contentType: mime } });
  const url = `/uploads/${key}`;
  await c.env.DB.prepare(`UPDATE clinics SET logo_url=?2, updated_at=?3 WHERE id=?1`).bind(clinicId, url, nowIso()).run();
  await audit(c.env.DB, c.get("user"), "clinic.logo_uploaded", "clinic", clinicId, {});
  return c.json({ ok: true, url }, 201);
});

/**
 * GET /uploads/<key>
 * - logo/...         → público (logomarca do site)
 * - <clinicId>/...   → exige sessão de equipe da clínica ou paciente dono
 */
uploadsRouter.get("/:a/:b/:c/:d", async (c) => {
  if (!c.env.MEDIA) return err(c, "Armazenamento não configurado.", 503);
  const key = `${c.req.param("a")}/${c.req.param("b")}/${c.req.param("c")}/${c.req.param("d")}`;
  return serveKey(c.env, key, c);
});

uploadsRouter.get("/logo/:clinicId/:file", async (c) => {
  if (!c.env.MEDIA) return err(c, "Armazenamento não configurado.", 503);
  const key = `logo/${c.req.param("clinicId")}/${c.req.param("file")}`;
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
});

async function serveKey(env: Env, key: string, c: Context<{ Bindings: Env }>) {
  const clinicId = Number(key.split("/")[0]);
  if (!Number.isInteger(clinicId)) return c.notFound();

  const user = await currentUserOptional(c);
  let authorized = false;
  if (user) {
    const membership = await getMembership(env.DB, user.id, clinicId);
    if (membership) {
      // Recepção sem permissão de prontuário não baixa documentos clínicos.
      if (membership.role === "clinic_admin" || membership.role === "dentist") authorized = true;
      else if (membership.can_view_records === 1) authorized = true;
    }
  }
  if (!authorized) {
    const session = await currentPatient(c);
    if (session && session.clinic_id === clinicId) {
      const doc = await env.DB.prepare(
        `SELECT id FROM clinical_documents WHERE clinic_id=?1 AND patient_id=?2 AND r2_key=?3 AND visible_to_patient=1 AND voided_at IS NULL`
      ).bind(clinicId, session.patient_id, key).first();
      if (doc) authorized = true;
    }
  }
  if (!authorized) return err(c, "Acesso negado a este arquivo.", 403);

  const obj = await env.MEDIA!.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": `attachment; filename="${key.split("/").pop()}"`,
    },
  });
}
