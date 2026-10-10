# 专业业务 Skill 登记
唯一入口 skills/lifeos-personal-companion 保留已有改动；本轮不覆盖其1.2.1 local WIP，也不把Codex开发技能算学生Skill。

| Skill | 版本 | 真正读取指令的路径 | 证据/当前范围 |
|---|---|---|---|
| lifeos-action-review | 0.1.0-candidate | action-workflow/host | 主入口合成Provider+隔离PG自动触发2轮 |
| lifeos-direction-analysis | 0.1.0-candidate | direction-decision各节点adapter入参 | 本地合成DAG10测试；未启用真实模型 |
| lifeos-experience-evidence | 0.1.0-candidate | growthDiff | 独立确定性测试读取；不宣称真实模型遵循 |
| lifeos-growth-diff | 0.1.0-candidate | growthDiff | post-commit门禁/撤回测试；产品星图未接 |
| lifeos-guide-application | 0.1.0-candidate | applyGuide | approved/失效与预算测试；host全文卡桥接待做 |

五份SKILL.md均有触发/引用/步骤/JSON/工具权限/禁止操作/降级/至少6条正负多轮例。skills.ts读取真实文件、SHA256并产生skill_loader trace；SOURCE_MANIFEST.json冻结指纹，执行类型按实际记录。指南类Skill读了文件不等于已在所有学生会话自动启用。
仓库候选未安装全局、未同步云Skill，不冒充平台官方技能。用户不操作专业机器人。
