// ============================================================================
// CR ODONTO — Worker (Hono) + cron de lembretes.
//
// Rotas:
//   /api/setup/*              bootstrap protegido do primeiro superadministrador
//   /api/auth/*               login, sessão, senha, recuperação
//   /api/super/*              superadministrador da plataforma
//   /api/c/:slug/*            público: site, agendamento, portal, links seguros
//   /api/c/:slug/admin/*      painel da clínica (admin e recepção)
//   /api/c/:slug/pro/*        painel do dentista + prontuário/odontograma
//   /api/webhooks/whatsapp    Meta Cloud API (sem sessão, com assinatura)
//   /uploads/*                R2 privado (documentos) e logomarcas
//   scheduled()               cron a cada 5 min → fila de lembretes
// ============================================================================
import { Hono } from "hono";
import type { Env } from "./types";
import { authRouter } from "./routes/auth";
import { setupRouter } from "./routes/setup";
import { superRouter } from "./routes/super";
import { adminRouter } from "./routes/admin";
import { proRouter } from "./routes/pro";
import { publicRouter } from "./routes/public";
import { webhooksRouter } from "./routes/webhooks";
import { uploadsRouter } from "./routes/uploads";
import { originGuard } from "./lib/auth";
import { purgeRequestRateLimits } from "./lib/rate-limit";
import { processDueJobs } from "./lib/messaging/jobs";
import { nowIso } from "./lib/utils";

const app = new Hono<{ Bindings: Env }>();

app.onError((e, c) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[api-error] ${c.req.method} ${c.req.path}:`, msg, (e as Error).stack ?? "");
  return c.json(
    {
      error:
        c.env.APP_ENV === "production"
          ? "Não foi possível concluir a solicitação. Tente novamente em instantes."
          : "Erro interno. Migrations aplicadas? (npm run db:migrate:local)",
      detail: c.env.APP_ENV !== "production" ? msg : undefined,
    },
    500
  );
});
app.notFound((c) => c.json({ error: "Rota não encontrada", path: c.req.path }, 404));

// Dados de saúde: nada pode ser cacheado por intermediários.
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  await next();
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "cr-odonto-api",
    time: nowIso(),
    d1: Boolean(c.env.DB),
    r2: Boolean(c.env.MEDIA),
    environment: c.env.APP_ENV ?? "development",
    security: {
      session_secret_ready: Boolean(c.env.SESSION_SECRET && c.env.SESSION_SECRET.length >= 32),
      encryption_key_ready: Boolean(c.env.MSG_ENC_KEY && c.env.MSG_ENC_KEY.length >= 32),
      setup_token_configured: Boolean(c.env.SETUP_TOKEN && c.env.SETUP_TOKEN.length >= 16),
    },
    whatsapp: {
      webhook_ready: Boolean(c.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN),
      signature_check: Boolean(c.env.WHATSAPP_APP_SECRET),
      mock: c.env.WHATSAPP_MOCK === "1" && c.env.APP_ENV !== "production",
    },
  })
);

app.use("/api/*", originGuard);

app.route("/api/setup", setupRouter);
app.route("/api/auth", authRouter);
app.route("/api/super", superRouter);
app.route("/api/webhooks", webhooksRouter);
app.route("/api/c/:slug/admin", adminRouter);
app.route("/api/c/:slug/pro", proRouter);
app.route("/api/c/:slug/uploads", uploadsRouter);
app.route("/api/c/:slug", publicRouter);
app.route("/uploads", uploadsRouter);

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),

  /** Cron: processa lembretes vencidos e limpa limites expirados. */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (env.CR_ODONTO_STAGING === "1") return; // homologação: nenhum disparo real
    ctx.waitUntil(
      (async () => {
        try {
          const result = await processDueJobs(env, { limit: 50 });
          if (result.processed > 0)
            console.log(`[cron] jobs=${result.processed} enviados=${result.sent} falhas=${result.failed} ignorados=${result.skipped}`);
          const now = new Date();
          if (now.getUTCHours() === 3 && now.getUTCMinutes() < 5) {
            await purgeRequestRateLimits(env.DB);
            // Exclui códigos de portal e tokens de ação vencidos (retenção mínima).
            await env.DB.prepare(`DELETE FROM portal_codes WHERE expires_at < ?1`).bind(nowIso()).run();
            await env.DB.prepare(`DELETE FROM action_tokens WHERE expires_at < ?1`).bind(nowIso(new Date(Date.now() - 7 * 86400_000))).run();
            await env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?1`).bind(nowIso()).run();
            await env.DB.prepare(`DELETE FROM patient_sessions WHERE expires_at < ?1`).bind(nowIso()).run();
          }
        } catch (e) {
          console.error("[cron]", String(e));
        }
      })()
    );
  },
};

export { app };
export const fetchHandler = (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx);
