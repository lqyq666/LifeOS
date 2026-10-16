---
name: lifeos-growth-diff
description: 仅合法事务真的保存变化后，解释证据与星图投影；默认0模型调用。
metadata:
  version: "0.2.0-candidate"
---

# lifeos-growth-diff

版本：0.2.0-candidate。由唯一 lifeos-personal-companion 内部调用，学生不切换机器人。

## 触发与输入引用

仅合法事务真的保存变化后，解释证据与星图投影；默认0模型调用。

host committed receipt、旧/新revision、有效证据引用、主题/经历/identity边界。

## 步骤与输出 JSON

验证事务回执；比较实际新增/更正/撤回；生成过去/新增证据/现在/仍未知/需确认；投影交原星图接口。

GrowthDelta v2: before, evidenceRefs, now, unknowns, needsConfirmation（本人已确认=false，AI观察或proposed=true）；没有写权限。

可执行 schema 和候选运行入口：server/workflows/contracts.ts。每次激活记录实际读取的 SHA256 与脱敏 trace；文件存在不代表生产启用。

示例输出（仅在真实 host 事务回执之后计算）：

```json
{"schemaVersion":2,"before":"此前还没有这条任务记录。","evidenceRefs":[{"type":"experience","id":"synthetic-design","revision":1}],"now":"新增的本人报告：完成一张海报并收到50元。","unknowns":["任务范围外的稳定能力未知。"],"needsConfirmation":false,"change":"added","itemId":"synthetic-design"}
```

## 工具权限与禁止操作

只读提交前后快照；用户更正经既有带expectedRevision接口；不保存模型猜测。

不将星球亮度或等级解释为人格更高级，不复活遗忘文本，不推断本人认同。

## 失败降级

无变更→null；过期快照/来源不可见→unavailable，无增量。

## 正例、负例与多轮例

- 事务保存新交付记录 → 任务范围内新证据。
- 只有模型建议 → 无提交，无delta。
- 用户更正时间限制 → 依赖旧时间的解释收回。
- Memory OFF且跨会话来源 → 拒绝读取。
- 撤回旧反馈 → 不复述旧原话。
- 会话1提交→会话2更正→会话3新建议 → 读取新修订，旧解释与目标边界同步。

## 本地集成候选边界

运行激活、工具权限、快照与事务由 LifeOS host 校验。实际加载hash随trace保存；版本号不代表扣子或用户安装副本已同步。不得自动收费重试、绕开唯一调用账本或创建新的学生机器人。云端调用本轮暂停。
