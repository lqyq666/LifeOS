# LifeOS 开发交接

工作区 D:\aaaLife\LifeOS。当前唯一验收目标是 PRODUCT.md 的校园成长与连续决策完整产品。用户已恢复自主开发，允许在原 grant 剩余额度内选择产品模型；旧固定 qwen3.8-flash 与旧实现顺序已替代。整体 WIP_NOT_READY。公网 lqynb.xyz 仍是旧 52a4e47 镜像，不代表新产品已发布。

## 2026-10-05 当前：恢复校园完整产品开发

### 第五批：政策范围形式与未知边界（免费，本地）

- 接续 `f2b957d`。免费红测证实旧维护导入只检查已有值，空对象、缺字段、数字或空白范围可被接受；导入/引用/检索共用完整范围校验后通过。
- 兼容历史 `scopeKeys` 精确五文本范围；新增 `scopeRules` 的 specific/all/not_applicable/unknown。核实具体、全部或不涉及范围须附维护卡 excerpt 原文；不涉及另有解释。未知可诚实存储，但任意未知令适用性判断弃权，不当成泛化通配符。全国时段无需伪造学校/院系，具体年度/对象仍匹配；两套冲突范围和非法字段被拒绝。来源维护审阅仍负责核实原文是否支持范围，形式校验不能证明个人资格。
- 回归覆盖全国政策无虚构学校、年度错配、未知弃权、范围证据不在原文、类型/空白/缺失/额外字段和新旧表示冲突。新增后知识源12/12、引擎42/42、离线实际语义检索1/1和服务端类型检查通过；最终全量34文件191测试全部通过，日志 `policy-scope-final-backend.log`。客户端45/45与构建已于第四批通过，本批未改客户端/依赖/迁移。日志 `.local/campus-growth/policy-scope-*.log` 保留原红测。
- 本机直接只读核对研招网2027招生规定和浙江2026专升本通知；`.planning/research/campus-growth/official-source-registry.json` 区分发布/落款/适用年度、不同报名动作与未读附件。仅 RESEARCH_ONLY_NOT_IMPORTED；未有原始字节hash、附件正文和个人资格核验，不导入成已验收产品知识。复用已有维护卡、SDK/TypeBox及引用失效机制，未安装抓取或Agent框架。
- 没有新付费调用、生产写入或部署；付费比较仍等待主线程处理自动审批授权问题。完整连续产品仍 WIP_NOT_READY。

### 第四批：真实交付缺失回归与受控比较准备（本地，未部署）

- 接续 `ce219e9`，继续同一隔离 fix 分支，不覆盖用户改动、push 或合并 main。提交前再次只读检查没有其他 LifeOS Node/Git 开发进程。默认产品仍 qwen3.8-flash/关闭思考；候选只在独立比较进程配置。
- 两份真实 API 探针均保留 **FAIL**：Flash 的 R3 对明确起草要求只给抽象建议；Max 给了可发送文本但放在 reply、未产生 action，且一个 background.value 不在原话 quote 内。R1/R2/R4 各通过不代表业务交付或整体接口通过。原报告/原文/收据分别在 `.local/campus-growth/provider-flash-20261005` 与 `provider-max-20261005`，旧冻结不覆盖。
- 免费最小回归首先复现 Flash 提交漏洞（`missing-delivery-red.log`），修复后 40/40。新拒绝对照又先失败（`direct-draft-boundary-red.log`）：不得把“不要直接起草”与普通“我想问”跨句组合成当前起草指令。当前 guard 仅对分句开头明确“直接起草/请直接起草”及既有材料展示合同要求 action.draft；不是通用语义意图分类器。抽象建议得到一次具体修复，二次失败不保存 assistant；合法修复的材料只保存一次、保留确认需求目的，拒绝旁的普通问句一轮完成。
- `scripts/probe-model.ts` 在账户/传输错误的收据结算后停止其他夹具，不继续收费请求；自然业务结构 FAIL 仍原样记录，不弱化 R3。
- 新 `scripts/compare-campus-models.ts` 固定两组复杂成年学生合成案例，复用当前 SDK/原 prompt/native schema/同一金额账本。区分团队奖项与个人贡献、收入与时间限制、留本地陪家人与外地实习、学校政策与同学说法。拟同题 Flash/Max/Plus 非思考以及 Max 2048 思考对照；无自动重试、60 秒单调用上限、总输出 token 有界、思考 token 按 completion usage 计费、没有打印或保存思维链。输出标记 PARSED_NOT_COMMITTED/事务未验证/待人工审阅，不能计业务成功或普通20样本。`--preflight` 已免费通过，Provider 0；同题真实比较尚未执行。
- 执行真实 Flash 两案例的命令被自动审批拒绝，补充父线程给出的用户授权原文后原样仅重试一次仍拒绝。理由为审批未认可后续转述授权覆盖最初零付费要求。两次均未启动 shell、未 reserve 或发送调用；不改通道绕过，付费部分暂停并已报父线程处理。脚本与预检保留为具体可审阅结果。
- 最新唯一原账本 **414 finished、0 pending**。原新增 ¥30 grant 保守占用 **¥2.0787178**、余 **¥27.9212822**；其中两次取消未返回有效 usage，合计预约上限 **¥1.9554304** 保守占用，不是确认账单。旧追加/原计次/生产预算不叠加，不重置收据。不得将被拒绝的新比较算作调用或费用。
- 全量 `npm run test:backend`：34 文件、189 测试通过；`npm test` 45/45；`npm run typecheck:server` 和 `npm run build` 通过。日志 `.local/campus-growth/fourth-backend.log`、`fourth-unit.log`、`fourth-typecheck-final.log`、`fourth-build.log`。Three.js 既有 1.17 MB 分块警告保留。上一批真实 Chrome + 模拟模型和非空 PG 43 表恢复验证仍在，不宣称本批真实模型/生产浏览器验收完成。
- 继续 **WIP_NOT_READY**：API 能力和自然业务质量尚须分开取得真实证据；高思考/Plus 比较、校园完整连续链及反事实、官方政策来源模块、≥20 普通有效首内容/完成速度、每100成功交互含失败修复的完整成本、条件发布 Gate 均未完成。实际产品前不得用单元绿或模型自评替代。原 UI/卡通/3D资产未修改，生产未写入。

