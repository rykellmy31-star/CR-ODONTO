// ============================================================================
// Webhooks do WhatsApp Cloud API (Meta).
//  - GET  /api/webhooks/whatsapp  → verificação (hub.challenge)
//  - POST /api/webhooks/whatsapp  → eventos de mensagem/status
//
// Segurança e idempotência:
//  - assinatura x-hub-signature-256 validada com WHATSAPP_APP_SECRET
//  - cada evento é gravado em message_webhook_events com event_uid único
//    (reprocessar o mesmo webhook nunca duplica confirmações)
//  - tokens de ação são de uso único (action_tokens.used_at)
//  - clínica identificada pelo phone_number_id (nunca por parâmetro do cliente)
// ============================================================================
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { err, nowIso } from "../lib/utils";
import { verifyWebhookSignature } from "../lib/messaging/provider";
import { loadActionToken, tokenIsUsable, consumeActionToken } from "../lib/tokens";
import { confirmAppointment, getAppointment, cancelAppointment } from "../lib/appointments";
import { cancelAppointmentJobs } from "../lib/messaging/jobs";
import { audit } from "../lib/audit";

export const webhooksRouter = new Hono<{ Bindings: Env }>();

webhooksRouter.get("/whatsapp", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  const expected = c.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected) return c.text(challenge ?? "", 200);
  return c.text("forbidden", 403);
});

const payloadSchema = z.object({
  object: z.string().optional(),
  entry: z.array(
    z.object({
      id: z.string().optional(),
      changes: z.array(
        z.object({
          field: z.string().optional(),
          value: z.record(z.unknown()),
        })
      ).default([]),
    })
  ).default([]),
});

interface InboundMessage {
  id: string;
  from: string;
  type: string;
  text?: string;
  buttonId?: string;
}

function extractMessages(value: Record<string, unknown>): InboundMessage[] {
  const messages = (value.messages as unknown[] | undefined) ?? [];
  const out: InboundMessage[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const msg = m as Record<string, any>;
    const id = String(msg.id ?? "");
    const from = String(msg.from ?? "");
    if (!id || !from) continue;
    const type = String(msg.type ?? "");
    let buttonId: string | undefined;
    if (type === "interactive") buttonId = msg.interactive?.button_reply?.id ?? msg.interactive?.list_reply?.id;
    if (type === "button") buttonId = msg.button?.payload;
    out.push({ id, from, type, text: msg.text?.body, buttonId });
  }
  return out;
}

