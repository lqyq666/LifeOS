-- A derived index only: no duplicate raw text, no separate database or platform.
CREATE TABLE coach_semantic_index (
  user_id text NOT NULL,
  event_id uuid NOT NULL,
  revision integer NOT NULL,
  generation integer NOT NULL,
  signature text NOT NULL,
  part integer NOT NULL,
  embedding real[] NOT NULL CHECK(array_length(embedding,1)=512),
  PRIMARY KEY(user_id,event_id,part),
  FOREIGN KEY(user_id,event_id) REFERENCES coach_events(user_id,id) ON DELETE CASCADE
);
CREATE TABLE coach_index_jobs (
  user_id text NOT NULL,
  event_id uuid NOT NULL,
  revision integer NOT NULL,
  generation integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','failed')),
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  PRIMARY KEY(user_id,event_id,revision,generation),
  FOREIGN KEY(user_id,event_id) REFERENCES coach_events(user_id,id) ON DELETE CASCADE
);
CREATE FUNCTION coach_queue_semantic_index() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM coach_semantic_index WHERE user_id=NEW.user_id AND event_id=NEW.id;
  DELETE FROM coach_index_jobs WHERE user_id=NEW.user_id AND event_id=NEW.id;
  IF NEW.status='active' THEN
    INSERT INTO coach_index_jobs(user_id,event_id,revision,generation) VALUES(NEW.user_id,NEW.id,NEW.revision,NEW.generation);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER coach_event_index_change AFTER INSERT OR UPDATE OF revision,generation,status ON coach_events
  FOR EACH ROW EXECUTE FUNCTION coach_queue_semantic_index();
INSERT INTO coach_index_jobs(user_id,event_id,revision,generation)
  SELECT user_id,id,revision,generation FROM coach_events WHERE status='active';
