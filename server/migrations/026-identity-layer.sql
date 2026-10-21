-- P0 信任边界 + 身份层：主题与经历是“追求/事实”，不是身份本身。
-- identity_claims 只存用户明确的自述认同与有待核对的 AI 观察（复用 growth
-- 事实作权威来源，不另建人格档案）；identity_change_events 记录真实发生的
-- 状态迁移（旧/新、原因、来源、影响、确认状态、提交时间），无变化不生成。
-- experience_theme_links.confirmed 区分系统候选与用户确认的关系。
ALTER TABLE experience_theme_links ADD COLUMN IF NOT EXISTS confirmed boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS identity_claims (
  user_id text NOT NULL,
  id uuid NOT NULL,
  text text NOT NULL CHECK (length(text) <= 400),
  origin text NOT NULL CHECK (origin IN ('user_stated','ai_observation')),
  confirmed_by_user boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('active','retired')),
  source_refs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(source_refs)='array'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS identity_change_events (
  user_id text NOT NULL,
  id uuid NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('theme','experience','identity_claim','link')),
  subject_id text NOT NULL,
  transition text NOT NULL CHECK (transition IN ('created','updated','merged','corrected','retired','paused','resumed','confirmed','revoked','backfilled')),
  old_snapshot jsonb,
  new_snapshot jsonb,
  reason text NOT NULL CHECK (length(reason) <= 500),
  source_refs jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(source_refs)='array'),
  impact text NOT NULL DEFAULT '' CHECK (length(impact) <= 500),
  user_confirmation text NOT NULL DEFAULT 'none' CHECK (user_confirmation IN ('none','pending','confirmed','rejected')),
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS identity_change_events_subject_idx ON identity_change_events (user_id, subject_type, subject_id, committed_at DESC);
