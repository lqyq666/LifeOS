---
name: lifeos-action-review
description: 本人行动反馈与卡点复盘；纯倾听、第三方故事和初次教程不触发。
metadata:
  version: "0.2.0-candidate"
---

# lifeos-action-review

版本：0.2.0-candidate。由唯一 lifeos-personal-companion 内部调用，学生不切换机器人。

## 触发与输入引用

本人行动反馈与卡点复盘；纯倾听、第三方故事和初次教程不触发。

授权 eventId/revision、当前 user message quote、原动作、kb_guide_usage、已回答问题。

## 步骤与输出 JSON

找同一事件；七状态分别判断；已发/已读/答复/使用/效果分别保留；只问尚未回答的关键缺口；低成本调整或停止。

ActionReview: proposal(WorkflowProposal v2), feedback, stages, reply, feedbackSource, needsClarification

可执行 schema 和候选运行入口：server/workflows/contracts.ts。每次激活记录实际读取的 SHA256 与脱敏 trace；文件存在不代表生产启用。

示例输出（合成数据；proposal 的完整字段以可执行 schema 为准）：

```json
{"feedback":"waiting_result","stages":{"sent":true,"read":false,"replied":false,"used":false,"effect":null},"reply":"已发出，尚未回复，原因未知。","feedbackSource":{"type":"message","id":"synthetic-feedback","revision":1,"quote":"我发了，还没回复"},"needsClarification":false}
```

此片段展示 ActionReview 的业务字段；运行结果同时包含完整 proposal。

## 工具权限与禁止操作

只读当前本人事件与攻略使用日志；提交交回主入口 finishRun；无写工具。

不得把建议写成执行、未回复当拒绝、失败当人格；已拒绝方向不换说法重推。

## 失败降级

事件歧义问一次对象；来源不可用/撤回返回 unavailable；没有事务回执只说候选。

## 正例、负例与多轮例

- 我愿意试这个方法 → accepted，实际执行未知。
- 我发了，三天还没有回复 → waiting_result，原因未知，5分钟停止等待方案。
- 我不想继续了 → declined，零下一步催促。
- 如果我发了没人回怎么办 → 假设，零行动事实。
- 同学说他发了 → 他人，零本人事实。
- 会话1接受→会话2未回复→会话3拒绝 → 同event承接，拒绝后停止，不重问已回答问题。

## 本地集成候选边界

运行激活、工具权限、快照与事务由 LifeOS host 校验。实际加载hash随trace保存；版本号不代表扣子或用户安装副本已同步。不得自动收费重试、绕开唯一调用账本或创建新的学生机器人。云端调用本轮暂停。
