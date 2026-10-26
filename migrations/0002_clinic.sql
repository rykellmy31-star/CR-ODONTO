-- ============================================================================
-- CR ODONTO — 0002 CLÍNICA / AGENDA
-- Unidades, especialidades, procedimentos, dentistas, escalas individuais,
-- salas/cadeiras, pacientes, agendamentos (máquina de estados), encaixes,
-- lista de espera, faltas e histórico de alterações.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ── Unidades da clínica ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS units (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id  INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  slug       TEXT NOT NULL,
  name       TEXT NOT NULL,
  address    TEXT NOT NULL DEFAULT '',
  city       TEXT NOT NULL DEFAULT '',
  state      TEXT NOT NULL DEFAULT '',
  zip        TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  whatsapp   TEXT NOT NULL DEFAULT '',
  timezone   TEXT NOT NULL DEFAULT '',            -- vazio = herda da clínica
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (clinic_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_units_clinic ON units(clinic_id, active, sort);

-- ── Salas e cadeiras odontológicas ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  unit_id   INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  kind      TEXT NOT NULL DEFAULT 'cadeira' CHECK (kind IN ('cadeira','sala','consultorio')),
  active    INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (unit_id, name)
);
CREATE INDEX IF NOT EXISTS idx_rooms_clinic ON rooms(clinic_id, unit_id, active);

-- ── Especialidades odontológicas ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS specialties (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  slug      TEXT NOT NULL,
  color     TEXT NOT NULL DEFAULT '#0f766e',
  active    INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort      INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (clinic_id, slug)
);

-- ── Procedimentos (com duração individual, base da agenda) ────────────────
CREATE TABLE IF NOT EXISTS procedures (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL,
  name           TEXT NOT NULL,
  specialty_id   INTEGER REFERENCES specialties(id) ON DELETE SET NULL,
  duration_min   INTEGER NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 5 AND 480),
  price_cents    INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),  -- opcional/informativo
  requires_room  INTEGER NOT NULL DEFAULT 1 CHECK (requires_room IN (0,1)),
  description    TEXT NOT NULL DEFAULT '',
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  show_in_booking INTEGER NOT NULL DEFAULT 1 CHECK (show_in_booking IN (0,1)),
  sort           INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (clinic_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_procedures_clinic ON procedures(clinic_id, active, sort);

-- ── Dentistas / profissionais ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS professionals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id    INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  slug         TEXT NOT NULL,
  name         TEXT NOT NULL,
  cro          TEXT NOT NULL DEFAULT '',          -- número de inscrição
  cro_uf       TEXT NOT NULL DEFAULT '',          -- UF do CRO (2 letras)
  cpf          TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  photo_url    TEXT NOT NULL DEFAULT '',
  bio          TEXT NOT NULL DEFAULT '',
  color        TEXT NOT NULL DEFAULT '#0f766e',
  default_unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  slot_min     INTEGER NOT NULL DEFAULT 15 CHECK (slot_min BETWEEN 5 AND 120),
  show_in_booking INTEGER NOT NULL DEFAULT 1 CHECK (show_in_booking IN (0,1)),
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (clinic_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_professionals_clinic ON professionals(clinic_id, active, sort);

CREATE TABLE IF NOT EXISTS professional_specialties (
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  specialty_id    INTEGER NOT NULL REFERENCES specialties(id) ON DELETE CASCADE,
  PRIMARY KEY (professional_id, specialty_id)
);

-- Quais procedimentos cada dentista executa (e em qual unidade)
CREATE TABLE IF NOT EXISTS professional_procedures (
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  procedure_id    INTEGER NOT NULL REFERENCES procedures(id) ON DELETE CASCADE,
  PRIMARY KEY (professional_id, procedure_id)
);

-- ── Escalas individuais de trabalho (por dia da semana) ───────────────────
-- weekday: 0=domingo .. 6=sábado, no fuso da clínica.
CREATE TABLE IF NOT EXISTS work_schedules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id       INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  unit_id         INTEGER REFERENCES units(id) ON DELETE SET NULL,
  weekday         INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_min       INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min         INTEGER NOT NULL CHECK (end_min BETWEEN 1 AND 1440),
  break_start_min INTEGER,                        -- intervalo de almoço (opcional)
  break_end_min   INTEGER,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (end_min > start_min),
  CHECK (
    (break_start_min IS NULL AND break_end_min IS NULL)
    OR (break_start_min IS NOT NULL AND break_end_min IS NOT NULL
        AND break_start_min >= start_min AND break_end_min <= end_min
        AND break_end_min > break_start_min)
  )
);
CREATE INDEX IF NOT EXISTS idx_work_schedules_pro ON work_schedules(professional_id, weekday, active);
CREATE INDEX IF NOT EXISTS idx_work_schedules_clinic ON work_schedules(clinic_id, unit_id);

-- Exceções: férias, folgas, feriados, ausências, bloqueios e horários
-- excepcionais em uma data específica.
CREATE TABLE IF NOT EXISTS schedule_exceptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id       INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  professional_id INTEGER REFERENCES professionals(id) ON DELETE CASCADE, -- NULL = toda a clínica
  unit_id         INTEGER REFERENCES units(id) ON DELETE SET NULL,
  date            TEXT NOT NULL,                  -- YYYY-MM-DD local
  kind            TEXT NOT NULL CHECK (kind IN ('vacation','dayoff','holiday','absence','block','custom_hours')),
  start_min       INTEGER,                        -- NULL + kind='block' => dia inteiro
  end_min         INTEGER,
  reason          TEXT NOT NULL DEFAULT '',
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (start_min IS NULL AND end_min IS NULL OR (start_min IS NOT NULL AND end_min IS NOT NULL AND end_min > start_min))
);
CREATE INDEX IF NOT EXISTS idx_exceptions_date ON schedule_exceptions(clinic_id, date);
CREATE INDEX IF NOT EXISTS idx_exceptions_pro ON schedule_exceptions(professional_id, date);

