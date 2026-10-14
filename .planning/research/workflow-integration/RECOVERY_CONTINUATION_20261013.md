# 当前版本恢复与真实云验收推进断点

本文件已更新至2026-10-14本地开发断点。最终目标仍是Agent、工作流、五Skill真实云验收及完整发布门槛全部通过后发布。当前 `WIP_NOT_READY`；没有执行生产暂停、重启、发布或新产品/Coze调用。原账号/原额度授权继续，不购买、不升级、不重复已通过的付费测试，不自动重发收费请求。

## 已完成的实际工作

- 标准浏览器连接已恢复。缺失的 `browser/26.1007.21434` 运行模块由本机同版本Chrome包原文件恢复，SHA一致，重新连接后实际登录读取扣子积分页成功，未修改任何安全检查。当前账号余额62658，既有20%授权上限12531未增加。
- 原9笔未决均已定位并读回两项目历史。与原账单基线一致的2026-10-08至11日期，扩展至13日的当前实际项目合计为成长79892.35、公共资料12015.95；原基线64403.21、7059.43。成长统计编程组件79892.34、托管显示0（不证明精确0）；当前差额不能独立对应每笔请求。尝试的整组结算草案被独审指出覆盖证明与重复入账缺口，已撤回全部草案代码/测试，原账本未写入结算或改变规则。
- ee7be5b旧源码复核已被后续缺口发现取代，不能当当前执行或源码许可。当前新增不可变私有容器/网络ID、独立预期完整迁移/DDL绑定及同一受监督恢复服务；7项守卫、6项Linux模拟预算/已启动重试/替换拒绝/网络中断状态测试通过，实际独立systemd子进程超时及两处Docker中断重试测试通过。最终源码按精确字节双路复核均 `PASS_SOURCE_ONLY`，`executionEligible=false`；尚未执行生产恢复。原失败报告和首次测试脚本错误保留；最终独审目录为 `reviews/recovery-network-final/`。主操作300秒、最多125秒恢复、435秒整体预算及外层480秒TERM/15秒KILL保持。
- 应用镜像沿用此前实际逐字核验/隔离重启通过的 `e3aec6dbb22b2655e7517e7be7f80e5ea57f42e4`。本轮新代码是宿主恢复工具，不冒称已在运行镜像内。原线上仍99ca3f6，33迁移，原容器ID `8a0c31530ec68986b89b203753a8fb1b0160adca5a3a4202e85e4addc9ec9f51`、image `sha256:7eda2b6173decc442bf219408b1bc49524a9df54d82636e9f00ff5f200e1020a`；`campus-advisor.service` active，其与海闻仓库对应关系未证实。

## 可继续使用的实际源码

- `deploy/rehearse-production.py`：从已有82b串行演练局部适配；参数 `--binding` 必须是唯一release内的operation-binding.json，且三个Python文件SHA匹配。
- `deploy/recovery-guards.py`：真实容器身份、全主机已知编码器和精确操作绑定守卫；独立CLI用于恢复看门狗。
- `deploy/verify-restoration.py`：已验证的受监督、完整迁移清单读回门禁；不得只凭HTTP200判恢复。
- `scripts/run-production-recovery.mjs`：默认输出已审计划，显式 `--execute` 才执行；独审须绑定操作、守卫、门禁、包装器及完整绑定文件。当前源码复核不能满足它的执行门槛。
- `tests/recovery_guards_test.py`：7项身份、编码器、预算、绑定、不可变私有归属、DDL和实际看门狗配置守卫。
- `tests/recovery_watchdog_test.py`：Linux无网络隔离容器中的6项模拟Docker故障；接近命令最大时限仍留下完整公网门禁预算、原容器已启动后的重试、复制标签替换拒绝、45秒清理预算耗尽不启动原容器，以及创建ID未提交时拒绝认领、已提交未连接/连接中/已连接的未启动容器不阻止原容器恢复。不是真实生产执行证据。

## 原账本仍保留的9笔

| 请求 | 类型 | 预留积分 |
|---|---|---:|
| LIFEOS_KB_R5_EXACT_RECEIPT_AND_REAL_CHAINS | 公共资料开发 | 20000 |
| LIFEOS_COZE_CORE_20261011_GROWTH_R11_RETAINED_LEDGER | 成长开发 | 15000 |
| LIFEOS_KB_R6_ACTUAL_INPUT_DELIVERY | 公共资料开发 | 15000 |
| LIFEOS_KB_R7_EXACT_PROTOCOL_FULL_BODY | 公共资料开发 | 10000 |
| LIFEOS_GROWTH_R12_REAL_HTTP_SQL_NO_MODEL | 成长开发 | 10000 |
| LIFEOS_KB_R8_ACTUAL_SEMANTICS | 公共资料开发 | 10000 |
| 72efee8c-9ade-4203-965c-6d0ee86c39bd | 业务首次失败 | 24 |
| 35f071a2-4617-45bc-a661-30e703fbd86d | 业务首次失败 | 24 |
| 8d78dbcf-e2e7-4474-aa97-424804b49faa | 业务首次失败 | 24 |

