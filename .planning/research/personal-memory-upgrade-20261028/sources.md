# 一手来源与适配记录

核验时间2026-10-28；通过官方网页与gh只读API查阅，未运行外部仓库代码、未安装依赖。

- DeepInfer，Apache-2.0，commit 553741557a57df44a46fb3ab72b6aafeaf945337：https://github.com/deepseek-ai/DeepInfer 。README核实支持模型、硬件、异步调度、draft token验证、结构约束与完整服务缺项。硬件级吞吐不直接转化为现用API性能。
- Hy-Memory，commit a621262fac2c0d30285d0dfbe7a27cf035588ce1：https://github.com/Tencent-Hunyuan/Hy-Memory 。README记录hy-memory2.0.4，chat/working/coding分层与lite/pro/ultra；已读取LICENSE正文，Apache-2.0（GitHub自动识别NOASSERTION不足以判定许可证）。
- https://memory.hunyuan.tencent.com/ ：2026-10-16官方2.0发布，模型/框架/MemHub可独立使用。官方比较结果不作为产品验收。
- https://huggingface.co/tencent/Hy-Memory-30B-A3B ：专用记忆写入模型；固定20%评测子样本、更换写入模型而固定读取/回答链；不能将约3B激活参数误作总驻留规模。
- https://arxiv.org/abs/2610.22196 ：记忆在线策略蒸馏及归因强化学习，控制过量存储、通过下游可回答性评价记忆；借鉴验收设计，不开展训练。
- https://arxiv.org/abs/2606.09483 ：同步写入与异步演化，版本变化链；上层抽象必须服从LifeOS用户确认与禁止人格推断边界。
- https://github.com/Tencent-Hunyuan/Hy-Memory/blob/a621262fac2c0d30285d0dfbe7a27cf035588ce1/docs/pro_graph_design.md ：图为派生投影，来源生命周期同步；有界关系扩展；Kuzu单进程限制与本项目双实例发布不匹配。
- https://github.com/Tencent-Hunyuan/Hy-Memory/blob/a621262fac2c0d30285d0dfbe7a27cf035588ce1/hy_memory/pipelines/_retrieval/evolution.py ：版本链回溯/去重，过滤不可见来源和SHADOW；参考设计，不复制实现，不引入第二数据库。

本地依据：PRODUCT.md、AGENTS.md、LIFEOS_CONTINUOUS_FEEDBACK_HANDOFF_20261027.md、LIFEOS_DECISION_WORKBENCH_ACCEPTANCE_20261027.md；server/experience-patterns.ts、server/starmap-enrichment.ts、server/experience-episodes.ts、server/coach-retrieval.ts、server/experience-vector-cache.ts、server/store.ts、server/turn-prompt.ts、server/turn-engine.ts。

## 2026-11-01 成熟实现复用核对

通过 agent-reach 的 GitHub/gh 路由只读核对；未执行外部仓库脚本，未安装依赖。

- Mem0，Apache-2.0，commit `753496cf1435d76c3a711f3af51303f7fdcb6420`：https://github.com/mem0ai/mem0 。核对 TypeScript OSS 的 `MemoryUpdateSchema` 与更新提示：https://github.com/mem0ai/mem0/blob/753496cf1435d76c3a711f3af51303f7fdcb6420/mem0-ts/src/oss/src/prompts/index.ts 。直接复用其显式 `ADD / UPDATE / DELETE / NONE` 操作代数；LifeOS 分别映射为现有 `create / correct(amend|replace) / forget|withdraw / omit`，但继续由服务器绑定 clauseId、旧记录 ID 和版本，不导入 Mem0 的独立向量库、事实改写或额外模型调用。
- Graphiti，Apache-2.0，commit `16bf514380de4e44884aed6779bece220e6fe470`：https://github.com/getzep/graphiti 。核对来源 episode、`valid_at / invalid_at` 时态边和失效逻辑：https://github.com/getzep/graphiti/blob/16bf514380de4e44884aed6779bece220e6fe470/graphiti_core/utils/maintenance/temporal_edge_utils.py 与 https://github.com/getzep/graphiti/blob/16bf514380de4e44884aed6779bece220e6fe470/graphiti_core/utils/maintenance/edge_operations.py 。直接复用“来源事实保留、派生关系版本化失效”的边界；LifeOS 继续使用现有 PostgreSQL 来源消息、事件修订和 suppression/withdrawal，不迁入 Neo4j/FalkorDB/Kuzu 第二真相源。
- Hindsight，MIT，commit `bc5ea195a0fed1346ff171a5780bbb72a38c89c8`：https://github.com/vectorize-io/hindsight 。核对 delta-retain 回归：https://github.com/vectorize-io/hindsight/blob/bc5ea195a0fed1346ff171a5780bbb72a38c89c8/hindsight-api-slim/tests/test_delta_retain.py 。直接复用“内容未变化不重新抽取、不调用模型；变化只处理增量且保留旧来源”的验收不变量。LifeOS 已用 requestId 回放避免第二次供应商调用，并且每轮只把当前服务器分句目录交给抽取器；因此保留现有实现和回归，不引入 Hindsight Python 服务。
- Letta，Apache-2.0，commit `8816d3a8516893bfdc0fa14bfb1235226012e295`：https://github.com/letta-ai/letta 。作为有状态 Agent 对照核对；其独立 Agent 运行时和记忆块生命周期会与 LifeOS 已有会话、来源权限和发布恢复链重叠，本轮不接入整套服务。
- Cognee，Apache-2.0，commit `525b1d1179c550cd5b5661bcbf8f00f57a676928`：https://github.com/topoteretes/cognee 。作为图记忆/数据管线对照核对；其 Python 图管线会增加另一套摄取与存储生命周期，本轮不接入整套服务。

直接落地：Mem0 的显式记忆操作代数映射到现有 create/correct/forget/omit；Graphiti 的未来断言时态边界用于阻止“计划完成了……后……”被当成已执行经历；Hindsight 的 unchanged/delta retain 不变量继续约束 requestId 回放、增量抽取和供应商调用计量。三者均通过 LifeOS 现有公共接口和唯一事务链验收，不另建兼容层服务。

复用结论：五个候选中，三个成熟机制已经落在 LifeOS 的同一事务/来源架构中；整套运行时接入会增加第二存储、Python/图数据库服务或额外收费调用，复用成本和真实性风险均高于局部机制复用。后续通用记忆模块仍先按 AGENTS.md 做同类核对。
