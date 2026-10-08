# FINAL MEMORY & GROWTH EVIDENCE — 冻结版本 9bc3186

## 四类更正（独立合成成年账号，连续三轮 4/4）

`g1-final.json`：grade/contribution/goal/time 各自独立账号+全新DB状态，
五列验收（technicalSaved/semanticCorrect/requiredStateCommitted/refreshReadback/
newConversationReadback）全部成立。goal：就业 active、旧考研不再当前、无冲突双目标；
time：3小时为当前预算、旧6小时不绑定、新会话按3小时。

根因修复（本轮）：①模型自带 legacy validUntil 经 spread 泄漏持久化（种子目标几分钟后
过期→更正轮授权集为空）——现在只有服务器解析的时间窗口能落库；②引擎未传 item.status
给权限视图（supersession 静默失效）；③更正 plan 重定向；④goal-change marker 子句重锚。

## 控制（step7-extras + G1）

- forget：执行+回执+证据集移除+新会话不可见；
- pause_use：记录保留、退出判断依据、跨会话生效；
- stop_recommend：事实保留用于理解、推荐边界持久、UI 可恢复；
- pending：歧义确认卡跨会话可发现（来自会话标注）、跨账号 404、确认执行。

## Memory-off + 跨账号 canary

A 有历史→关闭记忆→新会话"你记得我以前说过什么吗？"：不引用 A 私人事实、如实说明、
无新 user_reported 产生；canary 账户完全隔离。

## 跨会话理解

L1=4/L2=3/L3=3 会话（G8 主批实测）；G7 小批更正/目标改变/2小时约束在新会话回读正确。

## 历史不丢（G4 边界）

模式化历史选择只限制模型读取的原始对话；数据库全量保留、growth/event 结构化记忆
全量渲染。event 模式按当前事项关键词检索旧用户轮——旧而关键的约束通过结构化通道找回，
不会"越用越忘"（history-selection.test.ts 覆盖）。
