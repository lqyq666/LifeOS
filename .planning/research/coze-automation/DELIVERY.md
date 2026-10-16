# Coze 公共知识检索自动化交付报告（GLM_COZE_AUTOMATION.md S0–S9）

执行日期：2026-10-06（北京时间）。执行者：GLM（本机 CLI + 浏览器自动化）。
工单：`D:\aaaLife\LifeOS_Coze_GLM_20261006\GLM_COZE_AUTOMATION.md`。
私有证据目录：`.local/coze-automation/`（gitignored，不含任何密钥值）。

## 1. 基线、文件与 Git 状态

- 分支 `fix/campus-acceptance-contract-20261006`；本批基线 = R2 收口提交 `b4bc4ef`。
- 本批提交：`c5f4c1f`（S0–S7：云端服务 + 本地 code_workflow 适配器）+ 本报告所在收口提交（S8/S9：真实联调、registry 修复、对照脚本）。
- 本批修改/新增（相对 `b4bc4ef`）：
  - `server/coze-code-workflow.ts`（新增）：code_workflow 传输适配器。
  - `scripts/validate-coze-code-workflow.ts`（新增）：零网络 preflight + 显式 `--real` 验证驱动；本批补 process.env 合并（`--env:` 参数优先）。
  - `scripts/compare-coze-retrieval.ts`（新增）：S8 同题对照（真实扣子 vs 本地检索）+ C21 错误 Token 探针。
  - `tests/backend/coze-code-workflow.test.ts`（新增，5/5 绿）。
  - `tests/backend/coze-knowledge.test.ts`（修改）：registry 夹具改为 `.local/` 临时独立注册表（§7.4"结束后不得留下测试ID"）。
  - `server/coze-knowledge.ts`（修改）：`mapCozeCandidates` 注入 `registryRoot`。
  - `.planning/research/campus-growth/coze-public-registry.json`（修复）：清除误提交的测试绑定，恢复空 bindings（正确生产状态）。
  - `.planning/research/campus-growth/sources.md`、本报告。
- CLI：`coze 0.3.11`（复用，未重装；skills 0.3.6/0.3.11 mismatch 提示仅记录，未执行 skill install）。
- 收口回归（本批修改后全量）：`typecheck` ✓、`typecheck:server` ✓、`npm test` 74/74 ✓、`build` ✓、`test:backend` 全套隔离 PG exit 0 ✓。

## 2. 认证与云资源（无凭据值）

- CLI auth：首次检查 `logged_in:false` + exit 0（未登录判定正确）；用户本人完成官方设备激活后 `logged_in:true`（user_id 3647505259329274 / RootUser_2129409665）。
- 空间：唯一个人空间 `7651603600241836078`（个人空间），无多空间歧义。
- 项目：`7693465311558795327`（AI 编程 workflow，"公共资料检索工作流"）。S2 核实空间内无既有 LifeOS 项目后一次性创建，任务 `363941496948738` 状态轮询至 done，未重发。
- 云端消息：共 2 条（1 建项含完整任务书 + 1 只读审计指令）；`audit-send-result.json` 记录 exit 3221226505（Windows libuv 断言，消息已 sent、结果经 status/history 核对）。
- 运行时 API Token：**已创建**（用户授权后经浏览器官方 UI：部署页 → 记录"更多" → 执行工作流 → API 请求示例 → 管理 API Token → 创建）。
  - 形态：RS256 JWT，739 字符，`iss=api.coze.cn`，永久有效（exp ≈ 262142 年）；aud 1 项；`src=inbound_auth_access_token_id:7693531587320741903`。
  - 存储：仅 `.local/coze-automation/runtime-token.txt`（`.gitignore` 第 6 行 `.local/` 覆盖，`git check-ignore` 验证）。报告与日志只含布尔/长度/前后缀元数据。CLI OAuth 与运行时 Token 完全分离（C06）。

## 3. 云端 Knowledge 与语料

