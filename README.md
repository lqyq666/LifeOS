# LifeOS

面向大学生的个人 AI 成长决策伙伴，帮助用户看清自己、梳理方向，并把目标转化为可开始的小行动。

- 正式作品网址：[lqynb.xyz](https://lqynb.xyz/)（试运行，需要已开通的邮箱账户与对话资格）。
- [使用说明与材料中心](https://lqynb.xyz/competition/) · [五页使用说明 PDF](docs/competition/LifeOS_User_Guide_and_Submission_Checklist_20261023.pdf) · [可编辑源文件](docs/competition/LifeOS_User_Guide_and_Submission_Checklist_20261023.md)。
- [产品设计 PDF](docs/competition/LifeOS_Product_Design_20261023.pdf) · [功能验证与效果佐证 PDF](docs/competition/LifeOS_Functional_Validation_Evidence_20261023.pdf)。
- [交付状态与对应运行版本](docs/competition/DELIVERY_STATUS.md)：产品候选 `a12fd22`；文档提交与产品发布分别记录，当前发布核验中。

本仓库保持私有，评委查看代码需仓库所有者邀请。两份原报告分别保留 `88bd390 / final80` 与 `a12fd22 / final89` 测试口径。`final89` 的三项速度未达原目标；当前模型回复可能重复或不完全符合格式，材料需自行审阅，产品不自动发送或执行。真实学生长期效果尚未完成验收。

当前产品是面向中国大陆成年大学生的专属 AI 分身与成长决策伙伴，完整目标和验收见 [PRODUCT.md](PRODUCT.md)。开发断点见 HANDOFF.md，实施依据见 .planning/research/campus-growth/BRIEF.md。docs/v1.3-action-coach 保存历史组件目标，不再是当前整体验收。

## 本地开发

环境：Node.js 24、Docker（本地 PostgreSQL 17.11）以及 Python 3.12。先在本地将 [.env.server.example](.env.server.example) 复制为 `.env.server`，仅在私有环境填写模型密钥。新建开发环境可运行 `npm run db:setup` 建立专用本地数据库，然后 `npm run db:migrate`。已有数据库配置应先核对目标与备份。

离线检索依赖、固定模型和生产构建所需的能力证据见 [部署说明](deploy/README.md) 与 [部署交接](DEPLOYMENT_HANDOFF.md)；这些环境资源和密钥不随公开材料提供。准备好后分别运行 `npm run server` 与 `npm run dev`，访问 `http://127.0.0.1:5173`。本地启动地址不是参赛作品入口。

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

本批真实入口（暂停期间只运行 preflight，零模型/云派发）：

```powershell
npx tsx scripts/workflow-real-batch.ts
npx tsx scripts/workflow-coze-candidate.ts
npx tsx scripts/workflow-coze-real.ts
```

恢复产品模型后，现有 `workflow-real-entry.test.ts` 是隔离数据库执行入口。授权需绑定 HEAD、sourceDigest、contentHash、原账本 SHA、模型签名、到期时间、既有余额以内的 maxSpendCny，以及本人批准证据文件及其 SHA。需连续完成一次批准批次时，设置 `waitForIndependentReview:true`，并预先配置 `reviewReceipts.small/four_chains/complex20_pairs` 的本地文件路径。执行进程保留隔离账号和数据库等待实际独立审阅，读取真实结果的六轴回执后继续，不另申请同一批权限。审阅不通过、授权到期则停止后续派发；停止后不得重发已有尝试。深入任务使用明确标注的合成输入预存接口夹具，零预备生成，两方向4次、三方向5次；这不能代替真实普通聊天或界面效果验收。结果保留失败、无首内容的 null、未知费用与预留。`BLIND_REVIEW_INPUT.json` 不含单/多模式映射；实际映射只在执行日志，不能交给盲评者。代码检查回执格式不能证明真人独立性，需要实际外部审阅证据。

扣子入口独立需要明确解除云暂停与当前副本配置。先生成本地兼容候选，再以 `npx tsx scripts/workflow-coze-real.ts --authorization=<private-authorization.json> --output=<unique-output> --execute` 运行获准的首次尝试；无授权准确返回 PAUSED_NOT_RUN。授权 kind=`OWNER_APPROVED_LIFEOS_COZE_BATCH`，含 pauseLifted、head/sourceDigest/contentHash/ledgerSha256、ownerApprovalEvidence/ownerApprovalSha256、expiresAt、maxSpendCny、fundingScopeAllowsCoze，以及仅两个现有 projectId 的 endpoint、tokenEnv（仅环境变量名）、release、maxCostPerRequestCny、copyReadbackEvidence/copyReadbackSha256。总六次请求的足额上限必须落在既有获准余额内，不增加预算。副本 `/run` 必须返回 runtime 的 projectId/release/sourceDigest/contentHash；receipt 包含实际 id 和 complete/unknown 用量状态。知识项需对应 allowlist 的 documentId/revision/contentHash；工作流不得提交学生状态、不得超过5次生成，Skill 回执须匹配对应版本。输入为合成成年数据，场景包括正常、来源冲突和在途取消；异常回执在本地拒绝。费用未经真实核对保留 unknown 和全部预留，不信任响应自行声称的零费用，不收费重试。入口不上传/更新/部署副本；当前副本兼容内容需在解除暂停后于原项目实际准备并读回，旧部署不算本候选。
