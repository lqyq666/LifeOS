# LifeOS 两小时续跑结果与继续开发交接

## 23时49分后的增量核验

当前工程冻结已更新为 `evidence/v1.3-action-coach/freeze/source-1792338521065.json`，605文件，digest `85b41a9c56b08ab4f06920d9845d122ab09f9f6851054ba0461573ebb868ddf3`。根测试为598通过，相关隔离后端为87通过（turn-contract增加到38）；类型检查与构建通过。

本次追加修复针对“用户明确报告没有评价内容，却被写成是否评价未报告”。先复现纯函数错误，再由真实引擎测试发现通用回复目录仍覆盖报告；现在两处共用同一范围检查。五状态投影不承担内容评价这一额外维度，包含这项报告时保留既有普通生成和来源校验，不新增评价解析器，也不改写成未知。

此追加修改只完成本地与模拟供应商的隔离后端验证，未新开付费批次。最后完整真实样本仍是cl，性能与语义阻塞、独审待完成和三个NO/YES状态均未改变。原始36轮、首次失败与费用记录不变。下文保留23时42分前检查点的详细记录；其中12204e5冻结和597/86计数属于该历史检查点，不是当前工程版本。

当前增量验证原件为 `evidence/grilling/evaluation-projection-addendum-20261018.json`；新冻结下的隔离恢复也已通过，见 `evidence/grilling/recovery-85b41a9-20261018/recovery-report.json`。交接ZIP在同一文件名内更新为当前源码，旧校验记录保留为历史，最新归档校验以 `two-hour-handoff-archive-final-verification-20261018.json` 为准。

## 发布结论

当前不能正式上线。最新完整真实批次完成36轮，但首内容P95仍为9.402秒，超过5秒门槛；复核也发现事实来源、因果和跨会话承接缺陷。独立复核和验收负责人签收仍待完成。没有部署、push、merge、DNS变更或购买服务。

`GRILLING_CORE_ACCEPTED=NO`，`LIMITED_RELEASE_READY=NO`，`LONG_TERM_VALUE_PENDING=YES`。

本轮时间窗口为2026年10月18日21时55分22秒至23时55分22秒，北京时间。付费批次已经全部终态封存，没有后台自动重试或下一批任务。

## 当前代码与真实模型样本

工作目录为 `D:\aaaLife\LifeOS`，分支 `fix/campus-acceptance-contract-20261006`，HEAD 为 `1f8262e2f6f84849985339068ccf0e66a7771e76`。工作区仍有用户原有改动与本轮修改，没有重置、清理、stash或整体暂存。

最终工程冻结为 `evidence/v1.3-action-coach/freeze/source-1792337842703.json`，605个文件，digest 为 `12204e5ccf5e248b4990201ebe59577b13ed99ab6c72c7ed4e95c6906b1235e7`。本地8787服务已按该冻结重启并核对版本绑定。

最后一次完整真实模型样本是批次 `cl`，绑定 `source-1792337287758.json` 和 digest `7a17a19bc4698432ad7b425adf3dd0efd087d9093982907c11a09c519a855215`。最终冻结比该样本只多三项变更：`scripts/coach-provider-budget.ts`、`scripts/validation-preflight.ts`、`tests/backend/coach-provider-budget.test.ts`，均为付费预算独占与预检修复。没有把这次真实样本冒充为最终整体冻结重新跑过的样本。

当前最高状态为本地 `MODIFIED`、`TESTED`、`BUILT`、`FROZEN`；对话候选有 `REAL_PROVIDER_CHAIN_COMPLETED` 证据。新候选不是 `DEPLOYED`、`ONLINE_VERIFIED` 或 `ACCEPTED`。

## 已实现并验证的修复

