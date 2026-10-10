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

## 真实批次预检与恢复入口

`npx tsx scripts/workflow-real-batch.ts --output=.local/real-batch-preflight` 只读冻结源、规范内容、模型配置与唯一账本；没有明确解除暂停时报告 `PAUSED_NOT_RUN`，零派发，不重置账本。扣子兼容准备运行 `npx tsx scripts/workflow-coze-candidate.ts`，只生成现有两个项目的本地脱敏映射。

恢复时由本人提供私有授权文件，kind为`OWNER_APPROVED_LIFEOS_REAL_BATCH`，含`pauseLifted`、`head`、`sourceDigest`、`contentHash`、`ledgerSha256`、`modelSignature`、`expiresAt`、`maxSpendCny`及`ownerApprovalEvidence`与其`ownerApprovalSha256`。数值须在现有可核验剩余预算内；文件不能由生成者自签。当前模型能力检查必须匹配该配置。设置`LIFEOS_REAL_BATCH_AUTHORIZATION`为该文件、`LIFEOS_REAL_BATCH_OUTPUT`为新的证据目录、`LIFEOS_REAL_BATCH_EXECUTE=owner_authorized`后执行 `npm run test:backend -- --file=workflow-real-entry.test.ts`，自动使用隔离数据库与原宿主。不需修改产品代码。

入口顺序为小批、四连续链、20复杂配对、20普通交互；每阶段保留首次失败和取消，普通最多一次生成，未知费用按预留占用。独立六轴审阅回执须绑定实际阶段转录hash及执行证据，缺回执后续质量阶段暂停，不能以生成者打分放行。扣子当前副本和真实Skill运行仍须另行解除云暂停及获取对应版本，当前入口不会自动上传或部署；云执行准备与已完成实际验收分别记录。
