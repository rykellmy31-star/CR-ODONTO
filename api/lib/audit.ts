// Adaptado do TIGU (api/lib/audit.ts). Auditoria nunca bloqueia a operação.
import type { SessionUser } from "../types";

export async function audit(
  db: D1Database,
  user: SessionUser | null | undefined,
  action: string,
  entity: string,
  entityId: number | string = "",
  meta: unknown = {},
  opts: { clinicId?: number | null; scope?: "clinic" | "platform"; ipHash?: string } = {}
): Promise<void> {
  try {
    const clinicId = opts.clinicId ?? user?.clinic?.id ?? null;
    const scope = opts.scope ?? (clinicId ? "clinic" : "platform");
    await db
      .prepare(
        `INSERT INTO audit_log (clinic_id, scope, user_id, user_name, action, entity, entity_id, meta, ip_hash)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`
      )
      .bind(clinicId, scope, user?.id ?? null, user?.name ?? "sistema", action, entity, String(entityId), JSON.stringify(meta ?? {}), opts.ipHash ?? "")
      .run();
  } catch {
    /* noop por design */
  }
}
