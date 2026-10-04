# LifeOS 当前项目说明

当前目标、验收与执行路线见 docs/v1.3-action-coach/OBJECTIVE_V1_3_ACTION_COACH.md、docs/v1.3-action-coach/CODEX_FAST_LAUNCH_PLAN.md 和根目录 HANDOFF.md。

保持默认模型 qwen3.8-flash。先保护现有代码，做局部修改；后端测试必须经隔离运行器运行。区分本地测试、真实模型验证和正式部署，不把单测通过写成产品接受或上线。

凭据、私有环境、数据库备份和 Provider 原始账本不提交。真实模型调用沿用原工作区的唯一账本。生产数据、云资源和 DNS 的写入只在账号所有者授予目标权限后执行；阿里云和 Linux 主机权限分别确认，细节见 DEPLOYMENT_HANDOFF.md。

用户授权的本地 Git 提交可直接完成；不擅自 push、改 DNS、迁移生产库或宣布部署完成。