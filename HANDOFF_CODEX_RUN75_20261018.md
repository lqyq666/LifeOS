# LifeOS / 校园成长伙伴：Codex 交接文档

更新时间：2026-10-18（Asia/Shanghai）  
交接对象：Codex  
工作目录：`D:\aaaLife\LifeOS`  
分支：`fix/campus-acceptance-contract-20261006`  
HEAD：`1f8262e2f6f84849985339068ccf0e66a7771e76`（工作区有未提交修改，勿 reset/stash/clean）

---

## 0. 一句话结论

run50 独立复核的 **9 项缺陷**已经按共同根因修复；但最新代码在 run75 的 `action-review T5` 首次遇到 `MODEL_REQUEST_FAILED`，只完成 **11/12** 就停止。最新冻结没有完整 36 轮样本，**不能签收、不能部署**。

当前状态：

- `GRILLING_CORE_ACCEPTED = NO`
- `LIMITED_RELEASE_READY = NO`
- `LONG_TERM_VALUE_PENDING = YES`
- 公网仍为 `a6dcfa1` / `lifeos-grilling/1.0.8`
- 未部署、未 push、未 merge、未清理

---

## 1. 先读哪些文件

按顺序：

1. `AGENTS.md`：费用、账本、隔离测试、发布授权边界。
2. `PRODUCT.md`：当前校园成长与连续决策目标，优先于旧 docs/v1.3。
3. `NEXT_ACCEPTANCE.md`：当前状态、run75 失败、测试与成本口径。
4. `evidence/grilling/INDEPENDENT_REVIEW_RUN50_20261018.md`：9 项缺陷与 P0/P1/P2 要求。
5. `evidence/grilling/run50-postrepair-replay-20261018.json`：9 项原句的免费回放。
6. `evidence/grilling/run75-technical-failure-20261018.json`：最新提供方失败，不得覆盖。
7. `evidence/grilling/final-closeout-20261017-r3.json`：机器可读状态。
8. `evidence/grilling/run74-*`、`.local/grilling-1.0.19bw-*`：上一版完整样本，仅作历史参考。
9. `evidence/grilling/run69-local-audit-20261018.json`：更早的本地残余审计，已被后续修复部分覆盖，不能当作当前结论。

---

## 2. 当前候选与失败边界

### 最新冻结

- 文件：`evidence/v1.3-action-coach/freeze/source-1792322655568.json`
- digest：`f328522017d4acbac6e9186fbc17cc6a4ef67e1bea864b824d3e281b56be8a44`
- 603 文件，0 provider calls
- 本地策略名：`lifeos-grilling/1.0.19`

### run75 首次失败（保留，不重试）

- 链：`action-review`
- 轮次：idx5（T5）
- 错误：`MODEL_REQUEST_FAILED`
- requestId：`fb379589-86a8-4373-a1ec-a10a444e8a24`
- 完成：11/12 后停止
- 自动重试：0
- 证据：`evidence/grilling/run75-technical-failure-20261018.json`

不要把“提供方失败”直接解释为供应商整体停机；也不要为了拿到完整样本自动重试。保留原始失败、requestId 和费用 unknown。

### 上一版完整样本（旧冻结，不能替代最新代码）

run74：

- 冻结：`source-1792322348971.json`，digest `7436e4a52da4716e0d1f3e233efa7f16677d340c9089436b90b150f8078349cd`
- 36/36，0 失败，18 会话，Memory ON
- 首内容 P50 961.6ms / P95 1741.6ms
- 完整 P95 10266.6ms
- 该样本发生在最后几处 C4/C6 文案修复之前，**不能当成最新代码的完整验证**；不能与 run75 拼接。

---

## 3. run50 的 9 项缺陷

原始复核：**27 PASS / 9 DEFECT / 0 INVALID_UNCLEAR**。