### 第二批：对话增量、待核对观察和精确遗忘（本地，未部署）

第三批正在准备真实比较：已免费核实 Flash/Max/Plus 严格结构和来源/版本配对、单档2048思考预算/8192总输出/默认关闭、SDK完整思考token计费且不展示隐藏推理、校园13支(10场景)人工入口及每100成功交互成本。动态接口及思考模式均入签名/冻结，旧能力不能直接复用。预检预算修正为 currentGrant 优先，不使用旧additional补钱；唯一真实账本仍406finished/pending0，原grant剩¥29.9589132，尚未开始本批付费。免费校园预检通过真实本地认证/独立数据库/成长读取且删除临时库。新真实链仍待测，不是产品通过。

- 单轮可选 `growthUpdates` 与回复在原事务中提交；本人事实必须逐字来自当前用户消息，目标修改取授权条目版本，未变短片段不能擦掉原信息。观察只作有本人依据和明确局限的 proposed，用户采用后仍保持 AI 判断标记。行动反馈独立记录未做/尝试/卡住/动作完成/未知，动作完成不表示结果已达成。
- 新 `015-growth-observations.sql` 保存观察局限、实际行动状态及精确来源抑制。遗忘原话只抑制该消息的具体片段，清除成长历史和递归衍生内容；后续聊天上下文、个人记忆与经历检索排除失效依据，其他独立事实仍可用。原聊天作为用户记录可查看。拒绝/暂停单列 growthBoundaries 尊重边界，不作有效事实或建议依赖；提交再次验证有效状态和边界快照。
- Chrome 真实登录/隔离 PG/模拟模型：反馈状态、观察局限、采用后仍为 AI 判断、原创建丢回应重试、跨认证浏览器和1440/390/320布局通过。最新报告 `evidence/v1.3-action-coach/browser-local-1791193265338/report.json`。
- 完整后端33文件178测试通过；随后增加边界快照回归，成长定向9/9、SDK引擎38/38通过。客户端45/45、类型检查与构建通过。43表/16迁移真实恢复包含8成长项、11成长修订、1精确来源抑制，所有表内容哈希一致；恢复后继续更正/依赖失效/遗忘、观察局限和动作状态保持。报告 `.local/campus-growth/recovery-second-final/recovery-report.json`。最初恢复夹具变量重名、观察误引用含已遗忘片段两次失败日志保留；改成独立有效来源后通过，未放宽来源校验。
- 日志 `.local/campus-growth/` 中 `backend-second.log`、`growth-model-final.log`、`growth-engine-final.log`、`browser-second.log`、`unit-second.log`、`build-second.log`、`typecheck-second-final.log`、`recovery-second-final.log`。零新收费，未改默认 qwen3.8-flash，未部署/push/合main。Schema结构已改变，旧能力报告不再证明当前接口；需下一批冻结接口后重新验证，不能伪造复用。
- 下一步：官方来源正文与有效期/适用范围、合成成年学生连续链真实交互和差异对照、模型比较及最终20普通速度/混合成本。完整产品仍 **WIP_NOT_READY**，本地单测不等于这些语义验收。

### 第一批：成长工作区与可靠的个人状态（本地，未部署）

