// Gera hashes no MESMO formato do Worker (api/lib/crypto.ts) para seed local.
// Formato: pbkdf2_sha256$<iterações>$<salt b64>$<hash b64>
import { webcrypto as crypto } from "node:crypto";

const ITERATIONS = 100_000;
const b64 = (buf) => Buffer.from(new Uint8Array(buf)).toString("base64");

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return `pbkdf2_sha256$${ITERATIONS}$${b64(salt)}$${b64(bits)}`;
}

export function randomHex(bytes = 16) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("hex");
}
