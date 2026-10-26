// Adaptado do TIGU (api/lib/utils.ts) — utilitários neutros de domínio.
import type { Context } from "hono";

export const json = (c: Context, data: unknown, status = 200) => c.json(data, status as 200);
export const err = (c: Context, message: string, status = 400, details?: unknown) =>
  c.json({ error: message, ...(details ? { details } : {}) }, status as 400);

export function nowIso(d: Date = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function randomHex(bytes: number): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return [...arr].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I
export function readableCode(prefix = "CRO"): string {
  const arr = crypto.getRandomValues(new Uint8Array(8));
  let out = "";
  for (const b of arr) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `${prefix}-${out}`;
}

/** Somente dígitos (chave de busca de telefone/CPF). */
export function normalizePhone(phone: string): string {
  return (phone || "").replace(/\D/g, "");
}

export function formatPhoneBr(digits: string): string {
  const d = (digits || "").replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return formatPhoneBr(d.slice(2));
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

export function slugify(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Centavos → "R$ 45,00" */
export function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function b64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function uniqNumbers(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x) => Number.isInteger(x) && x > 0) as number[])];
}

/** Valida CPF (11 dígitos) — usado apenas quando o campo é informado. */
export function isValidCpf(raw: string): boolean {
  const cpf = (raw || "").replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(cpf[i], 10) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return calc(9) === parseInt(cpf[9], 10) && calc(10) === parseInt(cpf[10], 10);
}

/** Código de paciente legível: P-000123 */
export function patientCode(id: number): string {
  return `P-${String(id).padStart(6, "0")}`;
}

export function jsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
