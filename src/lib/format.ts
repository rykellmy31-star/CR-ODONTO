export function formatPhone(digits: string): string {
  const d = (digits || "").replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d || "—";
}

export function formatCpf(v: string): string {
  const d = (v || "").replace(/\D/g, "");
  if (d.length !== 11) return v || "—";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function formatMoney(cents: number): string {
  return ((cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDateBr(day: string | null | undefined): string {
  if (!day) return "—";
  const [y, m, d] = day.split("-");
  if (!y || !m || !d) return day;
  return `${d}/${m}/${y}`;
}

export function formatDateTime(iso: string | null | undefined, timezone?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    timeZone: timezone, day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** HH:MM no fuso da clínica. */
export function timeInTz(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
}

export function todayIso(timezone?: string): string {
  const now = new Date();
  if (!timezone) {
    const y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts;
}

export function addDaysIso(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function weekdayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("pt-BR", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "2-digit" });
}

export function ageFrom(birth: string | null | undefined): string {
  if (!birth) return "—";
  const [y, m, d] = birth.split("-").map(Number);
  if (!y) return "—";
  const today = new Date();
  let age = today.getFullYear() - y;
  const beforeBirthday = today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d);
  if (beforeBirthday) age--;
  return `${age} anos`;
}

export const STATUS_LABEL: Record<string, string> = {
  agendado: "Agendado",
  aguardando_confirmacao: "Aguardando confirmação",
  confirmado: "Confirmado",
  chegou: "Paciente chegou",
  em_atendimento: "Em atendimento",
  concluido: "Concluído",
  cancelado: "Cancelado",
  reagendado: "Reagendado",
  nao_compareceu: "Não compareceu",
};

export const STATUS_STYLE: Record<string, string> = {
  agendado: "bg-slate-100 text-slate-700",
  aguardando_confirmacao: "bg-amber-100 text-amber-800",
  confirmado: "bg-emerald-100 text-emerald-800",
  chegou: "bg-sky-100 text-sky-800",
  em_atendimento: "bg-indigo-100 text-indigo-800",
  concluido: "bg-brand-100 text-brand-800",
  cancelado: "bg-rose-100 text-rose-700",
  reagendado: "bg-violet-100 text-violet-700",
  nao_compareceu: "bg-orange-100 text-orange-800",
};

export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "nao_informado", label: "Não informado" },
  { value: "pix", label: "Pix" },
  { value: "dinheiro", label: "Dinheiro" },
  { value: "cartao_credito", label: "Cartão de crédito" },
  { value: "cartao_debito", label: "Cartão de débito" },
  { value: "transferencia", label: "Transferência" },
  { value: "pendente", label: "Pagamento pendente" },
  { value: "outro", label: "Outro" },
];
