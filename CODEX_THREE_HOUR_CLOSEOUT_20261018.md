# LifeOS Codex 三小时收口开发与最终验收任务书

工作目录：`D:\aaaLife\LifeOS`  
交接依据：`HANDOFF_CODEX_RUN75_20261018.md`  
时限：开始执行起最多 3 小时  
当前状态：`GRILLING_CORE_ACCEPTED=NO`、`LIMITED_RELEASE_READY=NO`、`LONG_TERM_VALUE_PENDING=YES`  
当前公网：`a6dcfa1 / lifeos-grilling/1.0.8`

## 0. 唯一目标

三小时内最大限度完成当前候选的必要修复、免费回归、工程验证、精确冻结、一次完整真实模型六链验证及盲评包准备。若任一门槛未通过，必须如实标记未通过；不得降低门槛或伪造成功。当前候选最新 run75 在第12轮中第11轮遇到 `MODEL_REQUEST_FAILED`，完成 11/12；原始失败必须保留。旧 run74 是旧代码，不能替代当前候选或与新样本拼接。

## 1. 强制边界

1. 开始前读取 `AGENTS.md`、`PRODUCT.md`、`NEXT_ACCEPTANCE.md`、本交接文件、`evidence/grilling/INDEPENDENT_REVIEW_RUN50_20261018.md`、`evidence/grilling/run50-postrepair-replay-20261018.json`、`evidence/grilling/run75-technical-failure-20261018.json`。
2. 当前工作区有未提交改动。禁止 `git reset`、`git clean`、`git stash`、覆盖其他工作、`git add -A`。
3. 唯一收费账本为 `.local/v1.3-action-coach/paid/provider-calls.json`。不得复制、重置或自动重试收费请求；保留首次失败、requestId和费用 unknown。
4. 禁止运行或修改 `tests/backend/action-coach-engine.test.ts`；SHA-256 必须保持 `6D834BDC20B462B285F97E8384BDA488A392B0FB7104B68F6A531BE005BF0C67`。
5. 后端测试必须走现有隔离运行器与 allowlist，不直连生产数据库。
6. 不部署、不 push、不 merge、不改 DNS、不购买额度、不接入 Mem0/Hy-Memory/新 Agent。
7. 不把 `MODEL_REQUEST_FAILED` 直接归因于供应商整体停机；只读检查现有日志/收据，不额外发收费探针。
8. 明确区分本地纯函数、隔离后端、真实模型、公网、真人长期效果。

## 2. 0–20分钟：确认当前事实

- 核对 HEAD、工作区、最新冻结 `evidence/v1.3-action-coach/freeze/source-1792322655568.json`（digest `f328522017d4acbac6e9186fbc17cc6a4ef67e1bea864b824d3e281b56be8a44`）。若工作区变化，旧冻结只作历史证据。
- 只读核查 run75 requestId `fb379589-86a8-4373-a1ec-a10a444e8a24`：现有日志中可见的异常类别、是否派发、供应商请求ID、用量/费用收据。无证据的字段保持 unknown。
- 输出简短事实/未知/风险清单，不重复生成长规划。

## 3. 20–65分钟：免费回放与最小修复

### A. 回放 run50 九项及变体

证据：`evidence/grilling/INDEPENDENT_REVIEW_RUN50_20261018.md`、`evidence/grilling/run50-postrepair-replay-20261018.json`。

重点覆盖：
- C1-T5：收到岗位与培养方案后，不机械重复抽象问题。
- C2-T4：本人动作停止条件是“发送完成即停”；对方回复是独立外部状态。
- C3-T1：用户尚未定义自由前，不推断自由等于时间自主。
- C4-T3/T6：不能同时改变多个条件后分配因果；两次相似体验只记录已报告事实，不判稳定或主要来源。
- C5-T2/T5：修拼接格式但不改状态；未报告评价/采用/效果不能改成“未进入阶段”。
- C6-T2/T3：承接已报告动机，不重复问题；同学少问一次不等于用户本人省时、成就感或规则普遍有效。

### B. 定位共同根因

