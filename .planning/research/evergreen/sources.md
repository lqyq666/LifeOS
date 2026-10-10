# 来源与复用决定

本轮先检查已有 KnowledgeCard、导入器、BGE本地编码器、权限/遗忘、Coze registry、聊天事务和React渲染接口。复用既有pg事务、cheerio、PyMuPDF、React原生details和前端api客户端；没有安装框架、运行外部仓库代码或新增Provider。

实施前通过GitHub搜索检查 Raudaschl/rag-fusion 的 main.py、test_main.py、LICENSE 和仓库维护记录。核对提交 870e46865e38c348d49ea65940f47d23265eeb6b，许可证MIT：<https://github.com/Raudaschl/rag-fusion/tree/870e46865e38c348d49ea65940f47d23265eeb6b>。借鉴多路排名融合的行为和去重测试；按公式独立实现RRF，不复制代码，不引入LangChain或其额外多query生成调用。持久化索引复用已有512维编码与PostgreSQL版本事实，而非迁入一套外部RAG服务。

公开来源先运行agent-reach doctor，Jina匿名正文读取返回401，改用公开原站GET及web原文读取。没有绕过登录/验证码，未读私有Cookie，不把搜索摘要充作原文。Upwork原站程序GET为403，但web工具可读正文；仅保存核对的短原文片段及行号，fingerprint_scope明确为片段，不能声称完整网页快照。

15个来源的URL、获取时间、可访问状态、未知作者/年份、source_group和hash见KB_SOURCE_REGISTRY.jsonl。quote、定位、提炼覆盖与舍弃范围见KB_EVIDENCE.jsonl；原文二次读取对应 *_REOPEN.jsonl。清华时间手册第12页经过PDF像素检查。英文短引文限制在每原文25词内；不保存或发布整篇正文、付费课件和原视频。

IES四个推荐共21词短引文，学习来源为原始指南；清华备考网页标明转载Reading University，故不作两个独立来源。Upwork两篇同平台实践文章同属upwork-practice。MVP、宿舍沟通、职业访谈报道明确是实践/教育材料，不冒充随机研究或个人效果证明。平台观看/点赞/收藏数据未获取时保持null。

32张逐卡语义审阅已记录在KB_SEMANTIC_REVIEW.json，审核者为Codex，非独立人工验收。12张标杆加4张有边界的方法获审；其余16张将原文确能支持的部分与缺口逐项写清，因缺任务相关证据保持needs_review，不能检索或引用。

## 2026-10-10 本地待审复核增量

没有新增产品模块、依赖或联网采集。复用既有Cheerio、guideContentHash/validateEvergreenGuide/validateKnowledge、隔离PG导入器及原SDK；只补局部门禁、说明和验收脚本。原15个registry来源与2份既有MIT正文按已保存字节重新读取，15份正文、2份短片段明确分开。短片段不支持角色/范围/复购的扩大主张；来源支持与LifeOS编辑适配分列，未以正文可读或hash匹配代替独立审批。

逐项材料：`../workflow-integration/evidence/acceptance-20261010/pending-review/SOURCE_REOPEN.json`、`PENDING_16_REVIEW.json`和`MAINLINE_REVISION_CANDIDATES.json`。复用既有华师职业访谈、清华考试检查、MIT读研目的及Upwork项目目标片段形成四份同canonical待审修订；不批准、不发布、不把59缺口改成已覆盖。精确原文位置、字节hash、局限和反馈适配均附在草案中。
