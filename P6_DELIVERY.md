# P6 交付报告 — 控制安全与跨会话更正收口（GLM_NEXT_WORKFLOW）

工单：GLM_NEXT_WORKFLOW.md（2026-10-08，GLM 全程）。P5 未达项续作；失败保留；WIP_NOT_READY 维持。

## 工单最终问题回答

**这个学生纠正或撤回一段经历后，AI 是否真能安全处理？** 是——P0 风险自动遗忘分支已重写为子句级意图检测（`server/forget-intent.ts`）：否定（"不要删除"）、假设（"如果以后想删"）、条件开启、引语/第三方/问句不授权；"记录保留"转为暂停语义而非删除；混合语句（新增长学长反馈+顺便遗忘海报）只从**控制子句**评分定位目标——隔离引擎实测 5/5：否定零写入、混合正确删海报保留反馈、失败审计不再被当成功（forgotNow 要求 executed===true）；幂等键改为请求 ID 的确定性 UUIDv5。**并在新的校园事情中使用正确、仍被允许的依据？** P1 跨会话更正已修：replace/amend 现在把条目 conversation_id 随新源迁移（不再 A 条目配 B 来源被 checkCampusSource 判 source_revoked）——A 创建→B 更正→C 新会话隔离验证：更正后事实 active、旧事实不再 active；**真实链 `coach-15f9ab53` T6 readback 首次显示更正事实 active**（前链全部 stale/source_revoked）。**通过正常应用实际完成？** 正常聊天入口✓（本链真实模型+隔离 PG）；W3 引擎内知识采用：本地 guide 卡（同一 manifest hash 绑定内容）在引擎知识通道被实际使用（回复内容证实），code_workflow 传输按本地优先策略作为空库回退（配置已验证 enabled）。

## W1（P0）— 控制意图子句级检测

| 反例 | 修复前 | 修复后 |
|---|---|---|
| F01 否定"不要删除" | 尝试 forget | **零意图** |
| F02 假设"如果以后想删" | 尝试 forget | **零意图** |
| F03 暂停"不再作为依据，记录保留" | 尝试 forget | **pause_use**（不删除） |
| F04 混合反馈+遗忘 | 错删公众号 | **正确删海报**（控制子句评分） |
| F06 action 失败 | audit 被当成功 | **executed:false 不授权** |

隔离引擎测试（`tests/backend/forget-intent.test.ts` 6/6）：含否定零写入（海报保留）、混合目标正确+反馈保留、失败语义。审计不再复制被删条目原文（无隐藏记忆）。

## W2（P1）— 跨会话更正来源身份

- **根因**：replace/amend 的 UPDATE 更换 sources 但保留旧 conversation_id；读取可用性按条目旧 conversation 验证新消息来源 → source_revoked。
- **修复**：两条 UPDATE 路径（ordinary replace + 单子句 amend）现在携带 `conversation_id=$14/$12`（运行会话）。多子句 split 原本就写新会话（不变）。**checkCampusSource 未被削弱**。
- **验证**：A 创建→B amend 更正→C 新会话（记忆开启）——更正事实 active 无 unavailableReason、旧事实非 active（隔离 6/6 含此用例）；真实链 T6 readback 更正后事实 **active**。

## W3 — 引擎内知识采用

当前隔离服务（指纹 339ec83）注入 code_workflow 传输配置（enabled, 无凭据输出）。两条场景（作品集/备考）真实引擎轮：growth applied、回复为指南个人化形态（团队/个人分开、4小时拆分）。本地知识（guide 卡 hash 绑定同一 manifest）在引擎通道被实际采用；Coze 远端回退按"本地空才走远端"的正确产品策略保留（配置+映射+边界此前已分段验证并保留 P5 探针）。诚实标注：引擎内远端 Coze 调用未在本批触发（本地卡命中），非能力缺失。

## 真实链（最终冻结 06dce92）

`coach-15f9ab53`：L1+L1OFF 11 轮 7 保存/4 失败（SOURCE_QUOTE/COACH_OUTPUT/COMPOSITE/DEPENDENCY——模型输出违约被正确拒绝，保留）。**T6 更正后事实 readback active**（W2 修复的真实链首次证明）；T9 引用更正后的个人贡献（"你之前做海报时只负责排版和打印"）——但 T9 回复主体仍偏向旧公众号（F01 方差残留，如实记录）。

## 版本与成本

- 提交：`339ec83`（W1+W2）；冻结 `06dce92`；探针复验（4 调用）。
- 账本：1356 收据/0 pending；剩余 **¥15.17**（本批 ≈¥0.18：探针 4、L1 链 11 轮、W3 trace 6 轮）。

## 未达项（如实）

1. p95 首内容（供应商 TTFT；本批无新速度大样本）。
2. ≥20 成功普通样本于单冻结。
3. 扣子原生 Skill 平台 UI（需账号所有者 code.coze.cn 扫码会话；未操作浏览器）。
4. 引擎内远端 Coze 调用触发（本地优先策略下未出现空库场景；分段证据保留）。
5. T9 当前问题方差（建议规则改善但非保证）。
6. 引文/输出类模型失败率（本链 4 失败轮保留）。
7. 生产 lqynb.xyz 未部署。

## 交付文件

| 文件 | 路径 |
|---|---|
| 本报告 | `P6_DELIVERY.md` |
| 验收 JSON | `.planning/research/campus-growth/P6-EVIDENCE-INDEX.json` |
| W1/W2 测试 | `tests/backend/forget-intent.test.ts`（6/6） |
| 遗忘意图模块 | `server/forget-intent.ts` |
| W3 trace | `.local/campus-growth/p6-w3-traces.json` |
| 真实链 | `evidence/v1.3-action-coach/real/coach-15f9ab53/` |
| 提交 | `339ec83`（+本文档提交） |
