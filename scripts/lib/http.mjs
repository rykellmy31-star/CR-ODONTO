// Cliente HTTP mínimo com cookie jar, usado no smoke test e no seed via API.
const FAKE_IP = process.env.SMOKE_IP || `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

export function createClient(baseUrl) {
  const cookies = new Map();

  function cookieHeader() {
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  function storeCookies(res) {
    const list = res.headers.getSetCookie?.() ?? [];
    for (const raw of list) {
      const [pair] = raw.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  async function request(method, path, body, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (cookies.size) headers.cookie = cookieHeader();
    // Em desenvolvimento o Worker respeita este header; em produção o Cloudflare sobrescreve.
    headers["cf-connecting-ip"] = FAKE_IP;
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    storeCookies(res);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, ok: res.ok, data, headers: res.headers };
  }

  return {
    get: (p) => request("GET", p),
    post: (p, b) => request("POST", p, b ?? {}),
    put: (p, b) => request("PUT", p, b ?? {}),
    del: (p) => request("DELETE", p),
    cookies,
  };
}
