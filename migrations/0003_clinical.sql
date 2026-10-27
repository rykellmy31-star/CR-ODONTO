-- ============================================================================
-- CR ODONTO — 0003 PRONTUÁRIO CLÍNICO
-- Anamnese, evolução clínica (append-only), odontograma, planos de tratamento,
-- documentos clínicos e trilha de auditoria/versionamento dos registros.
--
-- INTEGRIDADE: registros clínicos NÃO são editados in-place. Correções geram
-- um novo registro com `amends_record_id`; exclusões são lógicas
-- (`voided_at` + motivo + responsável). Toda escrita exige profissional
-- habilitado e fica registrada em clinical_record_events.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ── Anamnese (uma ficha por paciente, versionada por histórico) ────────────
CREATE TABLE IF NOT EXISTS anamneses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id         INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id        INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  allergies         TEXT NOT NULL DEFAULT '',
  medications       TEXT NOT NULL DEFAULT '',
  systemic_conditions TEXT NOT NULL DEFAULT '',   -- JSON array de condições
  surgeries         TEXT NOT NULL DEFAULT '',
  smoker            TEXT NOT NULL DEFAULT 'nao' CHECK (smoker IN ('nao','sim','ex')),
  pregnant          TEXT NOT NULL DEFAULT 'nao' CHECK (pregnant IN ('nao','sim','na_se_aplica')),
  bleeding_disorder INTEGER NOT NULL DEFAULT 0 CHECK (bleeding_disorder IN (0,1)),
  heart_condition   INTEGER NOT NULL DEFAULT 0 CHECK (heart_condition IN (0,1)),
  diabetes          INTEGER NOT NULL DEFAULT 0 CHECK (diabetes IN (0,1)),
  hypertension      INTEGER NOT NULL DEFAULT 0 CHECK (hypertension IN (0,1)),
  notes             TEXT NOT NULL DEFAULT '',
  updated_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by_name   TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (patient_id)
);