- 共享分句扫描器区分本人偏好、聊天指令、引用、假设和他人陈述；明确的专注时间自主偏好通过既有growth写入链保存，并验证Memory ON跨会话承接与Memory OFF边界。
- 状态回读由同一来源机制约束生成与最终渲染，区分发送、已读、回复、采用和效果；未报告内容评价不再写成确定未评价。严格的纯五状态回读零模型调用、零支出，仍经过正常校验和事务提交。
- “今天只想聊聊”等时间前缀进入既有倾听目录，不再把用户第一人称疲惫描述当成助手经历，不生成任务或个人档案。
- 共享请求解析识别“只给一句阶段理解”。数量限制同时进入实际wire schema、当前任务上下文与最终校验；合法一句不被旧修复扩写，多句违规只失败一次，不截断、不提交、不重试。真实 `cl` 最后一轮一句交付，完整耗时2.440秒。
- 标题、抽象区分开场、不保留的预览及未提交状态不能充当首内容。未保留的模型预览发出discard事件。稳定作为愿望与已证明稳定效果分开，后者仍受安全门控。
- 纠正了旧测试要求“收到回复就至少已读”的错误断言，保留未知状态；增加发送与送达同一分句范围的校验，另一分句的原因未知不能保护确定送达声明。
- 关闭旧文件工具对同一20元授权的独立复用，数据库成为这笔授权唯一活动的预留入口。原4034条文件收据未改，unknown未退款；旧工具的零网络预检明确返回预算已委派的阻断状态。

这些修复没有消除全部语义缺陷，也没有以新增固定句子补丁冒充整体产品验收。

## 工程与恢复验证

| 验证 | 结果与范围 |
| --- | --- |
| `npm test` | 597通过，0失败 |
| `npm run typecheck` | 退出0 |
| `npm run typecheck:server` | 退出0 |
| `npm run build` | 退出0；仍有既有three.js大于500kB的chunk警告 |
| 隔离后端allowlist | turn-contract 37、ordinary-turn 21、grilling-runtime 1、safety 18、coach-provider-budget 9，共86通过 |
| 最终恢复验证 | 39次迁移、68张表内容一致，恢复后继续写入、更正、遗忘、权限与预算约束通过；零供应商调用，未修改主库 |
| 历史run50免费回放 | 9条历史缺陷均发生修改；27条历史PASS有2条文本变化，分别纠正“未评价”误断言与去除重复标题，不能据此宣称独审通过 |
| `git diff --check` | 退出0，只有既有LF/CRLF提示 |
| 旧入口预检 | 修复前错误READY；修复后预期退出2，`BLOCKED_BUDGET`、`runtime_delegated`，文件账本哈希未变 |

相关后端使用 `lifeos_dialogue_test_29572_2d79812281ef` 等一次性库，不直接测试生产库。最后恢复证据在 `evidence/grilling/recovery-12204e5-20261018/`；这是合成隔离库恢复，不是生产恢复演练。

受保护的 `tests/backend/action-coach-engine.test.ts` 未运行、未修改，其SHA-256仍为 `6D834BDC20B462B285F97E8384BDA488A392B0FB7104B68F6A531BE005BF0C67`。

## 完整真实批次与性能

以下每批均独立使用6个合成成年账号、18个会话、Memory ON，首次尝试36轮，不重试、不拼接。性能采用更保守的保留首内容复核；旧原始指标原样保留。

| 批次 | 模型调用与确定回读 | 首内容P50毫秒 | 首内容P95毫秒 | 完整P95毫秒 |
| --- | --- | ---: | ---: | ---: |
| cf | 36次模型 | 2825 | 9773 | 13498 |
| cg | 36次模型 | 3019 | 11968 | 14808 |
| ci | 35次模型加1次零模型回读 | 3056 | 13370 | 13405 |
| cj | 35次模型加1次零模型回读 | 1293 | 8175 | 10133 |
| ck | 35次模型加1次零模型回读 | 2807 | 12497 | 14591 |
| cl | 35次模型加1次零模型回读 | 1356 | 9402 | 11708 |

性能要求保持P50不超过3000毫秒、P95不超过5000毫秒、完整P95不超过15000毫秒。没有一批同时满足当前保守口径。`ck`还出现首内容约59秒、完整约67.6秒的长尾，未重试。

`cd`在第11次尝试停止，完成10轮；`ce`在第25次尝试停止，完成24轮；`ch`第12次尝试超时，完成11轮。失败请求、支出与旧中断均保留，部分样本不生成完整盲评包。

最后完整盲评包为 `evidence/grilling/chatgpt-review-sixchain-run-cl-20261018.md`，SHA-256为 `40896051d3df47fe2bee545d7f4621e0b41b728fe8c0b09319d56d50750f9a1c`。包内不放版本、性能、费用或历史评分。状态为 `PENDING_INDEPENDENT_REVIEW`，Codex自评不等于独立或人工验收。

