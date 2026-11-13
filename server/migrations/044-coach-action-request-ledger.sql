-- A current, indexed action row owns the exact requests it has consumed.
-- Existing rows stay NULL and therefore retain conservative legacy behavior;
-- new writes maintain an exact JSON source array transactionally.
ALTER TABLE coach_actions
  ADD COLUMN consumed_request_sources jsonb,
  ADD CONSTRAINT coach_actions_consumed_request_sources_check
  CHECK (consumed_request_sources IS NULL OR jsonb_typeof(consumed_request_sources) = 'array');
