-- G3：时间轴前后差异要素——保留的未知与下一步影响（无来源则空，不编造）。
ALTER TABLE identity_change_events ADD COLUMN IF NOT EXISTS unknowns text NOT NULL DEFAULT '' CHECK (length(unknowns) <= 400);
ALTER TABLE identity_change_events ADD COLUMN IF NOT EXISTS next_step text NOT NULL DEFAULT '' CHECK (length(next_step) <= 400);
