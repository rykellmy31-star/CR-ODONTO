// ============================================================================
// Modelos de mensagem (texto) e renderização segura.
// Nenhum dado clínico sensível entra em mensagem: apenas nome, data, hora,
// profissional e unidade — o mínimo para confirmar/reagendar.
// ============================================================================
import { formatDayPtBr, utcToLocal, formatHHMM } from "../time";

export type TemplateCode = "lembrete" | "confirmacao" | "reagendamento" | "conclusao" | "retorno" | "boas_vindas";

export const DEFAULT_TEMPLATES: Record<TemplateCode, string> = {
  lembrete:
    "Olá, {{paciente}}! 🦷\n\nVocê possui uma consulta odontológica agendada para {{data}}, às {{hora}}, com {{profissional}} ({{unidade}}).\n\nPor favor, informe se poderá comparecer.\n\nResponda:\n1 - CONFIRMAR\n2 - REAGENDAR",
  confirmacao:
    "Olá, {{paciente}}! Sua consulta de {{data}} às {{hora}} com {{profissional}} está confirmada. Até lá! 🦷",
  reagendamento:
    "Olá, {{paciente}}! Sua consulta foi reagendada para {{data}} às {{hora}} com {{profissional}}. Se precisar mudar novamente, acesse: {{link}}",
  conclusao:
    "Olá, {{paciente}}! Seu atendimento de hoje foi concluído. Obrigado pela confiança! 🦷",
  retorno:
    "Olá, {{paciente}}! Podemos agendar seu retorno. Escolha o melhor horário aqui: {{link}}",
  boas_vindas:
    "Olá, {{paciente}}! Seja bem-vindo(a) à {{clinica}}. Você pode agendar sua consulta em: {{link}}",
};

export interface TemplateVars {
  paciente: string;
  primeiro_nome: string;
  data: string;
  hora: string;
  profissional: string;
  unidade: string;
  clinica: string;
  procedimento: string;
  link: string;
}

/** Substituição estrita: só as chaves conhecidas são interpoladas. */
export function renderTemplate(template: string, vars: Partial<TemplateVars>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => {
    const value = (vars as Record<string, string | undefined>)[key];
    return value === undefined ? "" : value;
  });
}

export async function loadTemplate(db: D1Database, clinicId: number, code: TemplateCode): Promise<string> {
  const row = await db
    .prepare(`SELECT body FROM message_templates WHERE clinic_id = ?1 AND code = ?2 AND active = 1`)
    .bind(clinicId, code)
    .first<{ body: string }>();
  return row?.body?.trim() ? row.body : DEFAULT_TEMPLATES[code];
}

export function buildVars(input: {
  patientName: string;
  timezone: string;
  startsAt: string;
  professionalName: string;
  unitName?: string | null;
  clinicName: string;
  procedureName?: string | null;
  link: string;
}): TemplateVars {
  const local = utcToLocal(input.timezone, input.startsAt);
  return {
    paciente: input.patientName,
    primeiro_nome: (input.patientName || "").trim().split(/\s+/)[0] || input.patientName,
    data: formatDayPtBr(input.timezone, local.day),
    hora: formatHHMM(local.minutes),
    profissional: input.professionalName,
    unidade: input.unitName || input.clinicName,
    clinica: input.clinicName,
    procedimento: input.procedureName || "",
    link: input.link,
  };
}

/** Mensagem de lembrete com as ações CONFIRMAR / REAGENDAR. */
export function reminderButtons(publicUrl: string, confirmToken: string, rescheduleToken: string) {
  return [
    { type: "reply", reply: { id: `confirmar:${confirmToken}`, title: "Confirmar consulta" } },
    { type: "reply", reply: { id: `reagendar:${rescheduleToken}`, title: "Reagendar consulta" } },
  ];
}

export function actionLinks(publicUrl: string, clinicSlug: string, confirmToken: string, rescheduleToken: string) {
  const base = publicUrl.replace(/\/+$/, "");
  return {
    confirm: `${base}/c/${clinicSlug}/confirmar/${confirmToken}`,
    reschedule: `${base}/c/${clinicSlug}/reagendar/${rescheduleToken}`,
  };
}
