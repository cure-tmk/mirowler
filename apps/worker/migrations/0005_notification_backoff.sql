ALTER TABLE notifications ADD COLUMN next_attempt_at TEXT;
ALTER TABLE notifications ADD COLUMN claimed_at TEXT;
CREATE INDEX notifications_due ON notifications (status, next_attempt_at);