-- ── Pacientes ─────────────────────────────────────────────────────────────
-- Código legível (ex.: P-000123) por clínica para busca rápida.
CREATE TABLE IF NOT EXISTS patients (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  name           TEXT NOT NULL,
  birth_date     TEXT,                            -- YYYY-MM-DD
  cpf            TEXT NOT NULL DEFAULT '',        -- somente dígitos, opcional
  phone          TEXT NOT NULL DEFAULT '',         -- dígitos normalizados
  email          TEXT NOT NULL DEFAULT '',
  address        TEXT NOT NULL DEFAULT '',
  city           TEXT NOT NULL DEFAULT '',
  state          TEXT NOT NULL DEFAULT '',
  zip            TEXT NOT NULL DEFAULT '',
  guardian_name  TEXT NOT NULL DEFAULT '',        -- responsável legal (menores)
  guardian_phone TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',        -- administrativo (não clínico)
  whatsapp_optin INTEGER NOT NULL DEFAULT 0 CHECK (whatsapp_optin IN (0,1)),
  optin_at       TEXT,
  anonymized_at  TEXT,                            -- LGPD: dados descaracterizados
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (clinic_id, code)
);
CREATE INDEX IF NOT EXISTS idx_patients_clinic_name ON patients(clinic_id, name);
CREATE INDEX IF NOT EXISTS idx_patients_clinic_phone ON patients(clinic_id, phone);
CREATE INDEX IF NOT EXISTS idx_patients_clinic_cpf ON patients(clinic_id, cpf);

