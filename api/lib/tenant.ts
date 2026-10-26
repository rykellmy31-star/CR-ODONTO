// ============================================================================
// Resolver de tenant — a ÚNICA forma de o backend saber "de quem são os dados".
// Adaptado do TIGU (api/lib/tenant.ts):
//  - slug na URL → clínica ativa (nunca id vindo do cliente)
//  - membership verificada a cada request (papel + vínculo com dentista)
//  - clínica suspensa/bloqueada → 403 com motivo honesto
//  - escrita bloqueada quando avaliação/assinatura vencida → 402
//  - papéis odontológicos: clinic_admin | dentist | receptionist
// ============================================================================
import type { Context, MiddlewareHandler } from "hono";
import type { ClinicPlan, Env, SessionUser, StaffRole } from "../types";
import { err } from "./utils";
import { loadClinicSettings, type ClinicSettings } from "./settings";
import { currentUserOptional } from "./auth";
import { canWrite, loadPlan, subscriptionState } from "./access";

export type AuthMode = "none" | "staff" | "admin" | "dentist" | "reception" | "records";

export interface ClinicRow {
  id: number;
  slug: string;
  name: string;
  status: "active" | "suspended" | "blocked";
  suspend_reason: string;
  plan_code: string;
  timezone: string;
  trial_ends_at: string | null;
  deleted_at: string | null;
  demo: number;
}

export async function findClinicBySlug(db: D1Database, slug: string): Promise<ClinicRow | null> {
  return db
    .prepare(
      `SELECT id, slug, name, status, suspend_reason, plan_code, timezone, trial_ends_at, deleted_at, demo
         FROM clinics WHERE slug = ?1`
    )
    .bind(slug)
    .first<ClinicRow>();
}

interface MembershipRow {
  role: StaffRole;
  professional_id: number | null;
  unit_id: number | null;
  can_view_records: number;
}

export async function getMembership(db: D1Database, userId: number, clinicId: number): Promise<MembershipRow | null> {
  return db
    .prepare(
      `SELECT m.role, m.professional_id, m.unit_id, m.can_view_records
         FROM clinic_memberships m
        WHERE m.user_id = ?1 AND m.clinic_id = ?2 AND m.active = 1
          AND (m.role <> 'dentist' OR EXISTS (
                SELECT 1 FROM professionals p
                 WHERE p.id = m.professional_id AND p.clinic_id = m.clinic_id AND p.active = 1))`
    )
    .bind(userId, clinicId)
    .first<MembershipRow>();
}

/** Regras de autorização por recurso (mantidas em um só lugar). */
export function roleCan(mode: AuthMode, role: StaffRole, canViewRecords: boolean): boolean {
  switch (mode) {
    case "none":
      return true;
    case "staff":
      return role === "clinic_admin" || role === "dentist" || role === "receptionist";
    case "admin":
      return role === "clinic_admin";
    case "dentist":
      return role === "dentist";
    case "reception":
      return role === "clinic_admin" || role === "receptionist";
    case "records":
      // Prontuário: apenas administrador e dentista; recepção se autorizada.
      if (role === "clinic_admin" || role === "dentist") return true;
      return role === "receptionist" && canViewRecords;
    default:
      return false;
  }
}

/** Rotas de escrita que continuam liberadas mesmo com assinatura vencida. */
const ALWAYS_WRITABLE = [
  /^\/api\/auth\//,
  /\/cancel$/,
  /\/appointments\/[^/]+\/cancel$/,
  /\/subscription/,
];

