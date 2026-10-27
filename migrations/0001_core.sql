-- ============================================================================
-- CR ODONTO — 0001 CORE
-- Plataforma SaaS multiempresa (clínicas odontológicas).
-- Cloudflare D1 / SQLite. Datas em UTC ISO-8601 ("...THH:MM:SSZ"); datas
-- locais "YYYY-MM-DD" no fuso da clínica. Valores monetários em CENTAVOS.
--
-- ISOLAMENTO: toda tabela operacional carrega clinic_id. O Worker resolve a
-- clínica pelo slug da URL + membership verificada no servidor; nenhum id de
-- clínica vindo do cliente é aceito.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ── Planos comerciais (sem gateway de pagamento: controle manual) ───────────
CREATE TABLE IF NOT EXISTS plans (
  code                TEXT PRIMARY KEY,          -- free | trial | pro | clinic
  name                TEXT NOT NULL,
  price_cents_month   INTEGER NOT NULL DEFAULT 0,
  max_units           INTEGER NOT NULL DEFAULT 1,   -- -1 = ilimitado
  max_dentists        INTEGER NOT NULL DEFAULT 2,
  max_staff           INTEGER NOT NULL DEFAULT 3,
  max_messages_month  INTEGER NOT NULL DEFAULT 500,
  whatsapp_enabled    INTEGER NOT NULL DEFAULT 0 CHECK (whatsapp_enabled IN (0,1)),
  clinical_enabled    INTEGER NOT NULL DEFAULT 1 CHECK (clinical_enabled IN (0,1)),
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  sort                INTEGER NOT NULL DEFAULT 0,
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ── Clínicas (tenants) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clinics (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,            -- /c/<slug>
  name           TEXT NOT NULL,
  legal_name     TEXT NOT NULL DEFAULT '',        -- razão social
  cnpj           TEXT NOT NULL DEFAULT '',        -- somente dígitos
  email          TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  whatsapp       TEXT NOT NULL DEFAULT '',
  logo_url       TEXT NOT NULL DEFAULT '',
  timezone       TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','blocked')),
  suspend_reason TEXT NOT NULL DEFAULT '',
  plan_code      TEXT NOT NULL DEFAULT 'trial' REFERENCES plans(code),
  trial_ends_at  TEXT,                            -- ISO; NULL = sem avaliação
  deleted_at     TEXT,                            -- exclusão controlada (soft delete)
  demo           INTEGER NOT NULL DEFAULT 0 CHECK (demo IN (0,1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_clinics_status ON clinics(status, id);
CREATE INDEX IF NOT EXISTS idx_clinics_cnpj ON clinics(cnpj);

CREATE TABLE IF NOT EXISTS subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id  INTEGER NOT NULL UNIQUE REFERENCES clinics(id) ON DELETE CASCADE,
  plan_code  TEXT NOT NULL DEFAULT 'trial' REFERENCES plans(code),
  status     TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','past_due','cancelled','blocked')),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  trial_ends_at TEXT,
  period_end    TEXT,
  notes         TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ── Usuários globais + vínculos por clínica (RBAC no servidor) ──────────────
-- platform_role: 'user' | 'superadmin'
-- membership:    'clinic_admin' | 'dentist' | 'receptionist'
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_role TEXT NOT NULL DEFAULT 'user' CHECK (platform_role IN ('user','superadmin')),
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,             -- minúsculo e normalizado
  password_hash TEXT NOT NULL,                    -- pbkdf2_sha256$iter$salt$hash
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0,1)),
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS clinic_memberships (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id       INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('clinic_admin','dentist','receptionist')),
  professional_id INTEGER,                        -- preenchido quando role='dentist'
  unit_id         INTEGER,                        -- unidade principal (opcional)
  can_view_records INTEGER NOT NULL DEFAULT 0 CHECK (can_view_records IN (0,1)), -- recepção: acesso clínico só se concedido
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (clinic_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON clinic_memberships(user_id, active);
CREATE INDEX IF NOT EXISTS idx_memberships_clinic ON clinic_memberships(clinic_id, role, active);

-- Sessões (cookie HttpOnly → sha256 do token). Rotação e expiração absoluta.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);

-- Sessões do portal do paciente (separadas das sessões de equipe)
CREATE TABLE IF NOT EXISTS patient_sessions (
  token_hash TEXT PRIMARY KEY,
  clinic_id  INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_patient_sessions_patient ON patient_sessions(patient_id, expires_at);

CREATE TABLE IF NOT EXISTS password_resets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pwresets_user ON password_resets(user_id, expires_at);

-- ── Configurações ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clinic_settings (
  clinic_id  INTEGER PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,                       -- JSON validado por zod
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ── Auditoria (nunca apagar) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id  INTEGER REFERENCES clinics(id) ON DELETE SET NULL,   -- NULL = plataforma
  scope      TEXT NOT NULL DEFAULT 'clinic' CHECK (scope IN ('clinic','platform')),
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name  TEXT NOT NULL DEFAULT '',
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL DEFAULT '',
  meta       TEXT NOT NULL DEFAULT '{}',
  ip_hash    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_clinic ON audit_log(clinic_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_scope ON audit_log(scope, created_at);

-- ── Limites de requisição persistentes (login, agendamento público) ─────────
CREATE TABLE IF NOT EXISTS request_rate_limits (
  fingerprint TEXT PRIMARY KEY,
  attempts    INTEGER NOT NULL,
  reset_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_reset ON request_rate_limits(reset_at);

-- ── Primeiro superadministrador: bootstrap de uso único ────────────────────
-- A linha só é criada pelo endpoint /api/setup/superadmin, que exige o segredo
-- SETUP_TOKEN do ambiente e se auto-desabilita após o primeiro uso.
CREATE TABLE IF NOT EXISTS platform_bootstrap (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  completed_at TEXT NOT NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- ── Defaults de plataforma (ajustáveis sem deploy) ─────────────────────────
INSERT OR IGNORE INTO platform_settings (key, value) VALUES
  ('trial_days',            '14'),
  ('reminder_offsets_min',  '[1440,300]'),
  ('send_window_start',     '08:00'),
  ('send_window_end',       '20:00'),
  ('whatsapp_max_attempts', '3'),
  ('retry_backoff_sec',     '120'),
  ('patient_sharing',       'clinic'),
  ('default_slot_min',      '15'),
  ('public_booking_enabled','1');

INSERT OR IGNORE INTO plans (code, name, price_cents_month, max_units, max_dentists, max_staff, max_messages_month, whatsapp_enabled, clinical_enabled, sort) VALUES
  ('trial',  'Avaliação gratuita', 0,     1,  2,  2,  200,  1, 1, 0),
  ('free',   'Essencial',          0,     1,  1,  1,  100,  0, 1, 1),
  ('pro',    'Profissional',       14990, 2,  6,  6,  3000, 1, 1, 2),
  ('clinic', 'Clínica',            29990, -1, -1, -1, -1,   1, 1, 3);