webhooksRouter.post("/whatsapp", async (c) => {
  const raw = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");
  const appSecret = c.env.WHATSAPP_APP_SECRET;

  // Sem app secret configurado, recusamos (nunca aceitar payload não assinado).
  if (!appSecret) return err(c, "Webhook não configurado (WHATSAPP_APP_SECRET ausente).", 503);
  if (!(await verifyWebhookSignature(appSecret, raw, signature))) return err(c, "Assinatura inválida.", 401);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return err(c, "Payload inválido.", 400);
  }
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return err(c, "Payload inválido.", 400);

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      if (change.field && change.field !== "messages") continue;
      const value = change.value as Record<string, unknown>;
      const metadata = (value.metadata ?? {}) as { phone_number_id?: string; display_phone_number?: string };
      const phoneNumberId = metadata.phone_number_id ?? "";
      if (!phoneNumberId) continue;

      const wa = await c.env.DB.prepare(
        `SELECT clinic_id FROM whatsapp_settings WHERE phone_number_id = ?1 AND enabled = 1`
      ).bind(phoneNumberId).first<{ clinic_id: number }>();
      if (!wa) continue;
      const clinicId = wa.clinic_id;

      // ── Status de entrega/leitura das nossas mensagens ──
      const statuses = (value.statuses as unknown[] | undefined) ?? [];
      for (const s of statuses) {
        const st = s as Record<string, any>;
        const eventUid = `status:${st.id}:${st.status}:${st.timestamp}`;
        const inserted = await c.env.DB.prepare(
          `INSERT INTO message_webhook_events (clinic_id, event_uid, status, payload, processed)
           VALUES (?1,?2,?3,?4,0) ON CONFLICT(event_uid) DO NOTHING`
        ).bind(clinicId, eventUid, String(st.status ?? ""), JSON.stringify(st)).run();
        if ((inserted.meta?.changes ?? 0) === 0) continue;
        const job = await c.env.DB.prepare(`SELECT id FROM message_jobs WHERE provider_msg_id = ?1 AND clinic_id = ?2`)
          .bind(String(st.id ?? ""), clinicId).first<{ id: number }>();
        if (job) {
          if (st.status === "delivered")
            await c.env.DB.prepare(`UPDATE message_jobs SET delivered_at=?2, updated_at=?2 WHERE id=?1`).bind(job.id, nowIso()).run();
          if (st.status === "read")
            await c.env.DB.prepare(`UPDATE message_jobs SET read_at=?2, updated_at=?2 WHERE id=?1`).bind(job.id, nowIso()).run();
          if (st.status === "failed") {
            const errorMsg = JSON.stringify(st.errors ?? [])
            await c.env.DB.prepare(`UPDATE message_jobs SET status='falhou', last_error=?2, updated_at=?3 WHERE id=?1`)
              .bind(job.id, errorMsg.slice(0, 300), nowIso()).run();
          }
        }
        await c.env.DB.prepare(`UPDATE message_webhook_events SET processed=1, job_id=?2 WHERE event_uid=?1`)
          .bind(eventUid, job?.id ?? null).run();
      }

      // ── Mensagens recebidas (botões / texto) ──
      for (const msg of extractMessages(value)) {
        const eventUid = `msg:${msg.id}`;
        const inserted = await c.env.DB.prepare(
          `INSERT INTO message_webhook_events (clinic_id, event_uid, status, payload, processed)
           VALUES (?1,?2,'received',?3,0) ON CONFLICT(event_uid) DO NOTHING`
        ).bind(clinicId, eventUid, JSON.stringify({ type: msg.type, button: msg.buttonId ?? null })).run();
        // Idempotência: se já processamos este id de mensagem, ignorar.
        if ((inserted.meta?.changes ?? 0) === 0) continue;

        const action = (msg.buttonId ?? msg.text ?? "").trim();
        let result: { ok: boolean; reply: string; appointmentId?: number | null } = {
          ok: false,
          reply: "Não consegui identificar sua consulta. Por favor, fale com a clínica.",
        };

        const match = /^(confirmar|reagendar|cancelar):([a-f0-9]{16,128})$/i.exec(action);
        const numeric = /^\s*([12])\s*$/.exec(action);

        let tokenStr: string | null = match ? match[2] : null;
        let intent: "confirmar" | "reagendar" | "cancelar" | null = match
          ? (match[1].toLowerCase() as never)
          : numeric
            ? numeric[1] === "1" ? "confirmar" : "reagendar"
            : null;

        // Para resposta numérica, localizamos o token mais recente do paciente.
        if (!tokenStr && intent) {
          const patient = await c.env.DB.prepare(`SELECT id FROM patients WHERE clinic_id=?1 AND phone=?2`)
            .bind(clinicId, msg.from.replace(/^55/, "")).first<{ id: number }>()
            ?? await c.env.DB.prepare(`SELECT id FROM patients WHERE clinic_id=?1 AND phone=?2`)
              .bind(clinicId, msg.from).first<{ id: number }>();
          if (patient) {
            const lastJob = await c.env.DB.prepare(
              `SELECT payload FROM message_jobs WHERE clinic_id=?1 AND patient_id=?2 AND kind='lembrete'
                ORDER BY created_at DESC LIMIT 1`
            ).bind(clinicId, patient.id).first<{ payload: string }>();
            if (lastJob) {
              try {
                const p = JSON.parse(lastJob.payload) as { confirm_token?: string; reschedule_token?: string };
                tokenStr = intent === "confirmar" ? p.confirm_token ?? null : p.reschedule_token ?? null;
              } catch { /* payload inválido */ }
            }
          }
        }

        if (tokenStr && intent) {
          const row = await loadActionToken(c.env.DB, tokenStr);
          if (row && row.clinic_id === clinicId && tokenIsUsable(row) && row.appointment_id) {
            const appt = await getAppointment(c.env.DB, clinicId, row.appointment_id);
            if (appt) {
              if (intent === "confirmar") {
                if (appt.status === "confirmado") {
                  result = { ok: true, reply: "Sua consulta já estava confirmada. Até lá! 🦷", appointmentId: appt.id };
                } else {
                  const consumed = await consumeActionToken(c.env.DB, row.id, "confirmar");
                  if (consumed) {
                    const confirmed = await confirmAppointment(c.env.DB, clinicId, appt.id, "whatsapp", { kind: "patient", name: "paciente" });
                    result = confirmed.ok
                      ? { ok: true, reply: "Consulta confirmada com sucesso! Obrigado. 🦷", appointmentId: appt.id }
                      : { ok: false, reply: "Não foi possível confirmar agora. A recepção entrará em contato." };
                  } else {
                    result = { ok: true, reply: "Sua consulta já havia sido confirmada. 🦷", appointmentId: appt.id };
                  }
                }
              } else if (intent === "reagendar") {
                const base = (c.env.PUBLIC_URL || "").replace(/\/+$/, "");
                result = {
                  ok: true,
                  reply: `Para escolher um novo horário, acesse: ${base}/reagendar/${tokenStr}`,
                  appointmentId: appt.id,
                };
              } else if (intent === "cancelar") {
                const consumed = await consumeActionToken(c.env.DB, row.id, "cancelar");
                if (consumed) {
                  const cancelled = await cancelAppointment(c.env.DB, clinicId, appt.id, "paciente", "Cancelado pelo WhatsApp", { kind: "patient", name: "paciente" });
                  if (cancelled.ok) {
                    await cancelAppointmentJobs(c.env.DB, appt.id, "cancelado pelo paciente");
                    result = { ok: true, reply: "Consulta cancelada. Obrigado por avisar! 🦷", appointmentId: appt.id };
                  }
                }
              }
            }
          }
        }

        await c.env.DB.prepare(`UPDATE message_webhook_events SET processed=1, status=?2 WHERE event_uid=?1`)
          .bind(eventUid, result.ok ? "handled" : "unresolved").run();
        await audit(c.env.DB, null, "whatsapp.inbound", "appointment", result.appointmentId ?? "", {
          intent, handled: result.ok,
        }, { clinicId });

        // Resposta automática (best-effort: falha não quebra o webhook).
        try {
          const { loadWhatsAppRow } = await import("../lib/messaging/jobs");
          const { loadWhatsAppConfig, sendWhatsApp } = await import("../lib/messaging/provider");
          const row = await loadWhatsAppRow(c.env.DB, clinicId);
          const config = await loadWhatsAppConfig(c.env, row);
          if (config) await sendWhatsApp(c.env, config, { to: msg.from, body: result.reply });
        } catch (e) {
          console.error("[webhook] resposta automática falhou", String(e));
        }
      }
    }
  }
  return c.json({ ok: true });
});
