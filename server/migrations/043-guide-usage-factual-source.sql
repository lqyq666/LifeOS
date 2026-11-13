-- SQL CHECK treats NULL as satisfied. Keep legacy rows available for audit,
-- but reject every new factual usage that has no verifiable user quote.
ALTER TABLE kb_guide_usage
  ADD CONSTRAINT kb_guide_usage_factual_source_v2_check
  CHECK (
    status = 'suggested'
    OR (
      source_message_id IS NOT NULL
      AND source_quote IS NOT NULL
      AND length(btrim(source_quote)) > 0
    )
  ) NOT VALID;
