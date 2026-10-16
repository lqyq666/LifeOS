-- Citation provenance is separate from user facts. No model-supplied URL is authority.
ALTER TABLE coach_actions ADD COLUMN knowledge_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(knowledge_refs)='array');
CREATE TABLE coach_reply_sources (
  user_id text NOT NULL,
  request_id uuid NOT NULL,
  source_id uuid NOT NULL REFERENCES campus_knowledge(id),
  revision integer NOT NULL CHECK(revision>0),
  PRIMARY KEY(user_id,request_id,source_id),
  FOREIGN KEY(user_id,request_id) REFERENCES runs(user_id,request_id) ON DELETE CASCADE
);
CREATE FUNCTION coach_knowledge_refs_valid(refs jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(refs) ref
    LEFT JOIN campus_knowledge k ON k.id=(ref->>'sourceId')::uuid
    WHERE k.id IS NULL OR k.revision<>(ref->>'revision')::integer OR k.status<>'verified'
      OR (k.valid_until IS NOT NULL AND k.valid_until<=now())
      OR (k.synthetic AND current_database() !~ '^lifeos_dialogue_(test|live)_')
  );
$$;
CREATE FUNCTION coach_reply_sources_valid(owner_id text,run_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coach_knowledge_refs_valid(COALESCE(jsonb_agg(jsonb_build_object('sourceId',source_id,'revision',revision)),'[]'::jsonb))
    FROM coach_reply_sources WHERE user_id=owner_id AND request_id=run_id;
$$;
