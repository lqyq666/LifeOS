---
name: lifeos-guide-application
description: 本人需要方法且存在当前approved攻略；使用现有常青库而非另一份知识库。
metadata:
  version: "0.2.0-candidate"
---

# lifeos-guide-application

版本：0.2.0-candidate。由唯一 lifeos-personal-companion 内部调用，学生不切换机器人。

## 触发与输入引用

本人需要方法且存在当前approved攻略；使用现有常青库而非另一份知识库。

guideId/revision/sourceHash、branch/step、证据片段、本人时间限制与原事件。

## 步骤与输出 JSON

先读全文与适用边界；区分原文支持/编辑适配；缩成可开始动作；反馈沿同event与step继续。

WorkflowProposal v2；nextActions有依据/分钟/stopCondition；攻略使用候选七状态单独交回主入口。

可执行 schema 和候选运行入口：server/workflows/contracts.ts。每次激活记录实际读取的 SHA256 与脱敏 trace；文件存在不代表生产启用。

示例输出（攻略仍是待执行候选）：

```json
{"schemaVersion":2,"traceId":"00000000-0000-4000-8000-000000000001","evidenceRefs":[{"type":"knowledge","id":"synthetic-approved-guide","revision":1}],"hypotheses":[],"alternatives":[],"nextActions":[{"description":"用5分钟整理一个具体问题。","estimatedMinutes":5,"stopCondition":"5分钟到时停下；不继续也可以。","evidenceRefs":[{"type":"knowledge","id":"synthetic-approved-guide","revision":1}]}],"suggestedStateChanges":[]}
```

## 工具权限与禁止操作

只读认证完整方法与本人使用日志；仅approved有效修订；公共检索候选由本地审核。

不把方法当本人经历，不把复制当发送，不用未审或失效卡，模型不能自行verified。

## 失败降级

没有可用卡时说清来源缺口；通用建议标为建议；不宣称已保存。

## 正例、负例与多轮例

- approved当前修订，问怎么开始 → 读完整方法，按本人预算拟一步。
- needs_review卡 → 拒绝作为方法依据。
- 我复制了消息 → 仍suggested/accepted，不算发送。
- 我已发了但没回复 → 同事件反馈，不重讲教程。
- 来源退役 → 停止引用与公开镜像资格。
- 会话1建议→会话2接受→会话3尝试 → 每步有当前本人原话和真实提交回执。

## 本地集成候选边界

运行激活、工具权限、快照与事务由 LifeOS host 校验。实际加载hash随trace保存；版本号不代表扣子或用户安装副本已同步。不得自动收费重试、绕开唯一调用账本或创建新的学生机器人。云端调用本轮暂停。
