-- Seamless star-map ingestion: experiences extracted from conversation are
-- confirmed on arrival. The source of that confirmation stays auditable —
-- 'user' (explicit confirm/correct action) vs 'auto' (structural extraction
-- the user never tapped). Deletion and correction remain available either way.
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS confirm_source text NOT NULL DEFAULT 'user';
