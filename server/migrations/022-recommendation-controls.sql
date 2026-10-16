-- P6 closeout fix 2: durable, cross-session distinction between pause_use and
-- stop_recommend. pause_use sets the growth item to 'paused' (data kept, out
-- of the evidence set). stop_recommend keeps the fact ACTIVE for
-- understanding and records a user-scoped recommendation boundary here: the
-- account's assistants must not proactively recommend or push that matter
-- again until the user explicitly resumes it.
CREATE TABLE growth_recommendation_controls (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('stopped','resumed')),
  revision integer NOT NULL CHECK (revision > 0),
  source_conversation_id uuid,
  source_message_id uuid,
  source_quote text NOT NULL DEFAULT '',
  origin_request_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id),
  FOREIGN KEY (user_id,item_id) REFERENCES growth_items(user_id,id),
  FOREIGN KEY (user_id,origin_request_id) REFERENCES runs(user_id,request_id),
  FOREIGN KEY (user_id,source_conversation_id,source_message_id)
    REFERENCES messages(user_id,conversation_id,id)
);
CREATE INDEX growth_recommendation_controls_stopped
  ON growth_recommendation_controls(user_id,item_id)
  WHERE state='stopped';
