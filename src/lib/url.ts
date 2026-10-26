/**
 * Roteamento HTTP compartilhado pela aplicação React e pelos testes Workers.
 * Não depende do navegador (DOM), para que a mesma regra seja testável no CI.
 *
 * Regras (na ordem):
 *  - URL absoluta ou já prefixada com /api → usa como está
 *  - /super, /auth, /setup → /api/...
 *  - caminho explícito /c/<slug>/...      → /api/c/<slug>/...
 *  - página dentro de /c/<slug>/admin|pro → /api/c/<slug>/<área>/...
 *  - página pública /c/<slug>/...         → /api/c/<slug>/...
 */
export function resolveApiUrl(path: string, pathname: string): string {
  if (/^https?:\/\//i.test(path) || path.startsWith("/api/")) return path;
  if (!path.startsWith("/")) throw new Error("Os caminhos da API precisam começar com /");

  if (/^\/(?:super|auth|setup)(?:\/|$)/.test(path)) return `/api${path}`;

  // Caminho já completo com a clínica (usado por uploads e páginas públicas).
  if (/^\/c\/[a-z0-9-]+(?:\/|$)/.test(path)) return `/api${path}`;

  const page = pathname.match(/^\/c\/([a-z0-9-]+)(?:\/(admin|pro)(?:\/|$))?/);
  if (page) {
    const [, slug, area] = page;
    return area ? `/api/c/${slug}/${area}${path}` : `/api/c/${slug}${path}`;
  }

  if (pathname.startsWith("/superadmin")) return `/api/super${path}`;
  return `/api${path}`;
}