- 新增 `014-growth-workspace.sql`、growth 模块和“我的成长”界面：用户明确填写处境、能力依据、偏好、未知、目标、方向、时间约束、近期重点、选择及反馈。记录有原话来源、版本、依赖和有效期；更正保留无关条目，旧版本依赖递归失效；遗忘清除该项/衍生内容及历史快照。用户界面状态不代表真实对外执行。
- 相同操作幂等、跨设备修订冲突阻断。关闭跨会话记忆后，AI 仅使用当前会话条目，用户仍可管理本人记录。当前有效成长状态已进入真实 SDK 请求，完成保存前再次检查快照；生成期间更正或新增目标会阻断过时回复提交。当前 AI 尚不自动抽取成长条目或形成完整方向工作流，这是下一批，不称完整链通过。
- 原 `App`、3D/2D Companion 与动画资产、原主题/聊天样式未删除或替换。新增页面沿用原深色/字体，原聊天、欢迎、等待和回应中的人物继续保留。Chrome 验证桌面1440/窄屏390/320、另一独立认证浏览器读最新更正并遗忘；保存回应丢失时保留输入/复用请求ID/不生成重复条目。
- 本批免费检查：完整隔离后端32文件166测试；随后新增来源撤回回归12/12、SDK成长上下文引擎36/36；客户端45/45、服务端类型、构建、Chrome通过。旧浏览器替身案例未明确要求成品，触发现有材料边界；修正合成输入明确起草，未放宽生产校验。初始表单可访问性失败及旧替身失败原报告/日志均保留。新真实模型与最终20普通速度尚未测。
- 日志 `.local/campus-growth/`：backend.log、growth-boundaries.log、growth-engine.log、unit.log、typecheck-server-batch.log、build-final.log、browser-final.log。首轮恢复含42表/15迁移但成长表为空；补充非空成长恢复夹具，检查更正/过期/拒绝/幂等/恢复后继续更正与遗忘，结果见 recovery-populated/recovery-report.json。主数据库未改、零 Provider。
- 原grant仍406 finished、pending0、余¥29.9589132，本批零收费。未部署、不push/合main。GitHub复用优先规则已进AGENTS；Brief/sources记录模型官方价格/Schema能力和Readability/Virtual候选。本批只复用已有成熟依赖和仓库模块，未执行外部仓库脚本。

- 实际恢复 HEAD `e0aafd7495566202c08f68738951412a4dbb264c`，分支 `fix/coach-material-boundaries-20261005`；暂停留下 `server/action-coach-contracts.ts` 和 `server/turn-prompt.ts` 两项修改原样保留纳入新目标评估，没有回退/重复旧收费批。当前改动清单以 Git 为准。
- 完整用户目标与授权已保存 PRODUCT.md。README/AGENTS 指向此单一当前目标；旧 V1.3 目标/顺序标为历史。此前各批记录均是历史组件证据，不能代替新产品接受。
- 恢复时唯一 D 盘账本 406 条全部 finished、pending=0；原 ¥30 grant 从 385 条起计，21 调用累计 ¥0.0410868、剩 ¥29.9589132，继续该剩余额度，不新增 ¥30。旧余额及生产 ¥10 池分开。所有旧 runner 已关闭。
- 首发成年大学生，少经历/未定方向/低时间精力必须可用。现有认证、PG、来源校验、事件/经历、检索与材料作为组件复用；当前缺口评估与执行见 .planning/research/campus-growth/BRIEF.md。当前尚未完成新产品闭环，未部署。

## 历史组件记录（以下均非当前产品目标或模型约束）

## 2026-10-05 成品归入行动、流式问句使用语法（历史 e0aafd7 批次）

- 接续 `d106264`。真实 `coach-e8ef140f-947e-4444-8920-d974047555da` 两条独立开场后停止，保留原始输出/请求与人工审阅。A05 可复制文本仅在 reply，event.actions 为空，又把临时考试时间提为教育阶段；不是材料闭环通过。A01 仅开场，不能称整条接受。
- 免费红绿：当前明确要求起草/改写且 reply 实际以交付引导和冒号后非空文本呈现成品，却没有 action.draft 时，使用已有 `COACH_MATERIAL_NOT_VISIBLE` 至多一次具体修复；必要澄清仍一次调用、不强制占位。交付引导共用 staging 的有限匹配，不是通用成品语义识别。引擎定向 35/35。
- `openingQuestionDraft` 用中性问句语法取代长句首/人名白名单；保持完成问号、JSON 解码、引号平衡、敏感声明/引用/因果门，新增建议和确定结论问句门。保存原文的完整问句，未展示事实前言，不改正式回复。7/7 流式红绿回归。此有限初步问句门不替代语义接受或提交校验，真实速度仍须新版本 20 个普通样本验证。
- Schema 只收敛 description 与提示一致：回复从问题/必要回应开始，交付文本归材料；每节点一项陈述，corrections 仅实质更正，background 仅稳定身份/技能。结构签名仍 `1f11c0a4...6af1a6`、原四条真实能力收据保持不变；零 API 检查 `artifact-interface-equivalence.json` 确认 capabilityVerified=true，没有重复收费探针。
- 完整隔离后端 31 文件 155 测试、客户端 45/45、服务端类型与构建通过，保留 Three.js 分块警告。日志 `.local/coach-boundary-20261005/missing-material-red.log` / `missing-material-green.log` / `question-syntax-red.log` / `question-syntax-green.log` / `artifact-stream-full-backend.log` / `artifact-stream-unit.log` / `artifact-stream-build.log`。真实行为、稳定背景与速度待新冻结复核，尚未部署，**WIP_NOT_READY**。
- 唯一 D 盘账本 402 条、无 pending；新增 ¥30 授权 17 调用累计 ¥0.0318079、余 ¥29.9681921；旧/生产池独立，qwen3.8-flash 模型/模式/端点未变。

