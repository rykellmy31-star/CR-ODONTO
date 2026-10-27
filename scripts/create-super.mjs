// Cria o PRIMEIRO superadministrador (bootstrap seguro).
// Só funciona uma vez: usa o segredo SETUP_TOKEN do ambiente e grava em platform_bootstrap.
//
// Uso (local):  node scripts/create-super.mjs
// Uso (produção):
//   BASE_URL=https://crodonto.seudominio.com SETUP_TOKEN=... \
//   SUPER_NAME="..." SUPER_EMAIL="..." SUPER_PASSWORD="..." node scripts/create-super.mjs
import { createClient } from "./lib/http.mjs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const SETUP_TOKEN = process.env.SETUP_TOKEN || "";
const name = process.env.SUPER_NAME || "Super Administrador";
const email = process.env.SUPER_EMAIL || "super@crodonto.com.br";
const password = process.env.SUPER_PASSWORD || "";

if (!SETUP_TOKEN || SETUP_TOKEN.length < 16) {
  console.error("Defina SETUP_TOKEN (mínimo 16 caracteres) — o mesmo configurado no Worker.");
  process.exit(1);
}
if (!password || password.length < 10) {
  console.error("Defina SUPER_PASSWORD com pelo menos 10 caracteres (letras e números).");
  process.exit(1);
}

const c = createClient(BASE);
const status = await c.get("/api/setup/status");
if (!status.ok) {
  console.error(`Não foi possível consultar ${BASE}/api/setup/status (status ${status.status}).`);
  process.exit(1);
}
if (status.data?.bootstrap_completed) {
  console.log("Bootstrap já concluído. Use o login normal ou peça a recuperação de senha a outro superadministrador.");
  process.exit(0);
}

const res = await c.post("/api/setup/superadmin", { setup_token: SETUP_TOKEN, name, email, password });
if (!res.ok) {
  console.error(`Falha ao criar o superadministrador (status ${res.status}): ${res.data?.error ?? ""}`);
  process.exit(1);
}

console.log(`✅ Superadministrador criado: ${email}`);
console.log("   A senha é provisória: no primeiro login o sistema exige a troca.");