按 `合法背景/事件状态 → 模型原始业务输出 → 每阶段后处理差异 → 最终正文 → 实际提交回执 → 下一轮读回` 排查。优先修来源、人物/事件、时间线、明确拒绝/暂停/时间上限、已答问题、单次样本因果、后处理删改后残留的错误结论。不要继续堆“原句→固定替换”。保留账号隔离、来源、更正遗忘、Memory OFF、预算、取消、幂等与事务保护。

### C. run75失败

保留原失败，不重试原 requestId。若无法从现有证据确认原因，就记录未知；不要写“供应商整体停机”。若后续真实验证失败，保留首次失败并停止本批，不自动重试收费调用。

## 4. 65–95分钟：工程验证

在读取 `package.json` 和隔离运行器契约后，执行等价于以下的现有命令：

```powershell
npm test
npm run typecheck
npm run typecheck:server
npm run test:backend -- --file=ordinary-turn.test.ts
npm run test:backend -- --file=grilling-runtime.test.ts
```

如果参数不同，按仓库实际契约运行，不猜参数、不直连业务库。逐项记录真实退出码、通过/失败数和耗时。受保护测试必须保持未运行、未修改、哈希不变。不得跳过失败测试或放宽断言制造绿色结果。

## 5. 95–110分钟：精确冻结

只有免费回放与工程验证通过才冻结。绑定精确源码、Skill、配置、测试脚本摘要；记录文件数、缺失/差异数、provider call count。旧 digest 不能代表新代码。冻结中的 `entitlementsEnabled=false`、`providerBudgetEnabled=false` 是测试配置，不得用于生产。

## 6. 110–165分钟：最多一次完整真实六链

仅当前置步骤通过且既有费用授权仍有效时执行：
- 新合成成年账号、18会话、Memory ON；六链各6轮，共36轮。
- 使用新 requestId；不重试失败轮、不拼接旧版样本。
- 每轮保存输入、requestId、完成/失败、可见最终正文、`draft/delta/replace/discard/done` 帧与相对时间、状态读回、Memory状态、用量与费用状态。
- 首次失败保留并停止本批；不得为凑36轮自动重试。
- 性能目标：实质首内容 P50 ≤3000ms、P95 ≤5000ms；完整回复 P95 ≤15000ms。标题、占位、错误和被撤回内容不算实质首内容。
- 36/36技术完成不等于36/36语义正确。

如果时间或外部服务不允许完成，停止收费尝试，交付已验证本地结果与阻塞原因。

## 7. 165–180分钟：盲评包和最终报告

只有完整36轮与逐帧证据齐全才生成新单版本盲评包，记录 SHA-256。包内不放版本标签、性能、历史评审或 gate 分数。逐轮检查状态真实性、用户边界、来源、问题价值、行动可执行性、跨会话承接。AI-only评审不得冒充人工验收 oracle；没有独立人工复核就标 `PENDING_INDEPENDENT_REVIEW`，核心状态保持 NO。

最终报告必须列明：实际HEAD、工作区、新冻结/digest、免费回放、工程测试、六链尝试/完成/失败、会话与Memory状态、首内容P50/P95/完整P95、逐帧证据、模型调用与费用/unknown、盲评与剩余缺陷、受保护测试哈希、生产配置/恢复/容量缺口、三个最终状态。

## 8. 发布判定

以下任一未通过，不得部署：当前候选缺完整同版六链；存在事实篡改、状态混淆、拒绝/暂停失效、重复收费/提交或记忆越权；性能不达标；生产权益/预算、账号隔离、备份恢复、回滚或目标资源授权未核实；没有验收负责人签收。

即使工程门槛通过，本任务也只形成 `LIMITED_RELEASE_READY` 签收包，不执行部署、push、merge、DNS变更或清理工作区。发布必须沿 `DEPLOYMENT_HANDOFF.md` / `deploy/README.md` 的精确镜像、恢复与回滚流程。

## 9. 当前状态默认值

`GRILLING_CORE_ACCEPTED=NO`  
`LIMITED_RELEASE_READY=NO`  
`LONG_TERM_VALUE_PENDING=YES`

三个小时目标是最大化真实完成度，不是保证所有外部依赖必然成功。