| ID | 问题 | 当前处理方向 |
|---|---|---|
| C1-T5 | 重复追问“清晰产出”定义，没有利用岗位/培养方案新信息 | 改为针对两个选项的具体区分点，或给暂定小结 |
| C2-T4 | “收到回复即停”与“发送完成即止”冲突 | 本人动作完成条件统一为“发送完成即停”；导师回复另记外部状态 |
| C3-T1 | 用户未定义自由，就断言其重视时间自主 | 删除未确认的偏好注入；只问开放定义 |
| C4-T3 | 同时更换同伴和活动，无法区分运动/陪伴 | 最多改变一个条件；结果只作线索 |
| C4-T6 | 两次放松被写成稳定体验/主要来源 | 只记录两次都报告放松；来源和稳定性保持未知 |
| C5-T2 | “结果未知。，”拼接损坏 | 修输出完整性，不改正确状态 |
| C5-T5 | “未报告评价”写成“未进入评价阶段” | 未报告的已读/评价/采用/效果保持未知 |
| C6-T2 | 重复问整理感受，没承接动机 | 转向其他场景是否自然出现类似整理行为 |
| C6-T3 | 同学少问一次推成沟通成本下降，尾句未闭合 | 只记录具体结果；不推本人省时/收益/规则普遍有效 |

免费回放记录：`evidence/grilling/run50-postrepair-replay-20261018.json`  
结果：**9/9 DEFECT 改、27/27 PASS 未改**。

注意：这证明 9 条原句被覆盖，不证明新样本没有同类**变体**。

---

## 4. 本轮改动重点

主要修改：

- `server/review-repairs.ts`
- `tests/review-repairs.test.ts`

涉及的后处理/守卫范围：

- 未确认偏好注入清理；
- 外部状态与本人动作分层；
- 重复追问承接；
- 单次体验/单次结果的因果与稳定性收口；
- 状态未知不写成否定阶段；
- 编号、占位、拼接、悬空句清理；
- 单岗位不扩成多岗位/JD；
- 家庭期待不并入本人愿望；
- 创业拒绝不重开；
- 试用反馈不写成采用/拒绝；
- 输出中的 `【占位】`、`待补`、耗时断言清理。

**不要继续无限增加“原句→固定替换”规则。** 当前 repair 层已经很大；Codex 应先检查：

1. 模型输入；
2. 原始业务输出；
3. 每个后处理阶段差异；
4. 最终正文；
5. 状态提交/读回。

优先在共同模式层修复，而不是继续堆句子。

---

## 5. 当前仍未证明的事项

最新冻结 `f3285220…` 没有完整 36 轮样本，因此以下均未对最新代码成立：

- 36/36 完成；
- 首内容 P50/P95；
- 完整回复 P95；
- 语义无阻塞缺陷；
- 真实状态保存/读回；
- 账号隔离、权益、预算、取消、幂等；
- 备份/恢复/容量；
- 长期学生价值。

不要在报告中把 run74 或 run50 的数字写成最新候选的结果。

---

## 6. Codex 下一步（按顺序）

### P0：确认 9 项修复没有回归

- 重新跑 run50 免费回放：
  - 目标：9/9 DEFECT 改变，27/27 PASS 业务含义不变。
- 对 9 项各补至少一个语义变体，不要只测原句。
- 重点检查：
  - C4-T3：是否只改变一个条件；结果是否仍被映射成“来源/主要因素”；
  - C5-T5：编号是否从 1 开始；未知是否仍写成“未进入/暂无进展”；
  - C6-T2：是否仍问“按什么标准/哪个瞬间”，而不是其他场景；
  - C6-T3：是否仍写“实际帮助/减少沟通成本/规则已验证/协作价值”。

### P1：工程测试

从 `D:\aaaLife\LifeOS` 运行：

```powershell
npm test
npm run typecheck
npm run typecheck:server
npm run test:backend -- --file=ordinary-turn.test.ts
npm run test:backend -- --file=grilling-runtime.test.ts
```

后端测试必须使用既有隔离运行器，不得直连业务库。

**不要运行或修改：**

- `tests/backend/action-coach-engine.test.ts`

其 SHA-256 当前为：

```text
6D834BDC20B462B285F97E8384BDA488A392B0FB7104B68F6A531BE005BF0C67
```

### P2：冻结与真实六链

只有 P0/P1 通过后：

