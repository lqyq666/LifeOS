# LifeOS 新对话开发交接

交接时间：2026-10-11 晚，Asia/Shanghai。目标是修完真实上线阻塞并完成真实验收，不制作额外候选包。当前产品 **WIP_NOT_READY，未发布本次生产版本**。

## 1. 从这里继续

仓库 `D:\aaaLife\LifeOS`，分支 `fix/campus-acceptance-contract-20261006`。本次已验证源码提交 `4a9deffbfe5db77ec9bc8f040a76cb017b1c4a11`。随后提交只是本交接及版本记录；先读取实际 Git HEAD/status，继续后续有效版本，不 reset、clean、回退或重写已通过模块。

Founder 要求开新对话继续开发。“重新开发”按重新开始一个执行上下文理解，保留现有框架、一个校园个人伙伴、4条工作流、5个专业 Skill。不要新建重复扣子项目，不再反复跑大批模拟验收代替业务推进。每个有效增量及时本地提交。

先读实际文件：根目录 `AGENTS.md`、`NEXT_ACCEPTANCE.md`，以及 `.planning/research/workflow-integration/LOCAL_ACCEPTANCE_PROGRESS.md`、`WORKFLOW_ACCEPTANCE.json`、`RUN_BINDING.json`、`SOURCE_MANIFEST.json`、`SKILL_VERSION_MATRIX.json`、`LAUNCH_AUTHORIZATION.json`、`COZE_CREDIT_ALLOWANCE_20261011.json`。攻略内容与缺口在 `.planning/research/evergreen/`。

原工单可读 `C:\Users\LQY\Downloads\LifeOS_Codex_Coze_Full_Launch_20261011.md` 和 `LifeOS_Long_Batch_Acceptance_20261010.md`。附件是需求背景，用户后来直接授权优先；不要把附件旧暂停/两轮修复上限压过当前授权。

## 2. 已有授权，不重复申请

- 真实模型及原两个扣子项目的开发、候选部署、必要运行已恢复授权；验收只用合成成年数据及获审公共材料。
- 核心验收通过后，可备份并可回滚地更新已确认归属的 LifeOS 服务器、域名对应应用、数据库及这两个项目发布版本。未过核心门槛不能发布。
- 新实现路线已获准：官方百炼异步 HTTP，沿用原 CNY 账本、扣子积分账本；普通回复采用服务端限定依据/合法行动、模型有界选择和自然表达。`directHttpRouteApproval.exactAnswer` 保持 `批准新的实现路线，仍只用已有额度`，已有签名验证依赖原话。
- 修复轮数无上限。无需每完成一小批再要求同一授权。用户已同意本范围审批，但这不能制造独立审阅、来源、版本和真实执行证据。
- 最新积分授权原话：**从现在起，最多使用当前账户剩余积分的20%**。本地开发优先；先读真实认证账户余额，冻结该余额的20%作为之后新增使用上限，版本化绑定原账本，核对旧承诺避免重复计入。此次余额尚未读到，授权数值上限未知，零新派发；不能套用历史151559或原账本可用25作为账户余额。
- 不购买/升级积分，产品模型 CNY 不新增预算，无自动收费重试；失败、取消、未知费用保留预留。不复制、重置或另开相互矛盾的账本。
- 不 push、不合 main、不改 DNS、不操作无关服务、不上传真实学生资料、不覆盖用户定制 Skill。
- 新建永久访问凭据仍需浏览器动作现场确认；用户授权获取开发权限不等于可以静默创建任何永久 API Key。已有安全配置可以复用，勿打印密钥。

## 3. 刚完成的实际增量

`4a9deff` 修复了真实 V18 失败后的停止/暂停承接：

- 拒绝不覆盖原目标；直接来源明确时停止原事项，跨会话歧义走已有正常确认卡，原事实/经历保留。
- 待确认与已停止目标排除推荐输入，单独保留理解和确认数据。歧义时服务端限定澄清回复，禁止计划、成品、事件、经历候选和来源引用；计划与观察引用被停止项/未绑定暂停也会拒绝。
- `先不备考/复习` 是当前事项暂停，带真实原话、消息/会话来源和已核实期限，不变成全局考研方向暂停；原事项绑定未知时不能套到相似新任务。
- 确认校验真实目标版本和原用户指令，保存确认幂等键，同键冲突拒绝。查询前一用户消息直接用授权数据库，不依赖模型截取的历史。
- 受影响隔离 PostgreSQL/HTTP 3项通过，含新会话确认、原事实保留、错误版本/伪指令、恶意模型计划不落库。服务器 typecheck、当前 build 通过。
- 独立只读进程复核：`SOURCE_REVIEW_PASS_PRIOR_HIGH_FINDINGS_REPAIRED_REAL_MODEL_VERIFICATION_MISSING`，无新增源码缺陷；**该源码还没有新真实模型小批验收**。

