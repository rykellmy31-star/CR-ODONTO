// Popula o banco LOCAL com uma clínica de demonstração completa.
// NUNCA usar em produção: as senhas abaixo são públicas (apenas desenvolvimento).
//
// Uso: npm run db:reset:local && npm run db:seed:local
// Login admin:    admin@sorrisodemo.com.br   / DemoOdonto2026
// Login dentista: dra.ana@sorrisodemo.com.br / DemoOdonto2026
// Login recepção: recepcao@sorrisodemo.com.br / DemoOdonto2026
import { writeFile, mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword } from "./lib/password.mjs";

const SLUG = "sorriso-demo";
const PASSWORD = "DemoOdonto2026";

const iso = (d = new Date()) => new Date(d).toISOString().replace(/\.\d{3}Z$/, "Z");
const dayLocal = (offset) => iso(new Date(Date.now() + offset * 86_400_000)).slice(0, 10);
const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

const SPECIALTIES = [
  ["clinica-geral", "Clínica geral", "#0f766e"],
  ["ortodontia", "Ortodontia", "#7c3aed"],
  ["endodontia", "Endodontia", "#b45309"],
  ["periodontia", "Periodontia", "#0284c7"],
  ["implantodontia", "Implantodontia", "#be123c"],
  ["cirurgia", "Cirurgia odontológica", "#475569"],
  ["dentistica", "Dentística", "#16a34a"],
  ["odontopediatria", "Odontopediatria", "#db2777"],
];

const PROCEDURES = [
  ["avaliacao", "Avaliação / consulta inicial", "clinica-geral", 30, 15000, "Primeira consulta e plano de tratamento"],
  ["profilaxia", "Profilaxia (limpeza)", "clinica-geral", 45, 18000, "Limpeza e orientação de higiene"],
  ["restauracao-resina", "Restauração em resina", "dentistica", 60, 22000, "Restauração estética"],
  ["canal-unirradicular", "Tratamento de canal (unirradicular)", "endodontia", 90, 70000, "Endodontia em sessão única"],
  ["extracao-simples", "Extração simples", "cirurgia", 45, 25000, "Exodontia simples"],
  ["implante", "Instalação de implante", "implantodontia", 120, 250000, "Implante unitário"],
  ["manutencao-ortodontica", "Manutenção ortodôntica", "ortodontia", 30, 12000, "Ajuste mensal"],
  ["consulta-infantil", "Consulta odontopediátrica", "odontopediatria", 30, 15000, "Atendimento infantil"],
  ["retorno", "Retorno / revisão", "clinica-geral", 20, 0, "Revisão sem custo"],
];

const SETTINGS = {
  branding: {
    logo_url: "", primary_color: "#0f766e", accent_color: "#0ea5e9",
    tagline: "Odontologia com cuidado de verdade",
    about: "Clínica de demonstração da CR ODONTO: atendimento clínico, estético e preventivo.",
    instagram: "@sorrisodemo", website: "", address_public: "Av. Paulista, 1000 — São Paulo/SP",
    phone_public: "(11) 3555-1000", whatsapp_public: "(11) 98888-1000",
  },
  booking: { online_enabled: true, min_lead_min: 60, max_days_ahead: 60 },
  clinical: { require_record_on_finish: true, odontogram_default_dentition: "permanente" },
  scheduling: { slot_min: 15, allow_fit_in: true },
  modules: { payments_simple: true, commissions: false, inventory: false },
};

const [adminHash, dentistHash, receptionHash] = await Promise.all([
  hashPassword(PASSWORD), hashPassword(PASSWORD), hashPassword(PASSWORD),
]);

const CLINIC = `(SELECT id FROM clinics WHERE slug = '${SLUG}')`;
const stmts = [];
const push = (sql) => stmts.push(sql.trim().replace(/;\s*$/, "") + ";");

