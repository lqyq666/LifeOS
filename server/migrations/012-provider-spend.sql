CREATE TABLE lifeos_provider_budgets (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 80),
  enabled boolean NOT NULL DEFAULT true,
  limit_cny numeric(16,8) NOT NULL CHECK (limit_cny >= 0),
  revision integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lifeos_provider_spend (
  id uuid PRIMARY KEY,
  budget_id text NOT NULL REFERENCES lifeos_provider_budgets(id),
  user_id text NOT NULL,
  request_id uuid NOT NULL,
  call_index integer NOT NULL CHECK (call_index IN (1,2)),
  provider text NOT NULL,
  model text NOT NULL,
  reserved_cny numeric(16,8) NOT NULL CHECK (reserved_cny > 0),
  settled_cny numeric(16,8) CHECK (settled_cny >= 0),
  status text NOT NULL CHECK (status IN ('reserved','known','unknown','not_sent','overrun')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(user_id,request_id,call_index),
  CHECK ((status IN ('reserved','unknown') AND settled_cny IS NULL) OR (status NOT IN ('reserved','unknown') AND settled_cny IS NOT NULL))
);
CREATE INDEX provider_spend_by_budget ON lifeos_provider_spend(budget_id);
