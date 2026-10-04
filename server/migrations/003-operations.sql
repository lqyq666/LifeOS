-- Additive migration. Business data and existing auth tables are retained.
CREATE TABLE lifeos_model_state (
  id integer PRIMARY KEY CHECK (id=1),
  retry_until timestamptz,
  error_code text,
  last_success_at timestamptz,
  last_failure_at timestamptz
);
INSERT INTO lifeos_model_state(id) VALUES(1);
CREATE INDEX runs_user_started_at_idx ON runs(user_id,started_at);
