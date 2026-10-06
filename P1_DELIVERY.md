# P1 交付报告 — LifeOS 个人 AI 伙伴主线批次

工单：GLM_PERSONAL_COMPANION_P1（2026-10-06）。执行者：GLM（开发、测试、平台操作、审查与交付，未转交）。本报告按工单 §4 格式。

## 一段话回答：用户现在能怎样被这个 AI 更充分理解

用户说起一件事时，LifeOS 会先找回与该用户和该事件相关的已有背景（记忆开启时跨会话，关闭时诚实说明边界），从用户原话逐字沉淀个人事实（处境/目标/约束/反馈，带来源与版本），把"AI 推测"与"用户原话"与"未知"分开存放和展示；对没说清的关键经过（对方原需求、约定、实际交付、反馈依据）沿用户实际回答推进追问——同一句"对方没用"在打不开/交付晚/需求不符/仅未回复四种真实经过下走出不同的后续，且无证据时保持未知；明确说明的时间被精确区分为每周固定投入、本周剩余、下周安排三类并进入当轮计划；用户更正、拒绝解释、精确遗忘都会真实改变状态与后续建议。哪些新信息已经会改变帮助：时间预算变更（含 1.5 小时类小数与本周剩余）、目标变更与方向暂停/恢复、团队成果到个人贡献的更正、行动反馈（未做/试过/卡住/完成动作/结果未知）、被拒绝的解释不再复活。

## 实际版本

- 本地：分支 `fix/campus-acceptance-contract-20261006`，起点 `0cc26dd`，本批 6 笔本地提交至 `382071a`（未 push、未合 main、未部署生产）。全量检查：隔离后端 48 文件通过、客户端单测、服务端/客户端类型检查、构建全部通过（日志 `.local/campus-growth/p1-codebatch*-*.log`）。
- 云端参赛：项目 7693388932939300905 部署 commit `5b8a04b`（deployHistoryId 7693588747564335123，Succeeded），入口 https://v8bjn44ynd.coze.site 。
- 线上生产 lqynb.xyz：仍为旧 52a4e47 镜像，未变（按工单不部署生产）。

## G0–G6 状态

