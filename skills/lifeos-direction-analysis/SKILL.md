---
name: lifeos-direction-analysis
description: 至少两个本人真实路径且明确选择深入比较，具有授权预算；普通方向问答走主伙伴。
metadata:
  version: "0.2.0-candidate"
---

# lifeos-direction-analysis

版本：0.2.0-candidate。由唯一 lifeos-personal-companion 内部调用，学生不切换机器人。

## 触发与输入引用

至少两个本人真实路径且明确选择深入比较，具有授权预算；普通方向问答走主伙伴。

统一 case_envelope 引用、时间期间/来源、2–3路径、禁荐方向、maxCalls/maxCost/deadline。

## 步骤与输出 JSON

各路径同schema并行分析；服务端来源与时间硬校验；独立critic审查；blocker停止合成；needs_clarification追问关键缺口；uncertainty保留未知与小探索；阶段候选等本人确认。

综合只能选择已审主张与服务端fact handle；合法引用ID不授权新增客户、收入或执行状态。

WorkflowProposal v2；alternatives含directionId/pros/tradeoffs/unknowns/weeklyMinutes/evidenceRefs；hypotheses需确认。

可执行 schema 和候选运行入口：server/workflows/contracts.ts。每次激活记录实际读取的 SHA256 与脱敏 trace；文件存在不代表生产启用。

示例输出（完整的空候选；路径分析在 alternatives 中使用同一结构）：

```json
{"schemaVersion":2,"traceId":"00000000-0000-4000-8000-000000000001","evidenceRefs":[{"type":"message","id":"synthetic-budget","revision":1}],"hypotheses":[],"alternatives":[],"nextActions":[],"suggestedStateChanges":[]}
```

成功综合必须包含全部获准路径；空候选不能冒充分析完成。

## 工具权限与禁止操作

只读本人授权快照及approved公开资料；Coze只接受合成成年样例；全部个人提交留给主入口。

不编成功率、适配百分比；不替本人决定；不直接写当前目标；不自动重试收费。

## 失败降级

权限/来源/预算/取消/超时失效→unavailable+existing_single_agent，无个人写入。

## 正例、负例与多轮例

- 每周6小时，请深入比较就业、考研、独立开发 → 3并行+critic+合成至多5次。
- 考研还是就业好 → 初步回答或一个关键缺口，零深度调用。
- 别推荐考公了 → 考公不进入路径集合。
- 三条各要求每周8小时 → 硬预算冲突，无合成。
- 取消深入分析 → abort，不接受迟到结果。
- 会话1比较→会话2尚未选→会话3明确就业优先 → 只有会话3经主入口合法事务才可更新目标。

## 本地集成候选边界

运行激活、工具权限、快照与事务由 LifeOS host 校验。实际加载hash随trace保存；版本号不代表扣子或用户安装副本已同步。不得自动收费重试、绕开唯一调用账本或创建新的学生机器人。云端调用本轮暂停。
