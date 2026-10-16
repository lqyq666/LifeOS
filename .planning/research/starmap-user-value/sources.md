# Sources: 星图主要关键词与经历摘要

- https://github.com/getzep/graphiti — temporal context graph；entities/relationships 可追溯到原始 episodes。
- https://github.com/langchain-ai/langmem/blob/main/docs/docs/guides/extract_episodic_memories.md — episodic schema 将经历拆为 observation、action、result 等字段，并用于相似情境复用。
- https://github.com/microsoft/graphrag/blob/main/packages/graphrag/graphrag/prompts/index/community_report.py — 汇总结论必须由输入记录支持并保留 data references。
- https://github.com/mem0ai/mem0/blob/main/docs/core-concepts/memory-operations/update.mdx — 更正既有记忆后重新读取验证，内容与元数据同步维护。

这些项目仅提供设计参照；本次不引入其服务、数据库、模型调用或依赖。
