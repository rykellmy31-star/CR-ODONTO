// ============================================================================
// Bootstrap do PRIMEIRO superadministrador.
// - exige o segredo SETUP_TOKEN do ambiente (variável/secreta, nunca no código)
// - funciona UMA única vez (registro em platform_bootstrap)
// - a senha é definida agora e trocada no primeiro acesso (must_change_password)
// ============================================================================
import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../types";
import { hashPassword } from "../lib/crypto";
import { err, nowIso } from "../lib/utils";
import { rateLimit } from "../lib/auth";
import { audit } from "../lib/audit";

export const setupRouter = new Hono<{ Bindings: Env }>();

setupRouter.get("/status", async (c) => {
  const done = await c.env.DB.prepare(`SELECT completed_at FROM platform_bootstrap WHERE id = 1`).first();
  const admins = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM users WHERE platform_role='superadmin'`).first<{ n: number }>();
  return c.json({
    bootstrap_completed: Boolean(done),
    superadmins: admins?.n ?? 0,
    setup_token_configured: Boolean(c.env.SETUP_TOKEN && c.env.SETUP_TOKEN.length >= 16),
  });
});

const schema = z.object({
  setup_token: z.string().min(16).max(200),
  name: z.string().min(3).max(120),
  email: z.string().email().max(200),
  password: z.string().min(10).max(200),
});

setupRouter.post("/superadmin", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || "local";
  if (!(await rateLimit(c.env, `setup:${ip}`, 5, 60 * 60_000)))
    return err(c, "Muitas tentativas. Tente novamente mais tarde.", 429);

  if (!c.env.SETUP_TOKEN || c.env.SETUP_TOKEN.length < 16)
    return err(
      c,
      "Configuração inicial indisponível: defina o segredo SETUP_TOKEN no ambiente (npx wrangler secret put SETUP_TOKEN).",
      503
    );

  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return err(c, "Dados inválidos. A senha deve ter no mínimo 10 caracteres.", 422);

  // Comparação em tempo constante com o token do ambiente.
  const a = new TextEncoder().encode(parsed.data.setup_token);
  const b = new TextEncoder().encode(c.env.SETUP_TOKEN);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  if (diff !== 0) return err(c, "Token de configuração inválido.", 403);

  const done = await c.env.DB.prepare(`SELECT completed_at FROM platform_bootstrap WHERE id = 1`).first();
  if (done) return err(c, "A configuração inicial já foi concluída. Use o login normal.", 409);

  const email = parsed.data.email.trim().toLowerCase();
  const existing = await c.env.DB.prepare(`SELECT id, platform_role FROM users WHERE email = ?1`).bind(email).first<{ id: number; platform_role: string }>();
  if (existing && existing.platform_role !== "superadmin")
    return err(c, "Este e-mail já pertence a outro usuário da plataforma.", 409);

  const hash = await hashPassword(parsed.data.password);
  const userId = existing
    ? (await c.env.DB.prepare(`UPDATE users SET password_hash=?2, platform_role='superadmin', active=1, must_change_password=1, name=?3 WHERE id=?1`).bind(existing.id, hash, parsed.data.name).run(), existing.id)
    : Number(
        (
          await c.env.DB.prepare(
            `INSERT INTO users (platform_role, name, email, password_hash, must_change_password) VALUES ('superadmin', ?1, ?2, ?3, 1)`
          )
            .bind(parsed.data.name, email, hash)
            .run()
        ).meta?.last_row_id ?? 0
      );

  await c.env.DB.prepare(`INSERT INTO platform_bootstrap (id, completed_at, user_id) VALUES (1, ?1, ?2)`).bind(nowIso(), userId).run();
  await audit(c.env.DB, { id: userId, name: parsed.data.name, email, platform_role: "superadmin" }, "platform.bootstrap", "user", userId, {}, { scope: "platform" });

  return c.json({
    ok: true,
    message: "Superadministrador criado. Faça login e altere a senha no primeiro acesso.",
  }, 201);
});
