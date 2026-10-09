# STARMAP_IDENTITY_DESIGN — 视觉层级、信息来源与身份边界

> 基线：650b086 → 本轮（身份层/信任边界/变更模型）。全部 GLM 开发，未 push。

## 1. 视觉层级（保留原 Three.js 渲染系统）

| 层级 | 内容 | 数据来源 | 视觉规则 |
|---|---|---|---|
| 中央「当前的我」 | 用户认可的描述 / 正在探索的身份可能 / 有证据待核对的观察 | `identity_claims`（自述=认可；AI 观察=待核对；当前不自动生成 AI 观察，组保持空白） | 文字分组渲染在 self 节点 description；**亮度/大小不表达等级** |
| 内轨 | 0–3 个当前主题（追求=进行中；探索=待核对） | `user_themes`（growth 已提交事实投影） | 每主题必须带 HAS_VALUE 根连线；不足 3 不强制 |
| 中外轨 | 经历=真实行动/结果/反馈 | `experiences`（确认态） | 沿用原经历节点与轨道 |
| 连线 | acting_toward / exploring / partial_evidence / constraint / correction | `experience_theme_links` | 已确认（实线语义）与待核对（候选标记）区分；`confirmed` 字段驱动 |
| 时间轴 | 过去—现在—下一步 | `identity_change_events`（真实提交的迁移） | 纯 DOM 组件；暂缓/放弃渲染为中性变化，不是失败 |

四视角（思维认知/行动精力/关系意义/发展创造）作为**可选解释框架**：当前通过路径同义词锚表间接映射（如 科研/竞赛→思维，兼职/交付→行动），无来源领域保持空白，不生成评价、不打等级、不做人格画像。手机 390px：时间轴/面板自适应；`prefers-reduced-motion` 禁用动效。

## 2. 身份边界（§3 A–E 分类）

| 类别 | 存储 | 成为身份的条件 |
|---|---|---|
| A 用户自我认同 | `identity_claims` origin=user_stated | 用户亲口自述（“我是那种…”句式锚定原话）；可确认/否定/撤销 |
| B 当前追求 | `user_themes`（pursuit/exploration + active/pending/paused/retired） | 决定=active 追求；考虑/未来=exploration 待核对；否定/第三方/假设永不升级 |
| C 现实经历 | `experiences`（+coach_events 过程） | 已发生行动+结果+反馈；团队成绩与本人贡献由 growth 通道既有规则区分 |
| D AI 观察 | `identity_claims` origin=ai_observation（预留） | **默认待核对、不自动生成**；须有依赖来源并经用户确认 |
| E 变化事件 | `identity_change_events` | 只在真实迁移时记录；无变化不生成 |

**明确不做**：人格测试、发展等级、优劣排序、虚构心理画像。主题标题≠身份：身份只有用户自述（A 类）与经确认的观察（D 类）。

## 3. 信任边界（readStarMapContext，全部有隔离 DB 测试）

- memory 关闭 → 星图个人事实完全不进入模型上下文（与 memory 控制共用同一开关）；
- 连线只取 `status='active'`；主题/经历/来源 growth 事实必须仍有效；经历原话必须仍在来源消息中；
- `candidate:!confirmed` 真实区分候选与已确认；撤销的连线退出一切决策；
- 跨账号隔离；生成→提交期间主题被并发修改 → `STARMAP_SNAPSHOT_INVALIDATED`(409) 阻止落盘。
