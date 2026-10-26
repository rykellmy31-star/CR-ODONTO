import { describe, expect, it } from "vitest";
import { actionLinks, buildVars, reminderButtons, renderTemplate } from "../api/lib/messaging/templates";
import { normalizePhone, formatPhoneBr, slugify, brl } from "../api/lib/utils";
import { toWaNumber, withinSendWindow } from "../api/lib/messaging/provider";

const vars = buildVars({
  patientName: "Maria Souza Andrade",
  timezone: "America/Sao_Paulo",
  startsAt: "2026-03-10T13:00:00Z",
  professionalName: "Dra. Ana Paula",
  unitName: "Unidade Paulista",
  clinicName: "Clínica Sorriso",
  procedureName: "Avaliação",
  link: "https://app.exemplo/c/clinica/confirmar/abc",
});

describe("mensagens de WhatsApp", () => {
  it("renderiza variáveis do modelo", () => {
    const body = renderTemplate("Olá, {{paciente}}! Consulta em {{data}} às {{hora}} com {{profissional}} ({{unidade}}).", vars);
    expect(body).toContain("Maria Souza Andrade");
    expect(body).toContain("10/03");
    expect(body).toContain("10:00");
    expect(body).toContain("Dra. Ana Paula");
    expect(body).toContain("Unidade Paulista");
  });

  it("nunca inclui dados clínicos nas variáveis", () => {
    const serialized = JSON.stringify(vars).toLowerCase();
    for (const forbidden of ["diagnostico", "diagnóstico", "carie", "cárie", "prontuario", "prontuário", "anamnese", "alergia"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("gera no máximo 3 botões com títulos de até 20 caracteres", () => {
    const buttons = reminderButtons("https://app.exemplo", "tok1", "tok2");
    expect(buttons.length).toBeLessThanOrEqual(3);
    for (const b of buttons) expect(b.reply.title.length).toBeLessThanOrEqual(20);
  });

  it("links de ação apontam para a clínica certa", () => {
    const links = actionLinks("https://app.exemplo/", "clinica-x", "tok-confirma", "tok-reagenda");
    expect(links.confirm).toBe("https://app.exemplo/c/clinica-x/confirmar/tok-confirma");
    expect(links.reschedule).toBe("https://app.exemplo/c/clinica-x/reagendar/tok-reagenda");
  });

  it("normaliza telefone e adiciona o DDI exigido pela Meta", () => {
    expect(normalizePhone("(11) 98888-4321")).toBe("11988884321");
    expect(toWaNumber("(11) 98888-4321")).toBe("5511988884321");
    expect(toWaNumber("+55 11 98888-4321")).toBe("5511988884321");
    expect(formatPhoneBr("11988884321")).toBe("(11) 98888-4321");
    expect(formatPhoneBr("5511988884321")).toBe("(11) 98888-4321");
    expect(toWaNumber("123")).toBeNull();
  });

  it("respeita a janela de envio configurada", () => {
    expect(withinSendWindow("08:00", "20:00", 9 * 60)).toBe(true);
    expect(withinSendWindow("08:00", "20:00", 7 * 60)).toBe(false);
    expect(withinSendWindow("08:00", "20:00", 21 * 60)).toBe(false);
  });

  it("formata dinheiro em reais e gera slugs", () => {
    expect(brl(15000)).toContain("150,00");
    expect(slugify("Clínica Sorriso Demo")).toBe("clinica-sorriso-demo");
  });
});