关键实际文件已提交在 `evidence/coze-core-launch-20261011/`：

- `independent-task-boundary-current-first-{report,input-manifest,exit}.json`：原独审 HIGH 保留。
- `independent-task-boundary-enforced-followup-{report,input-manifest,exit}.json`：当前独立执行与冻结输入 SHA。
- `task-boundary-final-pg.log`、`task-boundary-final-verified-types.log`、`task-boundary-final-build.log`。
- `task-boundary-guarded-plan-pg-first.log`、`...second.log`：新增断言首次失败（null回执、自然分钟请求未产生周计划义务），不冒充真实模型失败，也不删除。

独立审阅通过不等于真人学生受益/真实模型选择正确/生产上线。独审使用已有 ChatGPT 登录的单独 ephemeral 只读 CLI 进程，产品 CNY/扣子派发0，订阅经济成本未知，不宣称免费或虚构多 Agent。

## 4. 真实模型首次结果与下一小批

- V17 3条新首次真实普通交互独审 `PASS_WITH_LIMITATIONS`：探索2297.781ms、拒绝零生成136.4224ms、新会话倾听3397.5931ms；不替代最终同版20样本。
- 1da源码四链24轮首次：23技术完成；课程第一轮 `WEEKLY_PLAN_BUDGET_MISMATCH` 无首内容，必须保留 null/失败，不能计0ms。联系、自由职业独审通过，课程首轮失败；创业压力轮的“必须新建长期压力身份”要求已独立裁定不必要，保留原消息即可。
- V18课程6轮真实首次在 `1f3a0ac` 技术全完成，独审 `BLOCKED_RETAINED`：自然“怎么安排”漏计划、受阻/暂停漏状态、拒绝覆盖原目标，以及“半小时足够/拿稳基础分”无来源效果表述。
- 1f、3aa、4a三次提交依次修对应机制。V18原回复和收费记录不重写为通过。当前独审源码通过后应预先标注 **V19新自然表达少量课程跨3会话首次样本**，冻结当前代码/内容/模型/预算，再实际运行；不重发V18原请求、不用旧样本冒充未曝光测试。
- 同一版本还需四条跨3会话真实链、20组单/多 Agent 独立盲配对、至少20个普通真实业务合格样本。普通0–1生成，复杂最多5；首内容p50≤3秒/p95≤5秒，完整p95≤15秒。保留所有首次失败、取消、慢样本、未知成本。价值与安全分别判断。

现有小批入口可复用 **结构**，不要直接重新执行已尝试的 V18：`.local/launch-20261011/run-course-v18-first.mjs`。它先新建隔离数据库、校验版本/预算/授权、通过 `scripts/workflow-real-batch.ts` 执行真实API并读回。先建立新 V19 标注和新输出目录，原目录存在就拒绝的保护保留。不要新增收费能力探测；已有匹配模型签名的能力报告可复用。

真实报告：`course-v18-first-readback.json`、`independent-course-v18-first-*.json`、`four-real-chains-current-1da-first-readback.json`、`independent-pressure-request-first-*.json`（上述 evidence 目录）。原始私有读回在 `.local/launch-20261011/` 对应目录，不能上传私有数据库或配置。

## 5. 攻略内容和独立审核，缺审批只阻止发布

现有32稿全部曾实质修订，59项均有研究/尝试记录；正式112候选仍53覆盖、59来源缺口，不能删除任务或把待审变成通过来归零。旧16approved/16needs_review保留历史含义，发现错误可撤回。校园资源v3已走一次真实独审→当前Owner授权→正常维护HTTP明确批准→规范发布→学生方法API与索引读回；不是32张全部批准。

最新实际独立原文审阅已提交：`independent-current-two-content-first-{report,input-manifest,exit}.json`，对应 `current-contact-v6-exam-v5-independent-input.json`。**两张均 BLOCKED_RETAINED，需要改稿，不能仅再写needs_review**：