- 调用方式：官方 `coze-coding-dev-sdk==0.5.25` `KnowledgeClient.add_documents` / `KnowledgeClient.search`（新版 Knowledge 数据库，非旧版 datasets/OpenAPI）。
- 集合：`lifeos_public_knowledge`（所有 add/search 实际发送的 table_name）。
- 图：`validate_query → knowledge_retrieve → assemble_response`，无 LLM 节点（检索服务内无答案生成，C35）。
- 语料版本：`v1(r1)`，8 份 gov.cn 公开资料，全部 active；幂等复验证：重复导入 0 新文档、doc_id 不变（C13）。
- 文档映射（真实平台 doc_id）：8 个 ID 全部固定：
  `7693516367932211243, 7693516416284246062, 7693517414327205939, 7693518118848806938, 7693518303737954323, 7693518373791186953, 7693518750766874650, 7693520896031604782`。
  其中 URL 级映射云端报告确认 2 条：`content_7082504.htm→7693517414327205939`、`content_7081574.htm→7693520896031604782`；其余 6 条按真实检索内容主题可反查（见 §7 质量发现）。
- 更新/停用规则：manifest（source_url+sha256 指纹幂等键，status active/inactive/retired，活动白名单在检索节点过滤）；云端开发环境实测 inactive → `items:[]`、恢复 active → 命中恢复、旧孤立 doc_id 经白名单隔离不返回。

## 4. 部署与接口契约

- deployId `7693525668302422058`，cloudCommit `7cf4bd7bc3ec0901136c8006fa985a461043c84a`，域 `https://7hdbk4bb24.coze.site`，`/run` 同步 POST，状态 Succeeded（单次部署、无 auto-fix；部署前无 Token 探测得 401 形状）。
- 输入：`{"query": string}`（≤2000）。输出：`{"schemaVersion":1,"items":[{"documentId","content","score|null}]}` ≤6 条、片段 ≤4000 字符、documentId+content 精确去重保序——与本地适配器 TypeBox 契约逐字段一致。
- 冻结：transport=code_workflow（与 legacy resource_workflow 互斥、不跨传输重试）；origin 白名单 `*.coze.cn/.coze.run/.coze.site` + 路径 `/run`、`/v1/fs/<id>/run`；redirect:error；256KiB 累计字节上限；TopK=6、min_score=0.0、超时默认见适配器；projectId=7693465311558795327。
- Token 存在性：`LIFEOS_COZE_CODE_TOKEN` 已配置（值不外泄、不入库）。

## 5. 真实调用证据（去密钥）

- 8 条验证矩阵（`validation/real-1791290716234.json`）：全部 200；冷启动 891ms，后续 518–713ms；命中 4–6 条。
- 12 条同题对照（`validation/comparison-1791291025580.json`）：正/负例、同义、英文类别、错年度、无关主题；Coze 全部 200，462–891ms。
- 请求样例（无密钥）：`POST https://7hdbk4bb24.coze.site/run`，头 `authorization: Bearer <739-char JWT>`，体 `{"query":"浙江 2026 专升本 报名条件"}`；响应 `{"schemaVersion":1,"items":[{"documentId":"7693520896031604782","content":"…","score":…}]}`（content 为语料原文片段）。
- C21 错误 Token：单次探针 `invalid-probe-token` → `CODE_AUTH_401`（FAIL_FAST，不冒充空命中；同凭据不重复调用）。

### C01–C36 验收矩阵

