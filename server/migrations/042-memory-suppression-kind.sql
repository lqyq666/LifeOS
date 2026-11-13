ALTER TABLE memory_suppressions
  ADD COLUMN suppression_kind text NOT NULL DEFAULT 'fact';

-- The old table did not record marker provenance. Even a same-transaction
-- `key`/`scope:key` pair can be two real tombstones, so every legacy row keeps
-- the conservative factual meaning. Only post-migration writers may create a
-- structurally typed scope marker.

ALTER TABLE memory_suppressions
  DROP CONSTRAINT memory_suppressions_pkey;

ALTER TABLE memory_suppressions
  ADD CONSTRAINT memory_suppressions_pkey
  PRIMARY KEY (user_id,source_conversation_id,source_message_id,key,suppression_kind),
  ADD CONSTRAINT memory_suppressions_kind_check
  CHECK (
    suppression_kind='fact'
    OR suppression_kind='scope_marker' AND key LIKE 'scope:%'
  );