## 2026-10-05 重复片段不能擦除复合事实（历史 d106264 批次）

- 接续 `a199922`。真实 `coach-7b193fc3-47ff-4cf1-af68-f2ecc6bdceca` 已停止，保留四轮/五调用及独立人工审阅。前三轮无行动且一次调用；第三轮模型却用未变化的人物片段更正整条投入/人物/结果，事件节点和 processTurns 失去其余详情（原聊天仍在实际 Provider 请求）。第四轮再次问已给出的来源/结果并试图继续错误更正。A01 **未通过**，有效首内容 4.96/5.60/6.60/14.11 秒，不算最终速度通过。
- 免费红绿新增 `COACH_CORRECTION_UNCHANGED`：旧事实的原样片段不足以授权缩小替换整个事实。保留原节点，新增当轮信息走 nodes；未知答案、确实变化的引文仍走原更正路径。引擎至多一次具体修复并说明保留原事实；这是结构性重复保护，不是通用语义更正判断。不同引文是否确为用户意图仍须真实语义验收。提示明确每节点一项陈述、补充/重述与实质更正的区别。
- 定向材料 8/8、引擎 34/34，完整隔离后端 31 文件 154 测试、客户端 44/44、服务端类型与构建通过（保留大分块警告）。日志 `.local/coach-boundary-20261005/correction-fragment-red.log` / `correction-fragment-green.log` / `correction-engine-green.log` / `correction-full-backend.log` / `correction-unit.log` / `correction-build.log`。初始红测与每次失败原文保留，不重写为成功。
- 唯一 D 盘账本 400 条、无 pending；本次新增 ¥30 授权 15 调用累计 ¥0.0280042，余 ¥29.9719958。未改模型、模式、端点及旧/生产池。最终真实全轨迹、20 普通样本速度、真实浏览器、恢复与条件部署仍待完成；当前 **WIP_NOT_READY**。

## 2026-10-05 叙述不是交付引导（历史 a199922 批次）

- 接续 `dde78c6`；新冻结 `source-1791185343488` 的真实 `coach-df280b67-46c8-4233-8e47-3e48d96c8dfe` 两轮后停止，原报告/SDK请求/原文/独立 `operator-review.json` 保留。A01 首轮追问行动被修复；第二轮继续追问同时擅自交付联系材料并承诺下一次整理，语义未通过，有效首内容约 8.96/9.83 秒。尚未透露 goal/agreement/outcome/currentNeed，不继续原配置刷样本。
- 实际 Provider payload 系统提示存在、用户/助手角色正确，Schema 仍只要求 reply。新增免费红测确认历史引号“可以”与“到考试前夜发链接”会被跨词匹配为交付引导。引导改为分句起始并不穿越引号，真实“可以先发这段”仍合法；材料边界 7/7、拒绝边界 5/5、引擎 33/33、payload 8/8 与服务端类型检查通过。日志 `narrative-framing-red.log` / `narrative-framing-green.log` / `framing-user-green.log` / `framing-engine-green.log`。
- 提示收敛重复条款：按本轮用途陪伴/追问/交付；复盘缺口等待回答时本轮先完成追问；成品只生成一次、保留角色、目的与边界。未增加额外模型调用或改变接口。真实行为仍须新冻结验证；最终全量本地检查需在剩余修复收敛后跑完。
- 唯一 D 盘账本 395 条、无 pending，新 ¥30 授权 10 调用累计占 ¥0.0163439、余 ¥29.9836561。旧/生产池不叠加。模型 qwen3.8-flash、未部署，状态 **WIP_NOT_READY**。

## 2026-10-05 真实失败复现与帮助角色核对（历史 dde78c6 批次）

