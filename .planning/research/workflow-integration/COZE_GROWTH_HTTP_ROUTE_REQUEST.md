# LIFEOS_COZE_CORE_20261011_GROWTH_R4_HTTP

本人已明确批准新实现路线：原两个项目改用百炼官方异步 HTTP、已有 Key 安全配置到成长项目开发环境；模型只沿用原唯一 CNY 账本，扣子开发只沿用原积分账本，不新增预算、不自动收费重试。本条是新路线，不是重发 R3；旧失败保留。只修改原项目7693388932939300905，不新建项目，不部署，不自行调用真实产品模型自测，不改认证、权限、AGENTS.md治理。只用合成成年数据与获审公共片段。

## 必须实际实现

1. 复用当前 Python 依赖里的 httpx.AsyncClient；如尚未声明就锁定实际现有兼容版本及许可证，不迁入框架。POST固定 `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions`；固定 qwen3.8-flash，enable_thinking=false，stream=false，JSON response_format，输出上限2048。AsyncHTTPTransport(retries=0)，follow_redirects=false，明确总截止/连接/读超时，取消传播到正在进行的请求，不做备用模型、自动修复或重发。官方协议：https://help.aliyun.com/zh/model-studio/text-generation 和 https://help.aliyun.com/zh/model-studio/qwen-structured-output 。Key只读取DASHSCOPE_API_KEY环境变量，绝不写代码、打印、回执或生成报告。

2. 旧provider.analyze/critic/synthesize丢弃transport返回后拼固定20/5分钟行动和 `resp-{transport}-{counter}`，这是实际BLOCKER。必须使用真实HTTP返回的choices[0].message.content JSON及顶层id、usage、finish_reason。严格校验响应JSON形状/ID白名单/来源，不给坏引用自动补全。使用附件provider-adapter.ts中有界选择机制和实际上下文；分析模型实际选择个人依据、支持/限制/未知、阶段理由、行动及改变建议的条件。review是另一实际执行，读取完整分析与当前请求；综合只能选择已审现有字段，不重新自由生成。不能保留静态生成结果并仅挂上实际responseId。没有合法本人依据的正常未知进入waiting_user/unknown，不一律全图失败；不得生成synthetic占位事实作为真实默认证据。

3. 路径分析必须真实async并行，两方向2+1+1最多4次、三方向3+1+1最多5次。action_review/growth_diff/kb_maintenance按各自已授权能力运行，不以空对象算有用产物。kb_maintenance只给编辑与审阅准备，模型自评不能构成独立攻略审阅或真人批准。实际按模式加载和执行原主Skill+5专业Skill相应版本，原字节SHA256核对，Skill内容进入相应能力的模型上下文；只报告真的执行过的Skill。沿用宿主传入0–2个规范方法片段，禁止另硬编码一套完整攻略库。

## 宿主整图预留凭证（不得复制原账本）

4. 原唯一CNY账本在本地主执行端，禁止复制、初始化或重置到扣子。主端在唯一账本reserveGraph成功后才签发短期凭证，并在网络派发前保存原始完整载荷和凭证。云端必须验证凭证才允许读取Key/派发；缺凭证零模型拒绝。现有运行Token通过HMAC-SHA256固定上下文 `lifeos-host-permit-v1` 派生验证密钥，安全配置为 LIFEOS_HOST_PERMIT_SECRET；这不是创建新Token或改变权限。开发阶段Key和验证密钥已由主端安全配置，不要查询/打印值。原账本和密钥不在附件。

