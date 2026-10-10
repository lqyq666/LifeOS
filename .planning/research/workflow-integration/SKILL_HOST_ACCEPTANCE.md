当前记录：本轮五专业Skill与主Skill原文件hash保持；实际通过65项 focused、原96项及四条跨3会话HTTP/PG/Chrome链。SCRIPTED_ONLY，不是Skill真实模型语义效果。用户安装1.2.0、仓库1.2.2-candidate、云历史1.2.0分开，详见SKILL_VERSION_MATRIX.json。

以下为历史候选workflow-v2-integration-ee442ef15ffa记录：

# 五专业Skill本地加载与宿主验收

实际hash与版本见SKILL_VERSION_MATRIX.json、evidence/PROCESS_VERSION.json。仓库主Skill1.2.2-candidate、五业务Skill0.2.0-candidate；用户安装主Skill实际仍1.2.0且hash6c3bfbb6…，没有覆盖安装副本或云核心规则。云1.2.0为历史接手记录，不宣称取得新的云内容hash。

| 专业Skill | 实际激活/授权工具及产物 | 不触发/失败证据 |
|---|---|---|
| action-review | 原host读取已获准event/message→持久action workflow→原finishRun反馈读回；加载SHA trace | 普通/倾听/拒绝fast；模糊事件或未知来源降级；declined不因attempted重启 |
| direction-analysis | 原runtime SDK四节点角色，PG进度、来源校验、合法选择和新会话提交读回；instruction SHA进trace | 无深入同意/时间先fast或waiting_user；跨账号404、Memory OFF跨会话403、取消不得采纳；最终5虚构断言拒绝 |
| experience-evidence | 同事务真实已提交经历/growth快照，解释本次范围，加载SHA；300元交付有原生回执 | 未提交不产生diff；稳定能力/认可不推断；来源删除后解释失效 |
| guide-application | 实际host读approved全文卡→applyGuide→native guide_usage suggested→HTTP读回；实际Skill hash | reply_only不发新方法；unapproved/失效拒绝，旧revision建议失效；public-card测试 |
| growth-diff | 实际finishRun后before/after引用，真实目标/经历投影+GET；SHA trace | 无changedIds不触发；同revision不伪造变化；旧来源撤回不复述 |

这些是代码宿主实际读取文件并调用授权工具的证据。确定性证据组件不是LLM Agent；Provider响应合成，不宣称真实模型完整遵循全部指令。Coze端五Skill的发现、加载、工具执行、产物读回尚未运行；整体验收WIP_NOT_READY。

## 继续集成核验（2026-10-10）

本次5个业务Skill与仓库主Skill内容hash未变，宿主运行代码变化由新sourceDigest区别。用户安装副本实时哈希在更新SKILL_VERSION_MATRIX.json，云副本标历史未读回且暂停；未安装或同步任何副本。不能把本地宿主通过称为云Skill已运行。
