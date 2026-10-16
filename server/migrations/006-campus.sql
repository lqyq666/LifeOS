CREATE TABLE campus_inquiries (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  conversation_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
  payload jsonb NOT NULL,
  stale boolean NOT NULL DEFAULT false,
  stale_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id),
  FOREIGN KEY(user_id,conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE
);
CREATE TABLE campus_current (
  user_id text NOT NULL,
  conversation_id uuid NOT NULL,
  inquiry_id uuid,
  PRIMARY KEY(user_id,conversation_id),
  FOREIGN KEY(user_id,conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY(user_id,inquiry_id) REFERENCES campus_inquiries(user_id,id)
);
CREATE TABLE campus_revisions (
  user_id text NOT NULL,
  inquiry_id uuid NOT NULL,
  revision integer NOT NULL,
  action text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,inquiry_id,revision),
  FOREIGN KEY(user_id,inquiry_id) REFERENCES campus_inquiries(user_id,id) ON DELETE CASCADE
);
CREATE TABLE campus_knowledge (
  id uuid PRIMARY KEY,
  revision integer NOT NULL CHECK(revision>0),
  kind text NOT NULL CHECK(kind IN ('method','case','policy')),
  status text NOT NULL CHECK(status IN ('verified','unverified','revoked')),
  synthetic boolean NOT NULL DEFAULT false,
  valid_until timestamptz,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE campus_knowledge_revisions (
  id uuid NOT NULL REFERENCES campus_knowledge(id),
  revision integer NOT NULL,
  snapshot jsonb NOT NULL,
  PRIMARY KEY(id,revision)
);
CREATE TABLE campus_dependencies (
  user_id text NOT NULL,
  inquiry_id uuid NOT NULL,
  source_type text NOT NULL CHECK(source_type IN ('message','memory','experience','knowledge')),
  source_id uuid NOT NULL,
  source_revision integer NOT NULL,
  PRIMARY KEY(user_id,inquiry_id,source_type,source_id),
  FOREIGN KEY(user_id,inquiry_id) REFERENCES campus_inquiries(user_id,id) ON DELETE CASCADE
);
CREATE INDEX campus_inquiry_user ON campus_inquiries(user_id,updated_at DESC);
CREATE INDEX campus_dependency_source ON campus_dependencies(source_type,source_id);

CREATE FUNCTION campus_invalidate_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_kind text; source_owner text;
BEGIN
  IF TG_TABLE_NAME='memory_items' THEN source_kind:='memory'; source_owner:=NEW.user_id;
  ELSIF TG_TABLE_NAME='experiences' THEN source_kind:='experience'; source_owner:=NEW.user_id;
  ELSE source_kind:='knowledge'; source_owner:=NULL;
  END IF;
  IF OLD.revision=NEW.revision AND OLD.status=NEW.status THEN RETURN NEW; END IF;
  WITH changed AS (
    UPDATE campus_inquiries i SET stale=true,stale_reason=source_kind||'_changed',revision=i.revision+1,updated_at=now()
    WHERE (source_owner IS NULL OR i.user_id=source_owner) AND EXISTS (
      SELECT 1 FROM campus_dependencies d WHERE d.user_id=i.user_id AND d.inquiry_id=i.id
      AND d.source_type=source_kind AND d.source_id=NEW.id
      AND NOT(source_kind='experience' AND OLD.status='candidate' AND NEW.status='confirmed' AND d.source_revision=0))
    RETURNING i.*
  ) INSERT INTO campus_revisions(user_id,inquiry_id,revision,action,snapshot)
    SELECT user_id,id,revision,'source_invalidated',to_jsonb(changed) FROM changed;
  RETURN NEW;
END $$;
CREATE TRIGGER campus_memory_changed AFTER UPDATE ON memory_items FOR EACH ROW EXECUTE FUNCTION campus_invalidate_source();
CREATE TRIGGER campus_experience_changed AFTER UPDATE ON experiences FOR EACH ROW EXECUTE FUNCTION campus_invalidate_source();
CREATE TRIGGER campus_knowledge_changed AFTER UPDATE ON campus_knowledge FOR EACH ROW EXECUTE FUNCTION campus_invalidate_source();
