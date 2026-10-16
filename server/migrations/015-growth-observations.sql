ALTER TABLE growth_items ADD COLUMN limitation text NOT NULL DEFAULT '' CHECK (length(limitation) <= 1200);
ALTER TABLE growth_items ADD COLUMN progress_state text CHECK (progress_state IN ('unattempted','attempted','stuck','completed','unknown'));
ALTER TABLE growth_items ADD COLUMN origin_request_id uuid;
ALTER TABLE growth_items ADD CONSTRAINT growth_origin_run FOREIGN KEY (user_id,origin_request_id) REFERENCES runs(user_id,request_id);
CREATE TABLE growth_source_suppressions (
  user_id text NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid NOT NULL,
  quote text NOT NULL CHECK (length(quote) BETWEEN 1 AND 8000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,message_id,quote),
  FOREIGN KEY (user_id,conversation_id,message_id) REFERENCES messages(user_id,conversation_id,id) ON DELETE CASCADE
);
