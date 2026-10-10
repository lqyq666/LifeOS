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

## 攻略维护入口

使用已批准的本地配置运行 `npm run db:migrate`、`npm run server` 和 `npm run dev`，访问 `http://127.0.0.1:5173/#maintenance`。迁移应先在隔离数据库验证；本批没有迁移或重启用户的运行实例。

入口沿用实际登录账户，默认无维护权限。宿主配置 `LIFEOS_KB_MAINTAINER_IDS`、`LIFEOS_KB_REVIEWER_IDS`、`LIFEOS_KB_PUBLISHER_IDS` 为获授权账户的 `/api/session` ID，逗号分隔。编辑者排队仓库内32张固定修订稿；审阅者打开原文、逐项核对主张、填写问题或审阅意见；独立审阅完成后，有权批准者再次核对并明确批准发布。编辑、审阅、批准账户必须满足分离检查；真实人员独立性还须实际执行记录证明，不能靠多开账户推断。

原文链接、定位片段、原版本对照、修订 hash、反馈分支和不可推断范围在同一页面。退回、拒绝、取消会保留回执；版本、来源变化、越权和伪造回执不能发布。发布回执、内容版本和检索索引失效标记在同一数据库事务提交。没有独立审阅或本人批准，稿件不进入学生检索。

免费接口验证：`npm run test:backend -- --file=kb-maintenance-http.test.ts`。该命令自动创建并销毁专用数据库，合成账户审批只证明实现，不计为独立审阅、真人批准或实际发布。
