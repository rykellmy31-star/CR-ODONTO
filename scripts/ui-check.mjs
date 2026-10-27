// Verificação funcional da UI em navegador real: percorre as telas de cada perfil,
// confere conteúdo esperado, erros de console e chamadas de API com falha.
//
// Requer (opcional, apenas para esta verificação):
//   npm i -D playwright-core && npx playwright install chromium
// Uso:
//   BASE_URL=http://localhost:5173 SLUG=sorriso-demo node scripts/ui-check.mjs
const pwPath = process.env.PLAYWRIGHT_CORE || "playwright-core";
let chromium;
try {
  const mod = await import(pwPath);
  chromium = mod.chromium ?? mod.default?.chromium;
  if (!chromium) throw new Error("chromium não encontrado");
} catch {
  console.error("playwright-core não instalado. Rode: npm i -D playwright-core && npx playwright install chromium");
  process.exit(2);
}
import { mkdir } from "node:fs/promises";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:5173").replace(/\/$/, "");
const OUT = process.env.SHOTS_DIR || "docs/screenshots";
const SLUG = process.env.SLUG || "sorriso-demo";
const ADMIN = { email: process.env.ADMIN_EMAIL || `admin@${SLUG.replace("-", "")}.com.br`, password: process.env.ADMIN_PASSWORD || "DemoOdonto2026" };
const DENTIST = { email: process.env.DENTIST_EMAIL || `dra.ana@${SLUG.replace("-", "")}.com.br`, password: ADMIN.password };
const SUPER = { email: process.env.SUPER_EMAIL || "super@crodonto.com.br", password: process.env.SUPER_PASSWORD || "" };
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: "pt-BR" });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);

const consoleErrors = [];
const apiFailures = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 300)}`));
page.on("response", (r) => {
  if (r.url().includes("/api/") && r.status() >= 400) apiFailures.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`);
});

const results = [];
async function checkRoute(path, expected, label) {
  const before = apiFailures.length;
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" }).catch(() => {});
  let body = "";
  let okText = false;
  for (let i = 0; i < 12 && !okText; i++) {
    await page.waitForTimeout(700);
    body = (await page.textContent("body").catch(() => "")) ?? "";
    okText = expected.every((t) => body.toLowerCase().includes(t.toLowerCase()));
  }
  const newFail = apiFailures.slice(before);
  const ok = okText && newFail.length === 0;
  results.push({ label, path, ok, okText, newFail });
  console.log(`${ok ? "✅" : "❌"} ${label} (${path})${okText ? "" : ` — faltou: ${expected.filter((t) => !body.toLowerCase().includes(t.toLowerCase())).join(", ")}`}${newFail.length ? ` | API: ${newFail.join(", ")}` : ""}`);
}

async function login(email, password) {
  await ctx.clearCookies();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  return page.url();
}

// Público
await checkRoute("/", ["CR ODONTO"], "Raiz / escolha de clínica");
await checkRoute(`/c/${SLUG}`, ["Sorriso Demo", "Escolha o dentista"], "Site público da clínica");
await checkRoute(`/c/${SLUG}/portal`, ["Portal do paciente"], "Portal do paciente (login)");

// Admin
const adminUrl = await login(ADMIN.email, ADMIN.password);
results.push({ label: "Login admin redireciona ao painel", ok: adminUrl.includes(`/c/${SLUG}/admin`), path: "/login" });
console.log(`${adminUrl.includes(`/c/${SLUG}/admin`) ? "✅" : "❌"} Login admin → ${adminUrl.replace(BASE, "")}`);

await checkRoute(`/c/${SLUG}/admin`, ["Painel"], "Dashboard do admin");
await checkRoute(`/c/${SLUG}/admin/agenda`, ["Agenda"], "Agenda (dia/semana)");
await checkRoute(`/c/${SLUG}/admin/pacientes`, ["Paciente"], "Lista de pacientes");
await checkRoute(`/c/${SLUG}/admin/pacientes/1`, ["Maria Souza Andrade", "Odontograma"], "Prontuário + odontograma");
await checkRoute(`/c/${SLUG}/admin/equipe`, ["Usuários com acesso"], "Equipe e acessos");
await checkRoute(`/c/${SLUG}/admin/procedimentos`, ["Procedimentos"], "Procedimentos e especialidades");
await checkRoute(`/c/${SLUG}/admin/whatsapp`, ["WhatsApp"], "Configuração de WhatsApp");
await checkRoute(`/c/${SLUG}/admin/relatorios`, ["Operacional"], "Relatórios");
await checkRoute(`/c/${SLUG}/admin/configuracoes`, ["Dados da clínica"], "Configurações da clínica");

// Dentista
const proUrl = await login(DENTIST.email, DENTIST.password);
console.log(`${proUrl.includes("/pro") ? "✅" : "❌"} Login dentista → ${proUrl.replace(BASE, "")}`);
results.push({ label: "Login dentista redireciona ao painel do dentista", ok: proUrl.includes("/pro"), path: "/login" });
await checkRoute(`/c/${SLUG}/pro`, ["Minha agenda"], "Painel do dentista");

// Superadmin
const superUrl = await login(SUPER.email, SUPER.password || "SuperOdonto2026");
console.log(`${superUrl.includes("/superadmin") ? "✅" : "❌"} Login superadmin → ${superUrl.replace(BASE, "")}`);
results.push({ label: "Login superadmin redireciona ao painel da plataforma", ok: superUrl.includes("/superadmin"), path: "/login" });
await checkRoute("/superadmin/visao-geral", ["Visão geral"], "Superadmin: visão geral");
await checkRoute("/superadmin/clinicas", ["Nova clínica"], "Superadmin: clínicas");
await checkRoute("/superadmin/planos", ["Novo plano"], "Superadmin: planos");
await checkRoute("/superadmin/auditoria", ["Logs administrativos"], "Superadmin: auditoria");

// Responsivo
const mobile = await ctx.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.goto(`${BASE}/c/${SLUG}`, { waitUntil: "domcontentloaded" });
await mobile.waitForTimeout(2000);
const mobileBody = (await mobile.textContent("body")) ?? "";
const mobileOk = mobileBody.toLowerCase().includes("sorriso demo");
results.push({ label: "Site público em viewport mobile", ok: mobileOk, path: "/c/:slug (390px)" });
console.log(`${mobileOk ? "✅" : "❌"} Site público em viewport mobile (390px)`);

// Screenshots (best-effort, não bloqueiam a verificação)
try {
  await page.goto(`${BASE}/c/${SLUG}/admin/agenda`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/agenda.png`, animations: "disabled", timeout: 8000 });
} catch { /* opcional */ }

const passed = results.filter((r) => r.ok).length;
console.log(`\nTelas verificadas: ${passed}/${results.length}`);
if (consoleErrors.length) {
  console.log("\nErros de console:");
  for (const e of [...new Set(consoleErrors)].slice(0, 20)) console.log(` - ${e}`);
}
console.log(`Erros de console: ${consoleErrors.length} · Falhas de API: ${apiFailures.length}`);
await browser.close();
process.exitCode = passed === results.length && consoleErrors.length === 0 && apiFailures.length === 0 ? 0 : 1;
