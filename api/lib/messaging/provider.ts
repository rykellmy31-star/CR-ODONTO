// ============================================================================
// Provedor WhatsApp Cloud API (Meta) + provedor "mock" para desenvolvimento.
// Adaptado do TIGU (api/lib/messaging/provider.ts), simplificado:
//  - credenciais POR CLÍNICA (banco, cifradas com AES-GCM)
//  - provedor mock nunca é usado em produção
//  - toda falha é reportada como resultado, nunca derruba a agenda
// ============================================================================
import { decryptSecret } from "../crypto";

export interface WhatsAppConfig {
  provider: "meta_cloud" | "mock";
  phoneNumberId: string;
  accessToken: string;
  wabaId?: string;
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  outcome: "aceito" | "erro_temporario" | "erro_permanente" | "simulado";
  httpStatus?: number;
  error?: string;
}

export interface WhatsAppSettingsRow {
  enabled: number;
  provider: "meta_cloud" | "mock";
  waba_id: string;
  phone_number_id: string;
  display_phone: string;
  access_token_enc: string;
  max_per_day: number;
  require_optin: number;
  send_window_start: string;
  send_window_end: string;
}

export async function loadWhatsAppConfig(
  env: { MSG_ENC_KEY?: string; SESSION_SECRET?: string; APP_ENV?: string; WHATSAPP_MOCK?: string },
  row: WhatsAppSettingsRow | null
): Promise<WhatsAppConfig | null> {
  if (!row || row.enabled !== 1) return null;
  const mockAllowed = env.WHATSAPP_MOCK === "1" && env.APP_ENV !== "production";
  if (row.provider === "mock") {
    return mockAllowed ? { provider: "mock", phoneNumberId: "mock", accessToken: "mock", wabaId: row.waba_id } : null;
  }
  const token = await decryptSecret(env, row.access_token_enc);
  if (!token || !row.phone_number_id) return null;
  return { provider: "meta_cloud", phoneNumberId: row.phone_number_id, accessToken: token, wabaId: row.waba_id };
}

export interface OutboundMessage {
  to: string;                // dígitos com DDI (ex.: 5511999998888)
  body: string;
  buttons?: { type: string; reply: { id: string; title: string } }[];
}

/** Meta exige DDI. Números brasileiros locais recebem 55 automaticamente. */
export function toWaNumber(phone: string): string | null {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export async function sendWhatsApp(
  env: { GRAPH_API_VERSION?: string; APP_ENV?: string; FETCH?: typeof fetch },
  config: WhatsAppConfig,
  msg: OutboundMessage
): Promise<SendResult> {
  const to = toWaNumber(msg.to);
  if (!to) return { ok: false, outcome: "erro_permanente", error: "Telefone inválido" };

  if (config.provider === "mock") {
    // Simulação explícita: não chama nenhum provedor externo.
    return { ok: true, outcome: "simulado", providerMessageId: `mock-${Date.now()}`, httpStatus: 200 };
  }

  const version = env.GRAPH_API_VERSION || "v23.0";
  const url = `https://graph.facebook.com/${version}/${config.phoneNumberId}/messages`;
  const payload = msg.buttons?.length
    ? {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: msg.body.slice(0, 1024) },
          action: { buttons: msg.buttons.slice(0, 3).map((b) => ({ ...b, reply: { ...b.reply, title: b.reply.title.slice(0, 20) } })) },
        },
      }
    : {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: msg.body.slice(0, 4096) },
      };

  try {
    const doFetch = env.FETCH ?? fetch;
    const res = await doFetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${config.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (res.ok) {
      let id = "";
      try {
        const parsed = JSON.parse(text) as { messages?: { id: string }[] };
        id = parsed.messages?.[0]?.id ?? "";
      } catch {
        /* resposta sem JSON: ainda é sucesso HTTP */
      }
      return { ok: true, outcome: "aceito", providerMessageId: id, httpStatus: res.status };
    }
    // 429/5xx são temporários; 4xx (exceto 429) são permanentes.
    const temporary = res.status === 429 || res.status >= 500;
    return {
      ok: false,
      outcome: temporary ? "erro_temporario" : "erro_permanente",
      httpStatus: res.status,
      error: text.slice(0, 500),
    };
  } catch (e) {
    return { ok: false, outcome: "erro_temporario", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Validação de webhook: assinatura HMAC sha256 do corpo bruto. */
export async function verifyWebhookSignature(
  appSecret: string,
  rawBody: string,
  header: string | undefined
): Promise<boolean> {
  if (!appSecret || !header) return false;
  const expected = header.replace(/^sha256=/, "").trim();
  if (!/^[0-9a-f]{64}$/i.test(expected)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  // comparação em tempo constante
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.toLowerCase().charCodeAt(i);
  return diff === 0;
}

/** Janela de envio (evita mensagens de madrugada). */
export function withinSendWindow(startHHMM: string, endHHMM: string, minutesNow: number): boolean {
  const [sh, sm] = startHHMM.split(":").map((x) => parseInt(x, 10));
  const [eh, em] = endHHMM.split(":").map((x) => parseInt(x, 10));
  const start = (sh || 0) * 60 + (sm || 0);
  const end = (eh || 23) * 60 + (em || 59);
  return minutesNow >= start && minutesNow <= end;
}
