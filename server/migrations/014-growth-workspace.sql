CREATE TABLE growth_items (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  conversation_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('context','ability','preference','observation','unknown','goal','direction','constraint','priority','decision','feedback')),
  text text NOT NULL CHECK (length(text) <= 4000),
  assertion text NOT NULL CHECK (assertion IN ('user_reported','user_edit','ai_observation','unknown')),
  status text NOT NULL CHECK (status IN ('active','proposed','paused','completed','rejected','forgotten','stale')),
  sources jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(sources)='array'),
  dependencies jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(dependencies)='array'),
  valid_until timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id,id),
  FOREIGN KEY (user_id,conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE
);
CREATE INDEX growth_user_current ON growth_items(user_id,updated_at DESC);
CREATE TABLE growth_revisions (
  user_id text NOT NULL,
  item_id uuid NOT NULL,
  revision integer NOT NULL,
  action text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,item_id,revision),
  FOREIGN KEY (user_id,item_id) REFERENCES growth_items(user_id,id) ON DELETE CASCADE
);
CREATE TABLE growth_operations (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  fingerprint text NOT NULL,
  item_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,request_id),
  FOREIGN KEY (user_id,item_id) REFERENCES growth_items(user_id,id) ON DELETE CASCADE
);