push(`INSERT INTO platform_settings (key, value, updated_at)
  VALUES ('platform_name', '"CR ODONTO"', ${q(iso())})
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
push(`INSERT INTO platform_settings (key, value, updated_at)
  VALUES ('support_email', '"suporte@crodonto.com.br"', ${q(iso())})
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`);

// Remove apenas a clínica de demonstração (cascata pelas FKs declaradas).
push(`DELETE FROM clinics WHERE slug = '${SLUG}'`);
push(`INSERT INTO clinics (slug, name, legal_name, cnpj, email, phone, whatsapp, timezone, status, plan_code, trial_ends_at, demo)
  VALUES (${q(SLUG)}, 'Clínica Sorriso Demo', 'Sorriso Demo Odontologia LTDA', '12345678000199',
          'contato@sorrisodemo.com.br', '(11) 3555-1000', '(11) 98888-1000', 'America/Sao_Paulo',
          'active', 'pro', ${q(dayLocal(30))}, 1)`);
push(`INSERT INTO clinic_settings (clinic_id, data, updated_at)
  VALUES (${CLINIC}, ${q(JSON.stringify(SETTINGS))}, ${q(iso())})
  ON CONFLICT(clinic_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`);

push(`INSERT INTO units (clinic_id, slug, name, address, city, state, zip, phone, whatsapp, is_primary)
  VALUES (${CLINIC}, 'matriz', 'Unidade Paulista', 'Av. Paulista, 1000', 'São Paulo', 'SP', '01310-100', '(11) 3555-1000', '(11) 98888-1000', 1)`);
push(`INSERT INTO units (clinic_id, slug, name, address, city, state, zip, phone, is_primary)
  VALUES (${CLINIC}, 'vila-mariana', 'Unidade Vila Mariana', 'R. Domingos de Morais, 500', 'São Paulo', 'SP', '04010-000', '(11) 3555-2000', 0)`);

for (const room of ["Consultório 1", "Consultório 2", "Sala de raio-X"]) {
  push(`INSERT INTO rooms (clinic_id, unit_id, name)
    VALUES (${CLINIC}, (SELECT id FROM units WHERE clinic_id = ${CLINIC} AND slug = 'matriz'), ${q(room)})`);
}

for (const [slug, name, color] of SPECIALTIES) {
  push(`INSERT INTO specialties (clinic_id, slug, name, color) VALUES (${CLINIC}, ${q(slug)}, ${q(name)}, ${q(color)})`);
}

for (const [slug, name, specialty, duration, price, descr] of PROCEDURES) {
  push(`INSERT INTO procedures (clinic_id, slug, name, specialty_id, duration_min, price_cents, requires_room, show_in_booking, description)
    VALUES (${CLINIC}, ${q(slug)}, ${q(name)},
            (SELECT id FROM specialties WHERE clinic_id = ${CLINIC} AND slug = ${q(specialty)}),
            ${duration}, ${price}, 1, 1, ${q(descr)})`);
}

const PROS = [
  ["dra-ana-paula", "Dra. Ana Paula Ribeiro", "12345", "SP", "dra.ana@sorrisodemo.com.br", "(11) 97777-1000", "#0f766e"],
  ["dr-carlos-eduardo", "Dr. Carlos Eduardo Lima", "67890", "SP", "dr.carlos@sorrisodemo.com.br", "(11) 97777-2000", "#7c3aed"],
];
for (const [slug, name, cro, uf, email, phone, color] of PROS) {
  push(`INSERT INTO professionals (clinic_id, slug, name, cro, cro_uf, email, phone, color, slot_min, show_in_booking, active, default_unit_id)
    VALUES (${CLINIC}, ${q(slug)}, ${q(name)}, ${q(cro)}, ${q(uf)}, ${q(email)}, ${q(phone)}, ${q(color)}, 30, 1, 1,
            (SELECT id FROM units WHERE clinic_id = ${CLINIC} AND slug = 'matriz'))`);
  for (const weekday of [1, 2, 3, 4, 5]) {
    push(`INSERT INTO work_schedules (clinic_id, professional_id, unit_id, weekday, start_min, end_min, break_start_min, break_end_min, active)
      SELECT p.clinic_id, p.id, p.default_unit_id, ${weekday}, 480, 1080, 720, 780, 1
        FROM professionals p WHERE p.clinic_id = ${CLINIC} AND p.slug = ${q(slug)}`);
  }
}

const USERS = [
  ["Administrador Demo", "admin@sorrisodemo.com.br", adminHash, "clinic_admin", 1, null],
  ["Dra. Ana Paula Ribeiro", "dra.ana@sorrisodemo.com.br", dentistHash, "dentist", 1, "dra-ana-paula"],
  ["Recepção Demo", "recepcao@sorrisodemo.com.br", receptionHash, "receptionist", 0, null],
];
for (const [name, email, hash, role, canView, proSlug] of USERS) {
  push(`INSERT INTO users (name, email, password_hash, must_change_password)
    VALUES (${q(name)}, ${q(email)}, ${q(hash)}, 0)`);
  push(`INSERT INTO clinic_memberships (clinic_id, user_id, role, can_view_records, active, professional_id)
    VALUES (${CLINIC}, (SELECT id FROM users WHERE email = ${q(email)}), ${q(role)}, ${canView}, 1,
            ${proSlug ? `(SELECT id FROM professionals WHERE clinic_id = ${CLINIC} AND slug = ${q(proSlug)})` : "NULL"})`);
  if (proSlug) {
    push(`UPDATE professionals SET user_id = (SELECT id FROM users WHERE email = ${q(email)})
      WHERE clinic_id = ${CLINIC} AND slug = ${q(proSlug)}`);
  }
}

const PATIENTS = [
  ["P00001", "Maria Souza Andrade", "11999990001", "1988-04-12", "11122233344", "maria@example.com", "", ""],
  ["P00002", "João Pedro Martins", "11999990002", "1975-11-30", "", "joao@example.com", "", "Hipertenso, usa losartana"],
  ["P00003", "Beatriz Almeida Nunes", "11999990003", "2016-07-08", "", "", "Fernanda Almeida (mãe)", "Paciente infantil"],
];
for (const [code, name, phone, birth, cpf, email, guardian, notes] of PATIENTS) {
  push(`INSERT INTO patients (clinic_id, code, name, phone, birth_date, cpf, email, guardian_name, notes, whatsapp_optin)
    VALUES (${CLINIC}, ${q(code)}, ${q(name)}, ${q(phone)}, ${q(birth)}, ${q(cpf)}, ${q(email)}, ${q(guardian)}, ${q(notes)}, 1)`);
}

/** 13:00 UTC = 10:00 em America/Sao_Paulo. */
const slotUtc = (offsetDay, minutesUtc) => iso(new Date(`${dayLocal(offsetDay)}T00:00:00Z`).getTime() + minutesUtc * 60_000);
const APPOINTMENTS = [
  ["A00001", 0, "dra-ana-paula", "P00001", "avaliacao", 13 * 60, 30, "confirmado", "reception", "Consultório 1", "whatsapp"],
  ["A00002", 0, "dr-carlos-eduardo", "P00002", "profilaxia", 14 * 60, 45, "agendado", "reception", null, ""],
  ["A00003", 1, "dra-ana-paula", "P00003", "consulta-infantil", 13 * 60, 30, "aguardando_confirmacao", "online", null, ""],
];
for (const [code, offset, proSlug, patientCode, procSlug, startUtc, duration, status, source, roomName, confirmedVia] of APPOINTMENTS) {
  push(`INSERT INTO appointments (clinic_id, code, unit_id, professional_id, patient_id, procedure_id, room_id, kind,
      starts_at, ends_at, local_day, status, source, created_by, confirmed_at, confirmed_via)
    VALUES (${CLINIC}, ${q(code)},
      (SELECT id FROM units WHERE clinic_id = ${CLINIC} AND slug = 'matriz'),
      (SELECT id FROM professionals WHERE clinic_id = ${CLINIC} AND slug = ${q(proSlug)}),
      (SELECT id FROM patients WHERE clinic_id = ${CLINIC} AND code = ${q(patientCode)}),
      (SELECT id FROM procedures WHERE clinic_id = ${CLINIC} AND slug = ${q(procSlug)}),
      ${roomName ? `(SELECT id FROM rooms WHERE clinic_id = ${CLINIC} AND name = ${q(roomName)})` : "NULL"},
      'consulta', ${q(slotUtc(offset, startUtc))}, ${q(slotUtc(offset, startUtc + duration))}, ${q(dayLocal(offset))},
      ${q(status)}, ${q(source)}, (SELECT id FROM users WHERE email = 'admin@sorrisodemo.com.br'),
      ${confirmedVia ? q(iso()) : "NULL"}, ${q(confirmedVia)})`);
}

const dir = await mkdtemp(join(tmpdir(), "crodonto-seed-"));
const file = join(dir, "seed.sql");
await writeFile(file, `${stmts.join("\n")}\n`, "utf8");
console.log(`Aplicando ${stmts.length} comandos no D1 local...`);
execFileSync("npx", ["wrangler", "d1", "execute", "crodonto-db", "--local", "--file", file], { stdio: "inherit" });
console.log(`
✅ Clínica de demonstração criada (${SLUG}).
   Painel:       http://localhost:5173/c/${SLUG}/admin
   Site público: http://localhost:5173/c/${SLUG}
   Admin:        admin@sorrisodemo.com.br / ${PASSWORD}
   Dentista:     dra.ana@sorrisodemo.com.br / ${PASSWORD}
   Recepção:     recepcao@sorrisodemo.com.br / ${PASSWORD}
`);
