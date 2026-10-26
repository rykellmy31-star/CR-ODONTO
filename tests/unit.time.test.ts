import { describe, expect, it } from "vitest";
import { addDays, formatHHMM, localToUtc, parseHHMM, todayLocal, utcToLocal } from "../api/lib/time";

describe("tempo e fuso horário da clínica", () => {
  it("converte UTC → horário local da clínica", () => {
    // 13:00 UTC = 10:00 em São Paulo (UTC-3)
    const local = utcToLocal("America/Sao_Paulo", "2026-03-10T13:00:00Z");
    expect(local.day).toBe("2026-03-10");
    expect(local.minutes).toBe(10 * 60);
  });

  it("vira o dia corretamente ao anoitecer em UTC", () => {
    // 02:00 UTC do dia 11 = 23:00 do dia 10 em São Paulo
    const local = utcToLocal("America/Sao_Paulo", "2026-03-11T02:00:00Z");
    expect(local.day).toBe("2026-03-10");
    expect(local.minutes).toBe(23 * 60);
  });

  it("converte horário local → UTC (ida e volta)", () => {
    const utc = localToUtc("America/Sao_Paulo", "2026-03-10", 10 * 60);
    expect(utc.toISOString()).toBe("2026-03-10T13:00:00.000Z");
    const back = utcToLocal("America/Sao_Paulo", utc.toISOString());
    expect(back.day).toBe("2026-03-10");
    expect(back.minutes).toBe(600);
  });

  it("respeita o fuso de Manaus (UTC-4)", () => {
    const local = utcToLocal("America/Manaus", "2026-03-10T13:00:00Z");
    expect(local.minutes).toBe(9 * 60);
  });

  it("formata e interpreta HH:MM", () => {
    expect(formatHHMM(0)).toBe("00:00");
    expect(formatHHMM(8 * 60 + 5)).toBe("08:05");
    expect(formatHHMM(23 * 60 + 59)).toBe("23:59");
    expect(parseHHMM("08:05")).toBe(485);
    expect(parseHHMM("23:59")).toBe(1439);
    // valores fora da faixa são limitados a 23:59 (nunca gera agendamento inválido)
    expect(parseHHMM("24:00")).toBe(1439);
  });

  it("soma dias em ISO sem depender de fuso do servidor", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("todayLocal devolve AAAA-MM-DD", () => {
    expect(todayLocal("America/Sao_Paulo")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