| ID | 结果 | 证据 |
|---|---|---|
| C01 | PASS | CLI 0.3.11 复用；LifeOS 依赖零变更 |
| C02 | PASS | 首查 logged_in:false+exit0 正确判未登录；官方设备激活后 true |
| C03 | PASS | 空间内无既有 LifeOS 项目（list 核对）后一次性 create |
| C04 | PASS | create/audit 结果均经 status/history 轮询，未自动重发 |
| C05 | PASS | 唯一个人空间，无歧义落资源 |
| C06 | PASS | CLI OAuth 与运行时 JWT 分离；适配器只读 LIFEOS_COZE_CODE_TOKEN |
| C07 | PASS | 后端单测（空/非字符串/超长 query 明确报错） |
| C08 | PASS | 8 doc_id 与检索片段实测对应（本批 20 次真实调用） |
| C09 | PASS(结构)/质量受限 | 专接本/备考同义查询 200 返回；相关性受语料主题限制（§7） |
| C10 | PASS(结构) | 英文类别渲染查询 200 返回；同样受语料限制 |
| C11 | 如实记录 | 量子纠缠查询返回 4 条低相关候选（未硬编码空结果） |
| C12 | 如实记录 | 2019 错年度返回与 2026 相同文档（语料无按年度政策文件） |
| C13 | PASS | 云端幂等复验 0 新文档 |
| C14 | NOT_TESTED(真实) | manifest revision 机制存在；本批未做真实语料更新 |
| C15 | PASS(云端)/NOT_TESTED(部署API) | 云端 inactive→items:[] 实测；未对部署 API 复测 |
| C16 | PASS(设计) | 内容仅作数据；白名单/无执行路径；语料无恶意文档实测 |
| C17 | PASS | 严格 schema 单测 + 20 次真实响应合规 |
| C18 | PASS | documentId+content 精确去重保序（单测+parse 矩阵） |
| C19 | PASS | 直接 JSON，旧 data 信封拒收（单测） |
| C20 | PASS | resource_workflow 显式分支可解析；无跨协议重试（单测+引擎代码） |
| C21 | PASS | 真实 401 探针 FAIL_FAST |
| C22 | PASS | 超时/500/429/坏JSON 错误类别单测 |
| C23 | PASS | 预取消不发请求/中途取消 CANCELLED（单测） |
| C24 | PASS | 累计字节上限流式中止（单测） |
| C25 | PASS | 端点矩阵单测：https/无 userinfo/无 query/固定路径/官方后缀/私网拒收 |
| C26 | PASS(设计+单测) | 引擎只传 renderPublicKnowledgeQuery 白名单结构化字段 |
| C27 | PASS | 未登记 documentId 全部 unverified 候选，零写入（单测+真实调用：本批 registry 空，20 次调用 0 verified） |
| C28 | PASS | registry revision/hash 不匹配→unverified（单测 stale-revision 用例） |
| C29 | PASS | 候选 excerpt 连续包含校验（单测编造内容用例） |
| C30 | PASS | 部署 API 只返回云侧 doc_id；本地开发库数据未上云 |
| C31 | PASS | registry 缓存按路径+指纹隔离；本批并修复测试污染真实 registry 问题 |
| C32 | PASS | 默认关闭零外呼（preflight.json + 单测）；产品按原路径运行 |
| C33 | PASS(设计) | 引擎 coze_knowledge_failed 仅审计，回答链不编造外部结论 |
| C34 | UNKNOWN | 平台未暴露逐操作计费；见 §8 费用 |
| C35 | PASS | 云端图无 LLM 节点；部署响应亚秒级、内容为语料原文 |
| C36 | PASS | 本报告分层列出 |

## 6. 分层结果

| 层 | 结果 |
|---|---|
| 本地模拟（mock HTTP + 隔离 PG） | 全绿（coze-code-workflow 5/5、coze-knowledge 6/6、全量回归见 §1） |
| 云端开发试运行 | 通过（云端 test_run 输出契约一致；幂等复验 0 新文档） |
| 部署 API 真实调用 | `DEPLOYED_API_PASSED`（20 次 200、错误路径 401 正确） |
| 来源映射/可信引用 | `SOURCE_MAPPING_PASSED`（registry 机制+8 doc_id 稳定反查）；可信引用链 PENDING——8 份云文档在本地无已核验卡片，按设计全部为未核候选（§7.4 首卡规则） |
| 真实产品模型回答 | NOT_TESTED（百炼 Key 缺失，未发起任何百炼调用/费用） |

