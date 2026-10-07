# P5 交付报告 — 确定性缺陷修复 + 记忆一致性 + 攻略边界收口

工单：GLM_P5_EXECUTION（2026-10-07，GLM 全程）。两个 P0 修复并验证；失败保留；WIP_NOT_READY 维持。

## 工单最终问题回答

**一个大学生从短期试用到长期使用后，AI 是否仍能正常回应？** 两个 P0 修复后是——隔离 PG 回归证明 60 条有效记录下普通轮正常提交（不再有幻影 GROWTH_SNAPSHOT_INVALIDATED），真实并发修订仍被安全拒绝；大档案相关性选择使 45 个字面重叠干扰项不再挤掉零重叠关键约束（每星期仅三小时）。**记住真正影响他的条件？** essentials 兜底真实可达（修复前是死代码）；但最新 L1 重跑（`coach-93cf159e`）也诚实暴露：T9 虽答对时间预算（4小时 vs 10小时缺口计算）但把新主播机会答成旧公众号机会——当前问题主导是概率改善非保证，记为 SAVED 轮上的语义失败。**可靠地接受更正与控制？** 跨轮 outstanding-forget 守卫已实装并在真实链触发（T8 遗忘请求轮被诚实拒绝而非虚称完成）；更正链路 P4 已证。**通过正常应用、Agent、主 Skill 与扣子工作流交到他手上？** 正常聊天入口✓；扣子生产 `4aa53641`——自编方法全部建议式措辞（"可以考虑/一种做法是"），情绪→方法同会话恢复正常路由；主 Skill v1.2.0（P4 已实跑）；原生扣子 Skill 平台 UI 操作仍未执行（阻塞见未达项）。

## P0 修复（S1/S2/K01）——附件探针全部转绿

| 探针 | 修复前 | 修复后 | 实现 |
|---|---|---|---|
| M01 零重叠旧约束 | 未入选 | **入选** | essentials 换入最低分非关键项（不再要求零分槽位） |
| M02 40/41/200 快照 | 41/200 INVALIDATED | **全 PASS** | 快照/引用/授权由 growthAll（全量）驱动；子集只缩模型阅读 |
| M03 同分排序 | 偏旧 | **偏新** | 升序 index tie-break（growthView 新者在前） |
| M04 字符预算 | 160k 字符 | **≤60k** | 预登记 maxChars=60,000；非关键项先裁 |
| K01 禁用+附加断言 | verified=1（两处都过） | **verified=0** | enabled=false 硬禁用；contentHash 校验；excerpt=本地已核验 span |

隔离 PG 回归（`tests/backend/growth-scale.test.ts` 新增）：60 条 user_edit 来源记录 + 模拟 provider——普通轮提交成功且 selection audit 记录实际裁剪；生成后真实并发 revision+1 仍正确 GROWTH_SNAPSHOT_INVALIDATED。

## S3.4 跨轮遗忘生命周期

前 3 条用户消息含遗忘词且无 forget action 提交 → outstandingForget=true → 后续任何轮的"已移除/已撤下/不再作为依据"宣称被拒（修复前 T9 形态：T8 失败后 T9 虚称"已撤下"）。真实链验证：`coach-93cf159e` T8（遗忘请求轮）触发 REPLY_CLAIMS_UNCOMMITTED_FORGET——诚实失败而非虚称完成。

## S5 真实链（最终冻结 182f3452）

- L1/L2/L3/L1OFF（`coach-f736cc93`，冻结 4e0ad9bb）：17 保存/7 失败。
- L1/L1OFF 重跑（`coach-93cf159e`，冻结 182f3452 含 outstanding-forget）：8 保存/3 失败。
- **诚实语义记录**：最新 T9 SAVED 但答旧公众号机会（当前问题主导方差残留）；T8 遗忘轮诚实失败；T4 SOURCE_QUOTE/T6 COMPOSITE 类模型失败保留。
- L1OFF 2/2：同会话内记忆正确（引用 T1 原话），无跨账号串用。

## C 线

- **参赛生产 `4aa53641`**：自编方法建议式措辞（无"官方规定/不可安排满"硬规则残留，实测 hard-residue=false）；情绪→方法同会话恢复正常路由（turn2 route=knowledge）；指南卡版本 2 幂等修订。
- **K01 边界**：本地 registry 映射代码已修（enabled/contentHash/excerpt）；在线接线负例由探针验证（模拟 registry/行）。
- **原生扣子 Skill**：平台 UI 操作（上传 .skill/ZIP→预览→部署）仍未执行——真实阻塞：该流程需要浏览器登录扣子平台的本人会话，本环境未获平台登录凭据注入授权；CLI 无对应命令。具体待办：账号所有者在 docs.coze.cn 平台会话中上传包后告知结果。

## 版本与成本

- 提交：`9845034`→`0dd554d`（+类型修正）；冻结 4e0ad9bb 与 182f3452；探针每冻结复验。
- 账本：1326 收据/0 pending；剩余 **¥15.52**（P5 ≈¥0.42：探针 8、两链 24+11 轮）。
- 速度：L 链 p50 4.20s/5.47s；样本 12+6=18（两冻结分列，不拼接）。

## 未达项

1. 首内容 p95≤5s（供应商 TTFT）。
2. 原生扣子 Skill 平台 UI 上传/预览/部署（需账号所有者平台会话；CLI 无命令）。
3. 在线 Coze→registry→个人化行动端到端真实轮（本地映射代码已修+探针验证；真实 code_workflow 环境配置未注入运行）。
4. ≥20 成功普通样本于单冻结。
5. 当前问题主导的语义保证（建议式规则改善概率；T9 方差残留）。
6. 引文/计划引用类模型失败率（两链 10 失败轮保留）。
7. 生产 lqynb.xyz 未部署。

## 交付文件

| 文件 | 路径 |
|---|---|
| 本报告 | `P5_DELIVERY.md` |
| 行为验收 | `P5_BEHAVIOR_ACCEPTANCE.md` |
| 记忆证据 | `P5_MEMORY_GROWTH_EVIDENCE.md` |
| 机读索引 | `.planning/research/campus-growth/P5-EVIDENCE-INDEX.json` |
| 真实链 | `evidence/v1.3-action-coach/real/coach-{f736cc93,93cf159e}/` |
| 云端证据 | `.local/coze-competition/p5-*.json` |
| 提交 | `9845034` `e31d1e3` `0dd554d`（+本文档提交） |
