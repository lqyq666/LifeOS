# LifeOS 本地集成：2026-10-10 时间与连续链验收

**最新已提交增量：workflow-v2-integration-c373290f0265，代码/验收提交b66b29a。** 从42a255f继续，6次本地增量提交。攻略反馈跨会话承接、可校验的个人依据—行动缺口连接、有效星图时间窗口、实际Skill版本门禁/降级，以及录屏暴露的愿望误收和退出方向误投影已修复；保留原4工作流/5专业Skill。

当前root117/117、原相关96/96、本轮最终隔离后端73/73及检索/工作流边界14/14通过，范围重叠；类型与build通过。四条各3会话24轮在真实本地认证HTTP、隔离PG、原SDK、Chrome1440/390通过，逐轮实际助手消息/事件/成长/guide usage/Skill执行读回。旧专项65与保存失败13保留为历史起点。视频3分05秒且持续标明模拟Provider，不能称为真实AI效果。

完整结果、逐项表和所有红/绿日志见[LOCAL_ACCEPTANCE_PROGRESS.md](LOCAL_ACCEPTANCE_PROGRESS.md)；436源码、内容、索引、Skill版本与证据hash在SOURCE_MANIFEST.json、CONTENT_MANIFEST.json、INDEX_BINDING.json、SKILL_VERSION_MATRIX.json、RUN_BINDING.json。视频及逐轮状态在evidence/acceptance-20261010/demo/local-campus-story.mp4、FOUR_ROUND_READBACKS.json。录屏进程和后续只完善读回的验收进程分别绑定，不混用候选。旧清单和协议均保留，旧压缩包校验只适用于旧包。

**WIP_NOT_READY / MODIFIED / TESTED_LOCAL / BUILT / COMMITTED_LOCAL。** 真实模型、已有两Coze项目、云Skill、20组真实对照、20真实普通性能和学生签收仍PAUSED_NOT_RUN；59来源缺口、16待审和独立审核未取得继续保留。新增真实模型/云调用、真实预算、收费重试均0；未push、合并、部署或覆盖用户安装。常驻新服务未经核验，临时验收服务已关闭。

---

以下为原0670候选的历史交付，原HEAD、数字与包操作仅适用于当时：

候选 **workflow-v2-integration-0670b2f68bf8**，HEAD仍 `70914b1cbd55b75a4d0f74785163d33519f70f71`。实际最高状态 MODIFIED / TESTED_LOCAL / BUILT；完整未验收，**WIP_NOT_READY**。旧候选 `workflow-v2-integration-ee442ef15ffa` 与旧协议/失败证据保留，不混合计分。

本轮完成实际代码和本地链路：

1. 复用原时间/来源机制，保存常规360与本周剩余120两条事实，当前计划与深入比较使用本周120。本人、第三方、已花时间、机会要求及下周分开；同作用域冲突保持未知。限定周记录按Asia/Shanghai有效窗口读取。
2. 原waiting_user明确追问后，“六小时”、估计、上限、下周和拒绝继续可承接；无上下文仍未知。保持原任务身份、控制/来源/代码指纹、取消、并发和不得重复派发。追问过期拒绝复用。原句柄曾在SDK提示中丢失，红测后恢复同一来源句柄。
3. 零时间生成空行动列表，显示“暂不新增行动”；不以1/5分钟凑协议。原候选实际invalid_contract红证据与修复后0/1/4/120分钟绿证据均保留。
4. 个人原话按support/limit/unknown进入支持、限制或未知；省略关系默认为未知，防止全部当优点。未绑定公开攻略的动作标为LifeOS编辑建议。原五Skill、四workflow与批准攻略/guide usage接口继续使用。
5. 完成联系复盘、自由职业与就业、创业与升学、课程与备考四条链：每条6轮跨3会话，共24轮；正常认证HTTP、原SDK、隔离PG、Chrome1440/390。联系更正采用未知不清掉发送/已读；零时间暂缓；阶段方向改变保留旧作品；新机会的10小时要求不冒充本人预算。连续链暴露的星图经历关系类型错误已修复，并保留旧数据的严格兼容回归。

