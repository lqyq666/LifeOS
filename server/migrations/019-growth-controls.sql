CREATE TABLE growth_direction_controls (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN (
    'employment','postgraduate_recommendation','postgraduate_exam',
    'public_service','entrepreneurship','overseas_study','undergraduate_upgrade'
  )),
  state text NOT NULL CHECK (state IN ('paused','enabled')),
  revision integer NOT NULL CHECK (revision > 0),
  source_conversation_id uuid,
  source_message_id uuid,
  source_redacted boolean NOT NULL DEFAULT false,
  source_quote text NOT NULL CHECK (length(source_quote) BETWEEN 1 AND 8000),
  origin_request_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,scope),
  FOREIGN KEY (user_id,origin_request_id) REFERENCES runs(user_id,request_id),
  FOREIGN KEY (user_id,source_conversation_id,source_message_id)
    REFERENCES messages(user_id,conversation_id,id),
  CHECK ((source_redacted AND source_message_id IS NULL AND source_conversation_id IS NULL)
      OR (NOT source_redacted AND source_message_id IS NOT NULL AND source_conversation_id IS NOT NULL))
);
CREATE TABLE growth_direction_control_revisions (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  scope text NOT NULL,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  origin_request_id uuid NOT NULL,
  PRIMARY KEY (user_id,scope,revision),
  FOREIGN KEY (user_id,origin_request_id) REFERENCES runs(user_id,request_id)
);