唯一Coze账本 `.local/coze-launch/credits-ledger.jsonl`，本轮未修改SHA `235365dfd5a90d45fc071bd9e6f6bae916e7dd52aa354ddadc4fc843658364b4`。已知71462、未决80072、可调度0。只在得到与请求可核对的实际账单后沿原reconcile方法结算，不分摊项目合计，不把托管显示0当精确零费用。产品模型CNY账本仍为 `.local/v1.3-action-coach/paid/provider-calls.json`，与Coze积分分开；本轮未调用。

## 当前开发断点（2026-10-14，以本节覆盖历史记录）

用户最新要求：直接在本地继续开发，停止重复仓库、账单和现有服务巡检。只读取修改所必需的源文件和运行必要验证；完成最终验收门槛后自行沿已有服务发布/重启，保留其他服务与真实数据。没有放宽付费额度、真实云验收或安全恢复要求。

镜像已完成：同一 e3aec6dbb22b2655e7517e7be7f80e5ea57f42e4 镜像、唯一目录 /opt/lifeos/releases/recovery-e3aec6d-76ceda52，600073449字节完整SHA 5ce5e000d4e82137038fa55a072e96b33f79245b60573f49090bf0f50b36b5e6。实际 image ID sha256:1fb0cf1156c91b682dea896d4146b8027e4df837d888945090bdf3e778f22278；47文件及37迁移逐字PASS。原默认docker images过滤漏掉无标签镜像，曾误判加载失败；实际按ID及--all确认后不再加载。SCP迁移复制超时后保留23个已匹配文件，仅补14个缺失文件，完整核验已通过。所有首次失败回执保留，旧stage/complete/resume程序不得再次运行，不再上传归档。

上轮实际源码/绑定4文件已暂存并读回SHA，服务器私有演练前备份749390字节，SHA ba23f4dccf41950516933b8aaa40192e88a5435cfeae52103191d9c8f426f802；仅pg_restore --list结构验证，不是恢复通过。原服务未停止。执行级双路独审在 .local/continuation-20261013/reviews/exact-bound-operation-20261014/ 拒绝：创建后ID持久化前中断会阻断恢复；停服前缺少内存容量证明。executionEligible=false，未执行生产演练。

本轮直接修改 deploy/rehearse-production.py、deploy/recovery-guards.py：先fsync唯一创建意图token，再docker create附相同label；ID未提交时，仅允许完全匹配意图且Status=created/Pid=0/从未启动/network none的容器被只读保留，不认领、不启动、不停止它，继续核验并恢复原服务。缺意图、令牌不符、已启动或联网均拒绝；已提交容器仍严格校验不可变ID。停服前读取原容器精确cgroup匿名内存与MemAvailable，要求640MiB应用+256MiB宿主+64MiB余量；不把文件缓存当作额外可回收内存。停服后8秒立即再次检查实际可用内存，不足则在创建dump/恢复/迁移之前退出并恢复原服务；每次私有应用启动前复用同一门槛。

10项守卫+7项Linux隔离模拟恢复=17项通过。局部源码独审最终PASS_SOURCE_ONLY（reviews/local-intent-memory-final），executionEligible=false；审查源码哈希与当前文件一致。新增中断场景先红后绿；首次整套测试因只读容器没有/tmp失败，补临时tmpfs后全部通过，两个日志都保留。本机真实Docker从未启动容器状态通过，按ID/令牌核验后已移除；此证据不证明生产恢复。实际文件：tests/recovery_guards_test.py、tests/recovery_watchdog_test.py，及 .local/continuation-20261013/LOCAL_RECOVERY_INTENT_MEMORY.json、creation-intent-red.log、creation-intent-memory-green.log、local-inert-intent-docker-proof.json。

本地恢复源码已改变，远端旧绑定与旧独审不能用于新源码。局部修复Review已通过；下一步只补真实缺口，继续现有Agent/四工作流/五Skill目标，不制造新候选包或重复已通过的付费验收。后续真正进入发布阶段时，在同一release内保留旧回执并重新绑定变更宿主源码，经精确执行独审与恢复演练后才可发布；旧attempt不得删除或盲目重派。原9笔Coze仍未逐请求核清，唯一原账本可调度0，余额/项目合计只保留既有观测，不冒称本轮重查。整体WIP_NOT_READY。

## 私有证据与长期推进

当前实际账单AX与截图、只读线上绑定、4项守卫日志、独审原件及源文件SHA都在 `.local/continuation-20261013/`；这些文件不含新授权或可伪造的成功替代物。账单/账本/环境/备份保持私有，不能整体上传或提交。唯一私有转运脚本在该目录，作为当前同一镜像操作的继续文件保留。

当前线程已创建小时级heartbeat自动化 `lifeos`（LifeOS 最终云验收与发布推进），沿本断点继续；无变化时安静，只在实际推进、完成、失败或确需用户动作时通知。普通工程与原权限无需再询问；权限不能替代缺失账单、实际验收或工具安全门槛。
