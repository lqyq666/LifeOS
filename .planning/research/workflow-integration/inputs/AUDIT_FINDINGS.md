# LifeOS 工作流最新进度核查

核查窗口：2026-10-10 12:40–12:44（北京时间）。
仓库：`D:\aaaLife\LifeOS`。
HEAD：`70914b1cbd55b75a4d0f74785163d33519f70f71`；工作区有未提交的 evergreen、Coze 接手及 workflow 改动。
工作流源码候选：`workflow-v2-ffd2186a2231`。

## 核查范围与证据等级

本次重新读取了最新 Git、工作流源码、验收报告、模拟执行夹具及两个扣子项目的实时部署状态。直接调用原函数，进行了五组仅进程内、模拟数据的探针；未调用真实模型、未连接数据库执行这些探针、未修改产品源码、未安装工具、未发送云端开发消息、未部署。

12:43:52 对 `.planning/research/agent-workflows/SOURCE_MANIFEST.json` 的36个文件逐个计算SHA256：全部与报告中的清单一致。该检查只证明清单中的36个文件匹配，不代表整个脏工作区已被冻结或已验收。

本文件中的测试数字来自已读取的项目报告，不声称本次重跑了这96项测试。

## 1. 已有进展

来源：`.planning/research/agent-workflows/AGENT_WORKFLOW_FINAL_GATE.md`、`G1_GATE.md`、`G2_GATE.md`、`SKILL_REGISTRY.md`、`evidence/VERIFICATION_REPORT.json`。

- 新建 `server/workflows/`，包含契约、路由、编排器、证据校验、回执、trace、行动复盘、方向决策、成长diff、知识维护、Skill加载与host适配等模块。
- 增加5个业务Skill候选，版本为 `0.1.0-candidate`：`lifeos-action-review`、`lifeos-direction-analysis`、`lifeos-experience-evidence`、`lifeos-growth-diff`、`lifeos-guide-application`。
- 原主Skill的 `1.2.1 local WIP` 增量保留，未因此自动同步用户级或扣子发布副本。
- 最新9套相关隔离PG测试报告96/96：workflow contracts 14、action 6、direction 10、growth/knowledge 6、main-entry 1、原action engine 44、材料边界9、guide HTTP 1、Coze adapter 5。
- 这96项的Provider是模拟的；不能称为96轮真实模型交互。
- 历史13条失败的零网络回放13/13绿色，使用旧原始输出及确定性协议适配，不是新版模型重新回答13条。
- 工作流专用类型检查、前端构建已有通过报告。
- 全服务端仍61条错误、37种归类；报告显示比基线少1类，新增0类，但仍不通过。根测试110/113，3项星图相关失败。
- A/B评估文件只是预登记20个用例，结果均null；没有真实多Agent胜率。

## 2. 真正接入程度

### WF-A 行动复盘

`server/turn-engine.ts` 导入 `workflows/host.ts`，模型调用前可获得 `actionReviewHints`，在原事务授权继续事件后可补充 `continuedActionUsage`。

该入口由 `LIFEOS_ADVANCED_WORKFLOWS` 控制，默认关闭。只对部分反馈且能唯一定位事件时提供候选帮助。报告已经包含 accepted → waiting_result → declined 的3会话模拟Provider/真实PG链；不是当前正常用户真实使用验收。

### WF-B 多方向决策

`direction-decision.ts` 实现2–3个分析节点并行、程序约束检查、独立critic、critic_check、综合节点。

源码明确包含：

```ts
if (adapter.executionKind === 'real_provider')
  throw new WorkflowError('unavailable')
```

目前没有真实预算适配器接入。这是候选阶段的安全门禁，不是平台报错；不能只删除此行就启用收费模型。

本次主入口引用检查未发现方向决策在 `http.ts` / `turn-engine.ts` / `store.ts` 中形成正常用户的深入分析创建、读取、取消、确认全链。当前需要接入这部分，而不是继续增加Agent名称。

### WF-C 星图成长变化

`growth-diff.ts` 是独立候选函数，已有提交回执/来源检查，但项目最终报告明确写着产品星图UI与新会话链尚未集成。已修正部分 `experience-insight.ts` 过度肯定与等级话术，这一修复应保留。

### WF-D 攻略维护

`knowledge-maintenance.ts` 已有来源、独立审查、覆盖、人类审批的门禁函数。不能把检查一份传入对象等同为来源研究、提炼、反证审阅与发布流水线已经真正执行。

原evergreen报告仍为32草稿、16获审、53/112覆盖、59待来源。此为本地维护审阅状态，不是32张全通过或独立人工最终通过。

## 3. 本次五组无写入探针

脚本：本包 `probe-workflow-boundaries.mjs`。从实际工作流模块及原模拟夹具导入函数，仅使用模拟读接口和模拟Provider。

### WF01 — 真实方向适配器仍禁止

给 `createDirectionWorkflow` 传入 `executionKind='real_provider'`，调用在进入真实Provider前被拒绝：`unavailable`。