- 联系v6：USST引文只支持学术背景、研究兴趣和选导师原因，现稿还声称“针对不同导师修改邮件”，给出的原文未证明，先缩窄。职业访谈作者短引只支持核对选人理由，整段课堂设计顺序缺全文，缩窄外部主张，编辑步骤明确标适配。
- 校园室友打招呼/隐私原文不能冒充从零社交/新朋友效果证据。Stanford仅主题与已建立指导关系沟通，不引入中国招生规则、固定等待期限或回复效果。
- 考试v5：“科研受阻复盘”分支仅实验记录整理有HZAU原文；缩窄直接方法范围，代码/文献/写作仍明确缺任务资料。只选已评分题、只改一步是编辑选择，不能说原文证明最佳或必须如此。
- 精确旧 `tsinghua-exam-batch` 全文hash未验证；同URL另一个已存正文不能当同一版本。可切换到确实读取且定位的新来源，保留旧版本和撤换依据。
- CMU材料发布前仍需处理实际许可适用性，不把授权标签当许可证。

交接前已从现有原HTML重新还原两份完整正文，并按**原算法**核对精确hash/短引定位：PKU `ff9c1bed86b081ba55a008d4969de5a72b67f6c497581d9ec06a87340865096d`；USTC `123c5fb8d5ef5bc2e90bea773702790e304d941564a6f1cd2b7e232e6f9c2c4e`。正文暂存 `.local/launch-20261011/recovered-contact-originals.json`，由 `recover-two-source-bodies.py` 从 `.local/content-first-contact/*.html` 还原。没有改32稿、没有新审阅或发布。下一轮可把实际全文加入独审输入，不重复网络抓取。

方法库使用现有规范 `.planning/research/evergreen/KB_CONTENT_REVISIONS.json` 等，`server/evergreen-guide.ts` 提供 `guideContentHash`/校验。改稿需保存draftHistory、更新revision/hash、正文与结构/步骤一致、清空旧版批准绑定、补当前独审。现有修改脚本 `.local/content-first-contact/revise-contact.ts`、`.local/content-exam-followup/revise-exam.mjs` 仅作结构参考，不重跑覆盖新稿。

检索旧235及已曝光160/116/32只作回归。现有未参与调参64保留集未执行，不提前读取答案再调参；最终公布合法相关卡 Recall@5≥90%、Top1适用率≥90%、路由≥95%以及各领域/阶段/缺卡分子分母。缺来源仍待审，不进入正式学生检索。

## 6. 扣子：真实开发版本与生产分别看

只复用成长 `7693388932939300905` 和知识 `7693465311558795327`。

成长当前开发 **R33 `74562efe01d9eb4be6c43e9376be9d0b24f65e92`**，云源码digest `aa39dec5372574aa156fc8a1758e4d0974c37bad51b1f9a998bcd852a69b1c70`。当前云 host binding 仍指向 **1f3a0ac/6a1133ba7a39af0a8c533090ee13a190024b265b7855ce3f97f4064eabcceb7a**，与4a代码不同，先准确重绑，不能假装已同步。

R33修复：全部分析路径完整请求/Skill/schema先检查字节和slot再任何CAS或异步HTTP；去掉完全等于fact.text的重复模型引文，不改不可变输出引用。实际R32失败输入12065/11780/12066字节，现在11597/11318/11598；后置路径超12000验证零CAS/HTTP。20源码hash实际云读回、编译、相关来源/Memory OFF/账号/时间守卫通过；**R33未运行新真实三方向业务**。

保留首次R32三方向 `8d78dbcf-e2e7-4474-aa97-424804b49faa`：476.8974ms、providerCalls1（开始后取消）、costCny null，其他未派发；原24积分未知预留与开始调用.02 CNY预留保留。R28两方向4真实调用技术候选成功7655.6584ms，独审业务失败：整段原话复用、未知只编号、课程/休息主张无依据、停止条件不匹配。R30/R31/R32修过表达/完整schema只携带一次/长度；R33新真实选择收益尚未证明，深度模式仍实验性。

文件：上述evidence目录的 `COZE_R33_PUBLIC_PATCH.json`、`coze-r33-actual-source-readback.json`、`coze-native-r32-direction-three-first*.json`、`coze-native-r28-direction-two-first.json`。私有原生图输入在 `.local/coze-launch/native-r32-direction-three-first/`，含授权令牌，**勿打印/上传/直接重用**。

知识开发R8 `10b80bfb5f20f068a7dfaa050813ece970468fab`。旧生产成长 `4aa53641b7177604cfa96631b9584de991531324`、知识 `04849caa93a33f4584ce5637acba864e97757a46`。新开发编译/原生图≠公网接口通过：原生产Gateway401/生产环境变量为空的问题尚未证明解决。勿用旧部署成功替代本次版本。

