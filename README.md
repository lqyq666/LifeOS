# LifeOS

当前产品是面向中国大陆成年大学生的专属 AI 分身与成长决策伙伴，完整目标和验收见 [PRODUCT.md](PRODUCT.md)。开发断点见 HANDOFF.md，实施依据见 .planning/research/campus-growth/BRIEF.md。docs/v1.3-action-coach 保存历史组件目标，不再是当前整体验收。

## 本地开发

    npm ci
    npm run typecheck
    npm run typecheck:server
    npm test
    npm run build

后端集成测试使用隔离运行器和专用测试 PostgreSQL。产品模型依据当前授权与真实质量/速度/成本选择，密钥只从已有私有环境注入。

离线语义检索模型和 Linux wheels 按 DEPLOYMENT_HANDOFF.md 准备，不存入 Git。
