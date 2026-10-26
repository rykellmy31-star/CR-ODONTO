import { resolveApiUrl } from "./url";

export interface ApiError extends Error {
  status: number;
  details?: unknown;
}

function currentClinicSlug(): string | null {
  const m = location.pathname.match(/^\/c\/([a-z0-9-]+)/);
  return m ? m[1] : null;
}

export function clinicBase(): string {
  const slug = currentClinicSlug();
  return slug ? `/c/${slug}` : "";
}

async function request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const url = resolveApiUrl(path, location.pathname);
  const res = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message = (body as { error?: string } | null)?.error ?? `Erro ${res.status}`;
    const error: ApiError = Object.assign(new Error(message), {
      status: res.status,
      details: (body as { details?: unknown } | null)?.details,
    });
    throw error;
  }
  return body as T;
}

export const api = {
  get: <T = unknown>(path: string, signal?: AbortSignal) => request<T>(path, { method: "GET", signal }),
  post: <T = unknown>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data) }),
  put: <T = unknown>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: data === undefined ? undefined : JSON.stringify(data) }),
  del: <T = unknown>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: async <T = unknown>(path: string, file: File): Promise<T> => {
    const url = resolveApiUrl(path, location.pathname);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(url, { method: "POST", credentials: "same-origin", body: fd });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error((body as { error?: string })?.error ?? "Falha no envio"), { status: res.status });
    return body as T;
  },
};

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "Não foi possível concluir a ação.";
}