export const tenantMiddleware =
  (opts: { auth: AuthMode; writeGuard?: boolean }): MiddlewareHandler<{ Bindings: Env }> =>
  async (c, next) => {
    const slug = c.req.param("slug");
    if (!slug || !/^[a-z0-9-]{3,80}$/.test(slug)) return err(c, "Clínica inválida", 404);
    const clinic = await findClinicBySlug(c.env.DB, slug);
    if (!clinic || clinic.deleted_at) return err(c, "Esta clínica não existe (ou o endereço mudou).", 404);
    if (clinic.status !== "active")
      return err(
        c,
        `Esta clínica está temporariamente ${clinic.status === "blocked" ? "bloqueada" : "suspensa"}${
          clinic.suspend_reason ? `: ${clinic.suspend_reason}` : ""
        }.`,
        403
      );

    const settings = await loadClinicSettings(c.env.DB, clinic.id);
    const plan = (await loadPlan(c.env.DB, clinic.plan_code)) ?? null;

    if (opts.auth !== "none") {
      const user: SessionUser | null = await currentUserOptional(c);
      if (!user) return err(c, "Não autenticado. Faça login para continuar.", 401);
      if (user.must_change_password) return err(c, "Altere sua senha provisória antes de acessar a clínica.", 403);

      let m = await getMembership(c.env.DB, user.id, clinic.id);
      let supportReadOnly = false;

      // Super Admin em modo suporte: SOMENTE leitura administrativa, sem acesso
      // a prontuário/dados clínicos (LGPD: papel comercial não concede acesso).
      if (!m && user.platform_role === "superadmin" && opts.auth === "admin") {
        if (c.req.method !== "GET" && c.req.method !== "HEAD")
          return err(c, "Modo suporte: somente consulta. Use as ações auditadas do Super Admin.", 403);
        m = { role: "clinic_admin", professional_id: null, unit_id: null, can_view_records: 0 };
        supportReadOnly = true;
        c.header("X-CR-Support-Mode", "read-only");
        c.header("Cache-Control", "no-store");
      }
      if (!m) return err(c, "Você não tem acesso a esta clínica.", 403);

      // Nunca permitir que o modo suporte alcance prontuário.
      if (supportReadOnly && (opts.auth === "records" || opts.auth === "dentist"))
        return err(c, "Dados clínicos não são acessíveis em modo suporte.", 403);

      const canViewRecords =
        m.role === "clinic_admin" || m.role === "dentist"
          ? true
          : settings.clinical.receptionist_can_view_records && m.can_view_records === 1;

      if (!roleCan(opts.auth, m.role, canViewRecords))
        return err(c, "Seu perfil não tem permissão para este recurso.", 403);

      user.clinic = {
        id: clinic.id,
        slug: clinic.slug,
        name: clinic.name,
        role: m.role,
        professional_id: m.professional_id,
        unit_id: m.unit_id,
        can_view_records: canViewRecords,
        plan: {
          code: clinic.plan_code,
          whatsapp_enabled: plan?.whatsapp_enabled ?? 0,
          clinical_enabled: plan?.clinical_enabled ?? 1,
          max_units: plan?.max_units ?? 1,
          max_dentists: plan?.max_dentists ?? 1,
          max_staff: plan?.max_staff ?? 1,
          max_messages_month: plan?.max_messages_month ?? 0,
        },
      };
      c.set("user", user);
      c.set("clinic", user.clinic);

      // Assinatura vencida: leitura/cancelamento continuam; novas escritas não.
      const isWrite = ["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method);
      const exemption = ALWAYS_WRITABLE.some((re) => re.test(c.req.path));
      if (opts.writeGuard !== false && isWrite && !exemption && !supportReadOnly) {
        const sub = await subscriptionState(c.env.DB, clinic.id);
        if (!canWrite(sub)) {
          return err(
            c,
            "A avaliação gratuita ou assinatura desta clínica está vencida. Solicite a reativação ao administrador da plataforma. Consultas e cancelamentos continuam disponíveis.",
            402
          );
        }
      }
    } else {
      c.set("clinic", {
        id: clinic.id,
        slug: clinic.slug,
        name: clinic.name,
        role: "public",
        professional_id: null,
        unit_id: null,
        can_view_records: false,
        plan: {
          code: clinic.plan_code,
          whatsapp_enabled: plan?.whatsapp_enabled ?? 0,
          clinical_enabled: plan?.clinical_enabled ?? 1,
          max_units: plan?.max_units ?? 1,
          max_dentists: plan?.max_dentists ?? 1,
          max_staff: plan?.max_staff ?? 1,
          max_messages_month: plan?.max_messages_month ?? 0,
        },
      });
    }

    c.set("settings", settings);
    await next();
  };

export function cid(c: Context<{ Bindings: Env }>): number {
  return (c.get("clinic") as { id: number }).id;
}

export function ctxSettings(c: Context<{ Bindings: Env }>): ClinicSettings {
  return c.get("settings") as ClinicSettings;
}

export function ctxPlan(c: Context<{ Bindings: Env }>): ClinicPlan | null {
  const clinic = c.get("clinic");
  return clinic?.plan ?? null;
}

/** Dentista só acessa os próprios pacientes/agenda. */
export function assertOwnProfessional(c: Context<{ Bindings: Env }>, professionalId: number): boolean {
  const u = c.get("user") as SessionUser | undefined;
  if (!u?.clinic) return false;
  if (u.clinic.role === "clinic_admin") return true;
  if (u.clinic.role === "dentist") return u.clinic.professional_id === professionalId;
  return false;
}
