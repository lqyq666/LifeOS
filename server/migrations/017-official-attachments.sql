CREATE TABLE official_attachments (
  id uuid PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES official_sources(id),
  url text NOT NULL,
  revision integer NOT NULL CHECK(revision>0),
  status text NOT NULL CHECK(status IN ('parsed','partial','unsupported','rejected','fetch_failed')),
  current_hash text,
  source_hash text NOT NULL,
  checked_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  UNIQUE(source_id,url)
);
CREATE TABLE official_attachment_snapshots (
  attachment_id uuid NOT NULL REFERENCES official_attachments(id),
  revision integer NOT NULL CHECK(revision>0),
  raw_bytes bytea,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(attachment_id,revision)
);
CREATE OR REPLACE FUNCTION official_knowledge_current(card jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM official_sources s WHERE s.url=card->>'url'
    AND (s.status<>'fetched' OR s.current_hash IS DISTINCT FROM card->>'sourceHash'
      OR s.checked_at<=now()-interval '24 hours')
  ) AND NOT EXISTS (
    SELECT 1 FROM official_attachments a JOIN official_sources s ON s.id=a.source_id
    WHERE a.url=card->>'url'
    AND (a.status<>'parsed' OR a.current_hash IS DISTINCT FROM card->>'sourceHash'
      OR a.checked_at<=now()-interval '24 hours' OR s.status<>'fetched'
      OR s.current_hash IS DISTINCT FROM a.source_hash
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(s.payload#>'{extraction,attachments}','[]'::jsonb)) link WHERE link->>'url'=a.url)
      OR s.checked_at<=now()-interval '24 hours')
  );
$$;