-- ── Registros clínicos (append-only) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS clinical_records (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id        INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id       INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id   INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  professional_id  INTEGER NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
  author_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name      TEXT NOT NULL DEFAULT '',
  kind             TEXT NOT NULL CHECK (kind IN ('avaliacao','evolucao','diagnostico','observacao','retorno','procedimento')),
  chief_complaint  TEXT NOT NULL DEFAULT '',
  history          TEXT NOT NULL DEFAULT '',
  diagnosis        TEXT NOT NULL DEFAULT '',
  evolution        TEXT NOT NULL DEFAULT '',
  procedure_done   TEXT NOT NULL DEFAULT '',
  tooth_codes      TEXT NOT NULL DEFAULT '',       -- "11,12,21"
  notes            TEXT NOT NULL DEFAULT '',
  amends_record_id INTEGER REFERENCES clinical_records(id) ON DELETE SET NULL,
  voided_at        TEXT,
  voided_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  void_reason      TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  CHECK (length(trim(evolution)) > 0 OR length(trim(diagnosis)) > 0 OR length(trim(chief_complaint)) > 0
         OR length(trim(procedure_done)) > 0 OR length(trim(notes)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_records_patient ON clinical_records(patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_records_appt ON clinical_records(appointment_id);
CREATE INDEX IF NOT EXISTS idx_records_clinic ON clinical_records(clinic_id, created_at);

-- Trilha imutável de eventos dos registros clínicos
CREATE TABLE IF NOT EXISTS clinical_record_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id     INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  record_id     INTEGER NOT NULL REFERENCES clinical_records(id) ON DELETE CASCADE,
  action        TEXT NOT NULL CHECK (action IN ('created','amended','voided','viewed')),
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_name    TEXT NOT NULL DEFAULT '',
  meta          TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_record_events ON clinical_record_events(record_id, created_at);

-- ── Odontograma ───────────────────────────────────────────────────────────
-- Cada marcação é independente e histórica: o estado atual é obtido pelo
-- registro mais recente por (dente, face). `superseded_at` permite evolução
-- sem apagar o passado.
CREATE TABLE IF NOT EXISTS odontogram_entries (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id        INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id       INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id  INTEGER NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
  author_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dentition        TEXT NOT NULL DEFAULT 'permanente' CHECK (dentition IN ('permanente','decidua')),
  tooth_code       TEXT NOT NULL,                 -- 11..48 | 51..85
  face             TEXT NOT NULL DEFAULT 'geral' CHECK (face IN
                     ('geral','mesial','distal','oclusal','vestibular','lingual','palatina','incisal','cervical')),
  condition        TEXT NOT NULL CHECK (condition IN
                     ('carie','restauracao','ausente','extracao','coroa','endodontia','implante',
                      'fratura','provisorio','selante','limpeza','planejado','observacao')),
  status           TEXT NOT NULL DEFAULT 'existente' CHECK (status IN ('existente','planejado','concluido')),
  treatment_plan_item_id INTEGER,
  notes            TEXT NOT NULL DEFAULT '',
  record_id        INTEGER REFERENCES clinical_records(id) ON DELETE SET NULL,
  superseded_at    TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_odonto_patient ON odontogram_entries(patient_id, dentition, tooth_code, face);
CREATE INDEX IF NOT EXISTS idx_odonto_clinic ON odontogram_entries(clinic_id, created_at);

-- ── Planos de tratamento ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS treatment_plans (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id       INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id      INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE RESTRICT,
  title           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','ativo','concluido','cancelado')),
  notes           TEXT NOT NULL DEFAULT '',
  total_cents     INTEGER NOT NULL DEFAULT 0,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  closed_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_plans_patient ON treatment_plans(patient_id, status);

CREATE TABLE IF NOT EXISTS treatment_plan_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id       INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  plan_id         INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  procedure_id    INTEGER REFERENCES procedures(id) ON DELETE SET NULL,
  professional_id INTEGER REFERENCES professionals(id) ON DELETE SET NULL,
  description     TEXT NOT NULL DEFAULT '',
  tooth_code      TEXT NOT NULL DEFAULT '',
  face            TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_andamento','concluido','cancelado')),
  sessions_planned INTEGER NOT NULL DEFAULT 1 CHECK (sessions_planned BETWEEN 1 AND 60),
  sessions_done    INTEGER NOT NULL DEFAULT 0 CHECK (sessions_done >= 0),
  price_cents      INTEGER NOT NULL DEFAULT 0,
  notes            TEXT NOT NULL DEFAULT '',
  sort             INTEGER NOT NULL DEFAULT 0,
  completed_at     TEXT,
  completed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_plan_items ON treatment_plan_items(plan_id, sort);

-- ── Documentos clínicos e arquivos (R2 privado) ───────────────────────────
CREATE TABLE IF NOT EXISTS clinical_documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  professional_id INTEGER REFERENCES professionals(id) ON DELETE SET NULL,
  plan_id        INTEGER REFERENCES treatment_plans(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL CHECK (kind IN
                   ('atestado','declaracao','receita','encaminhamento','termo','plano_tratamento',
                    'exame','radiografia','foto','arquivo')),
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',        -- conteúdo textual (documentos gerados)
  r2_key         TEXT NOT NULL DEFAULT '',        -- arquivos enviados (bucket privado)
  mime           TEXT NOT NULL DEFAULT '',
  size_bytes     INTEGER NOT NULL DEFAULT 0,
  issued_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  issued_by_name TEXT NOT NULL DEFAULT '',
  cro            TEXT NOT NULL DEFAULT '',
  signature_hash TEXT NOT NULL DEFAULT '',        -- hash do conteúdo assinado (integridade)
  signature_kind TEXT NOT NULL DEFAULT '' CHECK (signature_kind IN ('','interna')),
  visible_to_patient INTEGER NOT NULL DEFAULT 0 CHECK (visible_to_patient IN (0,1)),
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voided_at      TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_docs_patient ON clinical_documents(patient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_docs_clinic ON clinical_documents(clinic_id, created_at);
