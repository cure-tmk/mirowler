CREATE INDEX runs_by_scheduled_at ON runs (scheduled_at);
CREATE INDEX events_by_run ON events (run_id);
