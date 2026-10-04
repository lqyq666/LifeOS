# LifeOS

当前目标和验收见 docs/v1.3-action-coach/OBJECTIVE_V1_3_ACTION_COACH.md。GLM 接续状态见 HANDOFF.md。部署方式与阿里云权限交接见 DEPLOYMENT_HANDOFF.md。

## 本地开发

    npm ci
    npm run typecheck
    npm run typecheck:server
    npm test
    npm run build

后端集成测试使用隔离运行器和专用测试 PostgreSQL；不要连到生产库。默认模型保持 qwen3.8-flash，模型密钥只从本机私有环境注入。

离线语义检索模型和 Linux wheels 按 DEPLOYMENT_HANDOFF.md 准备，不存入 Git。