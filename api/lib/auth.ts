// ============================================================================
// Autenticação (staff) + sessões no D1 + CSRF por origin + rate limit.
// Adaptado do TIGU (api/lib/auth.ts). Diferenças:
//  - papéis: superadmin (plataforma) / clinic_admin / dentist / receptionist
//  - cookie assinado "uid.<id>.<token>" com hash sha256 no D1 (nunca o token)
//  - sessão de paciente (portal) tratada em api/lib/patient-auth.ts
// ============================================================================
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createFactory } from "hono/factory";
import { sha256hex } from "./crypto";
import { persistentRateLimit } from "./rate-limit";
import type { Env, SessionUser } from "../types";
import { err, nowIso, randomHex } from "./utils";

const factory = createFactory<{ Bindings: Env }>();

export const COOKIE_NAME = "cr_sess";
const SESSION_DAYS = 7;

function secretOf(env: Env): string {
  const s = env.SESSION_SECRET;
  if (!s || s.length < 32) {
    if (env.APP_ENV === "production") throw new Error("SESSION_SECRET ausente/curto (mínimo 32 caracteres)");
    return "dev-only-session-secret-nao-use-em-producao";
  }
  return s;
}

const sha = (input: string) => sha256hex(input);

export async function createSession(c: Context<{ Bindings: Env }>, userId: number): Promise<void> {
  const token = randomHex(32);
  const tokenHash = await sha(`${token}:${secretOf(c.env)}:${userId}`);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await c.env.DB.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?1,?2,?3,?4)`
  )
    .bind(tokenHash, userId, nowIso(expires), nowIso())
    .run();
  setCookie(c, COOKIE_NAME, `uid.${userId}.${token}`, {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function destroySession(c: Context<{ Bindings: Env }>): Promise<void> {
  const v = getCookie(c, COOKIE_NAME);
  if (v) {
    const parts = v.split(".");
    if (parts.length === 3 && /^\d+$/.test(parts[1])) {
      const uid = parseInt(parts[1], 10);
      const tokenHash = await sha(`${parts[2]}:${secretOf(c.env)}:${uid}`);
      await c.env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?1`).bind(tokenHash).run();
    }
  }
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

/** Invalida todas as outras sessões do usuário (troca de senha, incidente). */
export async function revokeAllSessions(env: Env, userId: number, exceptTokenHash?: string): Promise<number> {
  const res = await env.DB.prepare(
    `DELETE FROM sessions WHERE user_id = ?1 ${exceptTokenHash ? "AND token_hash <> ?2" : ""}`
  )
    .bind(...(exceptTokenHash ? [userId, exceptTokenHash] : [userId]))
    .run();
  return res.meta?.changes ?? 0;
}

export async function currentUser(c: Context<{ Bindings: Env }>): Promise<SessionUser | null> {
  const v = getCookie(c, COOKIE_NAME);
  if (!v) return null;
  const parts = v.split(".");
  if (parts.length !== 3 || parts[0] !== "uid" || !/^\d+$/.test(parts[1])) return null;
  const uid = parseInt(parts[1], 10);
  const tokenHash = await sha(`${parts[2]}:${secretOf(c.env)}:${uid}`);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.platform_role, u.must_change_password
       FROM users u JOIN sessions s ON s.user_id = u.id
      WHERE s.user_id = ?1 AND s.token_hash = ?2 AND u.active = 1 AND s.expires_at > ?3`
  )
    .bind(uid, tokenHash, nowIso())
    .first<{ id: number; name: string; email: string; platform_role: "user" | "superadmin"; must_change_password: number }>();
  if (!row) return null;
  c.executionCtx?.waitUntil?.(
    c.env.DB.prepare(`UPDATE sessions SET last_seen_at = ?2 WHERE token_hash = ?1`).bind(tokenHash, nowIso()).run()
  );
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    platform_role: row.platform_role,
    must_change_password: row.must_change_password === 1,
  };
}

export async function currentUserOptional(c: Context<{ Bindings: Env }>): Promise<SessionUser | null> {
  try {
    return await currentUser(c);
  } catch {
    return null;
  }
}

export const requireAuth = factory.createMiddleware(async (c, next) => {
  const u = await currentUser(c);
  if (!u) return err(c, "Não autenticado. Faça login para continuar.", 401);
  if (u.must_change_password && c.req.path !== "/api/auth/password")
    return err(c, "Você precisa alterar a senha provisória antes de acessar esta área.", 403);
  c.set("user", u);
  await next();
});

export const requireSuper = factory.createMiddleware(async (c, next) => {
  const u = await currentUser(c);
  if (!u) return err(c, "Não autenticado.", 401);
  if (u.platform_role !== "superadmin") return err(c, "Acesso restrito à administração da plataforma.", 403);
  if (u.must_change_password) return err(c, "Troque a senha provisória antes de acessar o Superadmin.", 403);
  c.set("user", u);
  await next();
});

/** Proteção CSRF por Origin/Host em métodos de escrita. */
export const originGuard = factory.createMiddleware(async (c, next) => {
  const method = c.req.method;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const origin = c.req.header("origin");
    if (origin) {
      const host = c.req.header("host");
      try {
        if (new URL(origin).host !== host) return err(c, "Origem não permitida", 403);
      } catch {
        return err(c, "Origem inválida", 403);
      }
    } else {
      const ct = c.req.header("content-type") || "";
      if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
        return err(c, "Requisições cross-origin de formulário não são permitidas", 403);
      }
    }
  }
  await next();
});

export function rateLimit(env: Env, key: string, limit: number, windowMs: number): Promise<boolean> {
  return persistentRateLimit(env.DB, env.SESSION_SECRET || "dev-request-limit-key", key, limit, windowMs);
}

export const authRateLimit =
  (limit = 10, windowMs = 5 * 60_000) =>
  async (c: Context<{ Bindings: Env }>, next: () => Promise<void>) => {
    const ip = c.req.header("cf-connecting-ip") || "local";
    const scope = c.req.path.replace(/^\/api\/c\/[a-z0-9-]+/, "");
    if (!(await rateLimit(c.env, `auth:${ip}:${scope}`, limit, windowMs))) {
      return err(c, "Muitas tentativas. Aguarde alguns minutos e tente novamente.", 429);
    }
    await next();
  };

export { hashPassword, verifyPassword } from "./crypto";

export const publicUser = (u: SessionUser) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  platform_role: u.platform_role,
  must_change_password: u.must_change_password === true,
  clinic: u.clinic
    ? {
        slug: u.clinic.slug,
        name: u.clinic.name,
        role: u.clinic.role,
        professional_id: u.clinic.professional_id,
        unit_id: u.clinic.unit_id,
        can_view_records: u.clinic.can_view_records,
        plan: u.clinic.plan.code,
      }
    : null,
});