| 验证 | 本候选实际结果 | 证据（evidence/local-time-20261010/） |
|---|---|---|
| 根测试 | 114/114：原113保持，新增保存星图回归1项 | root-current.log |
| 原相关九套 | 96/96，本地模拟/契约 | VERIFICATION_REPORT.json |
| 时间/持久host/零动作/个性化等九套 | 65/65，包含原新4项相关覆盖；与其他套有重叠，不累计独立总数 | product-final.log、browser-http-current.log |
| 旧保存失败隔离回放 | 13/13；原快照不改 | dgate13-replay.log、D_GATE_REPLAY_METADATA.json |
| 正常HTTP/browser四套 | 4/4，1440/390 | browser-http-current.log |
| 授权采纳浏览器复验 | 1/1，与上行HTTP套重叠 | adoption-ui-current.log、adoption-ui/BROWSER_CHAIN.json |
| 四条连续链 | 24轮 / 12会话 / 24张截图，六项状态逐轮PASS | FOUR_TRAJECTORIES.md、FOUR_TRAJECTORIES.json |
| 前后端typecheck / build | PASS；既有Three体积warning保留 | server-current.log、frontend-current.log、build-current.log |

红测：time-red.log（原36用例19绿17红）、ZERO_RED.json/zero-red.log（原适配器真实0分钟invalid_contract）、provider-clause-red.log（SDK丢句柄）、graph-red.log/TRAJECTORY_UI_FAILURE.json（真实图读回阻断UI）。修复、验证及再次Review见 FINAL_REVIEW.json。早期夹具/429限流/并发清理失败日志也保留，不把失败换成另一候选的绿结果。

资料来源仅核对已存本地正文片段、revision与引用范围，13个优先攻略见 LOCAL_SOURCE_BRANCH_AUDIT.json。四个连续链攻略适配候选已保存到 PRIORITY_BRANCH_REVIEW_CANDIDATES.json，状态needs_review，未自批、未导入服务。原32攻略：16approved/16needs_review；112分支：53 covered/59 awaiting_source，59缺口逐项保留。没有进行新互联网采集或云审稿。

版本分开记录：仓库主Skill1.2.2-candidate；五业务Skill0.2.0-candidate，文件保持；用户安装主Skill1.2.0，只读核验未覆盖；云主Skill1.2.0仅历史记录，未取得新内容hash，PAUSED_NOT_RUN。验收HTTP临时进程代码摘要 `cf706bcaaf362be14e735576c2fb81d1723fc5bf89697f10f2ac88457e671ae6`；读模块指纹不是常驻运行服务证明。SKILL_VERSION_MATRIX.json保留真实各进程元数据。

交付绑定：SOURCE_MANIFEST.json的431份源码hash + CONTENT_MANIFEST.json + INDEX_BINDING.json + RUN_BINDING.json。后者逐项绑定当前测试日志hash，自动核验脚本VERIFY_DELIVERY.py在不一致时STOP。runtime sourceFreezeDigest含各进程配置，应与该进程捕获记录比较。旧COMPLEX_DECISION_AB_EVAL/ORDINARY_PERFORMANCE_PROTOCOL/SAFETY_EVAL文件未改，不能把旧候选协议直接作为新候选结果；新真实测试须重新声明绑定。

所有生成内容由明确标记的SCRIPTED/模拟Provider提供；认证、持久化、SDK、HTTP与Chrome是真实本地执行。模型名、token和估算费用属于模拟合同字段，不能当真实调用。新增真实模型/云调用0、预算0；原唯一付费账本SHA未变。仅在临时隔离PG迁移/测试；未改主库，未部署生产，未改云候选，不reset/clean/commit/push/merge。

真实模型、Coze云候选/云Skill、最终性能、盲评、真实学生验收全部 **PAUSED_NOT_RUN**。继续开发未解除暂停。当前剩余问题是上述未验收项目与59来源缺口，不具备ACCEPTED/生产发布结论。

