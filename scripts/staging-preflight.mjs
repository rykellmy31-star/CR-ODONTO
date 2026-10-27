// Confere que o deploy por GitHub/Cloudflare Builds aponta somente para homologacao.
// Nao usar esta verificacao como autorizacao para publicar dados reais.
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
const errors = [];
if (config.name !== "cr-odonto") errors.push("Worker incorreto: esperado cr-odonto");
if (config.vars?.APP_ENV !== "staging" || config.vars?.CR_ODONTO_STAGING !== "1")
  errors.push("APP_ENV e CR_ODONTO_STAGING precisam indicar homologacao");
const db = config.d1_databases?.find((item) => item.binding === "DB");
if (db?.database_name !== "crodonto-staging-db" ||
    db?.database_id !== "cc562d69-dd29-4646-8bd2-0df6f26d9907")
  errors.push("Binding DB nao aponta para o D1 de homologacao aprovado");
const media = config.r2_buckets?.find((item) => item.binding === "MEDIA");
if (media?.bucket_name !== "crodonto-staging-media")
  errors.push("Binding R2 nao aponta para o bucket de homologacao");
if (config.triggers?.crons?.length) errors.push("Cron nao pode executar envios reais no staging");
if (errors.length) {
  errors.forEach((error) => console.error("ERRO: " + error));
  process.exit(1);
}
console.log("Preflight staging OK: Worker, D1, R2 e bloqueio de envio real configurados.");
