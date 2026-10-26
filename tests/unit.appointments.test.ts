import { describe, expect, it } from "vitest";
import { TRANSITIONS, TERMINAL, canTransition, type ApptStatus } from "../api/lib/appointments";

const ALL: ApptStatus[] = [
  "agendado", "aguardando_confirmacao", "confirmado", "chegou", "em_atendimento",
  "concluido", "cancelado", "reagendado", "nao_compareceu",
];

describe("máquina de estados do agendamento", () => {
  it("cobre todos os 9 estados exigidos", () => {
    for (const status of ALL) expect(TRANSITIONS[status]).toBeDefined();
  });

  it("caminho feliz do atendimento", () => {
    expect(canTransition("agendado", "aguardando_confirmacao")).toBe(true);
    expect(canTransition("aguardando_confirmacao", "confirmado")).toBe(true);
    expect(canTransition("confirmado", "chegou")).toBe(true);
    expect(canTransition("chegou", "em_atendimento")).toBe(true);
    expect(canTransition("em_atendimento", "concluido")).toBe(true);
  });

  it("permite pular a confirmação (recepção confirma no balcão)", () => {
    expect(canTransition("agendado", "chegou")).toBe(true);
    expect(canTransition("agendado", "confirmado")).toBe(true);
  });

  it("bloqueia saídas de estados terminais", () => {
    for (const terminal of TERMINAL) {
      for (const target of ALL) expect(canTransition(terminal, target)).toBe(false);
    }
  });

  it("permite iniciar o atendimento direto (paciente que já está na clínica)", () => {
    expect(canTransition("agendado", "em_atendimento")).toBe(true);
    expect(canTransition("confirmado", "em_atendimento")).toBe(true);
  });

  it("só conclui depois de registrar a chegada ou iniciar o atendimento", () => {
    expect(canTransition("agendado", "concluido")).toBe(false);
    expect(canTransition("confirmado", "concluido")).toBe(false);
    expect(canTransition("chegou", "concluido")).toBe(true);
    expect(canTransition("em_atendimento", "concluido")).toBe(true);
  });

  it("não retorna de \"em atendimento\" para estados anteriores", () => {
    expect(canTransition("em_atendimento", "agendado")).toBe(false);
    expect(canTransition("em_atendimento", "chegou")).toBe(false);
  });

  it("permite reagendar/cancelar/faltar a partir dos estados ativos", () => {
    for (const from of ["agendado", "aguardando_confirmacao", "confirmado"] as ApptStatus[]) {
      expect(canTransition(from, "reagendado")).toBe(true);
      expect(canTransition(from, "cancelado")).toBe(true);
      expect(canTransition(from, "nao_compareceu")).toBe(true);
    }
  });
});
