// ============================================================================
// Autenticação da equipe (clínicas + superadmin).
// ============================================================================
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import {
  authRateLimit, createSession, currentUser, destroySession, hashPassword,
  publicUser, requireAuth, revokeAllSessions, verifyPassword,
} from "../lib/auth";
import { audit } from "../lib/audit";
import { sha256hex } from "../lib/crypto";
import { err, nowIso, randomHex } from "../lib/utils";
import { rateLimit } from "../lib/auth";

export const authRouter = new Hono<{ Bindings: Env }>();

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

authRouter.post("/login", authRateLimit(10, 5 * 60_000), async (c) => {
  const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Informe e-mail e senha.", 422);
  const email = parsed.data.email.trim().toLowerCase();
  const ip = c.req.header("cf-connecting-ip") || "local";
  // Limite por conta além do limite por IP (evita ataque distribuído).
  if (!(await rateLimit(c.env, `login:${email}`, 8, 10 * 60_000)))
    return err(c, "Muitas tentativas para esta conta. Aguarde alguns minutos.", 429);

  const user = await c.env.DB.prepare(
    `SELECT id, name, email, password_hash, platform_role, active, must_change_password FROM users WHERE email = ?1`
  )
    .bind(email)
    .first<{ id: number; name: string; email: string; password_hash: string; platform_role: "user" | "superadmin"; active: number; must_change_password: number }>();

  const generic = { error: "E-mail ou senha incorretos." };
  if (!user) return c.json(generic, 401);
  if (user.active !== 1) return c.json({ error: "Usuário inativo. Fale com o administrador." }, 403);
  const valid = await verifyPassword(parsed.data.password, user.password_hash);
  if (!valid) return c.json(generic, 401);

  await createSession(c, user.id);
  await c.env.DB.prepare(`UPDATE users SET last_login_at = ?2 WHERE id = ?1`).bind(user.id, nowIso()).run();
  await audit(
    c.env.DB,
    { id: user.id, name: user.name, email: user.email, platform_role: user.platform_role },
    "auth.login", "user", user.id, { ip_hash: await sha256hex(ip) },
    { scope: "platform" }
  );

  return c.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      platform_role: user.platform_role,
      must_change_password: user.must_change_password === 1,
    },
  });
});

authRouter.post("/logout", async (c) => {
  const user = await currentUser(c);
  await destroySession(c);
  if (user) await audit(c.env.DB, user, "auth.logout", "user", user.id, {}, { scope: "platform" });
  return c.json({ ok: true });
});

/** Usuário atual + clínicas às quais tem acesso (para o seletor de clínica). */
authRouter.get("/me", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ user: null, clinics: [] });
  const rows = await c.env.DB.prepare(
    `SELECT c.id, c.slug, c.name, c.status, m.role, m.professional_id, p.name AS professional_name
       FROM clinic_memberships m
       JOIN clinics c ON c.id = m.clinic_id
       LEFT JOIN professionals p ON p.id = m.professional_id
      WHERE m.user_id = ?1 AND m.active = 1 AND c.deleted_at IS NULL
      ORDER BY c.name`
  )
    .bind(user.id)
    .all<{ id: number; slug: string; name: string; status: string; role: string; professional_id: number | null; professional_name: string | null }>();
  return c.json({
    user: publicUser(user),
    clinics: rows.results ?? [],
  });
});

const passwordSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: z.string().min(8).max(200),
});

