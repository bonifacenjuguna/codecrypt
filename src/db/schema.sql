-- GitroHub database schema
-- Run automatically on boot by src/db/migrate.js (safe to re-run, uses IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS users (
  telegram_id         BIGINT PRIMARY KEY,
  github_username     TEXT,
  github_token_enc    TEXT,          -- AES-256-GCM encrypted access token
  github_scope        TEXT,
  connected_at        TIMESTAMPTZ,
  disconnected_at     TIMESTAMPTZ,

  -- Notification preferences (per design: Settings -> Notifications submenu)
  notif_github_activity BOOLEAN NOT NULL DEFAULT TRUE,
  notif_system_alerts   BOOLEAN NOT NULL DEFAULT TRUE,
  notif_long_ops        BOOLEAN NOT NULL DEFAULT TRUE,
  notif_token_health     BOOLEAN NOT NULL DEFAULT TRUE,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id            BIGSERIAL PRIMARY KEY,
  telegram_id   BIGINT NOT NULL,
  icon          TEXT NOT NULL,        -- e.g. '⬆️', '➕', '⚠️'
  summary       TEXT NOT NULL,        -- e.g. "Uploaded 4 files → weather-app"
  detail        TEXT,                 -- optional expanded detail / error stack
  is_error      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_telegram_id_created
  ON activity_log (telegram_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_log_errors
  ON activity_log (telegram_id, is_error, created_at DESC);

-- ── v0.3.0 additions ─────────────────────────────────────────

-- My Defaults, Storage & Data auto-cleanup, Access Log alerts
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_commit_message TEXT NOT NULL DEFAULT 'Update via GitroHub';
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_upload_path TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_sort TEXT NOT NULL DEFAULT 'updated';
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_filter TEXT NOT NULL DEFAULT 'all';
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_suggest_defaults BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS activity_retention_days INT NOT NULL DEFAULT 90;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_cleanup_on_delete BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_on_new_connection BOOLEAN NOT NULL DEFAULT TRUE;

-- Pinned repos, with a manual order for the reorder feature
CREATE TABLE IF NOT EXISTS pinned_repos (
  id            BIGSERIAL PRIMARY KEY,
  telegram_id   BIGINT NOT NULL,
  repo_name     TEXT NOT NULL,
  position      INT NOT NULL,
  pinned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (telegram_id, repo_name)
);
CREATE INDEX IF NOT EXISTS idx_pinned_repos_user ON pinned_repos (telegram_id, position);

-- Tags (user-defined labels) and their assignment to repos
CREATE TABLE IF NOT EXISTS tags (
  id            BIGSERIAL PRIMARY KEY,
  telegram_id   BIGINT NOT NULL,
  name          TEXT NOT NULL,
  emoji         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (telegram_id, name)
);

CREATE TABLE IF NOT EXISTS repo_tags (
  id            BIGSERIAL PRIMARY KEY,
  telegram_id   BIGINT NOT NULL,
  repo_name     TEXT NOT NULL,
  tag_id        BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  UNIQUE (telegram_id, repo_name, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_repo_tags_lookup ON repo_tags (telegram_id, repo_name);

-- Per-repo "last upload path used" memory, feeds Upload Here's smart default
CREATE TABLE IF NOT EXISTS repo_path_memory (
  telegram_id   BIGINT NOT NULL,
  repo_name     TEXT NOT NULL,
  last_path     TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_id, repo_name)
);

-- Security-focused connection history, separate from the general Activity Log
CREATE TABLE IF NOT EXISTS access_log (
  id            BIGSERIAL PRIMARY KEY,
  telegram_id   BIGINT NOT NULL,
  event         TEXT NOT NULL, -- 'connected' | 'reconnected' | 'disconnected'
  detail        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_access_log_user ON access_log (telegram_id, created_at DESC);