- 接续本地 `2eaa4bb`，仍在 `fix/coach-material-boundaries-20261005`。真实运行 `coach-74470d15-383d-4e10-b97a-1bbdc02e73ad` 已关闭，原报告和 `operator-review.json` 保留。A05 两轮直接材料与同一 action rev1→2 保持确认需求目的，但首轮回复复述、有效首内容约 9.18 秒；A01 只执行三轮，仍未通过：追问材料被拒绝后修复，第三轮反转帮助关系，不能称闭环或整体验收通过。
- A01 原始输入“用途说明和有没有再试别的发送方式，这两个细节我记不清了。”免费回归复现 `COACH_ACTION_DECLINED`。单字“别”改为须紧接同一有限材料/联系动词及命令前缀，不再通过不断补充名词例外来过滤；“别的发送方式”保留为叙述。有效历史起草请求可以继续完成，真实停止仍阻断。边界回归 5/5，红绿日志 `narrative-decline-red.log` / `narrative-decline-green.log` 位于 `.local/coach-boundary-20261005`。
- 对话提示最小调整：从必要回应或关键问题开始，避免逐句复述输入；按用户原话保持帮助提供者、成果使用者及各自诉求。没有新增模型调用、分类器、角色架构或故事专用示例。真实效果尚待新冻结验证，不能用本地测试代替语义验收。
- 本地完整检查通过：`npm run test:backend` 31 文件、151 测试；`npm test` 44/44；`npm run typecheck:server` 与 `npm run build` 通过（后者含前端 TypeScript 构建，保留 Three.js 大分块警告）。`npm run test:backend -- --file=action-coach-browser.test.ts` 真实 Chrome/认证/隔离 PG 界面回归通过，模型为替身；不能计为真实模型或生产浏览器验收。日志 `final-backend.log` / `final-unit.log` / `final-build.log` / `final-browser.log`。
- 唯一 D 盘账本此批真实测试后 392 条、无 pending；本次 ¥30 授权从 385 条起计，7 调用占 ¥0.0119706、余 ¥29.9880294。旧余额和生产 ¥10 池保持独立。没有改模型/模式/端点，也未部署；所有 Gate 成立后才用已授权现有服务器、域名与数据库发布。目前 **WIP_NOT_READY**。

## 2026-10-05 拒绝优先、统一去重与新增测试授权（历史 2eaa4bb 批次）

- 接续 `b94c039`，分支 `fix/coach-material-boundaries-20261005`。同一写工作区，无覆盖或回退；本批完成受影响检查后本地提交，不 push 或合并 main。
- 拒绝边界先红后绿：用户不写、不改或先别联系时，模型自身交付前言不能授权 create/modify，无问号材料也受约束；close 可尊重停止。已有有效请求可在后续补充后完成首次材料，停止后普通确认不撤销停止；独立肯定分句仍可起草/改短。此有限文本/授权上下文校验不是通用语义分类器。新隔离回归 4/4，旧材料边界 6/6，engine/process-turns 回归和前后端类型检查通过。
- `coachNodeSource` 共用于预检和提交，重复覆盖判定为 `coachInputCovered`，移除持久化 8 字残留。相同集合实测短投入、日期、停止联系、拒绝结果、普通确认和真重复的预检/提交/下一轮输入来源；未结构化输入保留原文，不强制事实化；撤回与版本冲突仍阻断。此前不一致只作为源码风险，本批没有观测到旧预检放行后吞短信息。
- 依据已保存 `coach-f065a08b` 首轮三选一失败，收窄提示中“先确定目的”的歧义：用户明确要材料时直接把待确认未知写成问对方的成品，已指定渠道/目的不复问。没有增加默认模型自查或更改协议、模型、模式、端点。
- 用户最新明确新增开发测试 ¥30，取消旧 10/12 次批上限；完整 V1.3 验收达标后可沿用现有服务器、域名、数据库部署。单请求仍一次生成至多一次具体修复，无自动重试。唯一 D 盘账本当前 385 条、无 pending；新增授权基线 startingCall=385，currentGrant 上限 ¥30、已占 ¥0，旧追加余 ¥12.8783804 与原计次余 21 保持独立、不叠加；生产费用池 ¥10 不动。授权说明 `.local/v1.3-action-coach/paid/development-test-grant-20261005.json`，预算新 grant 模拟红绿 6/6，旧收据保留且未知用量按预留保守占用。
- 零付费证据保留 `.local/coach-boundary-20261005/next-boundaries-red-framed.log`、`next-boundaries-complete-green.log`、`material-final-green.log`、`grant-red.log`、`grant-green.log`。原全量后段失败与随后定向恢复成功日志保留，39 表恢复无需本批重复开发。
- 已只读核实技术通道：执行器权限升级后 HTTPS health 可达；现有 SSH BatchMode/StrictHostKeyChecking 的 `id -u` 返回 0；服务器应用实际镜像 `lifeos:v1.3-glm-52a4e47`，应用/PG 容器健康。目标为 SWAS 成都 `8.137.181.86`、`lqynb.xyz`；部署手册的 ECS/保留海闻描述过时，以后文历史更正与生产状态为准。尚未修改生产、DNS、防火墙、账号权限或运营预算；本地通过前不部署，保护其他服务。当前仍 **WIP_NOT_READY**，真实业务小批和完整最终 Gate 待执行。

