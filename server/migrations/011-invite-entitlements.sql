CREATE TABLE lifeos_entitlements (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  expires_at timestamptz NOT NULL,
  turn_limit integer NOT NULL CHECK (turn_limit BETWEEN 0 AND 1000000),
  used_turns integer NOT NULL DEFAULT 0 CHECK (used_turns >= 0 AND used_turns <= turn_limit),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE runs ADD COLUMN entitlement_reserved boolean NOT NULL DEFAULT false;
CREATE INDEX running_entitlement_reservations ON runs(user_id) WHERE status='running' AND entitlement_reserved;
