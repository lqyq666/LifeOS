# P6 收作交付报告 — 控制完整闭环、正确对象与真实远端链（GLM_CLOSEOUT）

工单：GLM_P6_CLOSEOUT.md（2026-10-08，GLM 全程，不转交）。基线 `e6097cb`；AUDIT_FINDINGS.md F01–F06 未达项续作。**WIP_NOT_READY 维持**（D 关口 20 样本同版验收未达，见文末）。

## 工单问题回答

**控制是否从范围确认到执行、提交、可查回执全部真实生效？** 是——隔离库实测：聊天中的遗忘/暂停使用/停止推荐意图只在引擎内 **staging**，实际提交移入 `finishRun` 事务（`server/memory-controls.ts` + 迁移 021）：控制与回复同 commit/同回滚；回执 `stateChange.memoryControl` 由真实写入派生；`pause_use/stop_recommend` 写入真实 `paused` 边界（数据保留、退出证据集、`growthBoundaryContext` 可读回），不再是 `executed:false` 审计备注。**记不清不删**（认知遗漏零操作）、**否定不删也不暂停**（N02/N03 修复）。**歧义确认卡全链贯通**：持久表 `growth_control_requests` + GET/POST API + 前端 `ControlCards` + SSE 回执 + 新会话可读 + 跨账号不可见 + 已决不可重决。**完整事务终点补齐**：旧"正向 forget 测试无 finishRun"与"异常测试仅布尔判断"已替换为 `startRun→engine→finishRun→runStatus(GET)→listConversations(刷新)→新会话` 全路径测试，含真实并发冲突（外部 revision 变更→整轮 409 回滚、记录原样、无助手消息）、控制后继失败（早期回执仍可读、效果持续）、取消/断线零写入、同 requestId 重放幂等（重放不产生第二个 growth_operations）。

**更正是否改对对象？** 是——T6 复现测试：growthAll 仅有"还不确定"项时，海报更正被**转为有据 create**（quote=更正原话），不确定项 revision/text/status 全部不变；模型选错已授权 ID 时**重定向到评分目标**；评分目标存在且一致时保持。审计新增 `correction_target_normalized`（modelTarget/scoredTarget/finalTarget/mode）。

**当前新机会不再被旧问题覆盖？** 主题分组（`splitGrowthByCurrentTopic`）：剔除时间/数量功能字后按主题字符覆盖度分组（T9 混淆轴正是"每周/小时/数字"），`growth`=当前事项记录、`growthBackground`=其余（两组都进提示词），系统提示明确"旧经历仅作比较与核对，不得把旧经历的对象、时长或内容当作当前机会的答案，也不得因未记录就断定本人没有相关经验"。科研/课程、两社团词汇对照验证非海报特例。目标/方向/约束/优先级/决策/反馈类常驻当前组（长期框架）。

**受控本地 miss 的真实 Coze 远端集成？** 是——诊断开关 `LIFEOS_DIAG_LOCAL_KNOWLEDGE_MISS`（默认关、审计标注 `controlledIntegrationOnly`）：受控阶段两个场景同 requestId 全链：`local_knowledge_miss`→**真实网络** code_workflow 调用→注册表映射（verified=2: guide-portfolio-evidence + guide-intern-first-contact；verified=1: guide-exam-course-conflict）→回复采用指南方法（三行法/紧迫度排序）→**反馈轮真实保存**（"按三行法整理了第一件作品，发现还缺'被谁使用'"）。自然阶段：未覆盖主题（留学推荐信）自然本地 miss→远端 4 命中全部未核验→**不引用不硬答**（诚实边界）；本地命中控制轮审计证明**零 Coze 访问**。8 份方法卡从原始创建 prompt 逐字重建，manifest sha256 绑定（`guides-manifest.json`），注册表对实时远端标题重审。

