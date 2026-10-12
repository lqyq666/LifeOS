-- Additive: old binaries ignore this table. Reservations count toward free limits,
-- including failed/unknown delivery; restarting or rolling back cannot refund them.
CREATE TABLE lifeos_password_reset_deliveries (
  id uuid PRIMARY KEY,
  recipient_hash text NOT NULL CHECK (length(recipient_hash)=64),
  status text NOT NULL CHECK (status IN ('reserved','sent','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE INDEX lifeos_password_reset_deliveries_time ON lifeos_password_reset_deliveries(created_at);
CREATE INDEX lifeos_password_reset_deliveries_recipient ON lifeos_password_reset_deliveries(recipient_hash,created_at);
