# 自包含继续开发入口

任务规范为本目录DEVELOPMENT_SPEC.md（原附件复制）；固定范围和冻结测试在KB_TAXONOMY.json、KB_COVERAGE.json、KB_QUERY_BENCHMARK.json、KB_FREEZE.json。当前实现状态与缺口分别见KB_ACCEPTANCE.md、KB_GAPS.md；KB_IMPLEMENTATION_FREEZE.json 是前轮检查点。Coze 接手增量与最新源码指纹见仓库根 COZE_CODEX_HANDOFF.md 和相邻 coze-codex/COZE_INTEGRATION_FREEZE.json。

仓库 D:/aaaLife/LifeOS。本轮未生产迁移、未部署、未远端写入。开发环境已装依赖；测试必须从此仓库根运行，沿用scripts/test-backend-isolated.ts，严禁将测试连接改为主库。

```powershell
Set-Location -LiteralPath 'D:\aaaLife\LifeOS'
node --experimental-strip-types --test tests/evergreen-guide.test.ts
npm run typecheck
npm run typecheck:server
npm run build
npm run test:backend -- --file=evergreen-knowledge.test.ts --file=coach-knowledge-relevance.test.ts --file=coach-knowledge.test.ts
npm run test:backend -- --file=action-coach-engine.test.ts --file=action-coach-material-boundary.test.ts
npm run test:backend -- --file=evergreen-index-load.test.ts
npm run test:backend -- --file=evergreen-browser.test.ts
npx tsx scripts/evergreen-audit.ts
```

evergreen-knowledge.test.ts会在临时DB中真实编码、导入、查询、评估并写KB_RETRIEVAL_EVAL.json/md；withdrawal检查在评估后执行。性能使用合成内容另表记录，不添加Provider调用。根测试和服务端类型原有失败应保留，不能只跑本轮绿项称整库通过。

内容维护：scripts/evergreen-seed.ts保存机制和动作草稿，evergreen-knowledge.ts支持freeze/acquire/draft/reopen/review/import/index。freeze已完成，不得覆写原冻结集。新增来源应记录实际原文短quote/定位；先提炼、再重新打开原文语义审阅，review命令只校验已明确写出的KB_SEMANTIC_REVIEW.json，不提供自动批准。批准新内容后必须提高卡修订；已经存在的相同修订内容改变会报409，不能绕过。

import/index命令仅接受lifeos_dialogue_test_/live_临时目标；不准为了方便修改主连接。生产迁移与上线不属于本轮授权范围。029-evergreen-knowledge.sql是追加迁移，保留原卡、修订、历史引用、事件与个人数据。

完整方法接口 GET /api/knowledge/:id?revision=N 必须登录，只返回当前有效获审卡；UI以原生details展开。来源status退役后读、引用保存、使用记录均无效。公共方法正文通过不可信标签进入方法槽，不写个人经历。

预算：唯一原账本 .local/v1.3-action-coach/paid/provider-calls.json，当前有1笔未结清。不要复制、重置、补零或替未核实的调用写成功/失败；只能在实际收据/响应终态核实后处理，然后重新snapshot。新增调用使用既有预算保留/结算与每次真实收据；真实模型/正常20样本目前没有本轮证据。

下一批先补16张needs_review的具体来源缺口和59个候选分支。旧8张自拟与8张研究映射见KB_LEGACY_MAP.json；4个研究案例仍独立保留。可选12草稿文件未找到，需要实际文件才能核对，不能还原想象内容。
# Coze 接手增量（2026-10-10）

当前入口见仓库根目录 `COZE_CODEX_HANDOFF.md`；本轮补齐官方 CLI 操作技能，
核对两项目部署、增加认证攻略反馈读回与同事务回执、更新仓库业务 Skill 到
1.2.1 local WIP。新证据与本地公开镜像方案位于 `.planning/research/coze-codex/`。
前轮 KB_IMPLEMENTATION_FREEZE.json 及 ZIP 为历史检查点；本轮源码状态由新的
COZE_INTEGRATION_FREEZE.json 标识。整体继续 WIP_NOT_READY，未同步或部署。
