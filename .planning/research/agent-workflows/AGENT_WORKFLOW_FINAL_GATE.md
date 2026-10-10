# 最终Gate与自包含交接
版本：workflow-v2-ffd2186a2231（SHA256源码冻结，不是Git提交）；Git HEAD仍为 70914b1cbd55b75a4d0f74785163d33519f70f71。整体 WIP_NOT_READY，不是RELEASE_CANDIDATE、DEPLOYED或ACCEPTED。

| Gate | 实际最高状态 | 验收边界 |
|---|---|---|
| G0 | CHECKPOINT_VERIFIED | 原85脏文件保护，唯一共享文件最小集成，账本未改 |
| G1 | TESTED_LOCAL | v2契约、14测试、16路由类别；全服务端仍失败 |
| G2 | TESTED_HOST_PG_SIMULATED_PROVIDER | 原SDK+3会话事务闭环；真实模型/学生未签收 |
| G3 | TESTED_ACTUAL_LOCAL_DAG_SIMULATED_PROVIDER | 并行/critic/预算/取消可执行；真实和云候选未运行 |
| G4 | MODIFIED / TESTED_CANDIDATE | 证据话术收口与独立diff；星图实际UI/新会话链未集成 |
| G5 | TESTED_GATE_CANDIDATE | approved来源/独立人工门禁；原16待审/59待来源未完成 |
| G6 | TESTED_PARTIAL_INTEGRATION | action最小hook默认关闭；其他工作流/云Skill未发布 |
| G7 | PARTIAL / BLOCKED | 相关96/96；旧回放exit=0；真实与全库缺口见下 |
| G8 | NOT_READY | 本地源码包/开发演示脚本；正式3–5分钟比赛成片未交付 |

工程证据：VERIFICATION_REPORT.json中9套隔离PG测试 96/96；主入口deadline修改另有g2-main-entry-final.log通过。旧13回放的逐条结果见D_GATE_REPLAY_RESULT.json，使用保存输出的确定性协议适配和假Provider，不能证明新真实模型13条全通过。迁移只在确认全部为合成账号的一次性副本执行，原快照及主库不改。

npx tsc -p tsconfig.workflows.json通过；npm run build通过。完整服务端从62条/38类降到61条/37类，新增类0；仍FAIL。npm test 110/113，3既有星图轨迹/否定第三方主题测试失败，原日志保留；未修复或标绿。构建有体积警告。

失败清单：历史回放首先缺表/列，临时副本现有迁移补齐后12/13；剩余findEpisode缺导入经最小修复后再回放。主入口反馈跨会话usage未更新已修复；早期测试素材/cleanup和共享fixture撤回污染修复在测试隔离层，未重启来源。critic程序校验拆出收费节点。所有初始失败日志保留，详见各Gate。

性能成本：实际新增付费0/新增预算0；普通入口合成SDK计数每轮1、额外0；实际产品20轮p50/p95 NOT_TESTED。未结算调用终态和真实余额未确认，real_provider显式关闭，云AI开发消息不发。旧云Succeeded不是本候选部署证明。

直接复现：仓库现有依赖下运行 npx tsx scripts/workflow-demo.ts（纯合成，无DB、无网络）；powershell -NoProfile -ExecutionPolicy Bypass -File scripts/workflow-verify.ps1（需本机PG和本地认证配置，每套一次性库，不改主库）；npx tsc -p tsconfig.workflows.json。历史13回放还需原合成报告/输出/数据库快照，脚本缺资源时明确NOT_TESTED，交付包不附个人库、账本或凭据。bundle的DELIVERY_README.md包含环境需求。

继续所需实际文件：包内当前源码、5个Skill、tests/workflows、5个workflow后端测试、16类路由夹具、scripts/workflow-*、完整计划和全部Gate证据；SOURCE_MANIFEST/INTEGRATION_PATCH可核验，无需靠提交号猜内容。完整代码包不含node_modules、.env、账本或DB备份。原检查点由CHECKPOINT_VERIFICATION指向现存包。

下一步依顺序：取得未结算Provider终态和真实余额证据（不补0、不新增预算）；已有两Coze项目开发候选写入与合成真实云运行；接私有预算adapter和深度UI的显式选择/取消；完成G4星图引用及4条跨3会话链；继续原evergreen来源/独立审批；收口剩余服务端与3根测试错误；20个冻结真实盲配对+20普通真实性能+独立学生试用；最终再决定能否RELEASE_CANDIDATE。当前不请求生产发布。
