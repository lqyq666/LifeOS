# 实现复用核查（2026-10-10）

- GitHub 检索用 agent-reach 的 GitHub / gh 后端。`gh search repos typebox`、`gh search repos p-limit`，读取仓库元数据、README、许可证链接和实际实现。
- [TypeBox](https://github.com/sinclairzx81/typebox)：本库已有 typebox 1.3.34，包声明 MIT，README 当前亦说明 MIT，GitHub 元数据 pushed_at 为2026-10-06。读取本机 `build/value/check/check.mjs`，其 Value.Check 直接交给 Schema.Check；复用已有 Type/Static/Value.Check，与现有 action-coach-contracts 同风格。验证为本轮实际 schema 正负测试，没有安装新版本或复制第三方源码。节省另写 JSON schema 和运行时检查。
- [p-limit](https://github.com/sindresorhus/p-limit)：MIT，pushed_at 为2026-09-18；读取真实 index.js。现有实现处理队列/并行限额，但清空队列不会取消已经运行的 Provider，需要另写 deadline、来源重验、消费预留、幂等和取消；本任务只需最多3条并行路径，不迁入队列框架，使用标准 Promise.allSettled 和 AbortController。未复制第三方代码，也未新增依赖。
- 原 LifeOS：复用 `scanUserClauses`、`readCoachEvent`、`readGuideUsage`、`growthQuoteSuppressed`、原模型 SDK、`finishRun`、`coach_events`、`kb_guide_usage`、隔离测试运行器和 evergreen corpus/importer。工作流不新建事实数据库。

外部核查是只读；没有执行外部仓库脚本。源码来源与本地依赖版本分开报告，上游默认分支不能代替本地版本验收。
