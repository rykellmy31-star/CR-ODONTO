import { describe, expect, it } from "vitest";
import { ACTIVE_STATUSES, INACTIVE_STATUSES, ACTIVE_SQL, clinicToday, slotToInstants, subtract } from "../api/lib/scheduling";

describe("regras de disponibilidade", () => {
  it("separa estados que ocupam a agenda dos que liberam o horário", () => {
    expect(ACTIVE_STATUSES).toContain("confirmado");
    expect(ACTIVE_STATUSES).toContain("em_atendimento");
    expect(INACTIVE_STATUSES).toEqual(["cancelado", "reagendado", "nao_compareceu"]);
    expect(ACTIVE_SQL).toContain("'confirmado'");
    expect(ACTIVE_SQL).not.toContain("cancelado");
  });

  it("remove o almoço do expediente", () => {
    const windows = [{ start: 8 * 60, end: 18 * 60 }];
    const remaining = subtract(windows, { start: 12 * 60, end: 13 * 60 });
    expect(remaining).toEqual([
      { start: 8 * 60, end: 12 * 60 },
      { start: 13 * 60, end: 18 * 60 },
    ]);
  });

  it("remove bloqueio no início do dia", () => {
    const remaining = subtract([{ start: 480, end: 1080 }], { start: 480, end: 600 });
    expect(remaining).toEqual([{ start: 600, end: 1080 }]);
  });

  it("bloqueio fora do expediente não altera a janela", () => {
    const remaining = subtract([{ start: 480, end: 1080 }], { start: 1200, end: 1300 });
    expect(remaining).toEqual([{ start: 480, end: 1080 }]);
  });

  it("calcula início e fim do agendamento respeitando a duração", () => {
    const instants = slotToInstants("America/Sao_Paulo", "2026-03-10", "10:00", 45);
    expect(instants).not.toBeNull();
    expect(new Date(instants!.startsAt).toISOString()).toBe("2026-03-10T13:00:00.000Z");
    expect(new Date(instants!.endsAt).toISOString()).toBe("2026-03-10T13:45:00.000Z");
  });

  it("rejeita horário inválido", () => {
    expect(slotToInstants("America/Sao_Paulo", "2026-03-10", "25:00", 30)).toBeNull();
  });

  it("clinicToday devolve o dia local da clínica", () => {
    expect(clinicToday("America/Sao_Paulo")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
