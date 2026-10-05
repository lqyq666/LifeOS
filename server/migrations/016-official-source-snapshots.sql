CREATE TABLE official_sources (
  id uuid PRIMARY KEY,
  url text NOT NULL UNIQUE,
  publisher text NOT NULL,
  revision integer NOT NULL CHECK(revision>0),
  status text NOT NULL CHECK(status IN ('fetched','partial','fetch_failed')),
  current_hash text,
  checked_at timestamptz NOT NULL,
  payload jsonb NOT NULL
);
CREATE TABLE official_source_snapshots (
  source_id uuid NOT NULL REFERENCES official_sources(id),
  revision integer NOT NULL CHECK(revision>0),
  raw_bytes bytea,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_id,revision)
);
-- A tracked official document can suspend a proposition even if another local
-- maintenance importer accidentally leaves its row marked verified.
CREATE FUNCTION official_knowledge_current(card jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM official_sources s WHERE s.url=card->>'url'
    AND (s.status<>'fetched' OR s.current_hash IS DISTINCT FROM card->>'sourceHash'
      OR s.checked_at<=now()-interval '24 hours')
  );
$$;
CREATE OR REPLACE FUNCTION coach_knowledge_refs_valid(refs jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(refs) ref
    LEFT JOIN campus_knowledge k ON k.id=(ref->>'sourceId')::uuid
    WHERE k.id IS NULL OR k.revision<>(ref->>'revision')::integer OR k.status<>'verified'
      OR (k.valid_until IS NOT NULL AND k.valid_until<=now())
      OR (k.synthetic AND current_database() !~ '^lifeos_dialogue_(test|live)_')
      OR NOT official_knowledge_current(k.payload)
  );
$$;
