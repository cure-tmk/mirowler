CREATE TABLE monitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT NOT NULL,
  running_since TEXT,
  last_valid_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX monitors_due ON monitors (enabled, next_run_at);

CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors (id),
  config_version INTEGER NOT NULL,
  scheduled_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  status TEXT NOT NULL,
  value_json TEXT,
  state TEXT,
  reason TEXT,
  content_hash TEXT,
  error TEXT
);
CREATE INDEX runs_by_monitor ON runs (monitor_id, scheduled_at DESC);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs (run_id),
  monitor_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE TABLE notifications (
  event_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TEXT,
  PRIMARY KEY (event_id, channel_id)
);
CREATE INDEX notifications_by_status ON notifications (status);

CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  secret_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