允许声明使用：`LOCAL_ADAPTER_PASSED`、`CLOUD_KNOWLEDGE_SMOKE_PASSED`、`DEPLOYED_API_PASSED`、`SOURCE_MAPPING_PASSED`（映射机制层）。LifeOS 整体仍 WIP_NOT_READY；本检索服务时延不替代 PRODUCT.md 20 次真实交互门槛。

## 7. 质量、时延与失败（不只列成功）

- 时延：冷启动 891ms；稳态 462–891ms（12 题均值 ≈ 600ms）。配置：code_workflow、TopK=6、min_score=0.0、每次调用均触发检索。
- **语料相关性缺口（本批最重要发现）**：云端代理选定的 8 份 gov.cn 资料为时政类（国庆招待会、《求是》民生文章、文化遗产保护、特种作业人员等），**不含升学/就业政策文件**。因此 12 条政策类查询的返回是"传输与契约正确、主题不匹配"的低相关候选：正例与错年度、无关题的返回集合高度重叠；错年度未因年份被拒（语料无按年度文件）；无关题返回 4 条而非空。该结果如实保存于 comparison JSON，未美化。
- 本地对照基线：当前本地 dev 库无 campus_knowledge 表（4/20+ 迁移），生产库亦未导入政策卡（sources.md 记录）——本地检索对这些公共题实际为空/不可用，这正是本接入层填补的缺口。
- 失败/异常记录：audit 消息 CLI exit 3221226505（Windows libuv 断言，消息实际送达）；Token 首次剪贴板捕获截断（execCommand 选区），改用完整 JWT 重组后 200 验证通过；验证脚本首跑 CONFIG_MISSING DISABLED（脚本只读 --env 参数），修复为合并 process.env。
- 无 TOKEN 值出现在任何报告/日志/截图。

## 8. 费用（unknown 不是 0）

- 云端 AI 编程消息：2 条（建项+审计）；单价 unknown（平台未暴露逐条计费）。
- Knowledge 写入/检索：开发与托管当前优惠下金额 unknown。
- 部署托管（CPU1/RAM2GiB）：unknown。
- 20 次真实检索调用：单价 unknown。
- 百炼：0 调用、0 费用（唯一原账本未动）。

## 9. 未达项、回退与下一步

未达项：
1. 语料相关性：需把已核验政策源（浙江 2026 专升本通知 zjzs.net、教育部 2027 硕士招生规定 yz.chsi.com.cn，sources.md 已有原始 hash）及更多政策页经云端幂等导入器替换/扩充语料，再复跑本矩阵——这是下一条最高价值动作。
2. C14/C15 对部署 API 的真实更新/停用复测。
3. 8 文档 URL 级映射补全（读云端 manifest 或一条只读消息）。
4. 可信引用链：政策语料入库并通过人工维护卡核验后，登记 registry bindings 才能让候选进入可信引用。
5. 真实产品端到端回答（待百炼 Key）。

回退方法：
- 产品开关默认关闭（LIFEOS_COZE_KNOWLEDGE!=='true' 或缺 code_workflow 配置即零外呼）；删除环境变量即完全回退。
- 云侧：CLI 删除项目/停部署；Token 在平台 API Token 管理中删除（创建路径同 §2）。
- 本批代码回退：revert 本批提交（适配器独立、无迁移、无产品行为变化）。

下一条可执行动作（按序）：
1. 授权一条云端只读消息：dump `assets/config/lifeos_doc_manifest.json` 补全 8 条 URL↔doc_id 映射。
2. 授权语料替换/扩充（用已核验 2 政策源起步）→ 重跑 `scripts/compare-coze-retrieval.ts` 12 题。
3. （可选）C14/C15 部署 API 真实复测。
