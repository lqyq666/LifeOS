-- Reversible transcript deletion; independently saved profile/experiences remain.
-- Recovery: remove only the owner/conversation tombstone after explicit restoration.
CREATE TABLE deleted_conversations (
 user_id text NOT NULL,
 conversation_id uuid NOT NULL,
 deleted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,conversation_id),
 FOREIGN KEY(user_id,conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE
);
