-- P0-2 生命周期约束审计：主题与经历连线补归属与完整性外键（复合键，沿用
-- experiences 的 (user_id,id) 惯例），title_locked 保护用户手动改过的主题
-- 名称不被自动再投影覆盖。向后兼容：既有行取默认值，不丢数据。
ALTER TABLE user_themes ADD COLUMN IF NOT EXISTS title_locked boolean NOT NULL DEFAULT false;
ALTER TABLE experience_theme_links
  DROP CONSTRAINT IF EXISTS experience_theme_links_experience_fk;
ALTER TABLE experience_theme_links
  ADD CONSTRAINT experience_theme_links_experience_fk
  FOREIGN KEY (user_id, experience_id) REFERENCES experiences(user_id, id) ON DELETE CASCADE;
ALTER TABLE experience_theme_links
  DROP CONSTRAINT IF EXISTS experience_theme_links_theme_fk;
ALTER TABLE experience_theme_links
  ADD CONSTRAINT experience_theme_links_theme_fk
  FOREIGN KEY (user_id, theme_id) REFERENCES user_themes(user_id, id) ON DELETE CASCADE;
-- P1：主题类型补充“正在探索”（考虑/试试/未来再说），与明确追求区分。
ALTER TABLE user_themes DROP CONSTRAINT IF EXISTS user_themes_kind_check;
ALTER TABLE user_themes ADD CONSTRAINT user_themes_kind_check
  CHECK (kind IN ('goal','pursuit','exploration','valued_point','interest'));
