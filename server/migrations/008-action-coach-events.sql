-- Additive V1.3 workspace records. Apply/recover in an isolated database first.
CREATE TABLE coach_source_withdrawals (
  user_id text NOT NULL,
  message_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  reason text NOT NULL CHECK(reason IN ('corrected','forgotten')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,message_id),
  FOREIGN KEY(user_id,conversation_id,message_id) REFERENCES messages(user_id,conversation_id,id) ON DELETE CASCADE
);
CREATE TABLE coach_events (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  conversation_id uuid NOT NULL,
  title text NOT NULL,
  title_source jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','forgotten')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,id),
  FOREIGN KEY(user_id,conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE
);
CREATE INDEX coach_events_owner_time ON coach_events(user_id,updated_at DESC,id);
CREATE TABLE coach_current (
  user_id text NOT NULL,
  conversation_id uuid NOT NULL,
  event_id uuid NOT NULL,
  PRIMARY KEY(user_id,conversation_id),
  FOREIGN KEY(user_id,conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY(user_id,event_id) REFERENCES coach_events(user_id,id) ON DELETE CASCADE
);
CREATE TABLE coach_event_revisions (
  user_id text NOT NULL,
  event_id uuid NOT NULL,
  revision integer NOT NULL CHECK(revision > 0),
  generation integer NOT NULL CHECK(generation > 0),
  request_id uuid NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,event_id,revision),
  FOREIGN KEY(user_id,event_id) REFERENCES coach_events(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY(user_id,request_id) REFERENCES runs(user_id,request_id) ON DELETE CASCADE
);
CREATE TABLE coach_nodes (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  event_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  kind text NOT NULL CHECK(kind IN ('fact','feeling','user_interpretation','unknown')),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','resolved','withdrawn')),
  content text,
  source jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,event_id,id),
  FOREIGN KEY(user_id,event_id) REFERENCES coach_events(user_id,id) ON DELETE CASCADE,
  CHECK((status='withdrawn' AND content IS NULL AND source IS NULL) OR (status<>'withdrawn' AND content IS NOT NULL))
);
CREATE INDEX coach_nodes_event ON coach_nodes(user_id,event_id,created_at,id);
CREATE TABLE coach_actions (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  event_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK(revision > 0),
  status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','closed','stale')),
  draft jsonb,
  source_message_ids uuid[] NOT NULL,
  closed_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,event_id,id),
  FOREIGN KEY(user_id,event_id) REFERENCES coach_events(user_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX coach_one_proposed_action ON coach_actions(user_id,event_id) WHERE status='proposed';
