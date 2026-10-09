-- P2/P3 优化：经历间关联（故事线）+ 提取来源置信度标记。
-- experience_relations 记录两条经历之间的关联（同主题/相似事件/先后关系）。
ALTER TABLE experiences ADD COLUMN IF NOT EXISTS extraction_source text NOT NULL DEFAULT 'model'
  CHECK (extraction_source IN ('model', 'server', 'user'));

CREATE TABLE IF NOT EXISTS experience_relations (
  user_id text NOT NULL,
  from_experience uuid NOT NULL,
  to_experience uuid NOT NULL,
  relation text NOT NULL CHECK (relation IN ('similar', 'follows', 'contradicts')),
  score real NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '' CHECK (length(reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, from_experience, to_experience)
);
CREATE INDEX IF NOT EXISTS experience_relations_from_idx ON experience_relations (user_id, from_experience);
