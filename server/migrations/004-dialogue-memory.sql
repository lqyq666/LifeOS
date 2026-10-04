CREATE TABLE user_memory_settings (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE dialogue_states (
  user_id text NOT NULL,
  conversation_id uuid NOT NULL,
  state jsonb NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, conversation_id),
  FOREIGN KEY (user_id, conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE
);

CREATE TABLE memory_items (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('fact','pattern_candidate')),
  key text CHECK (key IN ('education.school','education.major','education.stage','skills','currentConcern','taskGoal','availableTime','taskConstraints','priorAttempts','optionsUnderConsideration')),
  value jsonb,
  assertion text NOT NULL CHECK (assertion IN ('user_reported','user_edit','user_self_reported_pattern','system_pattern_candidate')),
  scope text NOT NULL CHECK (scope IN ('user','task')),
  task_type text CHECK (task_type IN ('university_direction','study_project','internship','personal_choice')),
  source_refs jsonb NOT NULL CHECK (jsonb_typeof(source_refs)='array'),
  observed_at timestamptz NOT NULL,
  valid_from timestamptz,
  valid_until timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('active','unknown','declined','pending','accepted','rejected','superseded','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id,id),
  CHECK ((kind='fact' AND key IS NOT NULL) OR (kind='pattern_candidate' AND key IS NULL)),
  CHECK (status NOT IN ('active','unknown','declined') OR kind='fact'),
  CHECK (status NOT IN ('pending','accepted','rejected') OR kind='pattern_candidate')
);
CREATE UNIQUE INDEX memory_one_current_fact ON memory_items(user_id,key,COALESCE(task_type,'')) WHERE kind='fact' AND status IN ('active','unknown','declined');
CREATE INDEX memory_items_profile ON memory_items(user_id,kind,status,updated_at DESC);

CREATE TABLE memory_revisions (
  user_id text NOT NULL,
  memory_item_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  action text NOT NULL CHECK (action IN ('create','correct','forget','accept','reject','supersede','invalidate')),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,memory_item_id,revision),
  FOREIGN KEY (user_id,memory_item_id) REFERENCES memory_items(user_id,id) ON DELETE CASCADE
);

CREATE TABLE memory_suppressions (
  user_id text NOT NULL,
  source_conversation_id uuid NOT NULL,
  source_message_id uuid NOT NULL,
  key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,source_conversation_id,source_message_id,key),
  FOREIGN KEY (user_id,source_conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY (user_id,source_conversation_id,source_message_id) REFERENCES messages(user_id,conversation_id,id) ON DELETE CASCADE
);

CREATE TABLE memory_review_runs (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','completed','failed','cancelled')),
  response jsonb,
  usage jsonb,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (user_id,request_id),
  FOREIGN KEY (user_id,conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE
);
CREATE INDEX memory_review_runs_conversation ON memory_review_runs(user_id,conversation_id,started_at DESC);
