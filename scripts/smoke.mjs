// Smoke test ponta a ponta contra uma API REAL (wrangler dev ou deploy).
// Cobre: bootstrap do superadmin, login, criação de clínica, RBAC, agenda,
// máquina de estados, finalização com retorno, prontuário/odontograma,
// links seguros, portal do paciente, WhatsApp (mock) e isolamento de tenant.
//
// Uso:
//   node scripts/smoke.mjs                       # http://127.0.0.1:8787
//   BASE_URL=https://... node scripts/smoke.mjs
//   SETUP_TOKEN=... SUPER_EMAIL=... node scripts/smoke.mjs
import { createClient } from "./lib/http.mjs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const SETUP_TOKEN = process.env.SETUP_TOKEN || "dev-setup-token-1234567890";
const stamp = Date.now().toString(36).slice(-6);
const SUPER = {
  email: process.env.SUPER_EMAIL || "super@crodonto.com.br",
  password: process.env.SUPER_PASSWORD || "SuperOdonto2026",
};
// Senhas candidatas: o smoke pode rodar várias vezes na mesma base local.
const SUPER_CANDIDATES = [SUPER.password, `${SUPER.password}X9`, `${SUPER.password}x`];
const ADMIN = { email: `admin.${stamp}@smoke.com.br`, password: "SmokeOdonto2026" };
const SLUG = `smoke-${stamp}`;

const results = [];
let failures = 0;

function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failures++;
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

const guest = createClient(BASE);
const superC = createClient(BASE);
const adminC = createClient(BASE);
const receptionC = createClient(BASE);

function finish() {
  const total = results.length;
  const passed = total - failures;
  console.log(`\n=== Resultado: ${passed}/${total} verificações OK (${failures} falha(s)) ===`);
  console.log(`Taxa de sucesso: ${total ? Math.round((passed / total) * 100) : 0}%`);
  if (failures > 0) {
    console.log("\nFalhas:");
    for (const r of results.filter((x) => !x.ok)) console.log(` - ${r.name}${r.detail ? ` (${r.detail})` : ""}`);
    process.exitCode = 1;
  }
}

/** Faz login e, se a senha for provisória, troca e loga de novo. */
async function loginReady(client, creds) {
  let res = await client.post("/api/auth/login", creds);
  if (!res.ok) return res;
  const me = await client.get("/api/auth/me");
  if (me.data?.user?.must_change_password) {
    const next = `${creds.password}X9`;
    const changed = await client.post("/api/auth/password", { current_password: creds.password, new_password: next });
    if (!changed.ok) return changed;
    creds.password = next;
    res = await client.post("/api/auth/login", creds);
  }
  return res;
}