authRouter.post("/password", requireAuth, async (c) => {
  const parsed = passwordSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "A nova senha deve ter ao menos 8 caracteres.", 422);
  if (parsed.data.new_password === parsed.data.current_password)
    return err(c, "A nova senha deve ser diferente da atual.", 422);
  if (/^\d+$/.test(parsed.data.new_password) || /^[a-z]+$/i.test(parsed.data.new_password))
    return err(c, "Use letras e números na nova senha.", 422);

  const user = await currentUser(c);
  if (!user) return err(c, "Não autenticado.", 401);
  const row = await c.env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?1`).bind(user.id).first<{ password_hash: string }>();
  if (!row) return err(c, "Usuário não encontrado.", 404);
  if (!(await verifyPassword(parsed.data.current_password, row.password_hash)))
    return err(c, "Senha atual incorreta.", 403);

  const hash = await hashPassword(parsed.data.new_password);
  await c.env.DB.prepare(`UPDATE users SET password_hash = ?2, must_change_password = 0 WHERE id = ?1`).bind(user.id, hash).run();
  // Encerra as demais sessões (a atual é recriada logo abaixo).
  await revokeAllSessions(c.env, user.id);
  await createSession(c, user.id);
  await audit(c.env.DB, user, "auth.password_changed", "user", user.id, {}, { scope: "platform" });
  return c.json({ ok: true, message: "Senha alterada. Você permanece conectado nesta sessão." });
});

/**
 * Recuperação de senha: a resposta é sempre a mesma (não revela se o e-mail
 * existe). Em produção o código é entregue pelo superadministrador/administrador
 * da clínica via canal interno; em desenvolvimento é devolvido na resposta.
 */
authRouter.post("/forgot", authRateLimit(5, 15 * 60_000), async (c) => {
  const body = (await c.req.json().catch(() => null)) as { email?: string } | null;
  const email = (body?.email || "").trim().toLowerCase();
  if (!email) return err(c, "Informe o e-mail.", 422);
  const user = await c.env.DB.prepare(`SELECT id, name FROM users WHERE email = ?1 AND active = 1`).bind(email).first<{ id: number; name: string }>();
  if (!user) return c.json({ ok: true, message: "Se o e-mail existir, um código de recuperação será disponibilizado." });

  const code = randomHex(4).toUpperCase();
  const codeHash = await sha256hex(`cr-reset:${user.id}:${code}`);
  await c.env.DB.prepare(
    `INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES (?1, ?2, ?3)`
  )
    .bind(user.id, codeHash, nowIso(new Date(Date.now() + 60 * 60_000)))
    .run();
  await audit(c.env.DB, null, "auth.forgot_requested", "user", user.id, {}, { scope: "platform" });
  const dev = c.env.APP_ENV !== "production";
  return c.json({
    ok: true,
    message: "Se o e-mail existir, um código de recuperação será disponibilizado.",
    ...(dev ? { dev_code: code, dev_note: "Código exposto apenas em ambiente de desenvolvimento." } : {}),
  });
});

const resetSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(40),
  new_password: z.string().min(8).max(200),
});

authRouter.post("/reset", authRateLimit(10, 15 * 60_000), async (c) => {
  const parsed = resetSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados inválidos. A senha deve ter ao menos 8 caracteres.", 422);
  const email = parsed.data.email.trim().toLowerCase();
  const user = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?1 AND active = 1`).bind(email).first<{ id: number }>();
  if (!user) return err(c, "Código inválido ou expirado.", 400);
  const codeHash = await sha256hex(`cr-reset:${user.id}:${parsed.data.code.trim().toUpperCase()}`);
  const reset = await c.env.DB.prepare(
    `SELECT id, attempts FROM password_resets
      WHERE user_id = ?1 AND code_hash = ?2 AND used_at IS NULL AND expires_at > ?3
      ORDER BY id DESC LIMIT 1`
  )
    .bind(user.id, codeHash, nowIso())
    .first<{ id: number; attempts: number }>();
  if (!reset) return err(c, "Código inválido ou expirado.", 400);
  if (reset.attempts >= 5) return err(c, "Muitas tentativas com este código. Solicite outro.", 429);

  await c.env.DB.prepare(`UPDATE password_resets SET used_at = ?2 WHERE id = ?1`).bind(reset.id, nowIso()).run();
  const hash = await hashPassword(parsed.data.new_password);
  await c.env.DB.prepare(`UPDATE users SET password_hash = ?2, must_change_password = 0 WHERE id = ?1`).bind(user.id, hash).run();
  await revokeAllSessions(c.env, user.id);
  await audit(c.env.DB, null, "auth.password_reset", "user", user.id, {}, { scope: "platform" });
  return c.json({ ok: true, message: "Senha redefinida. Faça login com a nova senha." });
});