IAB已登录扣子，旧页成长tab9/tab12、localhost旧tab11；新上下文先用CUA正常入口盘点现有tab，不借旧未验证locator。原CLI曾认证失效一次；KB message history/status读回可用但没有积分账单，只是历史文本/状态，不能释放80000旧开发未知预留。需要实际每任务账单或符合新授权的原账本延续核对。

## 7. 预算、安全配置和本地运行

20:36实际账本快照 `handoff-budget-20261011-2038.json`（文件名时间为交接标签，以内容at为准）：产品原27.62 CNY延续额度剩 **9.6358748 CNY**、accounted17.9841252、未暂停；扣子原账本initial151559、charged71462、held80072、available25。**这是新增20%授权前的账本余额，不是账户当前余额，也不是新增20%上限**。

唯一账本 `.local/v1.3-action-coach/paid/provider-calls.json` 与 `.local/coze-launch/credits-ledger.jsonl`。只调用现有预算类快照/预留/结算，不手改历史；扣子新增20%须核实真实账户余额后在原账本做可审核延续。旧unknown仍unknown，不能填0、凭done/布尔值释放。

安全配置入口 `.local/launch-20261011/provider-runtime.env`、`.local/coze-competition/runtime-token.txt`；只安全加载，不输出内容。不复制真实账本、密钥或私人数据库到新测试目录。已有依赖就在此仓库，无需新候选包。

受影响免费检查：

```powershell
Set-Location D:\aaaLife\LifeOS
npm run typecheck:server
npm run test:backend -- --file=remaining-plan-source.test.ts --file=memory-control-http.test.ts
npm run build
```

这些已在4a源码通过，不因换新对话再重复跑；修改对应机制时再跑。backend脚本自动隔离 `lifeos_dialogue_test_*`。**参数必须 `--file=...`**；裸文件名会误跑整批，早先旧fixture失败和busy连锁已有原件，不弱化validator。

当前没有新源码UI服务。旧临时18109为7ff代码/隔离库/SCRIPTED_LOOPBACK，仅技术UI，已在交接主动通过原stop指令关闭并确认无监听，不能给用户当当前服务。需要验UI时从当前源码启动一次，使用 `.local/launch-20261011/start-current-launch-ui.mjs`（先审配置）；API `/api/run/version` 读当前实际运行版本。最终1440桌面/390手机、键盘、减动画、空/错/断线、进度/取消/候选仍需当前浏览器验收，不用旧截图或脚本回复证明真实质量。

所属生产旧版：`8.137.181.86 /opt/lifeos https://lqynb.xyz`，上次只读版本 `lifeos:v1.3-glm-52a4e47`、schema32。这不是交接时重新在线核查结果。本次无生产变更；SMTP/认证和新Gateway、安全恢复验证尚未完成。改生产前确认归属、备份、版本迁移与回滚，核心真实门槛通过后才执行已有发布授权。

## 8. 下一执行顺序与时间估计

1. 确认当前Git/版本及新20%真实余额，在不收费的本地优先继续；不重做过去包和大模拟。
2. 4a源码新V19少量真实课程跨会话首次；同步按实际独审修联系/考试稿、加入恢复的全文。记录逐轮六轴及实际状态，不自评分代独审。
3. 成长R33先独立源码审阅，绑定当前host并检查实际全部request输入，再新首次三方向；取消/来源冲突/异常回执照实际读回。公网认证/实际部署问题并行修，原两个项目不新增同类Agent。
4. 小批通过后同版四真实链、20复杂盲配对、20普通及性能；五Skill在正常任务实际加载版本/获准执行/产物读回/失败降级。最终当前浏览器与安全/断线恢复验收。
5. 只有必要核心门槛通过才备份回滚地发布，读回公网实际版本与业务；技术通过、部署成功、在线业务通过、本人接受分别报告。

时间判断：已错过10月11日18:00目标，不能继续承诺今晚。按剩余实现与真实验收量，**顺利情况下预计还需1–2天**；这只是条件估计，前提是新小批不出现重大状态/来源问题，20%积分实际足够，公网认证和性能能修到通过。若账单/权限/实际额度或质量门槛卡住，正式上线会更晚；新对话应先完成下一真实小批和公网探针，再缩窄估计，不能以本地build或候选包宣布上线。

交接不取消已授权业务工作。新对话持续完成必要事项，有效增量提交，缺源只阻止相应稿发布，单项审批/预算限制只暂停对应外部派发。沿用现有验收文档作为结果事实链，本文件仅用于一次上下文交接，勿再衍生多套最终报告。
