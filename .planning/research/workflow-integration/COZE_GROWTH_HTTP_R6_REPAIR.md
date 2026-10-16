# LIFEOS_COZE_CORE_20261011_GROWTH_R6_HTTP_REPAIR2

这是已批准百炼异步 HTTP 路线内第二次修复。R5 实际云 HEAD 697655773bb6315eb38956a4de12bc1828aa02b1。主集成者下载实际六个文件；wire SHA3396c0868acc0c6e35dc527f9f21026539ccd3c7566bf087bea1399ed98a78ee 与终端一致。原宿主冻结 fixture 的 ISO/HMAC/原槽 UUID 回放及坏签名、过期、载荷篡改四项已通过，不重写已经通过的凭证实现。仅合成成年与现有16张获审公共卡，无真实模型自测、部署、AGENTS治理修改、权限扩大、收费重试或新增预算。

## 必修实际缺陷

1. entry._make_store(None) 在 get_engine 不可用时仍无条件返回 MemoryDispatchStore。函数代码上的“仅测试”注释不能替代隔离。正常 /run 必须使用真实已有 SQL 引擎，数据库读取、保留、写入失败均 unavailable 零派发；测试只允许明确传入 MemoryDispatchStore + MockHttpTransport，不能从正常入口隐式打开。finish/receipt 写失败保留 started 及未知费用，不能声称已完成或第二次重派。
2. provider._candidates_from_analysts 把所有 directionId 写为0，title写成 cr.model。原 path:employment 对应employment原方向的title必须保留。不能模型名冒充学生方向。主端实际函数 AST 执行已失败，原输出保留。
3. _build_proposal 当综合只选一项或含无效项时恢复所有 kept；实际输入[a]、可用[a,b]返回2项，已失败。只读回合法选择，非法/空值如实 invalid_contract/waiting_user，不恢复被删或未选项、不制造新事实。具体行动描述、actionBasis、support/limit/unknown、阶段适用及改变建议的条件必须来自实际获准方法片段与原学生事实，LifeOS编辑适配明确。目前_next_actions固定模型标题+核实stopCondition+15分钟，不算个性化；勿继续这个模板。沿用现有宿主 provider-adapter 的合法方法/编辑选择机制，不硬编码第二套攻略库。
4. run_analyzer 在完整字节门之前 ledger.begin，字节超限没有POST也记录为已派发。先计算完整实际 messages 与 schema/Skill/上下文/候选 UTF8 字节，再 CAS开始并马上POST。保留原slot，不重新签发。非POST的零派发不得虚记providerCalls。实际usage/id/finishReason/actualPromptBytes/model需进入对应slot，unknown保持null，不丢弃已开始slot。
5. asyncio.gather(*coroutines)首个异常后不会自动取消其他请求，当前代码只改状态，未cancel并await。RealHttpTransport.close调用gather没await，也没await client.aclose；sync包装thread.join(600)与120s总截止不一致。用统一截止管理真实Task句柄，异常/取消立即cancel兄弟，await gather(return_exceptions=True)和aclose，返回前所有HTTP任务终止。结束账本后不能还有正在跑的模型请求。应用逻辑/参数错误不能全部改成cancelled而隐藏首次错误。
6. _validated_records 必须核对 authorizedEvidenceRefs 的精确(type,id,revision)，而不只owner/event/status；不得消费未授权或错revision；当前strip丢弃budget/approved/sourceKind等主端字段也需保留并核对。拒绝已撤回/公共/工具资料成为个人依据；跨账号、跨事件零违规。真实public卡仅当前16批准版本片段，超界/撤回片段不得使用。
7. 仅direction_decision存在；按照原R5第6项，复用现有 action_review/growth_diff/kb_maintenance 四工作流与5专业Skill，补正常入口的真实结果通道。growth_diff不需模型时零生成，action_review分开未开始/交付/采用/付款/效果与未知，kb_maintenance只做编辑准备，不能产独审/本人批准/发布假回执。每模式只报告实际加载并消费的Skill及对应版本/hash，失败诚实unavailable而不丢合法已有事实。不扩图、不新增Agent。
8. runtime_binding 正式16卡已获得，禁止资产缺失时悄悄换legacy8卡或以unknown继续派发；本域实际哈希核对，不把host corpusHash当本地可用card片段域。最终从正常免凭证runtime_readback读完整提交、实际文件hash、全库/批准子集、可用模式。原6c宿主协议可作为当前修复兼容基线，不能宣称已自动适配更新的宿主版本。

## 交付与验证

所有运行零百炼付费调用。先保持原fixture四项；增加以上三个真实函数回放的失败修复，各自基于原host路径/候选/DB不可用。SQL两进程CAS与进程重启不可重派；真实httpx MockTransport/本地合成HTTP服务验证字节门之前零POST、一个失败后其他任务取消等待、图总deadline、unknownUsage足额预留。同事实变化导致具体取舍/行动改变；四模式使用真实原字节Skill进入请求的spy+正常入口产物读回，不能只检查函数返回布尔值。所有首次失败日志保留。AGENTS原字节hash核对不修改。按顺序源码提交→正常/run runtime_readback→最终完整commit/hash与原始日志；禁止用提交前旧HEAD作为最终版本。

不得把31/31 Mock、开发者自行评分或换角色名冒充独立审阅/真人批准/真实质量。若仍有HIGH/BLOCKER如实交付并保留首次失败；修复轮数不设上限，在既有授权和足额可用预算内继续修复、验证与Review。收费请求不自动重试，验收未通过不发布。原账本仅余既有额度，不引入预算。
