# GLM 开发交接

工作区为 D:\aaaLife\LifeOS。这是当前 LifeOS V1.3 的精简源码仓库，仅包含运行源码、测试、当前目标和部署所需文件；没有旧状态日志、历史交付包或 Git 旧历史。源码与原仓库 feature/v1.3-action-coach 提交 34bd6d8（declined 未知项）逐一比对一致，本轮未改动任何源码。

默认模型保持 qwen3.8-flash。当前状态 WIP_NOT_READY；整体仍未通过完整真实验收。

## 2026-10-04 本机环境恢复与全量本地验证（本轮 GLM）

原快照不含 node_modules、.env.server、BGE 权重和 evidence 数据文件，隔离测试最初无法运行。本轮按项目既定脚本恢复，未改源码：

- npm ci 安装依赖；`.env.server` 从本机既有 lifeos-postgres-20261001 容器（127.0.0.1:55432，本地开发库）恢复 DATABASE_URL，并按 .env.server.example 写入 LIFEOS_MODEL_PRICING_JSON；不含任何模型 API Key。
- `python scripts/setup-coach-embedding.py` 下载固定 revision 7999e1d 的公开 BGE 模型到 .local/models（逐文件摘要校验通过）。
- 从原工作区（C:\Users\LQY\Documents\Codex\2026-09-29\lifeos-campus-lifeos-growth-flywheel-three\outputs\lifeos-campus）只读复制测试所需最小 evidence：v1.3-action-coach 的 research/（3 个 json）、retrieval-db.json、service-lifecycle.json，以及 v1.2.1-reliability/20261003-authorized300-11 的 PROVIDER_AUTHORIZATION.json 与 6 份 campus-targeted 报告（SHA 校验文件，原样复制）。

全量本地验证结果（全部通过，0 失败）：

- npm run typecheck、npm run typecheck:server、git diff --check
- npm test（客户端 44/44）
- npm run build（three.js 大 chunk 警告为既有现象）
- 隔离后端全量 29 个测试文件（含 coach-process-turns 3/3、action-coach-events 10/10、action-coach-engine 33/33、coach-provider-budget 5/5、coach-knowledge-relevance 等），一次性数据库 14 个迁移
- npm run test:db-recovery：全量套件重跑 + 隔离迁移报告 + 真实 pg_dump/pg_restore 恢复验证（恢复后继续写、更正/撤销不复活、来源撤销链路、权益/花费延续，主库未修改）全部通过
- action-coach-browser（真实 Chromium + 模拟 Provider）1/1

declined 未知项功能核验：契约（declineUnknowns）、事件层（冲突校验 COACH_UNKNOWN_DISPOSITION_CONFLICT、状态迁移、更正恢复为 active fact）、修复指引、提示词透出 declined 状态、前端「暂不追问」展示与待核对列表排除，均有对应测试且通过。未发现代码缺陷。

本轮唯一代码修复：精简打包误删了仍被 scripts/verify-db-recovery.ts 引用的 scripts/campus-recovery-action.ts（006-campus 迁移恒在，campusWorker 必然执行），导致 npm run test:db-recovery 以 ERR_MODULE_NOT_FOUND 失败。已从原仓库 34bd6d8 同名跟踪文件恢复（SHA256 34cbbfc7…c39a7 与原件一致），并全仓库扫描确认再无其他被引用但缺失的脚本。

## 未完成项（保持 NOT_READY 的原因）

- A01–A08 真实模型轨迹、20 条普通真实追问速度样本（p50≤3s/p95≤5s、完成 p95≤15s）、真实来源失效链路：需要百炼 Key 与原工作区唯一 Provider 账本（263/300 已用、余 37 次），本工作区未复制凭据，未做任何真实调用。
- 最终配置下 1440/390/320 正式浏览器验收、最终源码全套检查与隔离迁移/恢复（本轮已跑机制回归，但不等同最终验收）。
- 阿里云部署未开始：需账号所有者正式授权（最小权限见 DEPLOYMENT_HANDOFF.md），DNS 在 Cloudflare。

先读本文件、AGENTS.md、docs/v1.3-action-coach/OBJECTIVE_V1_3_ACTION_COACH.md、docs/v1.3-action-coach/CODEX_FAST_LAUNCH_PLAN.md 和 DEPLOYMENT_HANDOFF.md。不切换模型、不擅自部署、不宣称完整验收通过。
