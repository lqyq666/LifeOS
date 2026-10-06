# 核实来源

- PRODUCT.md：用户当前完整目标及授权；父线程 01a10a5b-7f1a-7017-afb5-2681ffc95023 最新完整授权消息再次只读核对。
- server/turn-engine.ts、turn-prompt.ts、action-coach-contracts.ts：当前单生成链、来源约束、可选事件增量、有限修复。
- server/store.ts、memory.ts、campus.ts、http.ts：事务提交、记忆开关/抑制、来源失效、现有认证接口。
- src/features/conversation/ConversationPage.tsx、ConversationSummary.tsx；src/features/cognition/graph.ts：实际产品入口及图谱范围。
- server/migrations/000–013：当前已存在迁移。新功能只用增量迁移。
- [百炼模型大全](https://help.aliyun.com/zh/model-studio/models)：2026-10-05 直接读取官方页面，列出 qwen3.8-flash / qwen3.8-max / qwen3.7-plus / deepseek-v4.1-flash 等；这不是本账号接口成功证据。
- [百炼模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)：2026-10-05 可读，阶梯按整次输入范围计费、缓存价格独立；具体候选价格需选定部署地域和输入区间后摘录，当前没有改价格/模型。

搜索的非官方结果未用作模型可用性或价格依据。

## GitHub 复用优先（用户 2026-10-05 新规则）

本批沿用已有 pg / TypeBox / better-auth / pi-ai / Playwright，不引入迁移型 UI 或代理框架。成长控件接现有认证与 API，源校验调用已有 checkCampusSource；省去另建身份、持久化框架和模型平台。原 Companion/2D 资产、原主题样式和 Canvas 代码未改，新增页面适配旧 UI。

已读公开 [Mozilla Readability](https://github.com/mozilla/readability) README/API：Apache-2.0、实际 Readability.js/JSDOMParser.js 与 test 目录；只作为下批网页提取候选，尚未下载/执行/复制代码。Node 需要 DOM，脚本和外部资源默认禁用；纯文本产物优先，发布日期可能为空。官方短通知不能依靠默认 500 字阈值必定抽出正文。

已读 [TanStack Virtual](https://github.com/TanStack/virtual)：MIT、局部 React adapter 候选，尚未安装。父线程进一步只读核实 Cheerio MIT/当前 Node 范围、Virtual 3.14.13 和 Playwright 现有 Chrome/CDP 复用；锁定版本前仍需核对源码/测试/许可。当前记录数少，先使用原生语义表单和既有状态，后续分页再按真实规模引入 virtual。

## 百炼候选模型核实

官方价格页华北2北京、2026-10-05读取：Qwen3.8 Flash 输入/输出 ¥0.8/¥2.7 每百万token，Max ¥12/¥36；Qwen3.7 Plus ≤256K 原价 ¥2/¥8（限时优惠不作为长期预算保证）。缓存费率须单独核实，不把免费额度假定为账号现余额。

[官方结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output) 列出 Qwen3.8 Max/Flash、Qwen3.7 Plus/Flash/Max 的 JSON Schema 支持。已有SDK/传输可复用，实际账户及新结构能力仍需真实收据，当前没有更换生产模型。

第三批再次实际核实：官方结构化输出与模型大全可直接读取；价格页在 web 工具两次超时后，本机只读下载成功，保存 `.local/campus-growth/official-model-pricing.html`，SHA256 `0d63b40f60bff1500ca07dd2a1bf3e2d26863ac2844692b1e3cc9b619286b204`。当前北京 Max 12/36、Plus ≤256K 原价2/8、高于256K为6/24，价格档和临时折扣分开。小样本配置只使用已有128K运行上下文档；不预设免费额度或缓存折扣，缓存 token 按完整输入单价保守估算。未知费用仍为未知，不把估算当账单。官方公开支持不证明当前账户模型权限。

候选传输继续复用当前 pi-ai 和 TypeBox，Max/Plus 与 Flash 均关闭思考并使用同一严格 Schema；默认仍 Flash，候选只通过临时进程配置比较。动态成长更正和观察依赖进一步约束真实授权ID/版本配对；首次无成长依据不生成持久化AI观察。新校园夹具及操作入口复用原独立数据库/真实认证/人工逐条输入/同一预算观察器，不安装新的基准框架。

父线程新增受控高推理对照后，核对[官方深度思考](https://help.aliyun.com/zh/model-studio/deep-thinking)：Qwen3.8/3.7可用 enable_thinking 与 thinking_budget；max_completion_tokens 限制思考加回答的总长度。比较仅增加一档2048思考token，上限输出仍8192；实现限配置预算0–4096且必须小于总输出，不默认最高档、不同时传 reasoning_effort。实际已安装 pi-ai@0.73.1 的 openai-completions.js 在 HTTP create 之前等待 onPayload 并使用其返回对象；其 usage.completion_tokens 含推理token，text 与 thinking content 独立。模拟 SDK 回归证实参数传输/完整输出token统计/不显示或保存内部思考。官网控制台默认预算不等于本项目实测档；收益待同场景实测，不能宣称已经更聪明或更快。

## 官方政策前置核对（免费，只读）

本机执行者于2026-10-05实际读取[教育部2027硕士招生规定](https://yz.chsi.com.cn/kyzx/jybzc/202609/20260924/2293971511.html)：网页发布日与通知落款分开；第十九条的正式报名和预报名为不同动作，省级安排仍需另核。第十五、十六条及招生单位审核并不允许只凭成年大学生身份保证报考资格。

实际读取[浙江2026普通专升本通知](https://www.zjzs.net/art/2026/1/5/art_49_11840.html)：仅正文与附件链接可读；尚未下载/解析docx细则、xlsx专业对照和登记表，不提取附件资格/日期、不外推其他省份或2027年度。具体元数据见 `official-source-registry.json`；两项均研究准备、未入库，原始字节hash尚无，不能冒充已完成政策导入。

范围结构复用当前维护卡、引用验证和版本失效机制，不安装抓取/代理框架。旧精确五键卡仍支持；新的 specific/all/not_applicable/unknown 分开，已核实范围须有维护卡原文引用，unknown只能弃权，不冒充全部适用。形式校验不证明原文蕴含范围，仍需实际来源审阅。全国时段不虚构院校/院系，学校资格条件需另建准确范围命题。

## 第六批官方正文模块（2026-10-05，免费本地）

实际复用 [Cheerio v1.2.0](https://github.com/cheeriojs/cheerio/tree/v1.2.0)：读取固定版本源码 loadBuffer/encoding-sniffer、UTF-8/UTF-16测试及MIT许可，Node最低20.18.1满足本机。只用静态解析；不使用fromURL自动重定向。许可副本 THIRD_PARTY_NOTICES/cheerio-LICENSE.txt。自有HTTP边界限定官方HTTPS主机、固定公共IPv4解析、每次重定向再校验、2MiB/20秒上限，不执行脚本、发送凭证或读取内部地址。

上述两份官方页面已获得原始字节SHA256，初始通用选择器仅partial的失败保留；按实际DOM适配后两份读取通过。首次隔离DB公开测试省站超时仍保存FAIL，第二次明确人工执行两站成功，仅维护审阅国家报名时段一条，不把资格/附件和全部政策当通过。原始证据位于 .local/campus-growth/public-official-20261005 和 official-public-db-1791199745629/report.json，Provider 0。登记状态更新为本地隔离导入验证，主库/生产没有导入。

增量016迁移保留每版本原始字节、hash、发布/落款/年度和失败原因；正文候选不自动核验。维护审阅必须绑定当前原始hash、精确摘录及scopeEvidence跨度，24小时内到期。变更/部分读取/失败暂停原命题、连带旧回复/材料失效；相同字节不延长审核期。全国2027招生年度不能被2026报名日冒充。未知范围不作为全部适用。认证界面仅GET保存状态，无远程抓取或审核写入口。

## 发布前依赖安全核对（尚未修复）

npm audit五项high均沿 pi-ai0.73.1→proxy-agent6.5.0→pac-proxy-agent7.2.0→get-uri6.0.5→basic-ftp5.3.1 传播同一 [GHSA-c475-qrg2-pj4r](https://github.com/advisories/GHSA-c475-qrg2-pj4r) / CVE-2026-102990。basic-ftp<=6.2.0受影响，6.2.1修复恶意Unix目录列表解析的CPU耗尽。get-uri FTP路径MDTM失败回退Client.list可触发。pi-ai现有代理路径仅Bedrock provider；本产品仅Bailian/openai-completions，官方读取用agent:false，但不能因此忽略生产包含该依赖。

只读SSH docker ps证实旧生产lifeos-app-1仍lifeos:v1.3-glm-52a4e47，依赖5.3.1/get-uri6.0.5/proxy-agent6.5.0实际安装；安装不等于在运行进程已加载。不dump环境/读取凭证。上游最新get-uri8.0.1仍依赖basic-ftp^5.3.1；不force降级pi-ai。核对 [6.0.0变更](https://github.com/patrickjuchli/basic-ftp/releases/tag/v6.0.0)：默认禁止分离传输主机，是FTP bounce防御；[6.2.1补丁](https://github.com/patrickjuchli/basic-ftp/releases/tag/v6.2.1)修复该解析。窄override到6.2.2需实际get-uri本地FTP兼容/攻击边界回归，未通过前列潜在发布风险。
生产只读代理核查补充：当前容器六个HTTP_PROXY/HTTPS_PROXY/ALL_PROXY及小写变量均present=false、pac=false（只打印布尔值）。这降低现有配置触发概率，不证明未来配置安全或运行进程所有模块加载状态；尚无修复前不清除发布风险。

安全补丁本地结果：在get-uri专用override固定basic-ftp6.2.2，保持SDK及get-uri原版本。原5.3.1同一恶意Unix列表有界子进程3秒超时；6.2.2原样输入约57ms结束。实际回环FTP控制/数据socket覆盖MDTM失败、RFC3659列表日期、RETR内容/缓存、PASV分离主机拒绝。6.x默认拒绝分离主机是安全收紧，可能影响少数依赖不同数据主机的FTP/PAC配置；本产品无需此配置，不放宽该默认。局部兼容结果不声明全部FTP服务器/FTPS场景通过。npm audit新报告0漏洞，SDK引擎42/42和客户端/依赖47/47、类型/构建通过。旧生产仅只读查看未修补，安装与实际模块加载区分仍保留；部署前须使用新锁文件镜像并通过产品门槛。

## 官方附件受控解析（2026-10-05，本地）

复用 [Mammoth1.13.0](https://github.com/mwilliamson/mammoth.js) 的extractRawText与实际raw-text/tests、docx Files默认externalFileAccess=false；BSD-2-Clause。只读段落文本，不调用HTML转换；自动编号/表格布局/图片未还原，空白表不是个人填报。复用 [read-excel-file9.3.10](https://github.com/catamphetamine/read-excel-file) Node入口、实际parseCell/parseSheet/parseSpreadsheetContents，MIT，Node>=18；保留trim:false、sheet及A1坐标，字符串代码与零/空白分开，公式缓存不采用。ExcelJS4.4.0作为候选因写入/图表依赖过重未安装。复用 [yauzl3.4.0](https://github.com/thejoshwolfe/yauzl) lazyEntries/validateEntrySizes/strictFileNames，MIT；读取实际entry/size校验源码，预先约束ZIP而不自行实现Office格式。三个许可副本见THIRD_PARTY_NOTICES。

真实浙江官网将三份Office ZIP均标text/html。首次下载明确拒绝并保留official-attachments-20261005/report.json；人工固定公开页面Referer/通用UA只读诊断（未发送Cookie/凭据）发现PK签名，兼容分支只接受Office后缀+ZIP签名，不接受HTML错误页。再次明确执行的受控下载原文件保存到 .local/campus-growth/official-attachments-20261005-1791202250923：细则DOCX543038B/SHA739f3e5bee974e4a76facc5104be3b029a4bbc34b4955b7775b5d5fcb82618f9；专业对照XLSX39177B/SHA7e8d952943c8179d45ccc72838972f1bfd7f6bba6d704acb8d6b6d72496cf86b；空登记表DOCX292813B/SHAd416910f6b8cc75181894b5f45961c97adae3e7c6bb7397db223157cb7850028。三者原始字节未改。

DOCX分别提取2669/591字符，XLSX1611非空单元格；人工核对细则“我省全日制高职高专应届毕业”、Sheet1!A2年度标题/B5哲学代码、登记表身份证号为空表字段。专业类别合并格不自动填充/匹配，不推其他省/2027。独立附件发布日期未知，父通知2026-01-05和适用2026分列。实际HTTPS/Office bytes/隔离PG测试PASS，report:official-attachment-public-1791202570669/report.json，Provider0，没有自动维护核验命题。

解析独立worker10秒/128MiB；ZIP256项/单项4MiB/总12MiB与实际流大小限额，HTTP2MiB/20秒，路径/重复/加密、宏/OLE/ActiveX、外部资源/Word INCLUDETEXT/DDE、DTD实体、XLSX稀疏巨大网格及公式均拒绝，公式不执行、不采用缓存。PDF/旧doc/xls显式unsupported。017两表保存原始文件和每修订payload；父hash/版本CAS、当前链接成员、双24h及状态校验连带暂停附件引用；父失败界面仍保留原附件为暂停历史。没有新公开写接口，不通过浏览器/模型认证来源。新增依赖audit0漏洞。

## P0 身份隔离批（2026-10-06，本地，零Provider）

按用户2026-10-06工单（GLM_EXECUTION_ORDER.md P0）与当日追加指令执行。复用核查：本批不新增外部依赖或新框架——多账号注册复用仓库现有 BetterAuth 1.7.7 email signup 与 fetch（同 scripts/run-action-coach.ts 既有用法），操作员状态机复用原脚本逻辑仅去自动重发。无外部仓库脚本执行。核对 better-auth 1.7.7 实际源码 node_modules/better-auth/dist/api/rate-limiter/index.mjs：/sign-up* 默认特殊限流 window=10s、max=3（同IP同路径共享桶），故 ensureActor 对 429 按响应 Retry-After 有界等待重试本地免费注册（≤8次、单次≤15s），不改生产 auth 配置。

当日用户追加指令：停止扩建自建通用知识库/检索基础设施；新增薄扣子(Coze)公共知识检索接入层（复用现有来源检查与产品界面，不迁移聊天系统、不建第二套长期记忆，原检索保留对照回退）。该新增为用户明示授权的白名单外扩展，单独批次实施并记入 REPAIR-20261006.md。

## 扣子公共知识检索薄接入层（2026-10-06，用户当日追加指令，本地，零真实扣子调用）

按用户指令新增 server/coze-knowledge.ts：薄适配层，仅做"扣子数据集检索API ↔ 既有知识卡管线"的翻译。复用核查：不引入新依赖（Node fetch）；导入复用 campus-knowledge.importKnowledge 原函数与校验；检索/引用/撤回复用 coach-knowledge.retrieveCoachKnowledge、validateCoachCitations、assertCoachKnowledge 全链，未改任何既有校验语义。卡为内容寻址（sha256→UUID）、UTC日确定性时间戳保证同日幂等重导入、跨日 revision 递增（沿用导入幂等/冲突规则）；24h 有效期使过期卡自然退出检索；limitations 明示"未做本地原文核验"。接入点 turn-engine.ts：本地检索为主，结果为空才回退扣子（审计记录 coze_knowledge_* 阶段），扣子失败仅审计不失败轮次——原检索同时是对照与回退，退役决策留待替代方案验收。默认关闭（LIFEOS_COZE_KNOWLEDGE!=='true' 或缺 PAT/数据集ID），启用即接受查询文本传输到所配置端点，生产启用需用户数据传输授权；不迁移聊天系统、无第二套长期记忆（仅公共知识卡，非个人信息）。测试 tests/backend/coze-knowledge.test.ts 用本地mock扣子端点+真实隔离PG：默认关闭零外呼、Bearer/路径/查询体、导入后经未改动的本地管线可检索、同查询缓存命中、同内容幂等(changed=0)、HTTP500/非法JSON/超时均仅审计、过期卡不再检索。真实扣子API连通性 NOT_TESTED（无凭据，未发起任何真实调用）。

## P1 amend 协议与复合事实拆分（2026-10-06，本地，零Provider）

growth-source-fragments 纯函数模块来自工单附录A指定参考实现（工单声明已在独立 Node 30/30 通过；磁盘上无 reference/ 目录，按工单附录A逐字复制，差异记入 REPAIR-20261006.md）。未引入新依赖；复用现有 TypeBox target union、campus-knowledge.importKnowledge 无关、checkCampusSource/checkCampusSource 来源校验、lockGrowth 事务锁序、growth_revisions 审计与 growth_source_suppressions 精确遗忘。018 迁移 SQL 按工单原文。model-payload 的 amend itemId/expectedRevision 配对沿用既有 replace 单分支配对机制（一个授权项一个备选分支，模型无法跨项混配 id/revision）。

## P2 期限服务器推导（2026-10-06，本地，零Provider）

growth-time 纯函数来自工单附录A（同 P1 方式逐字复制）并按工单 P2.2 增加无副作用中文整数转换 chineseInteger（三/两/六等，duration 支持中文数量词，quote 保留原话）。无新依赖；时区仅实现 Asia/Shanghai 与 UTC，未覆盖表达明确拒绝（GROWTH_TIME_UNVERIFIED）。复用既有 expiry/018 迁移列（valid_from/time_basis）、growth_source_suppressions 与 013 既有时间校验路径；UI 仅改日期显示为上海时区（Intl.DateTimeFormat）。

## P3 方向控制（2026-10-06，本地，零Provider）

无新依赖。019 迁移按工单原文。deriveExplicitDirectionControls 为有限显式语法（分句级暂停/恢复动词+具名方向，用户本人语气；引号/疑问/否定/他人转述不触发；升学=推免+考研+留学+专升本四项原子展开），非通用语义分类器——未识别方向返回 needs_confirmation 不猜。复用现有 messages/runs 外键、growth 共用 lockGrowth 锁序、finishRun 单事务、HttpError 409 冲突语义与 growth 遗忘钩子（redactDirectionControlsForMessages 同步脱敏行与历史快照，暂停设置保留）。UI 复用 GrowthWorkspace/ConversationPage 现有组件与消息通道（onSendControl 经现有 send/ requestId/ run 事务），新增只读 GET /api/growth/direction-controls；无 CSS 新文件。

## P4 证据式简历材料（2026-10-06，本地，零Provider）

grounded-material 渲染器来自工单附录A（逐字复制）+ 服务器目录构建（buildMaterialFactCatalogue/resolveSelectedMaterialFacts，候选仅 user_reported/user_edit growth 条目与已确认经历，catalogueId 绑定 item id+revision 使更正即失效；completeForField 仅模式化完整字段——联系方式邮箱/手机号、姓名标注——"有三个作品"不构成完整项目条目）。无新依赖；draft 联合分支复用现有 TypeBox/action 修订链，服务器渲染结果写入旧存储结构并携带 readiness/missingRequired/materialFactIds 元数据；model-payload 在简历作品模式下仅暴露 resume_portfolio 选择分支（enum 绑定本轮目录），旧自由文本分支不可表示。

## P5 当前任务义务（2026-10-06，本地，零Provider）

turn-obligations 为纯模块（不加载DB链，保证 strip-only 单测可用；方向命令由引擎调用 growth-controls 传入）。OBL-02 回放夹具 tests/fixtures/campus-acceptance-regressions.json 保存 coach-b2dd4d6c 两条真实 C10 改时间失败原文（SOURCE_QUOTE_MISMATCH/COACH_SOURCE_INVALID，含旧反馈candidate与旧事件nodes），原 .local 证据未改动。无新依赖；复用既有 TypeBox/repairable 单次修复机制（新增语义错误码，CAS/权限/撤回类不可修复）、finishRun 单事务回执（真实写入计算，非模型自评）、store.stageCandidate 原有来源守卫。受影响引擎测试夹具仅去掉会触发新义务的每周措辞（业务含义不变）。

## P5–P7 复用与验证记录（2026-10-06，本地，零Provider）

P6/P7 无新依赖：双分母/ReviewRow/速度口径复用现有 scripts 结构；恢复夹具复用现有 verify-db-recovery 管道与 coach-recovery-action worker（018/019 数据由既有 growth/growth-controls 函数生成，无新框架）。完整后端 46 文件、单测 71、typecheck×2、build、真实 Chrome 既有回归、50 表非空恢复全部通过。真实模型验证因本会话无 DASHSCOPE_API_KEY（历史 DPAPI 注入器不可用）按工单 0.2 停止，账本未动（658 finished/0 pending，continuation 余 ¥19.7424037）。交付文档 REPAIR-20261006.md。

## R2 批次（2026-10-06，本地，零真实Provider/Coze调用）

按 GLM_NEXT_EXECUTION_ORDER.md R2 执行，接续R1九提交。新增模块：user-command-spans（单遍原文分句扫描器：绝对offset、代码/引号保护span、条件与转述句内状态机、分句级问句标记；供指令与时间两检测器共用，未覆盖表达交回调用方确认）、weekly-plans（复用growth_items priority/ai_observation/proposed，018/019/020既有列承载结构化计划）、coze-public-query（白名单公共检索词构造，输出仅由结构化字段组成）。020迁移SQL按工单原文。无新npm依赖。真实扣子API按工单S1官方 /v1/workflow/run 契约实现（本地mock验证），真实连通未测（无PAT/workflowId）。validation-preflight --offline 零联网预检（凭据仅存在性布尔，账本只读解析）。全部本地检查见 NEXT-20261006-R2.md。
