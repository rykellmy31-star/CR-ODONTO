import { describe, expect, it } from "vitest";
import { tokenIsUsable } from "../api/lib/tokens";

const base = {
  id: 1, clinic_id: 1, appointment_id: 10, patient_id: 5, purpose: "confirmar" as const,
  token_hash: "abc", expires_at: "", used_at: null, used_action: "", created_at: "",
};

describe("tokens de ação (links seguros)", () => {
  it("token novo e dentro da validade é utilizável", () => {
    expect(tokenIsUsable({ ...base, expires_at: new Date(Date.now() + 3600_000).toISOString() })).toBe(true);
  });

  it("token expirado não é utilizável", () => {
    expect(tokenIsUsable({ ...base, expires_at: new Date(Date.now() - 1000).toISOString() })).toBe(false);
  });

  it("token já usado não é utilizável", () => {
    expect(
      tokenIsUsable({
        ...base,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        used_at: new Date().toISOString(),
      })
    ).toBe(false);
  });
});
