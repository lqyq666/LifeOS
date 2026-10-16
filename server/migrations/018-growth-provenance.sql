ALTER TABLE growth_items ADD COLUMN valid_from timestamptz;
ALTER TABLE growth_items ADD COLUMN time_basis jsonb
  CHECK (time_basis IS NULL OR jsonb_typeof(time_basis) = 'object');
ALTER TABLE growth_items ADD CONSTRAINT growth_time_interval_valid
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from < valid_until);

CREATE TABLE growth_item_lineage (
  user_id text NOT NULL,
  parent_id uuid NOT NULL,
  parent_revision integer NOT NULL,
  child_id uuid NOT NULL,
  relation text NOT NULL CHECK (relation = 'split_from'),
  fragment_role text NOT NULL CHECK (fragment_role IN ('retained','changed')),
  superseded_quote text,
  source_redacted boolean NOT NULL DEFAULT false,
  CHECK ((fragment_role='changed' AND NOT source_redacted AND superseded_quote IS NOT NULL
            AND length(superseded_quote) BETWEEN 1 AND 4000)
      OR (fragment_role='changed' AND source_redacted AND superseded_quote IS NULL)
      OR (fragment_role='retained' AND superseded_quote IS NULL AND NOT source_redacted)),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,parent_id,parent_revision,child_id),
  FOREIGN KEY (user_id,parent_id,parent_revision)
    REFERENCES growth_revisions(user_id,item_id,revision) ON DELETE CASCADE,
  FOREIGN KEY (user_id,child_id)
    REFERENCES growth_items(user_id,id) ON DELETE CASCADE,
  CHECK (parent_id <> child_id)
);