| 阶段 | 状态 | 交付 |
|---|---|---|
| G0 | 完成 | 五项能力差距表 + 云端实测五缺陷（K1–K5）：`.planning/research/campus-growth/P1-GAP-20261006.md`；探针 `.local/coze-competition/p1-g0-probe*.json|mjs` |
| G1 | 完成（证据级） | 追问行为以 PC02/PC03/D01 真实轨迹验证（沿回答推进、四分支分化、边界四态）；机制层无新框架，复用既有 unknown/义务/合同 |
| G2 | 完成（机制+实证） | 剩余/每周/下周时间三类语义（新增 remaining_time 义务族）；calendar-week 证据同句继承；预算事实服务器补齐（修复4）；更正/拒绝/遗忘边界复验（C09/PC11N/PC12R） |
| G3 | 完成（证据级） | 最小行动（PC06M/C10 T4/D01 T3–T6）、反馈五态（C07A/B）、新选择用新信息（D01 T7/C10 T7） |
| G4 | 完成 | 主 Skill `lifeos-personal-companion` v1.0.0（仓库 `skills/`，安装于 `C:\Users\LQY\.agents\skills\`）；宿主多轮实测（PC16）；云端同规则适配（伙伴分支）部署并八探针复验 |
| G5 | 完成 | PC01–PC16 证据矩阵 + 原 C01–C10/十场景复验：`P1_BEHAVIOR_ACCEPTANCE.md`（全部指向原始 run 目录） |
| G6 | 完成 | 本文件 + `P1_BEHAVIOR_ACCEPTANCE.md` + 技能包 + 云端适配（实测记录）+ 设计文档 `docs/competition/P1_DESIGN.md`（约 1600 字）+ 演示脚本 `docs/competition/P1_DEMO_SCRIPT.md`（视频未录制，已标注） |

## PC01–PC16 与原必达场景

见 `P1_BEHAVIOR_ACCEPTANCE.md`（逐条判定 + 原始输出位置）。总况：13 项通过/部分通过中有 3 项带明确未达子项（PC05 行为保守、PC09 真实链更正轮弱、PC16 更正状态层未持久）；原 C01–C10 与 PRODUCT 十场景全部有当前代码证据。

## 主 Skill 实际加载与运行状态

- 包内容：SKILL.md（触发/不触发、追问-交付-停止决策、边界四态、三类未知、状态读写约定、诚实降级）+ references/host-api.md（HTTP 契约与"何时可宣称已记录"映射）+ examples/multirun.mjs（可运行样例）。
- 加载：安装于用户级技能目录（宿主标准发现位置，格式与既有技能一致）；宿主技能列表不热刷新，自下一会话起可被技能机制触发；本会话以执行其 runbook 验证（离线诚实路径与在线付费路径均实测）。
- 运行：四轮真实多轮（PC16）——追问→新信息→帮助通过；更正轮回复层通过、状态层未持久（残余类，见未达项）。

## 部署版本与云端验收

- 云端任务 LIFEOS_COMPETITION_AGENTS_P1（取代卡死的 FIX2）：修复 K1–K5（自愈清库+攻略标记保护、fact 回执 event_nodes(attribute=user_statement)、新会话自动注册不再 FK 500、伙伴分支 companion_agent+意图路由+事件/义务状态机+回执契约打通）。
- 部署后真实复验 8/8 通过（`.local/coze-competition/p1-deploy-verify-result.json`）：新会话 200；伙伴五轮（承接→经过→两小时行动→行动记录非完成→新选择用旧信息）；事实回执；空库政策未覆盖 0 引用；条件句零写入。已知偏差：obligations.pending 显示层重复项；KB 向量层无删除 API（查询层归属校验兜底）。
- 数据边界：云端仅合成学生数据；真实学生档案与生产库不流向参赛环境；未新建 Token、未充值。

## 成本与速度（分开报告）

- 账本：`.local/v1.3-action-coach/paid/provider-calls.json`，本批全部真实调用（探针 4 + 六轮链 + PC16 两批 8 轮）约 **¥1.19**，continuation 剩余 **¥18.55**（906 条收据、0 pending；含最坏 reserve 保守口径，非发票）。
- 成本 Gate：¥0.45–0.57 / 100 成功轮（含失败与修复）≤ ¥1 目标，**成立**。
- 速度 Gate：首内容 p50 4.2–5.9s、p95 7.6–15.3s，**不成立**（供应商侧 TTFT 主导、本地开销约 150ms，与 2026-10-05 批结论一致；需端点/模式层变更，未在本批授权内）；完整回复 p95 ≤15s 在 R2/R4/R6 成立（R5 20.1s 超标）；≥20 普通样本成立（R2+R4+R6 合计 62 个保存普通轮）。
- 轮成功率：六轮链合计 166 保存 / 129 失败轮（含两次冷却级联 21 轮空转与两次运行中止的空转轮；语义性失败约 90 轮中后期收敛至 ~24%）。

## 未达项与准确阻塞原因

1. **首内容 p50≤3s / p95≤5s**：供应商侧 TTFT；本地无可压缩空间；需更换/混合端点或 SSE 更早首包（需专项决策，本批未授权）。
2. **模型输出残余弱项**（服务端合同正确拒绝、数据未污染，失败全保留）：复合条目更正用 replace 而非 amend（PC09T 四次中一次通过）；结构化计划缺失/错引 id（PC07T、C10 T7）；更正引文不逐字（PC16 T4、C05B T3）。逐项跳过策略使其不再毒化整轮，但成功率与状态完整度受损。
3. **PC08D T4 逐字重复上一条回复**：无服务端重复检查，未修。
4. **PC05 "记不清转其他关键环节/不依赖信息的行动"**：产品选择完全尊重边界但偏保守，未演示推进面。
5. **云端 obligations.pending 重复项**：回执显示层缺陷，待下一云端批。
6. **视频未录制**：仅交付演示脚本（按工单如实标注）。
7. **WIP_NOT_READY 维持**：速度 Gate 与上述残余未达项未清；线上生产未更新（按既有授权需全部 Gate 成立后发布）。

## 交付文件路径（确切）

| 文件 | 路径 |
|---|---|
| 交付报告 | `P1_DELIVERY.md`（本文件） |
| 行为验收 | `P1_BEHAVIOR_ACCEPTANCE.md` |
| 差距表 | `.planning/research/campus-growth/P1-GAP-20261006.md` |
| 主 Skill 包 | `skills/lifeos-personal-companion/`（SKILL.md / references/host-api.md / examples/multirun.mjs）；安装副本 `C:\Users\LQY\.agents\skills\lifeos-personal-companion\` |
| 参赛设计文档 | `docs/competition/P1_DESIGN.md` |
| 演示脚本 | `docs/competition/P1_DEMO_SCRIPT.md` |
| 真实链证据 | `evidence/v1.3-action-coach/real/coach-{18a170c6,47dec128,efcc771c,c9e6bc63,fbaee8d5,d353af74}/`（report.json + review/） |
| 操作员日志 | `.local/campus-growth/continuous-17913{02354913,02796464,03453940,04628449,05424599,06313666}/` |
| PC16 执行 | `.local/campus-growth/pc16-multirun.log`、`pc16-multirun-2.log`、`pc16-server.log`、`.local/run-pc16-server.ts` |
| 云端证据 | `.local/coze-competition/p1-{prompt.txt,send-result.json,status-*.json,deploy-*.json,deploy-verify.mjs,deploy-verify-result.json}`、`p1-g0-probe*` |
| 本批提交 | `20dd412` `0cf8cc0` `2bc5f04` `16421d9` `4f93cc9` `382071a`（本地，未 push） |

## 最终通过问题

**这个 AI 是否真的在持续了解同一个人、把同一件事问明白，并让新的经历和反馈改变下一次帮助？**
机制与证据上：同一个人——逐字事实、账号隔离、记忆门与跨会话承接/遗忘不复活均已实证；同一件事——D01 七轮、PC03 四分支、C09/C10/PC11N 把经过问清并跨轮续接；改变下一次——D01 T7、C10 T7、PC12R、C06 的新建议确实使用中途新增的信息与更正。残余：约四分之一的轮次因模型输出合同失败未保存（服务端正确拒绝），更正类场景成功率仍低——"持续了解"的体验会被这些失败打断，这是当前与"完整成立"之间最主要的距离。
