// Recria o banco D1 local do zero (uso exclusivo em desenvolvimento).
import { rm } from "node:fs/promises";
import { execSync } from "node:child_process";

const stateDirs = [".wrangler/state", ".wrangler/tmp"];
for (const dir of stateDirs) {
  await rm(dir, { recursive: true, force: true });
  console.log(`removido: ${dir}`);
}
console.log("aplicando migrations...");
execSync("npx wrangler d1 migrations apply crodonto-db --local", { stdio: "inherit" });
console.log("Banco local recriado. Rode `npm run db:seed:local` para popular a clínica de demonstração.");
