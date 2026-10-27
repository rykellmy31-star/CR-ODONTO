// Kit de UI enxuto e responsivo (sem dependências externas além de React).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { Icon } from "../Icons";

// ── Botão ──────────────────────────────────────────────────────────────────
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
};

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, ...rest }: ButtonProps) {
  const base = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : variant === "ghost" ? "btn-ghost" : "btn-secondary";
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(base, size === "sm" && "px-3 py-1.5 text-xs", className)}
    >
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
      {children}
    </button>
  );
}

// ── Campos ─────────────────────────────────────────────────────────────────
export function Field({
  label, hint, error, children, required,
}: { label: string; hint?: string; error?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block">
      <span className="label">
        {label} {required && <span className="text-rose-500">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs font-medium text-rose-600">{error}</span>}
    </label>
  );
}

export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className={clsx("input", p.className)} />
);

export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...p} className={clsx("input min-h-[80px] resize-y", p.className)} />
);

export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={clsx("input appearance-none bg-white pr-8", p.className)} />
);

// ── Cartões e layout ───────────────────────────────────────────────────────
export function Card({ children, className, title, subtitle, actions }: {
  children?: ReactNode; className?: string; title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode;
}) {
  return (
    <section className={clsx("card p-4 sm:p-5", className)}>
      {(title || actions) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-800">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default" }: {
  label: string; value: ReactNode; hint?: string; tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneClass =
    tone === "good" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "bad" ? "text-rose-600" : "text-slate-900";
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={clsx("mt-1 text-2xl font-bold tabular-nums", toneClass)}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx("chip", className ?? "bg-slate-100 text-slate-700")}>{children}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-md text-xs text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      {label ?? "Carregando..."}
    </div>
  );
}

// ── Modal responsivo (full-screen no celular) ─────────────────────────────
export function Modal({ open, onClose, title, children, footer, size = "md" }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  const width = size === "sm" ? "sm:max-w-md" : size === "lg" ? "sm:max-w-3xl" : "sm:max-w-xl";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className={clsx("flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-3xl", width)}>
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Fechar"><Icon name="close" className="h-4 w-4" /></button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="border-t border-slate-200 px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

// ── Abas ───────────────────────────────────────────────────────────────────
export function Tabs({ tabs, value, onChange }: {
  tabs: { id: string; label: string; icon?: ReactNode }[]; value: string; onChange: (id: string) => void;
}) {
  return (
    <div className="no-scrollbar -mx-1 mb-4 flex gap-1 overflow-x-auto px-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            "flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold transition",
            value === t.id ? "bg-brand-700 text-white shadow-sm" : "bg-white text-slate-600 hover:bg-slate-100"
          )}
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────
type Toast = { id: number; message: string; tone: "success" | "error" | "info" };
const ToastCtx = createContext<{ push: (message: string, tone?: Toast["tone"]) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto w-full max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-lg",
              t.tone === "success" ? "bg-emerald-600 text-white" : t.tone === "error" ? "bg-rose-600 text-white" : "bg-slate-800 text-white"
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ── Confirmação simples ────────────────────────────────────────────────────
export function ConfirmDialog({ open, title, description, confirmLabel = "Confirmar", danger, onConfirm, onClose, children }: {
  open: boolean; title: string; description?: string; confirmLabel?: string; danger?: boolean;
  onConfirm: () => void | Promise<void>; onClose: () => void; children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try { await onConfirm(); } finally { setBusy(false); }
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {description && <p className="text-sm text-slate-600">{description}</p>}
      {children}
    </Modal>
  );
}

// ── Hook: carregar dados ───────────────────────────────────────────────────
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    loader()
      .then((d) => { if (mounted.current) setData(d); })
      .catch((e) => { if (mounted.current) setError(e instanceof Error ? e.message : "Erro ao carregar"); })
      .finally(() => { if (mounted.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    mounted.current = true;
    reload();
    return () => { mounted.current = false; };
  }, [reload]);
  return { data, error, loading, reload, setData };
}