## 2026-10-05 Codex 本地边界修复（历史 b94c039 批次，未部署）

- 实际接续基线为 `7826593`，初始工作区干净，晚于下方历史交接的 `a5b53ac`。该提交已取消 8 字去重门槛，并按当前输入起草/改写意图及交付引导校验问句材料；这些已完成部分不重复修复。
- 本批隔离于 `fix/coach-material-boundaries-20261005`，`main` 仍指向原基线。用户已批准本批本地 Git 提交，提交号见该分支最新 Git 记录；未推送、未合并、未部署。默认模型配置未改，保持 qwen3.8-flash。未调用付费模型或访问生产。
- 新复现：`不要帮我写消息，只想聊聊。` 的“帮我写”被当作肯定起草意图，追问 `他当时有回复你吗？` 可写成行动。隔离运行器定向测试先失败（Missing expected rejection），再修复为按分句检查请求/改写前的否定；独立肯定分句仍可起草或改短，`特别想写一句` 不误判为否定。
- `tests/backend/action-coach-material-boundary.test.ts` 新增拒绝起草的 create/modify 对照、拒绝后材料不变、否定长邮件但请求短消息、否定重写但请求改短，以及问句形式用户原话保留来源节点的回归。既有短约束去重回归继续通过。
- 已验证：最终定向隔离后端 6/6；`npm run typecheck`、`npm run typecheck:server`、`npm test`（44/44）、`npm run build` 通过。全量隔离后端 30 文件、145 测试通过；运行中补充“特别想写”的排除规则后，再跑受影响定向测试和服务端类型检查通过。构建保留 Three.js chunk >500 kB 的警告。
- 恢复检查另发现基线 `7826593` 的材料门会拒绝 `scripts/coach-recovery-action.ts` 原合成草稿（缺少交付引导），已修正夹具为“这份消息仍是草稿，可以先发这段”，不放宽产品校验。最初恢复运行失败；修正后 Docker 管道被沙箱拒绝，使用空临时 Docker 配置并经执行器权限升级重试后通过。最终命令为 `npm run test:db-recovery -- --file=action-coach-material-boundary.test.ts`，环境 `LIFEOS_EVIDENCE=.local/coach-boundary-20261005/recovery`；真实 pg_dump/restore 验证 39 表内容一致、恢复后继续修改同一行动/更正/幂等/过期索引租约/遗忘/引用撤回与权益账本通过，Provider 调用 0，恢复库已删除，主库未修改。证据为该目录的 `migration-report.json`、`recovery-report.json`，全量日志 `.local/coach-boundary-20261005-backend.log`、最终恢复日志 `.local/coach-boundary-20261005-recovery.log`（均 gitignored）。
- 并发检查：Codex 会话列表未发现另一个活动的本地仓库开发会话；系统拒绝 Win32_Process 详细查询，不能据此保证没有其他外部开发工具。仓库 HEAD 与改动在本批检查期间保持可核对；仓库及父目录未发现 `.agents/skills` 或额外 AGENTS.md，无需读本地记忆来补充已明确的接续目标。
- 仍为 **WIP_NOT_READY**。本地边界回归不能证明模型语义验收；意图校验仍是有限文本规则，A01/A05 真实小批、A02–A04/A07/A08、20 个速度样本、1440/390/320 正式浏览器验收和生产镜像更新均未由本批完成。下一步如执行真实模型复核，应先取得本次的调用数量/费用上限授权；部署或端点/模式变更另行批准。

## 2026-10-05 下午：按用户审阅意见收口（历史 GLM 批次）

用户纠正了上一轮"三条轨迹全部完整通过"的口径，并要求以已保存真实输出建立回归、做最小修复、分解等待时间。已执行：

### 逐项修正后的真实结论（基于 coach-8817402e / coach-46fba1bf / coach-07310002 原始输出）

