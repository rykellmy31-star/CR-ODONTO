// ============================================================================
// Tipos de ambiente do Worker (bindings Cloudflare + variáveis/secrets).
// Adaptado do TIGU (api/types.ts), removendo pagamentos/gateways e ajustando
// os papéis para o domínio odontológico.
// ============================================================================

export type StaffRole = "clinic_admin" | "dentist" | "receptionist";
export type PlatformRole = "user" | "superadmin";

export interface Env {
  DB: D1Database;
  MEDIA?: R2Bucket;
  ASSETS?: Fetcher;

  /** Segredo de sessão (obrigatório em produção, >=32 caracteres). */
  SESSION_SECRET?: string;
  /** Chave AES-256-GCM para cifrar tokens do WhatsApp em repouso. */
  MSG_ENC_KEY?: string;
  APP_ENV?: string;
  /** Token de uso único para criar o primeiro superadministrador. */
  SETUP_TOKEN?: string;
  /** Ambiente de homologação: bloqueia provedores e disparos reais. */
  CR_ODONTO_STAGING?: string;

  /** URL pública (links de confirmação/reagendamento enviados por WhatsApp). */
  PUBLIC_URL?: string;

  // ── WhatsApp Cloud API (credenciais por clínica ficam no D1, cifradas) ──
  WHATSAPP_WEBHOOK_VERIFY_TOKEN?: string;
  WHATSAPP_APP_SECRET?: string;
  GRAPH_API_VERSION?: string;
  /** Liga o provedor 'mock' (NUNCA em produção). */
  WHATSAPP_MOCK?: string;
}

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  platform_role: PlatformRole;
  must_change_password?: boolean;
  /** Contexto da clínica, preenchido pelo middleware de tenant. */
  clinic?: {
    id: number;
    slug: string;
    name: string;
    role: StaffRole | "public";
    professional_id: number | null;
    unit_id: number | null;
    can_view_records: boolean;
    plan: ClinicPlan;
  };
}

export interface ClinicPlan {
  code: string;
  whatsapp_enabled: number;
  clinical_enabled: number;
  max_units: number;
  max_dentists: number;
  max_staff: number;
  max_messages_month: number;
}

export interface PatientSession {
  patient_id: number;
  clinic_id: number;
  clinic_slug: string;
  name: string;
}

declare module "hono" {
  interface ContextVariableMap {
    user: SessionUser;
    clinic: NonNullable<SessionUser["clinic"]>;
    settings: import("./lib/settings").ClinicSettings;
    patient: PatientSession;
  }
}