**主 Skill 与扣子原生 UI？** 主 Skill v1.2.0 会话内真实激活并按其契约执行（指纹→产品对话→回执→状态读取→**新会话携带 3/3 事实**，记忆开关由合成学生本人经 API 开启）。扣子侧：已授权浏览器会话（已登录 RootUser_2129409665，**未出现扫码页故不声称扫码阻塞**）；实际打开 www.coze.cn/skills 技能页签与 code.coze.cn 技能入口；IAB 不支持 OS 文件上传（精确能力边界），改走官方文档支持的对话式创建：SKILL.md 原文逐字落盘、**安全校验通过**（无密钥/无凭证/无危险命令）、`package_skill` 打包 5.2K、**预览自动测试正确复述触发条件**；发布到"我的技能"库未完成（如实）。既有两工作流部署未动。

## A 关口明细（`tests/backend/forget-intent.test.ts` 重写 + `memory-control-http.test.ts`）

N01–N08 全过 + 未见表达（记不清/别拿…当依据/不用保留/帮我忘记 vs 我忘记了区分/问句/假设/引语）；N08 修复：控制子句自带对象时禁用整段消息加权，纯代词只解析**最近前句**。同请求多控制子句：首个唯一定位执行，其余转确认。幂等：操作 ID=（run请求,对象,操作）确定性派生，重复提交绑定 `growth_operations` 重放。日志不存被删原文（回执只带 itemId/revision/boundary）。

## B 关口明细（`correction-target.test.ts`、`growth-topic-split.test.ts`）

converted_create / redirected / kept 三模式 + 快照键与 usedGrowthRefs 仍描述全量授权集（子集只缩模型阅读）。引擎测试断言提示词分组落位 + 系统规则文本。

## 附加修复（C2 期间发现的真实缺陷）

模型在无安排请求的轮次输出 `weeklyPlan` 导致整轮 `WEEKLY_PLAN_BASIS_INVALID`（连续 3 次真实复现）→ 无 weekly-plan 义务时丢弃该字段并记 `weekly_plan_unsolicited_dropped`（有义务时完整契约不变）。

## 版本、成本与证据

- 代码：`server/forget-intent.ts`、`memory-controls.ts`（新）、`growth.ts`（applyGrowthAction 抽取）、`store.ts`、`turn-engine.ts`、`turn-prompt.ts`、`growth-selection.ts`、`http.ts`、`config.ts`、迁移 021；前端 `ControlCards.tsx`（新）+ `ConversationPage.tsx` + CSS。
- 隔离测试：forget-intent（重写）、memory-control-http、correction-target、growth-topic-split、coze-controlled-miss 全过；**全套件 61 文件通过**；前端 tsc+build 通过。
- 真实调用：20 次（受控 9 + 自然 6 + Skill 激活流 5），**全部登记唯一账本**（收据 1376，¥0.0562，currentGrant 余 ¥15.1218）；探针/扣子平台动作单列于 C2 记录，未入模型账本。
- 证据：`.local/campus-growth/p6-closeout-c1-{controlled,natural,controlled-retry-portfolio-intern}-traces.json`、`p6-closeout-c2-skill-activation.json`、`p6-closeout-c2-coze-ui.json`、`guides-manifest.json`；throwaway 库 3 个（审计源，未清理待确认）。
- 失败如实：portfolio 首次 ask `COACH_CITATION_INVALID`（重试过）；本地命中控制轮 2 次 `COACH_CITATION_INVALID`（**审计仍证明零 Coze 访问**；既有引用契约方差，非本批改动引入）；C2 激活流 2 次 `WEEKLY_PLAN_BASIS_INVALID`（促成修复后通过）。

## 未达项（WIP_NOT_READY）

1. D 关口：同版冻结 ≥20 普通样本、p50≤3s/p95≤5s/完整 p95≤15s、L1/L2/L3 连续链与记忆关闭对照未跑。
2. 扣子技能发布到"我的技能"库（项目内创建+打包+预览已完成）。
3. `COACH_CITATION_INVALID` 模型方差（真实模型引用契约）未定位根因（非本批引入，2+2 次如实记录）。
4. p95 速度目标沿用上一链数据（p50 3046ms/p95 5374ms/完整 9858ms），本批改动未复测。