- **A06：局部通过**。两轮纯倾听、零事件/节点/行动、尊重拒答。仅此范围成立，不扩大。
- **A01：未通过（语义）**。第 3/4/7 轮把对用户的追问原文写入 proposed action（t3 为 create、内容=整段回复；t4/t7 为 modify 覆盖）；第 8 轮用户补充"没有明确约好交付时间和格式"，模型只重发旧 outcome 原话，被当时的静默去重跳过，**约定事实未落任何节点**（聊天原文仍在，非数据丢失，但跨会话过程记录缺关键环节）；最终材料含"你考完试之后"，现有输入不能确认当前已考完（时间状态未核实）。
- **A05：机制通过、语义待复核**。直接起草与同 action rev1→rev2 实际改短成立（t2 的 reply==材料且含问号是合法形态，修复规则已据此收窄到 create）；但改写后"确认现在是否还需要"的目的弱化为"方便看吗"，目的保持待小批复核。
- 上一轮"93 次调用=13 探针+80 轨迹"分类有误：实际 **17 capability + 65 turn + 11 repair = 93**。账本现 383 条、0 未终结；追加 ¥15 保守已占 ¥2.1173882、余 ¥12.8826118；原计次桶余 21。三条轨迹合计 15 调用/14 输入，估算 ¥0.0334789。

### 冻结与 52a4e47 差异（真实运行证据的有效性）

三个真实运行绑定 source-1791172407783（digest d00c2ba5…）。与 52a4e47 逐文件比对仅两处差异：`server/action-coach-events.ts`（nodeSource 参数类型放宽+非空断言——esbuild 剥离类型后两版 JS sha256 完全一致，运行时等价已证明）与 `tests/backend/coach-history-fixture.test.ts`（测试文件，不进运行时）。故真实运行的行为证据对当前运行时仍有效；但按口径要求**不将其算作当前版本语义通过**——上述 A01/A05 语义缺口本就未过，本轮以本地回归钉住。

### 本轮最小修复（全部先红后绿；typecheck×2、客户端 44/44、隔离后端 30 文件全绿）

1. **追问不是新建材料**：checkDelta 新增 `COACH_MATERIAL_IS_CONVERSATION`——仅当 **create** 的 draft.content 与整段 reply 相同且其中含可见问句时拒绝（modify 的合法改短形态不受影响，A05t2 已作对照回归）；turn-engine 加入可修复集与具体指引；提示词同步一句"新建 action 的成品面向用户要接触的对象，不能等于本轮对用户的追问"。回归：tests/backend/action-coach-material-boundary.test.ts 用 A01 t3 真实输出回放拒绝、A05 真实形态对照放行。
2. **去重不得吞掉关键新信息**：checkDelta 与 persistCoachEvent 的去重条件对齐（均要求 source IS NOT NULL、同事件、非 withdrawn）；重发已记录原话仅在**当前消息无 ≥8 个有效字符（去标点字母/汉字）的未记录片段**时跳过，否则升级为 COACH_SOURCE_INVALID（携带当前消息全文的修复对照）——A01 t8 形态回放：旧原话重发+约定事实未记录→修复；"好的，我明白了"（6 字）→仍静默跳过。
3. **改写目的与时间状态**：提示词两句（保留原成品沟通目的；不虚构未确认的时间/完成状态）；预登记小批案例冻结于 evidence/v1.3-action-coach/research/a05-rewrite-purpose-cases.json（≤12 次 SDK 含修复，仅用既有追加授权，未执行）。
4. **四类负例补齐**（同文件）：跨事件 corrections/resolveUnknowns、有效 actionId 配错误 revision、staging 后来源撤回/版本冲突阻断、去重吞新事实。schema 枚举绑定只是防编造，跨事件错配/错误版本仍由服务端验证兜底（已在 HANDOFF 明确该边界）。

### 14 个真实请求的等待时间分解（零新增调用）

SAVED n=14：**原始首文本（firstRawDelta）中位 4472ms；完成中位 7182ms；每请求非模型开销（完成−Σ模型调用）中位 150ms**；输出 18~675 token。A06 两轮仅 18/24 token，firstRaw 仍 5329/5498ms；A01t7 生成 9644ms+修复 4802ms。结论：瓶颈在供应商侧 TTFT（网络+排队+协议），本地检索/校验/提交合计仅约 150ms，**仅改本地代码无法达到 p50≤3s**；SSE 首事件落后 firstRaw 的部分=模型流式前奏+完整中性问句积累（reply-draft 机制本身已有分块/转义/引号/撤回回归覆盖，tests/reply-draft.test.ts）。队列、snapshot、提交的细分时间点现有记录未覆盖，留 unknown；达标需要端点/模式层面变更，按规则须先呈报依据再由用户决定。

### 服务器归属更正（SWAS 核查）

此前"ECS 所有地域为空→服务器属其他账号"**结论有误**：目标服务器是本账号下的**轻量应用服务器**（swas-open ListInstances：be1d93d1b9914b25b8e031c3ba7168e5，Ubuntu-zhla，8.137.181.86，cn-chengdu，创建 2026-07-16，到期 2026-11-16，Normal）。所给 AccessKey 可经 swas-open API 管理它；此前部署经 SSH root 完成，不受影响。主账号长期 AccessKey 存于 .local/aliyun.env（gitignored），建议账号所有者择机轮换为最小权限 RAM 凭证；不影响现有服务前不擅自停用。

