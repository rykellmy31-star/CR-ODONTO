import { describe, expect, it } from "vitest";
import { resolveApiUrl } from "../src/lib/url";

describe("resolveApiUrl — roteamento da API a partir da URL da página", () => {
  it("prefixa /api em rotas de plataforma", () => {
    expect(resolveApiUrl("/auth/login", "/login")).toBe("/api/auth/login");
    expect(resolveApiUrl("/setup/status", "/setup")).toBe("/api/setup/status");
    expect(resolveApiUrl("/super/clinics", "/superadmin/clinicas")).toBe("/api/super/clinics");
  });

  it("usa o slug da clínica para páginas do painel administrativo", () => {
    expect(resolveApiUrl("/appointments?day=2026-01-01", "/c/clinica-x/admin/agenda"))
      .toBe("/api/c/clinica-x/admin/appointments?day=2026-01-01");
    expect(resolveApiUrl("/patients", "/c/clinica-x/admin/pacientes/12"))
      .toBe("/api/c/clinica-x/admin/patients");
  });

  it("usa o slug no painel do dentista", () => {
    expect(resolveApiUrl("/agenda", "/c/clinica-x/pro")).toBe("/api/c/clinica-x/pro/agenda");
  });

  it("usa o slug em páginas públicas e no portal", () => {
    expect(resolveApiUrl("/info", "/c/clinica-x")).toBe("/api/c/clinica-x/info");
    expect(resolveApiUrl("/portal/me", "/c/clinica-x/portal")).toBe("/api/c/clinica-x/portal/me");
  });

  it("aceita caminho já prefixado com a clínica (uploads e links de ação)", () => {
    expect(resolveApiUrl("/c/clinica-x/uploads/logo", "/c/clinica-x/admin/configuracoes"))
      .toBe("/api/c/clinica-x/uploads/logo");
    expect(resolveApiUrl("/c/clinica-x/action/abc", "/c/clinica-x/confirmar/abc"))
      .toBe("/api/c/clinica-x/action/abc");
  });

  it("não altera URLs absolutas nem caminhos /api", () => {
    expect(resolveApiUrl("https://api.exemplo.com/x", "/")).toBe("https://api.exemplo.com/x");
    expect(resolveApiUrl("/api/health", "/")).toBe("/api/health");
  });

  it("rejeita caminho relativo sem barra inicial", () => {
    expect(() => resolveApiUrl("auth/login", "/login")).toThrow();
  });
});