结论：还没有真实多Agent执行。这个限制应在账本预留、调用适配、状态读回等齐备后以显式配置替换，不能直接去掉守卫。

### WF02 — 否定更正没有清除旧进度

旧辅助状态：`sent=true, read=true, replied=true, used=true, effect='之前误报有效'`。
输入：`更正一下，我之前说错了：对方没有回复，也没有使用我发的材料。`
实际函数输出：

```json
{
  "feedback": "waiting_result",
  "stages": {
    "sent": true,
    "read": true,
    "replied": true,
    "used": true,
    "effect": "之前误报有效"
  },
  "reply": "你已经向学长发出了请教请求，目前只知道还没回复，原因仍未知。"
}
```

结论：`reviewAction` 的文字和阶段候选矛盾。它当前主要把true累积上去，没有把已明确更正的replied/used回退。未知也被boolean压成false，易把未确认误当未发生。

边界：这是辅助函数的真实复现，不是本次写错了用户数据库。接下来需要通过host→finishRun→GET→新会话验证最终修复。

### WF03 — 普通未知会使整图中止

模拟critic返回非阻断未知：“仍不知道是否喜欢科研，可以保留未知并做小探索”。其issues非空，实际结果 `unavailable / constraint_conflict`，综合节点调用0。

原因：`critic_check` 只看 `issues.length`。当前没有硬冲突、证据缺口、一般不确定性的区分。

结论：安全问题必须阻断，但普通未知应保留为未知或追问/探索候选，不应一律把已完成分析作废。

### WF04 — 进程内请求表用满后不能继续

给原编排器注入 `maxEntries=2`，连续完成三个不同请求：

```json
["proposed", "proposed", "unavailable"]
```

源码默认上限256；完成项没有释放/回收路径。若长期复用同一实例，达到上限后拒绝新请求；若每请求新建实例，进程内幂等又无法保护跨请求/重启。

结论：这是原型实现有意的fail-closed边界，尚非生产级幂等。接真实收费模型前，需要host侧持久化工作流身份和节点调用账本；不能简单清空Map来重复计费。

### WF05 — 合法来源ID不能保证最后自然语言有依据

只提供原夹具的“大三、6小时预算”等事实，在模拟综合节点添加：

`用户已有十个付费客户，月收入稳定过万元`

保持合法evidence IDs，原函数结果仍为 `proposed`。

结论：现有程序验证能检查引用身份/版本、方向和预算，不能独立证明自由文本的语义支持。critic又运行在综合之前，因此综合阶段新写入的错误结论没有被critic看到。

这是协议边界探针，不是实际模型编出了该内容。修复需要最终产物的事实归属与证据约束：综合只能使用已审主张/服务器事实引用，或调整为综合后审阅，且不增加隐形第6次调用。最终未通过时不给用户呈现为已验证个人事实。

## 4. 云端实时核查

12:43只读CLI查询：

- `7693388932939300905` 多智能体成长工作流：Succeeded；commit `4aa53641b7177604cfa96631b9584de991531324`；deployHistoryId `7693916256591740928`。
- `7693465311558795327` 公共资料检索工作流：Succeeded；commit `04849caa93a33f4584ce5637acba864e97757a46`；deployHistoryId `7693833432106991651`。

这两个是既有云版本，不是本次workflow-v2。项目报告也明确标注云候选 `NOT_WRITTEN_BUDGET_GATE`。

本次没有重新安装或修改CLI；最近接手报告的CLI/开发Skill匹配状态仍是0.3.11，但不能据此推断所有写入和运行权限已验证。

## 5. 其他不能遗漏的验收问题

- `MULTIAGENT_AB_EVAL.json` 的20条中有取消、没预算、未授权、听诉、来源撤回等安全控制用例。它们很重要，但不能全部算作20个复杂决策“价值对照”。应拆安全集与真实决策价值集，结果为空就继续NOT_TESTED。
- 根测试失败包含否定/假设/第三方主题语义、16类纵向轨迹的undefined读取、复合主题共存，不能自动全部归为“测试落后”。先分辨真实需求与夹具不符，再修代码或更新合法契约，不能改成永真断言。
- 历史账本有1条未确认终态，报告未新增付费。需要继续查原收据/日志/供应商终态，不得将unknown填0或重发旧请求；Coze开发费用与产品模型费用分别核对，不能混作一个余额。
- 当前库尚不足以覆盖全部112候选；可用16张已审卡先完成真实工作流，不要等待全部内容才接入口，也不能伪称全部覆盖。

## 6. 当前判断

**多智能体原型底座已开发，专业Skill候选已建立，行动工作流有有限host接线；真实模型、正常深度分析入口、持久任务控制、当前云候选与星图实际闭环尚未完成。**

下一批应继续这份方案的集成与验收，不新增Agent数量，不将96项模拟相关绿测当作最终产品通过，不复用旧Final Gate宣布新版READY。
