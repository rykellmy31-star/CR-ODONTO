import { describe, expect, it } from "vitest";
import { DECIDUOUS_TEETH, FACES, PERMANENT_TEETH, CONDITION_LABEL, CONDITIONS, isValidTooth } from "../api/lib/clinical";

describe("odontograma", () => {
  it("tem 32 dentes permanentes e 20 decíduos", () => {
    expect(PERMANENT_TEETH.flat()).toHaveLength(32);
    expect(DECIDUOUS_TEETH.flat()).toHaveLength(20);
  });

  it("valida numeração FDI por dentição", () => {
    expect(isValidTooth("permanente", "11")).toBe(true);
    expect(isValidTooth("permanente", "48")).toBe(true);
    expect(isValidTooth("decidua", "55")).toBe(true);
    expect(isValidTooth("decidua", "85")).toBe(true);
    expect(isValidTooth("permanente", "55")).toBe(false);
    expect(isValidTooth("decidua", "48")).toBe(false);
    expect(isValidTooth("permanente", "99")).toBe(false);
    expect(isValidTooth("permanente", "abc")).toBe(false);
  });

  it("oferece as faces clínicas necessárias", () => {
    for (const face of ["geral", "oclusal", "vestibular", "lingual", "mesial", "distal"]) {
      expect(FACES).toContain(face);
    }
  });

  it("descreve condições de cárie, restauração, ausência e planejamento", () => {
    for (const condition of ["carie", "restauracao", "ausente", "extracao"] as const) {
      expect(CONDITIONS).toContain(condition);
      expect(CONDITION_LABEL[condition]).toBeTruthy();
    }
  });
});
