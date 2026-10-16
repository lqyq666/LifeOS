CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  renamed boolean NOT NULL DEFAULT false,
  pinned boolean NOT NULL DEFAULT false,
  project_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, id)
);
CREATE TABLE messages (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  conversation_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 16000),
  run_request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE,
  UNIQUE (user_id, conversation_id, id)
);
CREATE INDEX messages_context ON messages(user_id,conversation_id,created_at,id);
CREATE TABLE runs (
  user_id text NOT NULL,
  request_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  source_message_id uuid NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','completed','cancelled','failed')),
  expected_version integer NOT NULL CHECK (expected_version >= 0),
  usage jsonb,
  tool_audit jsonb NOT NULL DEFAULT '[]',
  response jsonb,
  error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  PRIMARY KEY (user_id,request_id),
  FOREIGN KEY (user_id,conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY (user_id,conversation_id,source_message_id) REFERENCES messages(user_id,conversation_id,id)
);
CREATE UNIQUE INDEX one_active_run ON runs(user_id,conversation_id) WHERE status='running';
CREATE TABLE decision_versions (
  user_id text NOT NULL,
  conversation_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  request_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,conversation_id,version),
  UNIQUE (user_id,request_id),
  FOREIGN KEY (user_id,conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY (user_id,request_id) REFERENCES runs(user_id,request_id)
);
CREATE TABLE experiences (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  conversation_id uuid NOT NULL,
  source_message_id uuid NOT NULL,
  source_quote text NOT NULL CHECK (length(source_quote) BETWEEN 1 AND 4000),
  request_id uuid NOT NULL,
  content jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('candidate','confirmed','deleted')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  UNIQUE (user_id,id),
  UNIQUE (user_id,source_message_id,source_quote),
  FOREIGN KEY (user_id,conversation_id,source_message_id) REFERENCES messages(user_id,conversation_id,id),
  FOREIGN KEY (user_id,request_id) REFERENCES runs(user_id,request_id)
);
CREATE INDEX experiences_retrieval ON experiences(user_id,status,updated_at);
CREATE TABLE experience_links (
  user_id text NOT NULL,
  experience_id uuid NOT NULL,
  value_id text NOT NULL CHECK (value_id IN ('value-creation','value-autonomy','value-growth')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  disposition text NOT NULL DEFAULT 'proposed' CHECK (disposition IN ('proposed','accepted','edited','rejected')),
  PRIMARY KEY (user_id,experience_id,value_id),
  FOREIGN KEY (user_id,experience_id) REFERENCES experiences(user_id,id) ON DELETE CASCADE
);
CREATE TABLE experience_revisions (
  user_id text NOT NULL,
  experience_id uuid NOT NULL,
  revision integer NOT NULL,
  action text NOT NULL CHECK (action IN ('propose','confirm','correct','delete','review')),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,experience_id,revision),
  FOREIGN KEY (user_id,experience_id) REFERENCES experiences(user_id,id) ON DELETE CASCADE
);
CREATE TABLE user_operations (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,request_id)
);

