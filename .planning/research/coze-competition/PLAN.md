# LifeOS 参赛版：多智能体成长助手（Coze 编排）

立项日期：2026-10-06。用户意图：参赛项目，评审重点是智能体搭建与工作流编排；把 LifeOS 已有机制改编为多个智能体 + 编排层在 Coze 上实现并连接。

## 定位与红线

- **参赛演示件**，机制同构于本地 LifeOS 真实产品；两者数据互不流动。
- 全程**合成演示数据**（s_demo_001 小林 / s_demo_002 小张），不上传任何真实学生资料（沿用既有安全边界）。
- 不自动部署、不建 Token、不充值；部署/发布等收费动作先请示。
- 本地 LifeOS 产品代码**零改动**（本批不动仓库源码，只新增本文档与 .local 运行证据）。

## 云端资源

- 空间：7651603600241836078（个人空间，唯一）
- 项目：7693388932939300905 `LifeOS_多智能体成长助手`（workflow 类型，AI 编程）
- 建项消息：`.local/coze-competition/create-prompt.txt`（任务标识 LIFEOS_COMPETITION_AGENTS_C1）
- 既有检索服务 7693465311558795327 保持独立（真实产品用的微服务，参赛版自带知识库）

## 架构（写入建项任务书的契约）

```
/run {session_id, message}
  └─ orchestrator
      ├─ intent_router      [代码节点] 分句分类 control(疑问/条件)/knowledge/fact
      ├─ control_agent      [LLM] 方向控制：明确指令才写库；疑问只反问
      ├─ knowledge_search   [代码节点] 原生 KnowledgeClient.search top_k=6
      ├─ answer_agent       [LLM] 只依据检索原文回答，逐论断带引用
      ├─ citation_review    [代码节点] 引用必须是原文连续子串，否则降级 unverified
      ├─ fact_agent         [LLM] fact/feeling/unknown 结构化；unknown→追问义务
      └─ receipt            [代码节点] 本轮状态变化回执 + 义务清单
```

输出契约：`{schemaVersion, reply, route, receipt, obligations{pending,resolved,new}, citations[{quote,documentId,verified}], audit}`。

数据库表：demo_students, events, event_nodes, unknown_questions, direction_controls, receipts, knowledge_manifest。

语料：浙江2026专升本通知（zjzs.net）+ 教育部2027硕士招生规定（chsi.com.cn）+ 云端自行核验的 2-4 份政策页（限 gov.cn/zjzs/chsi 域），幂等导入。

## 差异化卖点（答辩用）

1. 逐轮追问义务状态机（unknown → pending → resolved），AI 不沉默丢失信息；
2. 引用可信链：代码节点硬校验"引用=原文连续子串"，伪造引用自动降级；
3. 用户可撤销方向控制（暂停/恢复），疑问句绝不直接改状态，AI 不替用户做决定；
4. 每轮回执：写库明细 + 义务变化 + 引用核验计数，全部可审计。

## 批次计划

- **C1 建项（完成）**：项目 7693388932939300905，任务标识 LIFEOS_COMPETITION_AGENTS_C1
- **C2 云端构建（完成）**：约20分钟，commit `8c7a17e`
- **C3 只读审计（完成）**：`.local/coze-competition/audit-answer.txt`（23KB，含文件树/编排连线/三个智能体系统提示词全文/引用审校算法/DDL/manifest/7轮真实试运行/伪造引用降级/7项已知偏差）
- C4 本地真实调用：**待部署授权**（workflow 项目无 CLI preview；需 deploy + 该项目专属运行时 Token）
- **C5 文档（本文件 + .local/coze-competition/ 证据）**
- 后续批次（待用户确认）：planner 智能体（周计划）、遗忘演示、发布为可访问演示入口

## C3 审计核实结论（2026-10-06）

交付与任务书一致并超出基线的部分：
- 编排：intent_router → 3 并行条件分支 → receipt 汇聚，DAG 连线代码可读；
- 三个 LLM 智能体系统提示词均写明"不替用户决定/不编造引用/命中≠资格/未核验只作候选"；
- 引用审校 `verify_citation`：去空白后连续子串判定，纯代码，伪造引用实测降级、缺 documentId 拒绝；
- 语料 5 份政策页全部实际抓取导入（含 zjzs 细则 docx 独立成档），sha256 幂等——**修正了检索服务项目语料离题的问题**；
- 7 轮真实试运行覆盖全部四条链路，义务 pending→resolved 与新建流转均有 DB 前后状态佐证。

已知偏差（云端如实报告，此处确认接受/跟踪）：
1. 伪造引用降级在脚本级演示，整图内模型未自然伪造（可接受：审校是防御机制）；
2. answer_agent 曾因 max_tokens 截断，已修复重跑；
3. 意图路由纯关键字，"我记起来了"类表述会误路由（参赛演示用标准表述规避，答辩可说明为规则路由边界）；
4. zjzs 通知页短、细则在 docx（已拆两条 manifest）；
5. manifest 无独立 verified 层级（引用审校运行时兜底）；
6. 未部署（按指令）。

## 运行证据

`.local/coze-competition/`：create-prompt.txt、create-result.json、status-*.json、后续 audit/验证输出。

## P1 批更新（2026-10-06，GLM 执行）

- 云端任务 LIFEOS_COMPETITION_AGENTS_P1（取代卡死的 FIX2）完成：K1–K5 修复 + companion 伙伴分支（承接+一关键追问/直接行动、事件与义务状态机 pending/resolved/declined、回执契约含嵌套 obligations、回复排序【记忆→伙伴→方向→政策】）。部署 commit `5b8a04b`（deployHistoryId 7693588747564335123，Succeeded），生产八探针复验通过：`.local/coze-competition/p1-deploy-verify-result.json`。
- 已知偏差新增：obligations.pending 显示层重复项；无"我"陈述在已有活跃个人线程的会话中会作为延续处理（设计语义）。
- 语料策略=空库（自愈清理保护 corpus_kind=guide 攻略标记）；攻略语料导入待下一批。
