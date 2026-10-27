// Verificações antes de aplicar migrations remotas ou publicar.
// Falha (exit 1) quando encontra algo que impediria um deploy seguro.
import { readFile } from "node:fs/promises";

const problems = [];
const warnings = [];

const wrangler = await readFile("wrangler.jsonc", "utf8");
const pkg = JSON.parse(await readFile("package.json", "utf8"));

if (wrangler.includes("REPLACE_WITH_YOUR_D1_DATABASE_ID")) {
  problems.push("wrangler.jsonc: troque REPLACE_WITH_YOUR_D1_DATABASE_ID pelo id real da sua D1 (npx wrangler d1 create crodonto-db).");
}
if (!wrangler.includes("d1_databases")) problems.push("wrangler.jsonc: binding D1 (DB) ausente.");
if (!wrangler.includes("r2_buckets")) problems.push("wrangler.jsonc: binding R2 (MEDIA) ausente.");

try {
  const devVars = await readFile(".dev.vars", "utf8");
  if (devVars.trim().length > 0) warnings.push(".dev.vars existe no diretório: confirme que NÃO será comitado (está no .gitignore).");
} catch {
  /* esperado em CI */
}

const requiredScripts = ["deploy", "db:migrate:remote", "test", "smoke"];
for (const s of requiredScripts) {
  if (!pkg.scripts[s]) problems.push(`package.json: script "${s}" ausente.`);
}

try {
  await readFile("dist/index.html");
} catch {
  warnings.push("dist/ ainda não existe: rode `npm run build` antes de publicar (o script deploy já faz isso).");
}

const requiredSecrets = ["SESSION_SECRET", "MSG_ENC_KEY", "SETUP_TOKEN"];
console.log("Segredos que precisam existir no Worker de produção:");
for (const s of requiredSecrets) console.log(`  - ${s}  (npx wrangler secret put ${s})`);
console.log("Opcionais (WhatsApp real): WHATSAPP_WEBHOOK_VERIFY_TOKEN, WHATSAPP_APP_SECRET, GRAPH_API_VERSION, PUBLIC_URL\n");

if (warnings.length) {
  console.log("Avisos:");
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (problems.length) {
  console.error("\nBloqueios:");
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("\n✅ Preflight OK para prosseguir.");
