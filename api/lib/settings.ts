// ============================================================================
// Configurações da clínica (JSON no D1, validado por zod).
// Adaptado do TIGU (api/lib/settings.ts): remove loja/carteira/pagamentos,
// adiciona personalização visual odontológica, regras de agendamento público
// e módulos opcionais DESATIVADOS por padrão.
// ============================================================================
import { z } from "zod";
import { jsonParse } from "./utils";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor deve ser hexadecimal (#RRGGBB)");

export const clinicSettingsSchema = z.object({
  branding: z
    .object({
      logo_url: z.string().max(500).default(""),
      primary_color: hexColor.default("#0f766e"),
      accent_color: hexColor.default("#0ea5e9"),
      tagline: z.string().max(160).default(""),
      about: z.string().max(2000).default(""),
      instagram: z.string().max(120).default(""),
      website: z.string().max(200).default(""),
      address_public: z.string().max(300).default(""),
      phone_public: z.string().max(40).default(""),
      whatsapp_public: z.string().max(40).default(""),
    })
    .default({}),
  booking: z
    .object({
      online_enabled: z.boolean().default(true),
      min_lead_min: z.number().int().min(0).max(20160).default(60),
      max_days_ahead: z.number().int().min(1).max(365).default(60),
      require_optin: z.boolean().default(true),
      allow_patient_cancel: z.boolean().default(true),
      cancel_limit_hours: z.number().int().min(0).max(168).default(4),
      allow_patient_reschedule: z.boolean().default(true),
      show_prices: z.boolean().default(true),
      show_professional_choice: z.boolean().default(true),
      require_cpf: z.boolean().default(false),
      default_procedure_slug: z.string().max(80).default(""),
    })
    .default({}),
  clinical: z
    .object({
      require_anamnesis_before_first_visit: z.boolean().default(false),
      require_record_on_finish: z.boolean().default(true),
      odontogram_default_dentition: z.enum(["permanente", "decidua"]).default("permanente"),
      /** Recepção só vê prontuário se receber permissão explícita. */
      receptionist_can_view_records: z.boolean().default(false),
      patient_sharing: z.enum(["clinic", "unit"]).default("clinic"),
    })
    .default({}),
  reminders: z
    .object({
      enabled_default: z.boolean().default(true),
      offsets_min: z.array(z.number().int().min(5).max(20160)).max(5).default([1440, 300]),
      send_window_start: z.string().regex(/^\d{2}:\d{2}$/).default("08:00"),
      send_window_end: z.string().regex(/^\d{2}:\d{2}$/).default("20:00"),
      short_notice_min: z.number().int().min(5).max(1440).default(120),
    })
    .default({}),
  scheduling: z
    .object({
      slot_min: z.number().int().min(5).max(120).default(15),
      allow_fit_in: z.boolean().default(true),
      fit_in_roles: z.array(z.enum(["clinic_admin", "receptionist", "dentist"])).default(["clinic_admin", "receptionist"]),
      max_parallel_per_professional: z.number().int().min(1).max(4).default(1),
      room_required_by_default: z.boolean().default(true),
    })
    .default({}),
  /** Módulos opcionais de gestão financeira/estoque: sempre OFF por padrão. */
  modules: z
    .object({
      payments_simple: z.boolean().default(true),
      accounts_receivable: z.boolean().default(false),
      accounts_payable: z.boolean().default(false),
      cash_register: z.boolean().default(false),
      commissions: z.boolean().default(false),
      inventory: z.boolean().default(false),
      suppliers: z.boolean().default(false),
      advanced_financial_reports: z.boolean().default(false),
    })
    .default({}),
  documents: z
    .object({
      footer_text: z.string().max(500).default(""),
      show_cro: z.boolean().default(true),
      share_with_patient_default: z.boolean().default(false),
    })
    .default({}),
});

export type ClinicSettings = z.infer<typeof clinicSettingsSchema>;

export function defaultClinicSettings(): ClinicSettings {
  return clinicSettingsSchema.parse({});
}

export async function loadClinicSettings(db: D1Database, clinicId: number): Promise<ClinicSettings> {
  const row = await db.prepare(`SELECT data FROM clinic_settings WHERE clinic_id = ?1`).bind(clinicId).first<{ data: string }>();
  if (!row) return defaultClinicSettings();
  // Merge profundo com defaults: cobre configurações gravadas por versões
  // anteriores sem perder valores do cliente.
  const base = defaultClinicSettings() as Record<string, unknown>;
  const stored = jsonParse<Record<string, unknown>>(row.data, {});
  for (const [k, v] of Object.entries(stored)) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof base[k] === "object") {
      base[k] = { ...(base[k] as object), ...(v as object) };
    } else if (v !== undefined) {
      base[k] = v;
    }
  }
  const parsed = clinicSettingsSchema.safeParse(base);
  return parsed.success ? parsed.data : defaultClinicSettings();
}

