-- P6 closeout A2b: durable ambiguity confirmations for chat-derived memory
-- controls (forget / pause_use / stop_recommend). A pending row is the
-- recoverable request record the confirmation card reads from — in this
-- conversation and in a new session — until the user confirms one candidate
-- or cancels. Executed unique-target controls never pass through here; they
-- commit in the run's own transaction and surface through the run receipt.
CREATE TABLE growth_control_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  source_message_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('forget','pause_use','stop_recommend')),
  clause_text text NOT NULL CHECK (length(clause_text) BETWEEN 1 AND 8000),
  candidates jsonb NOT NULL CHECK (jsonb_typeof(candidates)='array'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  decided_at timestamptz,
  outcome jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, request_id),
  FOREIGN KEY (user_id,request_id) REFERENCES runs(user_id,request_id),
  FOREIGN KEY (user_id,conversation_id) REFERENCES conversations(user_id,id),
  FOREIGN KEY (user_id,conversation_id,source_message_id)
    REFERENCES messages(user_id,conversation_id,id)
);
