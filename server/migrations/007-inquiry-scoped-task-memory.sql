ALTER TABLE memory_items
  ADD COLUMN task_inquiry_id uuid,
  ADD COLUMN task_conversation_id uuid;

UPDATE memory_items
SET task_conversation_id = (source_refs->0->>'conversationId')::uuid
WHERE kind='fact'
  AND scope='task'
  AND task_inquiry_id IS NULL
  AND task_conversation_id IS NULL
  AND source_refs->0->>'type'='message'
  AND source_refs->0->>'conversationId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

WITH inquiry_matches AS (
  SELECT DISTINCT m.id, i.id AS inquiry_id
  FROM memory_items m
  JOIN campus_inquiries i ON i.user_id=m.user_id AND i.conversation_id=m.task_conversation_id
  WHERE m.kind='fact'
    AND m.scope='task'
    AND m.task_inquiry_id IS NULL
    AND m.source_refs->0->>'type'='message'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(i.payload->'studentContext') AS fact(value)
      WHERE fact.value->'source'->>'type'='message'
        AND fact.value->'source'->>'id'=m.source_refs->0->>'messageId'
    )
), unambiguous_inquiries AS (
  SELECT id, min(inquiry_id::text)::uuid AS inquiry_id
  FROM inquiry_matches
  GROUP BY id
  HAVING count(*)=1
)
UPDATE memory_items m
SET task_inquiry_id=u.inquiry_id, task_conversation_id=NULL
FROM unambiguous_inquiries u
WHERE m.id=u.id;

ALTER TABLE memory_items
  ADD CONSTRAINT memory_task_inquiry_owner_fk
    FOREIGN KEY (user_id,task_inquiry_id) REFERENCES campus_inquiries(user_id,id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT memory_task_conversation_owner_fk
    FOREIGN KEY (user_id,task_conversation_id) REFERENCES conversations(user_id,id) ON DELETE CASCADE NOT VALID;

DROP INDEX memory_one_current_fact;

CREATE UNIQUE INDEX memory_one_current_user_fact
  ON memory_items(user_id,key)
  WHERE kind='fact' AND scope='user' AND status IN ('active','unknown','declined');

CREATE UNIQUE INDEX memory_one_current_inquiry_task_fact
  ON memory_items(user_id,key,COALESCE(task_type,''),task_inquiry_id)
  WHERE kind='fact' AND scope='task' AND task_inquiry_id IS NOT NULL AND status IN ('active','unknown','declined');

CREATE UNIQUE INDEX memory_one_current_conversation_task_fact
  ON memory_items(user_id,key,COALESCE(task_type,''),task_conversation_id)
  WHERE kind='fact' AND scope='task' AND task_inquiry_id IS NULL AND task_conversation_id IS NOT NULL AND status IN ('active','unknown','declined');

CREATE UNIQUE INDEX memory_one_current_legacy_task_fact
  ON memory_items(user_id,key,COALESCE(task_type,''))
  WHERE kind='fact' AND scope='task' AND task_inquiry_id IS NULL AND task_conversation_id IS NULL AND status IN ('active','unknown','declined');
