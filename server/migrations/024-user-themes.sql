-- 星图与聊天一体化：用户的成长主题是每人动态的，不是全站固定标签。
-- user_themes 是 growth_items 已提交事实之上的投影层（目标/阶段追求/重视点/兴趣探索），
-- 版本、来源、用户置顶/编辑状态全部持久化在账号下；experience_theme_links 记录
-- 经历与主题的关系类型与依据。旧的三个 value_id 通道保留为内部辅助分类，兼容读取。
CREATE TABLE IF NOT EXISTS user_themes (
  user_id text NOT NULL,
  id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) <= 60),
  kind text NOT NULL CHECK (kind IN ('goal','pursuit','valued_point','interest')),
  status text NOT NULL CHECK (status IN ('active','pending','paused','retired')),
  origin text NOT NULL CHECK (origin IN ('user_stated','model_proposed')),
  summary text NOT NULL DEFAULT '',
  source_refs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(source_refs)='array'),
  pinned boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
CREATE TABLE IF NOT EXISTS experience_theme_links (
  user_id text NOT NULL,
  experience_id uuid NOT NULL,
  theme_id uuid NOT NULL,
  relation text NOT NULL CHECK (relation IN ('exploring','acting_toward','partial_evidence','constraint','correction')),
  reason text NOT NULL CHECK (length(reason) <= 2000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, experience_id, theme_id)
);
CREATE INDEX IF NOT EXISTS experience_theme_links_theme_idx ON experience_theme_links (user_id, theme_id) WHERE status = 'active';