## 生产部署状态（2026-10-05，用户授权）

https://lqynb.xyz 已上线（细节见 git 历史 3fbd936 的 HANDOFF 版本）：海闻已删（备份 /root/backups/haiwen-20261005，含回滚步骤）、lifeos:v1.3-glm-52a4e47、生产预算 ¥10、权益门开启、LE 证书至 2026-12-19、重启持久化与真实 SSE 冒烟通过。signup 仍开启（权益门兜底）。生产限流为 compose 默认 3/分、50/日；本地 10000/10000 仅为测试放宽，不复制到生产。注意：**服务器上的镜像仍是 52a4e47 时代的源码，不含本轮语义修复**；用户已指示"先不急着部署"，故未更新镜像。

## 未完成项（保持 NOT_READY）

- A01 语义（追问入行动已由服务端门+回归钉住，但需真实小批复核）、A05 改写目的保持（预登记案例待执行）、A02–A04/A07/A08 真实轨迹。
- 速度：firstRaw 中位 4.47s 为供应商侧；20 条普通样本与 p50≤3s 目标未达，需端点/模式决策。
- 正式 1440/390/320 浏览器验收、最终源码全套+恢复、生产镜像更新（含本轮修复）。

### 第六批：真实官方正文、失效闭环和只读资料界面（免费）

- 复用固定MIT Cheerio1.2.0，明确HTTPS/公共IPv4/重定向/体积/超时边界，无JS执行。两份公开官方页面原始hash已保存；只有国家时段一条人工核验在临时DB成功，省级附件3份未读。失败与partial保留，不伪造全部资格和有效政策验收。详见 research/campus-growth/sources.md、official-source-registry.json。
- 016增量迁移两表保存原始快照、来源版本、时间/适用年度/未知；抓取不自动认证。维护命题绑定hash和原文跨度/独立范围跨度、<=24小时有效期，源变更/失败暂停命题和旧历史/材料，旧import误标verified也无法绕过SQL/JS/UI失效检查。认证GET只读界面保留原主题/2D/3D资产。
- 定向5/5（含真实DOM与旧import失效）、客户端45/45、服务端类型检查/构建通过；真实Chrome认证与三个尺寸320/390/1440通过并目检窄屏截图，模型/页面来源为显式合成。完整后端35文件196测试全部通过，日志 official-full-backend.log。公开HTTPS+实际PG双来源通过日志 official-public-db-2.log，不是合成来源验收。零新Provider。
- 一次与新迁移相关非空真实pg_dump/restore通过45表17迁移，全部内容hash一致；恢复保留原始hash/两种日期/失败快照，续写revision3不自动认证。报告 .local/campus-growth/official-recovery/recovery-report.json，原主库不修改。
- npm audit五项high同根FTP CPU拒绝服务，实际旧生产依赖已只读核实；完整触发链和补丁候选见sources.md，未盲目升级/降SDK、未部署。仍须窄补丁兼容验证。付费审批保持暂停，默认模型未改；真实完整校园链、20普通时延和混合成本仍未验收，WIP_NOT_READY。


### 第七批：窄FTP安全补丁（免费，本地，未部署）

- 五项high同根GHSA-c475-qrg2-pj4r/CVE-2026-102990，来源链及实际旧生产安装版本见sources.md。本批只override get-uri.basic-ftp=6.2.2，pi-ai0.73.1/get-uri6.0.5保持；上游MIT许可副本已保存。6.x禁用分离传输主机的默认安全变更保留，不启用allowSeparateTransferHost。
- 隔离下载旧5.3.1进行有界子进程实际攻击复现：同一畸形Unix列表达到3秒超时，原证据 ftp-baseline-report.json；修复6.2.2同样1000/10000/100000组输入约57ms完成。新测试走真实127.0.0.1控制/数据socket，MDTM不支持→LIST(RFC3659可解析日期)→RETR读取、缓存ENOTMODIFIED、PASV其他主机被拒绝均通过。原夹具Unix日期只有rawModifiedAt、get-uri原本不支持的首失败保留，不谎称解决该历史行为。
- npm audit新报告0漏洞（ftp-patched-audit.json）；客户端/依赖47/47、受影响SDK引擎42/42、服务端typecheck与构建通过，Three既有大chunk警告仍在。完整产品业务后端35文件196已在第六批通过；本次只改传递依赖，没有重复无关全恢复。未在生产升级或重启，旧镜像受影响依赖尚存在，补丁发布仍需整体验收和条件部署门槛。
- 本批Provider 0。付费审批未解决且无重试；模型真实完整校园链、20普通时延/混合费用、更多官方附件/就业/留学路径仍待验证，整体WIP_NOT_READY。
