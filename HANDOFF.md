# GLM 开发交接

工作区为 D:\aaaLife\LifeOS。这是当前 LifeOS V1.3 的精简源码仓库，仅包含运行源码、测试、当前目标和部署所需文件；没有旧状态日志、历史交付包或 Git 旧历史。

原仓库当前分支 feature/v1.3-action-coach，提交 34bd6d8404d635ea3163089e2038b214736a9b2d。最新改动把明确暂不回答的未知项保存为 declined，界面显示“暂不追问”；后续更正可把同一节点更新为事实。默认模型保持 qwen3.8-flash。

当前状态 WIP_NOT_READY。已验证 npm run typecheck，隔离后端 coach-process-turns 3/3、action-coach-events 10/10、action-coach-engine 33/33，以及 git diff --check。新增模型调用 0；本次没有部署阿里云。Codex 的目标已按用户指示暂停，由 GLM 从本目录接续。

先读本文件、AGENTS.md、docs/v1.3-action-coach/OBJECTIVE_V1_3_ACTION_COACH.md、docs/v1.3-action-coach/CODEX_FAST_LAUNCH_PLAN.md 和 DEPLOYMENT_HANDOFF.md。项目整体仍未通过完整真实验收。

实际凭据、私有 Provider 账本、数据库备份、缓存、认证目录和 Aliyun 控制台截图没有复制。账本仍在原工作区，若继续真实调用应沿用同一账本。