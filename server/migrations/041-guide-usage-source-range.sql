-- Preserve the exact occurrence backing a guide-feedback record.  The columns
-- are nullable for pre-upgrade rows; new non-suggestion writes resolve and
-- persist a verified range before commit.
ALTER TABLE kb_guide_usage
  ADD COLUMN source_start integer,
  ADD COLUMN source_end integer,
  ADD CONSTRAINT kb_guide_usage_source_range_valid CHECK (
    (source_start IS NULL AND source_end IS NULL)
    OR (source_start IS NOT NULL AND source_end IS NOT NULL
      AND source_start >= 0 AND source_end > source_start)
  );