export async function saveClinicSettings(db: D1Database, clinicId: number, settings: ClinicSettings): Promise<void> {
  const data = JSON.stringify(settings);
  await db
    .prepare(
      `INSERT INTO clinic_settings (clinic_id, data, updated_at) VALUES (?1,?2,?3)
       ON CONFLICT(clinic_id) DO UPDATE SET data=?2, updated_at=?3`
    )
    .bind(clinicId, data, new Date().toISOString().replace(/\.\d{3}Z$/, "Z"))
    .run();
}

/** Configuração padrão aplicada a clínicas novas (especialidades + procedimentos). */
export const DEFAULT_SPECIALTIES: { name: string; slug: string; color: string }[] = [
  { name: "Clínica geral", slug: "clinica-geral", color: "#0f766e" },
  { name: "Ortodontia", slug: "ortodontia", color: "#7c3aed" },
  { name: "Endodontia", slug: "endodontia", color: "#b45309" },
  { name: "Periodontia", slug: "periodontia", color: "#0284c7" },
  { name: "Implantodontia", slug: "implantodontia", color: "#be123c" },
  { name: "Cirurgia odontológica", slug: "cirurgia", color: "#475569" },
  { name: "Prótese dentária", slug: "protese", color: "#0891b2" },
  { name: "Odontopediatria", slug: "odontopediatria", color: "#db2777" },
  { name: "Dentística", slug: "dentistica", color: "#16a34a" },
];

export const DEFAULT_PROCEDURES: {
  name: string; slug: string; specialty: string; duration: number; price_cents: number;
}[] = [
  { name: "Avaliação / consulta inicial", slug: "avaliacao", specialty: "clinica-geral", duration: 30, price_cents: 15000 },
  { name: "Profilaxia (limpeza)", slug: "profilaxia", specialty: "clinica-geral", duration: 45, price_cents: 18000 },
  { name: "Restauração em resina", slug: "restauracao-resina", specialty: "dentistica", duration: 60, price_cents: 22000 },
  { name: "Tratamento de canal (unirradicular)", slug: "canal-unirradicular", specialty: "endodontia", duration: 90, price_cents: 70000 },
  { name: "Extração simples", slug: "extracao-simples", specialty: "cirurgia", duration: 45, price_cents: 25000 },
  { name: "Extração de siso", slug: "extracao-siso", specialty: "cirurgia", duration: 90, price_cents: 55000 },
  { name: "Instalação de implante", slug: "implante", specialty: "implantodontia", duration: 120, price_cents: 250000 },
  { name: "Manutenção ortodôntica", slug: "manutencao-ortodontica", specialty: "ortodontia", duration: 30, price_cents: 12000 },
  { name: "Raspagem periodontal", slug: "raspagem-periodontal", specialty: "periodontia", duration: 60, price_cents: 30000 },
  { name: "Consulta odontopediátrica", slug: "consulta-infantil", specialty: "odontopediatria", duration: 30, price_cents: 15000 },
  { name: "Moldagem para prótese", slug: "moldagem-protese", specialty: "protese", duration: 45, price_cents: 20000 },
  { name: "Retorno / revisão", slug: "retorno", specialty: "clinica-geral", duration: 20, price_cents: 0 },
];