解压新包到独立目录，不覆盖原脏工作区。先运行 `python VERIFY_DELIVERY.py` 核验包内全部内容；需现有Node依赖、本地PG与Chrome才能复验业务链。配置、凭据、node_modules、真实账本和数据库均未包含。RUN_BINDING.json列出本轮实际命令，保留源码和fixture，缺资源应明确NOT_RUN。当前开发源码仍位于D:/aaaLife/LifeOS，未另造checkout。

---

以下为历史候选 `workflow-v2-integration-ee442ef15ffa` 的报告，数字及指纹仅适用于当时，不代表当前验收。

当前增量已完成本地浏览器承接与个性化选择契约修复：root113/113、相关96/96、新产品4/4及原HTTP/浏览器链1/1，类型/build通过。真实模型与云端仍暂停，整体WIP_NOT_READY。最新结果见本报告“2026-10-10 继续集成实际结果”；下方原集成段保留历史验证边界。

候选源码版本：`workflow-v2-integration-ee442ef15ffa`；当前运行指纹见 evidence/continuation/WAITING_BROWSER_GREEN.json。

# LifeOS 工作流本地集成交付

当前状态 **WIP_NOT_READY / MODIFIED / TESTED_LOCAL / BUILT**。没有部署、push、合main或用户价值签收。仍为4条工作流、5个专业Skill、唯一学生聊天入口。当前源码摘要及423文件hash见 SOURCE_MANIFEST.json；原420基线清单见 evidence/continuation/BASELINE_SOURCE_MANIFEST.json；摘要不是Git提交，HEAD仍70914b1cbd55b75a4d0f74785163d33519f70f71。

## 学生任务与实际结果

1. 原生聊天承接行动反馈：更正“没回复、没采用”后，replied/used=false，独立的sent/read保留，旧效果清除。未知=null；逐字段保留实际消息与事件revision依据，旧错误前提退出后续提示。原拒绝选择不因“联系了”自动变成接受。认证GET、刷新和新会话读回通过。
2. 聊天里的深入分析：选择2–3方向，看真实任务与节点进度，可取消；看到候选后只采纳小行动、明确改阶段方向或不采用。分析不写个人事实；小行动保存为尚未执行。独立critic与最终综合使用原SDK，整图事前预留，2路径4次、3路径最多5次；最后只选择已审fact handle，禁止合法ID夹带虚构收入等。缺本人时间先持久waiting_user，不调用模型。
3. 合法提交后的成长变化：原finishRun事务把真实目标、约束、经历变化投影到growthDiff及星图；本人已确认记录不再假装待确认，任务数量不给身份定级。实际经历“海报交付、300元”进入星图；删除后旧解释不复活原话。下一会话原生聊天读到已提交阶段目标，仍仅一次合成生成。
4. 常青攻略：实际读取IES公共原文并保存正文hash/引文位置，同canonical卡生成revision2，区分原文支持与LifeOS适配。隔离导入/索引生命周期与旧修订失效门禁通过。独立Agent审阅和真实人工审批未取得，保持needs_review；学生API拒绝该修订。

以上聊天生成是本地合成Provider响应，底层认证、HTTP、原生SDK、PostgreSQL和浏览器真实运行。不能据此宣布真实多Agent语义质量或学生价值成立。实际交付内容、逐项四层判断见 WORKFLOW_ACCEPTANCE.json。

## 本轮验证

| 检查 | 实际结果 | 原始证据 |
|---|---|---|
| 全服务端类型 | PASS，原37类问题已收口 | server-final.log |
| 根测试 | 113/113；原3失败修复 | root-final.log |
| 原相关9套 | 96/96，仍为模拟Provider | evidence/VERIFICATION_REPORT.json |
| 新边界/持久化及相关星图 | 24/24 | focused-final.log |
| 原生HTTP与浏览器闭环 | 1/1，多步骤；1440/390无横向溢出 | http-chain-final.log，HTTP_CHAIN/BROWSER_CHAIN.json |
| 旧保存失败回放 | 13/13 GREEN；原快照仅克隆，不改来源 | evidence/dgate13-replay.log |
| 前端构建 | PASS；保留既有Three大chunk提示 | ui-build-final.log |
| 运行进程版本 | 真实HTTP读到启动指纹，与源码冻结一致 | evidence/PROCESS_VERSION.json |