1. 重新生成精确源码冻结；不要继续用 `f3285220…` 代表新代码。
2. 用新合成账号和新的 requestId，执行一次完整 36 轮六链。
3. 保留逐帧 `draft/delta/replace/discard/done` 和相对时间。
4. 不自动重试收费请求；首次失败、提供方失败、慢样本全部保留。
5. 不得把不同版本/不同冻结的结果拼成一个样本。

性能口径仍是：

- 实质首内容 P50 ≤ 3000ms
- 实质首内容 P95 ≤ 5000ms
- 完整回复 P95 ≤ 15000ms

### P3：独立复核

完整样本和性能通过后：

- 生成新的单版本盲评包；
- 完成独立或人工语义复核；
- AI-only 复核不能作为验收 oracle；
- 只有无阻塞缺陷并取得验收负责人签收，才讨论生产。

### P4：生产门槛（本轮不要执行）

先核对：

- 测试冻结中的 `entitlementsEnabled=false`、`providerBudgetEnabled=false` **不能直接带入生产**；
- 精确镜像/迁移/启动版本；
- 生产权益与预算；
- 账号隔离；
- Memory OFF、更正、遗忘；
- 真实保存/读回；
- 取消/幂等；
- 备份与恢复；
- 受控容量。

生产发布必须走 `DEPLOYMENT_HANDOFF.md` / `deploy/README.md` 的精确流程；当前没有发布授权。

---

## 7. 费用与账本

- 唯一账本：`.local/v1.3-action-coach/paid/provider-calls.json`
- 不复制、不重置账本。
- 不新增付费服务，不自动重试。
- 当前累计估算约 **¥10.15 / 约 3,107 次调用**（不是 provider 结算账单）。
- 原 unknown、延迟、失败和 unknown 费用继续保留。
- 本轮授权预算上限仍是 ¥20；不要购买新额度或接入新记忆框架。

---

## 8. 不要做的事

- 不要 reset、clean、stash、`git add -A`。
- 不要 push、merge、deploy。
- 不要改/运行受保护测试。
- 不要启动 Mem0、Hy-Memory 或新的记忆框架。
- 不要增加生产评审模型，不要用多评审投票替代证据。
- 不要为了好数字删慢样本、换 requestId 重刷首轮，或拼接 run74/run50/run69。
- 不要把“本地测试通过”写成“正式上线许可”。
- 不要把合成成年账号写成真人长期价值。

---

## 9. 关键证据索引

- 当前状态：`NEXT_ACCEPTANCE.md`
- 机器可读收口：`evidence/grilling/final-closeout-20261017-r3.json`
- run50 独立复核：`evidence/grilling/INDEPENDENT_REVIEW_RUN50_20261018.md`
- run50 缺陷免费回放：`evidence/grilling/run50-postrepair-replay-20261018.json`
- run69 本地残余审计：`evidence/grilling/run69-local-audit-20261018.json`
- run75 提供方失败：`evidence/grilling/run75-technical-failure-20261018.json`
- run74 旧完整样本：`.local/grilling-1.0.19bw-six-chains-results-part1.json`
- 最新冻结：`evidence/v1.3-action-coach/freeze/source-1792322655568.json`
- Promptfoo 诊断：`evidence/grilling/promptfoo-diagnosis-20261017.json`

---

## 10. 交接验收清单

Codex 完成时至少回答：

- [ ] 9 项原缺陷与哪些变体已覆盖？
- [ ] 免费回放是否 9/9、27/27？
- [ ] 根测试数量与结果？
- [ ] `typecheck` / `typecheck:server` 结果？
- [ ] 后端 allowlist 结果？
- [ ] 是否运行了受保护测试？（必须为否）
- [ ] 新冻结文件与 digest？
- [ ] 新完整样本是否 36/36、18 会话、Memory ON、0 自动重试？
- [ ] P50/P95/完整 P95 与逐帧证据？
- [ ] 首次失败/提供方失败是否保留？
- [ ] 是否有独立/人工复核？
- [ ] 费用与账本 state？
- [ ] 是否部署、push、merge？（当前必须为否）