逐帧与提交读回原件位于 `.local/grilling-1.0.19cl-six-chains-results-part1.json`、对应attempts JSONL和metrics文件；首次封存、身份会话归属、逐次用量预算、一问上限、协议摘要、保留首内容复核与自评分别在 `evidence/grilling/run-cl-*` 中。

## 尚未通过的上线门槛

`run-cl-codex-semantic-review-20261018.json`记录了非穷尽缺陷：更正被扩大成对家庭或路径的结论；暂停后的理解丢掉已报告个人依据；未报告的运动属性和安全感被补入；第二次放松被升格为旧具体感受的重复证据；试用被叫作采用判断；说“不猜”前仍列举未知原因；单次检索被称为“验证有效”。这些不是格式问题，也不能靠测试或HTTP成功抵消。

最终整体冻结仍没有新的完整同版真实样本。独立复核、验收负责人签收与学生长期价值均未完成。候选尚无可发布的干净提交与不可变镜像，没有候选在目标资源上通过容量、生产备份恢复及回滚执行验证。本地测试的 `entitlementsEnabled=false` 不能作为生产配置。

## 费用与密钥

本地数据库预算 `acceptance_topup_20261018` 上限为19.90169760元；当前314条收据中311条known、3条unknown、0条reserved。known估算1.05121520元，unknown保守占用0.37355520元，总计入1.42477040元，受控余额18.47692720元。这是当前预算累计状态，不是仅最后一批支出，也不是阿里云正式账单。20元授权与数据库上限之间0.09830240元保留未分配，不推断为已消费。

三条unknown请求为 `ed7a51c6-fb55-4fd7-8be2-e7ba573f4f3d`、`db3a2d83-efde-4981-9d09-b13e6b0ea0e5`、`68ec5bf8-d835-4281-9991-c6c989744f85`，每条保留0.12451840元占用。没有用未知费用为零、无回复为未派发或自动退款的假设。

密钥保存在当前Windows用户的 `.local/dashscope-credential.dpapi.xml`，通过DPAPI加密并在进程中注入，不放入交接包或Git。当前源码、评审证据、根目录env以及顶层本地脚本和结果共1602个文件未发现该密钥明文；扫描不覆盖历史嵌套副本与归档，因此不作全磁盘清除声明。

## 公网与安全继续入口

公网 `https://lqynb.xyz/api/run/version` 仍为旧HEAD `a6dcfa145152cbd0c6682ad6c39547a3ee6fd242`，加载时间为2026年10月17日06时19分40秒UTC。旧应用和PostgreSQL容器healthy；生产权益、供应商预算均启用，并发2、队列8。只读资源快照不证明新候选容量。

继续时保留当前工作区、605文件冻结、所有首次失败与预算委派证据。优先复现上述来源和跨会话缺陷，追踪合法个人依据、原始业务输出、各后处理阶段与最终提交，不继续堆原句固定替换。修复后运行相同allowlist并重新冻结；真实批次只能使用新账号与新请求，预算仍由现有数据库原子预留，失败即停。不要重新激活旧文件额度，不要运行绑定旧 `82b8572` 或 `REJECT` 的生产恢复包装器。

运行本地工程命令：

```powershell
Set-Location D:\aaaLife\LifeOS
npm test
npm run typecheck
npm run typecheck:server
npm run build
npm run test:backend -- --file=turn-contract.test.ts --file=ordinary-turn.test.ts --file=grilling-runtime.test.ts --file=safety.test.ts --file=coach-provider-budget.test.ts
```

付费续跑仅在当前Windows用户进程读取DPAPI凭据，不在命令、聊天、报告或日志中回显。按现有 `.local/run-grilling-1.0.19-current.mjs`、账户创建器及严格来源冻结启动；协议允许零模型仅限确定五状态纯回读。旧 `validation-preflight.ts` 的收费探针入口现已委派阻断，不应为得到READY而改回开关。

交接包提供实际源码、测试、当前和真实批次冻结、原始逐帧与复核文件，不复制财务权威账本、凭据、会话cookie或数据库备份。现有本地PostgreSQL、离线embedding缓存和所有者私有配置仍是运行前提，不在新机器上自动恢复付费权限。独立评审者只需收到最后的单版本盲评包，不应收到包含自评与版本信息的工程交接包。