回归覆盖257完成项、两worker相同请求、重启旧ID、派发后崩溃、超时未知预留、来源撤回、5类最终虚构事实、未知不阻塞及SDK部分usage。账本不清空，未用新建实例逃避计费幂等。default关闭时聊天不依赖新增任务表读写，不迁移主库来凑验收。

## 直接复现

在 D:\aaaLife\LifeOS 使用原有本地配置、已安装依赖、本机PostgreSQL角色的createdb权限。所有下列业务测试创建一次性数据库，不迁移lifeos主库。

```powershell
npm run typecheck:server
npm test
npm run build
$env:LIFEOS_WORKFLOW_EVIDENCE='.planning/research/workflow-integration/evidence'
./scripts/workflow-verify.ps1 -Directory .planning/research/workflow-integration/evidence
npm run test:backend -- --file=workflow-audit-boundaries.test.ts --file=workflow-journal.test.ts --file=workflow-runtime-adapter.test.ts --file=workflow-public-card.test.ts
$env:LIFEOS_WORKFLOW_BROWSER='true'
npm run test:backend -- --file=workflow-http-chain.test.ts
```

浏览器脚本使用本机Chrome与Codex捆绑Playwright；其他机器可设置PLAYWRIGHT_MODULE指向已有Playwright。测试启动/关闭自己的localhost候选服务，完成后清理自己的DB；不是持续在线服务。WF-D只复用已捕获公开正文，不需要再次联网。旧13回放还需本机原合成快照和保存日志：`npx tsx scripts/workflow-replay-dgate.ts`；缺资源时报告NOT_TESTED，不能只凭exit=0。

候选生产功能默认关闭。真实adapter开关需要当前源码/配置冻结、原付费账本和既有授权；本轮不启用付费或发布。030迁移仅在一次性库验证，主库未应用。

## 保护、成本、失败与下一步

原198个未提交文件全部仍存在，G0备份zip及hash见BASELINE_DIFF.json。原ffd2186a2231清单与失败证据保留；新增文件与共享修改由本任务同一集成点完成。原唯一账本SHA保持03891a1f...682a1a4，新预算0、新付费0；一笔0.1245184元保留预留，终态/usage未知，没有补零或重发。原授权保守剩余额11.2669713元不等于供应商账户余额。

初始4探针红测、服务端37类和根3失败，以及SDKcallId桥接、预算词“可用”、原生提示中测试fixture文本分离问题等修复记录留在本目录各attempt/red日志。正常生成默认取消自动收费修复；只有明确的测试observer可开启合成修复。

尚未验收：真实Provider小批语义、多轮学生任务、独立盲评及至少20真实普通性能样本；独立攻略审阅/人工发布；原16待审与59来源缺口；已暂停的Coze候选/Skill加载、工具执行和远端读回；正式比赛成片。安全集与20复杂价值案例已拆开、阈值预声明但未运行。下一步只解冻获准的对应真实调用，保留全部首次失败成本，完成上述价值签收后再决定是否具备发布条件。

追加实际待审卡核查：exam-diagnosis（d259a5aa-ec96-43f7-89ab-5f5c87031f1c）原状态needs_review。本轮对同一已捕获IES原文提炼候选revision2，技术审阅明确发现该原文不能支持四类错误诊断及科研/任务归因。原四分支保留awaiting_source，独立审批不足，隔离导入读回仍被学生API拒绝。没有将该来源缺口冒充解决，原53/112覆盖与59缺口不变。证据：public-card/needs-review-candidate.json、PUBLIC_CARD_CHAIN.json、public-card-final.log。

各Gate的代码版本、失败边界、成本与下一步：GATE_STATUS.md。补充普通性能预声明：ORDINARY_PERFORMANCE_PROTOCOL.json（20业务样本、未执行）。