-- ── Agendamentos ──────────────────────────────────────────────────────────
-- Estados: agendado | aguardando_confirmacao | confirmado | chegou |
--          em_atendimento | concluido | cancelado | reagendado | nao_compareceu
CREATE TABLE IF NOT EXISTS appointments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id        INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  unit_id          INTEGER REFERENCES units(id) ON DELETE SET NULL,
  professional_id  INTEGER NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
  patient_id       INTEGER NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
  procedure_id     INTEGER REFERENCES procedures(id) ON DELETE SET NULL,
  room_id          INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  code             TEXT NOT NULL UNIQUE,          -- protocolo legível global
  kind             TEXT NOT NULL DEFAULT 'consulta' CHECK (kind IN ('consulta','retorno','procedimento','avaliacao')),
  starts_at        TEXT NOT NULL,                 -- instante UTC
  ends_at          TEXT NOT NULL,                 -- instante UTC
  local_day        TEXT NOT NULL,                 -- YYYY-MM-DD no fuso da clínica
  status           TEXT NOT NULL DEFAULT 'agendado' CHECK (status IN
                     ('agendado','aguardando_confirmacao','confirmado','chegou','em_atendimento',
                      'concluido','cancelado','reagendado','nao_compareceu')),
  source           TEXT NOT NULL DEFAULT 'reception' CHECK (source IN
                     ('reception','online','whatsapp','return','fit_in','api')),
  is_fit_in        INTEGER NOT NULL DEFAULT 0 CHECK (is_fit_in IN (0,1)),
  fit_in_reason    TEXT NOT NULL DEFAULT '',
  fit_in_authorized_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  parent_appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL, -- retorno
  rescheduled_from_id   INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  rescheduled_to_id     INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  patient_notes    TEXT NOT NULL DEFAULT '',      -- informado pelo paciente
  internal_notes   TEXT NOT NULL DEFAULT '',      -- equipe
  price_cents      INTEGER NOT NULL DEFAULT 0,    -- snapshot informativo do procedimento
  confirmed_at     TEXT,
  confirmed_via    TEXT NOT NULL DEFAULT '' CHECK (confirmed_via IN ('','panel','whatsapp','portal','phone')),
  arrived_at       TEXT,
  started_at       TEXT,
  completed_at     TEXT,
  cancelled_at     TEXT,
  cancel_reason    TEXT NOT NULL DEFAULT '',
  cancel_reason_code TEXT NOT NULL DEFAULT '',
  completed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  no_show_at       TEXT,
  followup_choice  TEXT NOT NULL DEFAULT '' CHECK (followup_choice IN ('','scheduled','later','none')),
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_appt_clinic_day ON appointments(clinic_id, local_day, status);
CREATE INDEX IF NOT EXISTS idx_appt_pro_day ON appointments(professional_id, local_day, status);
CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments(patient_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appt_unit_day ON appointments(unit_id, local_day);
-- Trava de concorrência: duas reservas não podem começar no mesmo minuto
-- para o mesmo dentista. A garantia primária é a checagem atômica de
-- sobreposição em api/lib/scheduling.ts (INSERT ... WHERE NOT EXISTS).
CREATE UNIQUE INDEX IF NOT EXISTS uq_appt_pro_start ON appointments(professional_id, starts_at)
  WHERE status NOT IN ('cancelado','reagendado','nao_compareceu');
CREATE UNIQUE INDEX IF NOT EXISTS uq_appt_room_start ON appointments(room_id, starts_at)
  WHERE room_id IS NOT NULL AND status NOT IN ('cancelado','reagendado','nao_compareceu');

-- Histórico de transições (append-only): quem mudou o quê e quando.
CREATE TABLE IF NOT EXISTS appointment_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  from_status    TEXT NOT NULL DEFAULT '',
  to_status      TEXT NOT NULL,
  actor_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name     TEXT NOT NULL DEFAULT '',
  actor_kind     TEXT NOT NULL DEFAULT 'staff' CHECK (actor_kind IN ('staff','patient','system')),
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_appt_events_appt ON appointment_events(appointment_id, created_at);

-- Registro simples e OPCIONAL de pagamento (nenhum campo é obrigatório).
CREATE TABLE IF NOT EXISTS appointment_payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  amount_cents   INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
  method         TEXT NOT NULL DEFAULT 'nao_informado' CHECK (method IN
                   ('pix','dinheiro','cartao_credito','cartao_debito','transferencia',
                    'pendente','outro','nao_informado')),
  note           TEXT NOT NULL DEFAULT '',
  recorded_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ── Lista de espera ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS waitlist_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id       INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  unit_id         INTEGER REFERENCES units(id) ON DELETE SET NULL,
  patient_id      INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id INTEGER REFERENCES professionals(id) ON DELETE SET NULL,
  procedure_id    INTEGER REFERENCES procedures(id) ON DELETE SET NULL,
  desired_from    TEXT NOT NULL,                  -- YYYY-MM-DD
  desired_to      TEXT,
  preferred_period TEXT NOT NULL DEFAULT 'any' CHECK (preferred_period IN ('any','morning','afternoon','evening')),
  notes           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando','contatado','agendado','cancelado')),
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_waitlist_clinic ON waitlist_entries(clinic_id, status, desired_from);

-- ── Bloqueios manuais de agenda (por dentista/unidade, sem paciente) ──────
-- Reaproveita schedule_exceptions para o dia; esta tabela cobre janelas
-- pontuais criadas direto na agenda e alimenta a checagem de conflito.
CREATE TABLE IF NOT EXISTS agenda_blocks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id       INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  unit_id         INTEGER REFERENCES units(id) ON DELETE SET NULL,
  professional_id INTEGER REFERENCES professionals(id) ON DELETE CASCADE,
  starts_at       TEXT NOT NULL,
  ends_at         TEXT NOT NULL,
  reason          TEXT NOT NULL DEFAULT '',
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_agenda_blocks_pro ON agenda_blocks(professional_id, starts_at);
