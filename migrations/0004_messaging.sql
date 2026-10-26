-- ============================================================================
-- CR ODONTO — 0004 WHATSAPP / LEMBRETES
-- Configuração por clínica, modelos de mensagem, fila idempotente de jobs,
-- tentativas, eventos de webhook e tokens de ação (confirmar/reagendar).
--
-- REGRAS: nenhum dado clínico sensível nas mensagens; o sistema continua
-- operacional se a integração estiver indisponível (jobs ficam pendentes e
-- expiram sem bloquear agenda).
-- ============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS whatsapp_settings (
  clinic_id            INTEGER PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
  enabled              INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  provider             TEXT NOT NULL DEFAULT 'meta_cloud' CHECK (provider IN ('meta_cloud','mock')),
  waba_id              TEXT NOT NULL DEFAULT '',
  phone_number_id      TEXT NOT NULL DEFAULT '',
  display_phone        TEXT NOT NULL DEFAULT '',
  access_token_enc     TEXT NOT NULL DEFAULT '',   -- AES-256-GCM (MSG_ENC_KEY)
  verify_token_hash    TEXT NOT NULL DEFAULT '',
  reminder_offsets_min TEXT NOT NULL DEFAULT '[1440,300]', -- JSON array (min antes)
  send_window_start    TEXT NOT NULL DEFAULT '08:00',
  send_window_end      TEXT NOT NULL DEFAULT '20:00',
  max_per_day          INTEGER NOT NULL DEFAULT 400,
  require_optin        INTEGER NOT NULL DEFAULT 1 CHECK (require_optin IN (0,1)),
  notify_on_confirm    INTEGER NOT NULL DEFAULT 1 CHECK (notify_on_confirm IN (0,1)),
  send_confirmation_receipt INTEGER NOT NULL DEFAULT 1 CHECK (send_confirmation_receipt IN (0,1)),
  last_error           TEXT NOT NULL DEFAULT '',
  last_checked_at      TEXT,
  updated_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Modelos de mensagem (texto livre aprovado pela clínica + nome do modelo
-- aprovado na Meta quando aplicável).
CREATE TABLE IF NOT EXISTS message_templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id     INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  code          TEXT NOT NULL CHECK (code IN ('lembrete','confirmacao','reagendamento','conclusao','retorno','boas_vindas')),
  name          TEXT NOT NULL DEFAULT '',
  language      TEXT NOT NULL DEFAULT 'pt_BR',
  body          TEXT NOT NULL,
  provider_template_name TEXT NOT NULL DEFAULT '',
  provider_status TEXT NOT NULL DEFAULT 'nao_enviado'
                  CHECK (provider_status IN ('nao_enviado','pendente','aprovado','rejeitado')),
  provider_rejected_reason TEXT NOT NULL DEFAULT '',
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (clinic_id, code)
);

-- Fila idempotente: (clinic_id, idempotency_key) única impede duplicidade
-- mesmo com webhooks repetidos ou cron concorrente.
CREATE TABLE IF NOT EXISTS message_jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id       INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id  INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id      INTEGER REFERENCES patients(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('lembrete','confirmacao','reagendamento','conclusao','retorno','boas_vindas')),
  scheduled_at    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente','enviando','enviado','falhou','cancelado','expirado')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TEXT,
  to_phone        TEXT NOT NULL DEFAULT '',
  body            TEXT NOT NULL DEFAULT '',
  payload         TEXT NOT NULL DEFAULT '{}',
  provider_msg_id TEXT NOT NULL DEFAULT '',
  sent_at         TEXT,
  delivered_at    TEXT,
  read_at         TEXT,
  last_error      TEXT NOT NULL DEFAULT '',
  claimed_at      TEXT,                            -- trava de processamento (lease)
  idempotency_key TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (clinic_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON message_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_jobs_appt ON message_jobs(appointment_id, kind);
CREATE INDEX IF NOT EXISTS idx_jobs_clinic ON message_jobs(clinic_id, created_at);

CREATE TABLE IF NOT EXISTS message_attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      INTEGER NOT NULL REFERENCES message_jobs(id) ON DELETE CASCADE,
  n           INTEGER NOT NULL,
  outcome     TEXT NOT NULL CHECK (outcome IN ('aceito','erro_temporario','erro_permanente','simulado')),
  http_status INTEGER,
  error       TEXT NOT NULL DEFAULT '',
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_attempts_job ON message_attempts(job_id, n);

-- Webhooks processados (dedupe + auditoria). event_uid único = idempotência.
CREATE TABLE IF NOT EXISTS message_webhook_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id  INTEGER REFERENCES clinics(id) ON DELETE CASCADE,
  job_id     INTEGER REFERENCES message_jobs(id) ON DELETE SET NULL,
  event_uid  TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT '',
  payload    TEXT NOT NULL DEFAULT '{}',
  processed  INTEGER NOT NULL DEFAULT 0 CHECK (processed IN (0,1)),
  error      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_job ON message_webhook_events(job_id, created_at);

-- ── Tokens de ação de uso único (links seguros de confirmar/reagendar) ────
-- Guardamos apenas o sha256 do token. `used_at` garante uso único; o
-- reagendamento é transacional (nova reserva antes de liberar a antiga).
CREATE TABLE IF NOT EXISTS action_tokens (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id      INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id     INTEGER REFERENCES patients(id) ON DELETE CASCADE,
  purpose        TEXT NOT NULL CHECK (purpose IN ('confirmar','reagendar','portal','documento')),
  token_hash     TEXT NOT NULL UNIQUE,
  expires_at     TEXT NOT NULL,
  used_at        TEXT,
  used_action    TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_action_tokens_appt ON action_tokens(appointment_id, purpose);
CREATE INDEX IF NOT EXISTS idx_action_tokens_expiry ON action_tokens(expires_at);

-- Códigos de acesso ao portal do paciente (envio por WhatsApp; hash no D1)
CREATE TABLE IF NOT EXISTS portal_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id  INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  code_hash  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_portal_codes_patient ON portal_codes(patient_id, expires_at);

-- ── Consentimentos LGPD (mensageria e portal) ──────────────────────────────
CREATE TABLE IF NOT EXISTS consents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id  INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('whatsapp_lembretes','portal','dados_clinicos','marketing')),
  granted    INTEGER NOT NULL DEFAULT 1 CHECK (granted IN (0,1)),
  source     TEXT NOT NULL DEFAULT 'panel',
  at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_consents_patient ON consents(patient_id, kind);