5. wire契约固定为 `{payloadB64,claimsB64,signature}`。两个base64字符串分别为UTF-8完整有效请求JSON、UTF-8claims JSON的标准base64（非URL版）。摘要是解码后的原字节SHA256，不是重新JSON序列化。signature为HMAC-SHA256(验证密钥ASCII字符串, claimsB64 ASCII字符串)的小写hex。claims字段：schemaVersion=1、kind=LIFEOS_COZE_HOST_RESERVED_GRAPH、requestId、projectId、payloadDigest、hostSourceDigest、cloudCommit、cloudSourceDigest、contentHash、skillsDigest、issuedAt、expiresAt、model=qwen3.8-flash、endpoint固定上述完整URL、maxOutputTokens=2048、maxPromptUtf8Bytes=12000、inputCnyPerMillion=0.8、outputCnyPerMillion=2.7、slots数组。每slot有nodeId、callId（原账本UUID）、reservedCostCny（正数）。有效期最多300秒，issuedAt不在未来，requestId与完整请求一致；云commit完整40hex及source/content/skills摘要均64hex并与运行时真实加载一致，不能回显请求冒充自身绑定。

6. payloadB64解码后是正常HostRequest外加显式授权evidenceRecords、realFeedback、canonicalMethods等现有已校验的上下文，不传整段私人历史；仅syntheticAdult=true允许。完整payloadDigest用于幂等。slots与实际模式节点精确相等，nodeId唯一、callId唯一、最多5，费用正数，预算足够。每个实际HTTP前DB事务记录requestId+payloadDigest+claims摘要+nodeId+callId+started，唯一键防并发/进程重启重派；同ID不同任何载荷拒绝。同ID started/unknown只读现有状态，不重新派发。持久化失败零派发；拒绝/取消不得把已经开始的次数和未知费用清零。原子记录未发送slots；完整可信回执可证明not_sent，否则原账本留unknown足额预留。

7. 总prompt messages的实际JSON UTF-8字节必须<=12000（含Skill、schema、方法、上下文）；超长在派发前拒绝，不静默裁掉本人约束。2048输出上限，总图deadline遵循request<=120秒，超时取消剩余节点。回执每slot真实开始/结束、responseId、prompt_tokens/completion_tokens、finish_reason/失败、实际模型；真实usage完整才算估算CNY（不假装供应商最终账单），缺失/失败/取消保留unknown及全预留。整图费用与Coze积分分开，cloud内部账表只是幂等/派发记录，不是第二份预算账本。

8. 零模型runtime读回可免凭证，但业务入口禁止旧corpus_selfheal/私有记忆/隐藏模型前置。Memory OFF、拒绝建议、暂停、遗忘、跨事件、取消、来源版本变更沿用严格校验。Runtime实际读取构建绑定文件：真实已提交40位Git commit（不能unknown/请求回显）、cloud公开生产源码逐文件SHA256、其聚合64位digest、6Skill真实原字节SHA256、host绑定与16张正式可检索规范卡内容哈希分别标清域。原32草稿/16待审不进学生正式检索。修改完成提交当前真实源码，不用R2提交号冒充R4。自引用哈希用明确排除构建元数据文件的源码域，报告纳入路径清单，不把MD5叫SHA256。

9. 读取R3对AGENTS.md的实际diff；撤回未经本人批准的治理改动，仅恢复原治理版本，不加入新权限。报告实际diff。保留旧部署恢复路径4aa53641b7177604cfa96631b9584de991531324。此任务禁止部署；主端核查真实源码与无模型HTTP入口后才另行执行真实业务小批。

## 无模型验证与交付

只执行MockTransport注入的协议/结果解析测试，explicit synthetic；证明内容变化来自注入响应而非模板、独立review读取实际方案、有界综合拒绝新字段、错误source/skill/commit/签名/过期/载荷、重复ID+不同内容、并发、DB失败、进行中取消、超时、未知usage、实际调用预算；禁止真实百炼自测或收费重试。输出完整已提交commit、逐文件SHA256清单、原始测试输出、四模式实际输入输出Schema、可直接验证的零模型runtime/拒绝请求JSON及原始/run回执。生成者声称PASS仍只是开发报告；主Codex将核对真实源码。没有实际入口或能力明确unavailable，不以布尔值、角色名、49个夹具替代上线。