最终身份补充验收：已有授权成长 API 的创建、更正、遗忘在同一事务内同步真实中央身份；当前修订替代旧引文，遗忘同时撤回已退休事件中的新旧原话。后来的本人身份显式编辑具有独立来源。假设、疑问、引用和第三方不会成为本人身份。原红测与第一次条件边界失败保留，最终4项身份/星图回归与完整 HTTP 链见当前日志。

## 2026-10-10 继续集成实际结果

当前源码候选 `workflow-v2-integration-ee442ef15ffa`，前一候选 `workflow-v2-integration-377e87a9bc39`；HEAD仍70914b1，未提交。420文件基线全部匹配后保存本地检查点，仅修改5个既有运行文件并新增3个回归文件。当前源码清单423项；精确差异见 evidence/continuation/INTEGRATION_PATCH.diff，旧清单见 BASELINE_SOURCE_MANIFEST.json。没有增加Agent、工作流、依赖或生产迁移。

waiting_user 的真实Chrome红测已保存：只补“这周六小时”后仍waiting_user且没有继续入口，普通合成SDK一次、深度零次。修复后正常聊天补充→原任务“继续这次比较”→原就业/考研候选，原背景、方向和requestId保留；普通最多一次、两路径四次、刷新零重复。1440/390浏览器通过。恢复仅允许零派发、零预留的原waiting回执，事务锁保证两个worker只启动一次；取消、跨账号、控制/来源变化、过周时间与不明派发均禁止重开。

个性化对照先失败：每路径一个动作、统一5分钟。现改为同一方向可选不同可停止动作、取舍和建议时间，不生成新事实。已完成作品的合成案例选35分钟证据对照，缺岗位/作品的案例选20分钟要求核对，取舍不同；引用与未知保留，独立critic和最终已审字段校验未放宽。这些选择来自脚本Provider，只证明契约可以产生差异，**真实模型是否根据个人证据做有用取舍仍NOT_TESTED**，不宣布产品个性化签收。

当前类型/build通过、root113/113、原相关96/96、新产品回归4/4、原HTTP/Chrome连续链1/1；旧24及13回放保留前次通过，不冒充本轮真实模型效果。日志均在 evidence/continuation/。初次浏览器探针误用SSE response.finished导致等待，已中止自有测试并改为检查UI终态；各attempt记录保留，最终红测8.5秒、绿测约11秒。未停止用户关键服务。

免费来源维护实际读取MIT CAPD读研目的与简历证据原文，HTML和正文hash、短引文位置、适用范围见 sources/SOURCE_EVIDENCE.json；完整正文仅在.local，交付短引文与原创适配。Jina401和web open429没有冒充成功，随后canonical HTTPS直接读取成功。两个既有canonical仅形成revision2待审候选，来源同属MIT不算两个独立发布方；不自动导入/批准，112范围、53已覆盖及59缺口保留，中国考研资格与精确投入时长仍无该来源支持。

原账本2022笔、2021完成、1笔终态与usage未知；¥0.1245184预留保留，账本hash未变。原grant保守剩额¥11.2669713不等于供应商余额。账本paused=false不代表用户解除本次暂停；本轮新增付费0、云写入0、预算0。现有报告已更新，用户安装/仓库/云Skill分开列出。临时附包AUDIT_PROGRESS/CODEX_NEXT_EXECUTION/PROGRESS_SNAPSHOT已不存在，不能声称读到了原附包；已读取仓库现有工单、审计和最新交付，由当前用户请求覆盖旧工单的过时缺口。

真实小批继续PAUSED：解除对应暂停后先1次两方向、1次三方向及少量普通/复盘，逐节点记录request/usage/状态/语义；通过后才4条跨3会话、20复杂盲配对与20普通性能。无真实Provider胜率/性能/学生签收。整体仍 **WIP_NOT_READY / MODIFIED / TESTED_LOCAL / BUILT**，未push、合main、生产部署。
