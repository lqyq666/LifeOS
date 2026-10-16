-- Additive migration: keep original cards/revisions and citation identities.
CREATE TABLE kb_sources (
 source_id text NOT NULL, revision integer NOT NULL CHECK(revision>0),
 source_group text NOT NULL, canonical_url text NOT NULL,
 status text NOT NULL CHECK(status IN ('body_accessible','unavailable','retired')),
 content_hash text, payload jsonb NOT NULL,
 PRIMARY KEY(source_id,revision)
);
CREATE TABLE kb_evidence (
 evidence_id text PRIMARY KEY, source_id text NOT NULL, source_revision integer NOT NULL,
 content_hash text NOT NULL, payload jsonb NOT NULL,
 FOREIGN KEY(source_id,source_revision) REFERENCES kb_sources(source_id,revision)
);
CREATE TABLE kb_aliases (
 alias text PRIMARY KEY, guide_id uuid NOT NULL REFERENCES campus_knowledge(id),
 reason text NOT NULL
);
CREATE TABLE kb_index_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), epoch bigint NOT NULL DEFAULT 0,
 signature text, indexed_epoch bigint, corpus_hash text
);
INSERT INTO kb_index_state(singleton) VALUES(true);
CREATE TABLE kb_segments (
 guide_id uuid NOT NULL, revision integer NOT NULL, signature text NOT NULL,
 part text NOT NULL, content_hash text NOT NULL, body text NOT NULL, evidence_ids jsonb NOT NULL,
 embedding real[] NOT NULL CHECK(array_length(embedding,1)=512),
 PRIMARY KEY(guide_id,revision,signature,part,content_hash),
 FOREIGN KEY(guide_id,revision) REFERENCES campus_knowledge_revisions(id,revision) ON DELETE CASCADE
);
CREATE FUNCTION kb_index_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN UPDATE kb_index_state SET epoch=epoch+1; RETURN NULL; END $$;
CREATE TRIGGER kb_knowledge_dirty AFTER INSERT OR UPDATE OR DELETE ON campus_knowledge FOR EACH STATEMENT EXECUTE FUNCTION kb_index_dirty();
CREATE TRIGGER kb_sources_dirty AFTER INSERT OR UPDATE OR DELETE ON kb_sources FOR EACH STATEMENT EXECUTE FUNCTION kb_index_dirty();
CREATE TRIGGER kb_aliases_dirty AFTER INSERT OR UPDATE OR DELETE ON kb_aliases FOR EACH STATEMENT EXECUTE FUNCTION kb_index_dirty();
CREATE FUNCTION kb_knowledge_current(card jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT (card ? 'guide') OR (
   card#>>'{guide,reviewStatus}'='approved'
   AND jsonb_typeof(card#>'{guide,review,sourceRevisions}')='object'
   AND card#>'{guide,review,sourceRevisions}'<>'{}'::jsonb
   AND NOT EXISTS (
    SELECT 1 FROM jsonb_each_text(card#>'{guide,review,sourceRevisions}') ref
    LEFT JOIN kb_sources s ON s.source_id=ref.key AND s.revision=ref.value::integer
    WHERE s.source_id IS NULL OR s.status<>'body_accessible'
   )
 );
$$;
CREATE OR REPLACE FUNCTION coach_knowledge_refs_valid(refs jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements(refs) ref
  LEFT JOIN campus_knowledge k ON k.id=(ref->>'sourceId')::uuid
  WHERE k.id IS NULL OR k.revision<>(ref->>'revision')::integer OR k.status<>'verified'
    OR (k.valid_until IS NOT NULL AND k.valid_until<=now())
    OR (k.synthetic AND current_database() !~ '^lifeos_dialogue_(test|live)_')
    OR NOT official_knowledge_current(k.payload) OR NOT kb_knowledge_current(k.payload)
 );
$$;
-- Public methods never become user facts. The report is anchored to an owned
-- user message and event; suggestion is the only assistant-origin state.
ALTER TABLE messages ADD CONSTRAINT messages_user_id_id_unique UNIQUE(user_id,id);
CREATE TABLE kb_guide_usage (
 id uuid PRIMARY KEY, user_id text NOT NULL, event_id uuid NOT NULL,
 guide_id uuid NOT NULL, revision integer NOT NULL, branch text NOT NULL, step_id text NOT NULL,
 status text NOT NULL CHECK(status IN ('suggested','accepted','attempted','waiting_result','completed','declined','blocked')),
 source_message_id uuid, source_quote text,
 request_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(user_id,event_id) REFERENCES coach_events(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(guide_id,revision) REFERENCES campus_knowledge_revisions(id,revision),
 FOREIGN KEY(user_id,source_message_id) REFERENCES messages(user_id,id) ON DELETE CASCADE,
 UNIQUE(user_id,request_id,guide_id),
 CHECK(status='suggested' OR (source_message_id IS NOT NULL AND length(source_quote)>0))
);
CREATE INDEX kb_usage_event ON kb_guide_usage(user_id,event_id,created_at DESC);
