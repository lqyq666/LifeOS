# STARMAP_CHANGE_MODEL — 变化数据结构、来源、生命周期与接口

## 1. 数据结构（迁移 026）

```
identity_claims(user_id, id, text, origin[user_stated|ai_observation],
  confirmed_by_user, status[active|retired], source_refs, revision, …)

identity_change_events(user_id, id, subject_type[theme|experience|identity_claim|link],
  subject_id, transition[created|updated|merged|corrected|retired|paused|resumed|confirmed|revoked|backfilled],
  old_snapshot, new_snapshot, reason, source_refs, impact,
  user_confirmation[none|pending|confirmed|rejected], committed_at)

experience_theme_links + confirmed boolean（候选 vs 用户确认）
```

每条变更事件记录：稳定身份（user+subject）、旧/新快照、原因与来源引用、影响范围、用户确认状态、实际事务提交时间（`committed_at` 由同事务写入）。

## 2. 变更来源与生命周期

| 迁移 | 触发点 | 记录内容 |
|---|---|---|
| theme created/retired | projectUserThemes（含否定退休） | 标题、类型、状态、依据原话 |
| experience created | finishRun 候选入库 | 已发生行动 |
| experience merged | 同事件追述合并 | 结果更新+连线转 correction |
| link confirmed/revoked | `/api/theme-links/:exp/:theme/actions` | 用户裁决 |
| identity_claim created | 用户自述投影 | 原话与来源 |

生命周期规则：更正→重命名（用户改名锁定）；否定/遗忘/拒绝→退休+连线失效+遗忘原话清除；退休主题不被历史回放复活；**没有实质变化不生成事件**。

## 3. 接口

- `POST /api/theme-links/:experienceId/:themeId/actions` `{requestId, action: confirm|revoke}` — 幂等+修订校验；裁决同步变更事件。
- `POST /api/themes/:id/actions` — pin/unpin/rename(锁定标题)/pause/resume/revoke（沿用）。
- `/api/cognition` 图负载新增：self 节点 `identityAccepted/identityObservations`、连线 `confirmed`、`changeEvents[]`（时间轴）。
- 模型上下文：`readStarMapContext()`（信任边界见 DESIGN 文档）注入**同一轮**调用的 user prompt `starMap` 字段；`currentUserFocus` 携带经归属校验的 theme/experience 身份。

## 4. 快照一致性

引擎在构建 prompt 时捕获 `staged.starMapSnapshot=[{id,revision}]`；`finishRun` 事务内 `assertStarMapSnapshot` 复核，不一致 → 409 `STARMAP_SNAPSHOT_INVALIDATED`，整轮回滚可安全重试。
