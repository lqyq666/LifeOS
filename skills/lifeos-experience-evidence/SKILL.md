---
name: lifeos-experience-evidence
description: 本人作品、项目或反馈需要辨明证据强度；不由一次行为生成能力等级。
metadata:
  version: "0.2.0-candidate"
---

# lifeos-experience-evidence

版本：0.2.0-candidate。由唯一 lifeos-personal-companion 内部调用，学生不切换机器人。

## 触发与输入引用

本人作品、项目或反馈需要辨明证据强度；不由一次行为生成能力等级。

experience/growth/message id+revision、原文、个人贡献、撤回与可见范围。

## 步骤与输出 JSON

先检查主入口授权来源；描述本次任务中本人实际部分；第三方反馈按原话强度；观察与未知分别列出。

WorkflowProposal v2；evidenceRefs与hypotheses，suggestedStateChanges=[]；事实存储由原API处理。

可执行 schema 和候选运行入口：server/workflows/contracts.ts。每次激活记录实际读取的 SHA256 与脱敏 trace；文件存在不代表生产启用。

示例输出（合成任务；观察仍需本人核对）：

```json
{"schemaVersion":2,"traceId":"00000000-0000-4000-8000-000000000001","evidenceRefs":[{"type":"experience","id":"synthetic-design","revision":1}],"hypotheses":[{"text":"这次交付可能帮助了解设计工作。","limitation":"仅有一次交付，稳定能力与长期意愿未知。","needsConfirmation":true}],"alternatives":[],"nextActions":[],"suggestedStateChanges":[]}
```

## 工具权限与禁止操作

只读本人合法来源；不直接更新身份/画像/经历；仅返回可撤回解释。

一次有偿设计不等于稳定设计能力；没说不好不等于外部认可。

## 失败降级

来源不可见或撤回时不复述；保留未知，当前会话可继续听。

## 正例、负例与多轮例

- 完成一张海报并收到50元 → 只描述该次交付与付款。
- 客户没说不好 → 反馈未知，不写认可。
- 团队获奖但未说明我的贡献 → 个人贡献未知。
- 我只是计划接单 → 候选计划，零实际经历。
- 这段经历请忘掉 → 来源撤回，解释停止。
- 会话1海报→会话2时间压力→会话3就业优先 → 经历保留、限制新增、目标仅由明确确认提交。

## 本地集成候选边界

运行激活、工具权限、快照与事务由 LifeOS host 校验。实际加载hash随trace保存；版本号不代表扣子或用户安装副本已同步。不得自动收费重试、绕开唯一调用账本或创建新的学生机器人。云端调用本轮暂停。
