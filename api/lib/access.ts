// ============================================================================
// Assinatura, avaliação gratuita e limites de plano.
// Adaptado do TIGU (api/lib/trial.ts) — SEM gateway de pagamento: a situação
// da assinatura é controlada manualmente pelo superadministrador.
// ============================================================================
import type { ClinicPlan } from "../types";

export interface ClinicPlanFull extends ClinicPlan {
  name: string;
  price_cents_month: number;
}

export async function loadPlan(db: D1Database, code: string): Promise<ClinicPlanFull | null> {
  return db
    .prepare(
      `SELECT code, name, price_cents_month, whatsapp_enabled, clinical_enabled, max_units,
              max_dentists, max_staff, max_messages_month
         FROM plans WHERE code = ?1`
    )
    .bind(code)
    .first<ClinicPlanFull>();
}

export interface SubscriptionState {
  plan_code: string;
  status: "trial" | "active" | "past_due" | "cancelled" | "blocked";
  trial_ends_at: string | null;
  period_end: string | null;
  plan: ClinicPlanFull | null;
}

export async function subscriptionState(db: D1Database, clinicId: number): Promise<SubscriptionState | null> {
  const row = await db
    .prepare(
      `SELECT s.plan_code, s.status, s.trial_ends_at, s.period_end, c.trial_ends_at AS clinic_trial
         FROM subscriptions s JOIN clinics c ON c.id = s.clinic_id WHERE s.clinic_id = ?1`
    )
    .bind(clinicId)
    .first<{ plan_code: string; status: SubscriptionState["status"]; trial_ends_at: string | null; period_end: string | null; clinic_trial: string | null }>();
  if (!row) return null;
  return {
    plan_code: row.plan_code,
    status: row.status,
    trial_ends_at: row.trial_ends_at ?? row.clinic_trial,
    period_end: row.period_end,
    plan: await loadPlan(db, row.plan_code),
  };
}

export function trialExpired(sub: SubscriptionState | null, now = new Date()): boolean {
  if (!sub) return false;
  if (sub.status !== "trial") return false;
  if (!sub.trial_ends_at) return false;
  return new Date(sub.trial_ends_at).getTime() < now.getTime();
}

/** Escrita liberada? (leitura e cancelamento sempre liberados) */
export function canWrite(sub: SubscriptionState | null, now = new Date()): boolean {
  if (!sub) return false;
  if (sub.status === "active") return true;
  if (sub.status === "trial") return !trialExpired(sub, now);
  return false;
}

/** WhatsApp disponível? Exige plano com whatsapp + assinatura em dia. */
export function whatsappAllowed(sub: SubscriptionState | null): boolean {
  return Boolean(sub && sub.plan && sub.plan.whatsapp_enabled === 1 && canWrite(sub));
}

export function clinicalAllowed(sub: SubscriptionState | null): boolean {
  return Boolean(sub && sub.plan && sub.plan.clinical_enabled === 1 && canWrite(sub));
}

export interface PlanLimits {
  max_units: number;
  max_dentists: number;
  max_staff: number;
}

export async function withinLimits(
  db: D1Database,
  clinicId: number,
  plan: ClinicPlanFull | null,
  kind: "unit" | "dentist" | "staff"
): Promise<{ ok: boolean; limit: number; used: number }> {
  const limits: PlanLimits = {
    max_units: plan?.max_units ?? 1,
    max_dentists: plan?.max_dentists ?? 1,
    max_staff: plan?.max_staff ?? 1,
  };
  let used = 0;
  if (kind === "unit") {
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM units WHERE clinic_id=?1 AND active=1`).bind(clinicId).first<{ n: number }>();
    used = r?.n ?? 0;
    return { ok: limits.max_units < 0 || used < limits.max_units, limit: limits.max_units, used };
  }
  if (kind === "dentist") {
    const r = await db.prepare(`SELECT COUNT(*) AS n FROM professionals WHERE clinic_id=?1 AND active=1`).bind(clinicId).first<{ n: number }>();
    used = r?.n ?? 0;
    return { ok: limits.max_dentists < 0 || used < limits.max_dentists, limit: limits.max_dentists, used };
  }
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM clinic_memberships WHERE clinic_id=?1 AND active=1 AND role='receptionist'`)
    .bind(clinicId)
    .first<{ n: number }>();
  used = r?.n ?? 0;
  return { ok: limits.max_staff < 0 || used < limits.max_staff, limit: limits.max_staff, used };
}