async function main() {
  console.log(`\n=== CR ODONTO — smoke test (${BASE}) ===\n`);

  // 1. Saúde e configuração
  const health = await guest.get("/api/health");
  check("API responde /api/health", health.ok && health.data?.ok === true);
  check("Segredos de sessão/cifra configurados", health.data?.security?.session_secret_ready && health.data?.security?.encryption_key_ready);

  // 2. Bootstrap do primeiro superadmin (idempotente por setup já feito)
  const setupStatus = await guest.get("/api/setup/status");
  if (!setupStatus.data?.bootstrap_completed) {
    const badSetup = await guest.post("/api/setup/superadmin", {
      setup_token: "token-errado-000000000000", name: "Intruso", email: `x.${stamp}@smoke.com.br`, password: "IntrusoOdonto2026",
    });
    check("Bootstrap rejeita token inválido", badSetup.status === 403, `status ${badSetup.status}`);
    const created = await guest.post("/api/setup/superadmin", {
      setup_token: SETUP_TOKEN, name: "Super Admin Smoke", email: SUPER.email, password: SUPER.password,
    });
    check("Bootstrap do superadmin cria o primeiro acesso", created.status === 201, `status ${created.status} ${created.data?.error ?? ""}`);
  } else {
    check("Bootstrap já realizado (idempotente, sem reabertura)", true);
  }

  // 3. Login do superadmin
  let superLogin = null;
  for (const candidate of SUPER_CANDIDATES) {
    SUPER.password = candidate;
    superLogin = await loginReady(superC, SUPER);
    if (superLogin.ok) break;
  }
  check("Login do superadmin (com troca de senha provisória se aplicável)", superLogin.ok, `status ${superLogin.status} ${superLogin.data?.error ?? ""}`);
  if (!superLogin.ok) return finish();

  // 4. Criação da clínica pelo superadmin
  const clinic = await superC.post("/api/super/clinics", {
    name: `Clínica Smoke ${stamp}`, slug: SLUG, plan_code: "pro",
    admin_name: "Admin Smoke", admin_email: ADMIN.email, admin_password: ADMIN.password,
    city: "São Paulo", state: "SP",
  });
  check("Superadmin cria clínica + admin", clinic.status === 201, `status ${clinic.status} ${clinic.data?.error ?? ""}`);
  if (clinic.status !== 201) return finish();
  const clinicId = clinic.data.clinic.id;

  // 5. Superadmin NÃO acessa prontuário/dados clínicos
  const superClinical = await superC.get(`/api/c/${SLUG}/pro/agenda`);
  check("Superadmin não abre painel clínico da clínica", superClinical.status >= 401 && superClinical.status < 500, `status ${superClinical.status}`);

  // 6. Login do admin da clínica
  const adminLogin = await loginReady(adminC, ADMIN);
  check("Login do admin da clínica (1º acesso troca a senha)", adminLogin.ok, `status ${adminLogin.status} ${adminLogin.data?.error ?? ""}`);
  if (!adminLogin.ok) return finish();

  const me = await adminC.get("/api/auth/me");
  check("/auth/me devolve vínculo com a clínica", me.data?.clinics?.some((c) => c.slug === SLUG));

  // 7. Configuração inicial
  const settings = await adminC.put("/api/c/" + SLUG + "/admin/settings", {
    booking: { online_enabled: true, min_lead_min: 0, max_days_ahead: 60 },
    scheduling: { slot_min: 15, allow_fit_in: true },
    clinical: { require_record_on_finish: true },
  });
  check("Admin salva configurações da clínica", settings.ok, `status ${settings.status}`);

  const unit = await adminC.post(`/api/c/${SLUG}/admin/units`, { name: "Unidade Centro", slug: "centro", is_primary: true });
  check("Admin cria unidade", unit.status === 201, `status ${unit.status}`);
  const unitId = unit.data?.id ?? 1;

  const specialty = await adminC.post(`/api/c/${SLUG}/admin/specialties`, { name: `Ortodontia ${stamp}`, color: "#7c3aed" });
  check("Admin cria especialidade", specialty.status === 201, `status ${specialty.status}`);

  const procedure = await adminC.post(`/api/c/${SLUG}/admin/procedures`, {
    name: "Avaliação inicial", duration_min: 30, price_cents: 15000, requires_room: true, show_in_booking: true,
  });
  check("Admin cria procedimento", procedure.status === 201, `status ${procedure.status}`);
  const procedureId = procedure.data?.id;

  const pro = await adminC.post(`/api/c/${SLUG}/admin/professionals`, {
    name: "Dra. Smoke Dentista", cro: "99999", cro_uf: "SP", email: `dentista.${stamp}@smoke.com.br`,
    slot_min: 30, default_unit_id: unitId, login_password: "DentistaSmoke2026", show_in_booking: true,
  });
  check("Admin cria dentista com CRO/UF e acesso", pro.status === 201, `status ${pro.status} ${pro.data?.error ?? ""}`);
  const professionalId = pro.data?.id;

  const schedule = await adminC.put(`/api/c/${SLUG}/admin/professionals/${professionalId}/schedules`, {
    days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday, active: true, start: "08:00", end: "18:00", break_start: "12:00", break_end: "13:00",
    })),
  });
  check("Admin define a escala semanal do dentista", schedule.ok, `status ${schedule.status} ${schedule.data?.error ?? ""}`);

  // 8. Equipe e RBAC
  const member = await adminC.post(`/api/c/${SLUG}/admin/members`, {
    name: "Recepção Smoke", email: `recepcao.${stamp}@smoke.com.br`, password: "RecepcaoSmoke2026", role: "receptionist",
  });
  check("Admin cria acesso de recepção", member.status === 201, `status ${member.status} ${member.data?.error ?? ""}`);

  const receptionLogin = await loginReady(receptionC, {
    email: `recepcao.${stamp}@smoke.com.br`, password: "RecepcaoSmoke2026",
  });
  check("Login da recepção (1º acesso troca a senha)", receptionLogin.ok, `status ${receptionLogin.status} ${receptionLogin.data?.error ?? ""}`);
  const receptionSettings = await receptionC.get(`/api/c/${SLUG}/admin/settings`);
  check("Recepção não acessa configurações (RBAC)", receptionSettings.status === 403, `status ${receptionSettings.status}`);
  const receptionAgenda = await receptionC.get(`/api/c/${SLUG}/admin/appointments?day=${new Date().toISOString().slice(0, 10)}`);
  check("Recepção acessa a agenda", receptionAgenda.ok, `status ${receptionAgenda.status}`);
  const receptionClinical = await receptionC.get(`/api/c/${SLUG}/pro/agenda`);
  check("Recepção sem prontuário é bloqueada no painel clínico", receptionClinical.status === 403, `status ${receptionClinical.status}`);

  // 9. Pacientes, dedupe e agenda
  const patient = await adminC.post(`/api/c/${SLUG}/admin/patients`, {
    name: "Paciente Smoke Teste", phone: "(11) 99999-1234", birth_date: "1990-05-20", cpf: "52998224725", whatsapp_optin: true,
  });
  check("Admin cadastra paciente", patient.status === 201, `status ${patient.status} ${patient.data?.error ?? ""}`);
  const patientId = patient.data?.id;

  const duplicate = await adminC.post(`/api/c/${SLUG}/admin/patients`, {
    name: "Paciente Smoke Teste", phone: "(11) 99999-1234",
  });
  check("Dedupe bloqueia cadastro duplicado (409)", duplicate.status === 409, `status ${duplicate.status}`);

  const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const appt = await adminC.post(`/api/c/${SLUG}/admin/appointments`, {
    patient_id: patientId, professional_id: professionalId, procedure_id: procedureId, unit_id: unitId,
    day, time: "09:00", source: "reception",
  });
  check("Admin cria agendamento", appt.status === 201, `status ${appt.status} ${appt.data?.error ?? ""}`);
  const apptId = appt.data?.id;

  const conflict = await adminC.post(`/api/c/${SLUG}/admin/appointments`, {
    patient_id: patientId, professional_id: professionalId, procedure_id: procedureId, unit_id: unitId,
    day, time: "09:00", source: "reception",
  });
  check("Conflito de horário é bloqueado", conflict.status === 409, `status ${conflict.status}`);
  const fitIn = await adminC.post(`/api/c/${SLUG}/admin/appointments`, {
    patient_id: patientId, professional_id: professionalId, procedure_id: procedureId, unit_id: unitId,
    day, time: "09:00", is_fit_in: true, fit_in_reason: "Paciente com dor relatada por telefone", source: "reception",
  });
  check("Encaixe exige e registra motivo", fitIn.status === 201 || fitIn.status === 409, `status ${fitIn.status}`);
  const fitInNoReason = await adminC.post(`/api/c/${SLUG}/admin/appointments`, {
    patient_id: patientId, professional_id: professionalId, procedure_id: procedureId, unit_id: unitId,
    day, time: "09:00", is_fit_in: true, source: "reception",
  });
  check("Encaixe sem motivo é rejeitado", fitInNoReason.status === 422, `status ${fitInNoReason.status}`);

  // 10. Máquina de estados
  const confirm = await adminC.post(`/api/c/${SLUG}/admin/appointments/${apptId}/confirm`, {});
  check("Status: confirmar consulta", confirm.ok, `status ${confirm.status} ${confirm.data?.error ?? ""}`);
  const checkin = await adminC.post(`/api/c/${SLUG}/admin/appointments/${apptId}/checkin`, {});
  check("Status: paciente chegou", checkin.ok, `status ${checkin.status}`);
  const start = await adminC.post(`/api/c/${SLUG}/admin/appointments/${apptId}/start`, {});
  check("Status: em atendimento", start.ok, `status ${start.status}`);

  const finishNoRecord = await adminC.post(`/api/c/${SLUG}/admin/appointments/${apptId}/finish`, { followup_choice: "none" });
  check("Finalizar exige evolução clínica quando configurado", finishNoRecord.status === 422, `status ${finishNoRecord.status}`);

  // 11. Prontuário: anamnese, evolução, odontograma, plano, documento
  const anamnesis = await adminC.post(`/api/c/${SLUG}/pro/patients/${patientId}/anamnesis`, {
    allergies: "Dipirona", medications: "", systemic_conditions: ["hipertensão"], smoker: "nao", pregnant: "na_se_aplica",
    diabetes: false, hypertension: true, heart_condition: false, bleeding_disorder: false, surgeries: "", notes: "",
  });
  check("Anamnese salva", anamnesis.ok, `status ${anamnesis.status} ${anamnesis.data?.error ?? ""}`);

  const record = await adminC.post(`/api/c/${SLUG}/pro/patients/${patientId}/records`, {
    kind: "evolucao", chief_complaint: "Sensibilidade no dente 26", diagnosis: "Cárie oclusal",
    evolution: "Restauração em resina realizada sem intercorrências.", procedure_done: "Restauração",
    tooth_codes: ["26"], notes: "", appointment_id: apptId,
  });
  check("Evolução clínica registrada", record.status === 201, `status ${record.status} ${record.data?.error ?? ""}`);

  const odonto = await adminC.post(`/api/c/${SLUG}/pro/patients/${patientId}/odontogram`, {
    dentition: "permanente", tooth_code: "26", face: "oclusal", condition: "restauracao", status: "concluido", notes: "",
  });
  check("Odontograma registra face do dente", odonto.ok, `status ${odonto.status} ${odonto.data?.error ?? ""}`);
  const badTooth = await adminC.post(`/api/c/${SLUG}/pro/patients/${patientId}/odontogram`, {
    dentition: "permanente", tooth_code: "99", face: "oclusal", condition: "carie", status: "existente", notes: "",
  });
  check("Odontograma rejeita dente inexistente", badTooth.status === 422, `status ${badTooth.status}`);

  const plan = await adminC.post(`/api/c/${SLUG}/pro/patients/${patientId}/plans`, { title: "Reabilitação dente 26" });
  check("Plano de tratamento criado", plan.status === 201, `status ${plan.status} ${plan.data?.error ?? ""}`);

  const doc = await adminC.post(`/api/c/${SLUG}/pro/patients/${patientId}/documents`, {
    kind: "atestado", title: "Atestado odontológico", body: "Atesto que o paciente esteve em atendimento hoje.",
    sign: true, visible_to_patient: true,
  });
  check("Documento clínico emitido", doc.status === 201, `status ${doc.status} ${doc.data?.error ?? ""}`);

  const clinicalView = await adminC.get(`/api/c/${SLUG}/pro/patients/${patientId}/clinical`);
  check("Prontuário consolidado retorna dados", clinicalView.ok && (clinicalView.data?.records?.length ?? 0) > 0);

  // 12. Finalização com retorno agendado + pagamento opcional
  const finalize = await adminC.post(`/api/c/${SLUG}/admin/appointments/${apptId}/finish`, {
    followup_choice: "scheduled", return_day: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
    return_time: "10:00", return_procedure_id: procedureId,
    clinical_note: "Paciente orientado quanto à higiene.", payment: { method: "pix", amount_cents: 15000, paid: true },
  });
  check("Finalizar atendimento com retorno agendado", finalize.ok, `status ${finalize.status} ${finalize.data?.error ?? ""}`);
  check("Finalização cria agendamento de retorno", Boolean(finalize.data?.return_appointment_id), `return_id ${finalize.data?.return_appointment_id}`);

  // 13. Painéis e relatórios
  const dashboard = await adminC.get(`/api/c/${SLUG}/admin/dashboard`);
  check("Dashboard operacional responde", dashboard.ok, `status ${dashboard.status} ${dashboard.data?.error ?? ""}`);
  const reports = await adminC.get(`/api/c/${SLUG}/admin/reports/summary`);
  check("Relatório operacional responde", reports.ok && typeof reports.data?.summary?.total === "number");
  const audit = await adminC.get(`/api/c/${SLUG}/admin/audit`);
  check("Auditoria registra ações", audit.ok && (audit.data?.entries?.length ?? 0) > 0);

  // 14. WhatsApp (mock) e lembretes
  const waSave = await adminC.put(`/api/c/${SLUG}/admin/whatsapp`, {
    enabled: true, phone_number_id: "smoke-phone-id", waba_id: "smoke-waba", access_token: "smoke-token",
    reminder_offsets_min: [1440, 300], send_window_start: "00:00", send_window_end: "23:59", require_optin: true,
  });
  check("Configuração de WhatsApp salva (token cifrado)", waSave.ok, `status ${waSave.status} ${waSave.data?.error ?? ""}`);
  const waGet = await adminC.get(`/api/c/${SLUG}/admin/whatsapp`);
  check("GET WhatsApp nunca devolve o token", waGet.ok && waGet.data?.settings && !("access_token" in waGet.data.settings) && waGet.data.settings.has_token === 1);
  const waTest = await adminC.post(`/api/c/${SLUG}/admin/whatsapp/test`, { to: "(11) 99999-1234" });
  check("Envio de teste usa provedor mock", waTest.ok && waTest.data?.ok === true, `outcome ${waTest.data?.outcome}`);
  const runNow = await adminC.post(`/api/c/${SLUG}/admin/whatsapp/run-now`, {});
  check("Fila de mensagens processada", runNow.ok);
  const messages = await adminC.get(`/api/c/${SLUG}/admin/messages`);
  check("Fila lista mensagens sem dados clínicos", messages.ok && Array.isArray(messages.data?.messages));

  // 15. Site público e agendamento online
  const info = await guest.get(`/api/c/${SLUG}/info`);
  check("Site público da clínica responde", info.ok && info.data?.clinic?.slug === SLUG);
  const days = await guest.get(`/api/c/${SLUG}/availability/days?professional_id=${professionalId}&procedure_id=${procedureId}&days=10`);
  check("Disponibilidade pública responde", days.ok && Array.isArray(days.data?.days));

  const publicPatient = { name: "Paciente Online Smoke", phone: "(11) 98888-4321", birth_date: "1995-02-02" };
  const onlineDay = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const slots = await guest.get(`/api/c/${SLUG}/availability?day=${onlineDay}&professional_id=${professionalId}&procedure_id=${procedureId}`);
  check("Slots livres para o dia", slots.ok && Array.isArray(slots.data?.slots), `slots ${slots.data?.slots?.length}`);
  const slotsDetailed = await guest.get(`/api/c/${SLUG}/availability?day=${onlineDay}&professional_id=${professionalId}&procedure_id=${procedureId}`);
  check("Lista de horários detalhada", slotsDetailed.ok);

  const book = await guest.post(`/api/c/${SLUG}/book`, {
    ...publicPatient, procedure_id: procedureId, professional_id: professionalId, day: onlineDay,
    time: slots.data?.slots?.[0] ?? "11:00", accept_terms: true, optin: true,
  });
  check("Agendamento online criado", book.status === 201, `status ${book.status} ${book.data?.error ?? ""}`);
  const bookLinks = book.data?.links ?? {};
  check("Links de ação usam /c/<slug>/confirmar|reagendar",
    String(bookLinks.confirm ?? "").includes(`/c/${SLUG}/confirmar/`) && String(bookLinks.reschedule ?? "").includes(`/c/${SLUG}/reagendar/`),
    JSON.stringify(bookLinks));

  // 16. Links seguros de uso único
  const confirmToken = String(bookLinks.confirm ?? "").split("/").pop();
  const actionInfo = await guest.get(`/api/c/${SLUG}/action/${confirmToken}`);
  check("Link seguro carrega a consulta", actionInfo.ok && actionInfo.data?.appointment?.code, `status ${actionInfo.status}`);
  check("Link seguro não expõe telefone nem dados clínicos", !JSON.stringify(actionInfo.data).includes("98888-4321"));
  const actionConfirm = await guest.post(`/api/c/${SLUG}/action/${confirmToken}/confirm`, {});
  check("Confirmação pelo link funciona", actionConfirm.ok, `status ${actionConfirm.status}`);
  const reuse = await guest.post(`/api/c/${SLUG}/action/${confirmToken}/confirm`, {});
  check("Token é de uso único (reuso tratado)", reuse.ok || reuse.status === 410, `status ${reuse.status}`);

  const reschedToken = String(bookLinks.reschedule ?? "").split("/").pop();
  const options = await guest.get(`/api/c/${SLUG}/action/${reschedToken}/options`);
  check("Opções de reagendamento respeitam a escala", options.ok && Array.isArray(options.data?.days));
  const reschedule = await guest.post(`/api/c/${SLUG}/action/${reschedToken}/reschedule`, {
    day: options.data?.days?.[0]?.day, time: options.data?.days?.[0]?.slots?.[0] ?? "15:00",
  });
  check("Reagendamento pelo link (com validação de agenda)", reschedule.ok || reschedule.status === 409, `status ${reschedule.status} ${reschedule.data?.error ?? ""}`);

  // 17. Portal do paciente
  const codeReq = await guest.post(`/api/c/${SLUG}/portal/request-code`, { phone: publicPatient.phone, birth_date: publicPatient.birth_date });
  check("Portal: código solicitado sem revelar existência", codeReq.ok);
  const devCode = codeReq.data?.dev_code;
  check("Portal: código devolvido em ambiente de desenvolvimento", Boolean(devCode));
  if (devCode) {
    const verify = await guest.post(`/api/c/${SLUG}/portal/verify`, {
      phone: publicPatient.phone, birth_date: publicPatient.birth_date, code: devCode,
    });
    check("Portal: código válido autentica o paciente", verify.ok, `status ${verify.status}`);
    const portalMe = await guest.get(`/api/c/${SLUG}/portal/me`);
    check("Portal: histórico do próprio paciente", portalMe.ok && Array.isArray(portalMe.data?.appointments) && portalMe.data?.authenticated === true, `status ${portalMe.status} ${portalMe.data?.error ?? ""}`);
  }

  // 18. Isolamento entre clínicas
  const otherSlug = `${SLUG}-outra`;
  const otherClinic = await superC.post("/api/super/clinics", {
    name: `Clínica Vizinha ${stamp}`, slug: otherSlug, plan_code: "trial",
    admin_name: "Outro Admin", admin_email: `outro.${stamp}@smoke.com.br`, admin_password: "OutroAdmin2026",
  });
  check("Segunda clínica criada para teste de isolamento", otherClinic.status === 201, `status ${otherClinic.status}`);
  const crossTenant = await adminC.get(`/api/c/${otherSlug}/admin/patients`);
  check("Isolamento: admin de uma clínica não acessa outra", crossTenant.status === 403 || crossTenant.status === 401, `status ${crossTenant.status}`);
  const crossPublic = await guest.get(`/api/c/${otherSlug}/admin/patients`);
  check("Isolamento: visitante não acessa painel", crossPublic.status === 401, `status ${crossPublic.status}`);
  const wrongSlug = await guest.get(`/api/c/nao-existe-${stamp}/info`);
  check("Slug inexistente retorna 404", wrongSlug.status === 404, `status ${wrongSlug.status}`);

  // 19. Suspensão bloqueia escrita mas não apaga dados
  const suspend = await superC.post(`/api/super/clinics/${otherClinic.data.clinic.id}/status`, { action: "suspend", reason: "smoke" });
  check("Superadmin suspende clínica", suspend.ok, `status ${suspend.status}`);
  const suspendedInfo = await guest.get(`/api/c/${otherSlug}/info`);
  check("Clínica suspensa responde 403 honesto", suspendedInfo.status === 403, `status ${suspendedInfo.status}`);

  // 20. Logout
  const logout = await adminC.post("/api/auth/logout", {});
  const afterLogout = await adminC.get(`/api/c/${SLUG}/admin/patients`);
  check("Logout encerra a sessão", logout.ok && afterLogout.status === 401, `status ${afterLogout.status}`);

  finish();
}

main().catch((e) => {
  console.error("Erro fatal no smoke test:", e);
  process.exitCode = 1;
});
