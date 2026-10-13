# 当前版本恢复与真实云验收推进断点

本文件为2026-10-13本轮自包含断点。最终目标仍是Agent、工作流、五Skill真实云验收及完整发布门槛全部通过后发布。当前 `WIP_NOT_READY`；没有执行生产暂停、重启、发布或新产品/Coze调用。原账号/原额度授权继续，不购买、不升级、不重复已通过的付费测试，不自动重发收费请求。

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

## 当前镜像传输与下一步顺序

唯一暂存目录 `/opt/lifeos/releases/recovery-e3aec6d-76ceda52`。归档600073449字节，SHA `5ce5e000d4e82137038fa55a072e96b33f79245b60573f49090bf0f50b36b5e6`。初始SCP因速率不足主动结束，仅停止本任务已核对的SCP/SSH进程，生产未受影响。第一SFTP进程19288连接中断，云助手读到200605696字节前缀SHA734f18a264f77f3dae03898fad94d736e9747368dfaeacf0eaf93d7492d5871a；两端一致后PID29472续传。它随后EOF退出，发送计数252248064不能当远端字节数；云助手实际读到250773504字节、SHA46173a0b61d348b64895ed1223491ed9c2343be3415bfb03000341c796aad173。第三PID12764在SSH banner前失败，未进入前缀校验/写入。当前无活跃传输，两个既有工具会话95608/83437均已退出；不得假设第三次已上传。三次日志及前两次失败回执保留，当前回执是第三次失败。

云助手实际执行/读回可用（不能只凭提交成功），已确认原应用ID/image及启动时间2026-10-12T11:24:26.359594841Z未变、公网ready、campus active、测试资源无残留。SSH服务MainPID902/ActiveState active/NRestarts0，无近期相关错误、当前无连接；fail2ban不存在、ufw inactive、INPUT ACCEPT，云防火墙22/TCP现有开放规则未变。SSH本地显示TCP建立后在协议banner前被关闭，原因尚未确认；未重启服务器/SSH、未改变防火墙、VPN或账号安全。Windows当前进程非管理员。下次先检查进程/锁、必要时用现有云助手读实际前缀，再只续传该文件；脚本已加15秒keepalive和30秒SFTP读写超时，仍保留严格known_hosts及两端前缀SHA，未实现自动重试。

1. 先读 `.local/continuation-20261013/image-transfer-resume.json` 与日志。状态 `TRANSFERRING_VERIFIED_PREFIX` 时核对回执中的PID仍是本任务Python，保持原工作者运行，**不得重复派发上传**。当前三次PID均已退出；需要先核对远端文件/本地前缀与记录，再决定续传，不删除未知锁或假设成功。实际读取云助手回执可沿 `.local/continuation-20261013/read-after-second-drop-via-cloud.mjs`、`DescribeInvocationResult` 和保存的JSON；既有attempt先读结果，不再次派发未知操作。
2. 只有状态 `PASS_COMPLETE_REMOTE_ARCHIVE_SHA256`，运行 `node .local/continuation-20261013/complete-image-staging.mjs`。该实际脚本复用原暂存程序的归档加载、8运行文件逐字核验、37个Git blob迁移和manifest同步阶段；不再次上传镜像、不启动应用。已有completion-attempt回执时先检查实际远端结果，不重发。成功输出 `image-staging-final.json`，用实际远端image ID；不得假定它等于本机Docker image ID。
3. 成功后运行 `node .local/continuation-20261013/prepare-bound-recovery.mjs`。该实际脚本重读公网ready/version、原容器/属主、33迁移并要求与首次读回一致；还要求DB image/version/locale与独立 `canonical-schema-proof.json` 相同，生成含三个源码SHA、37迁移预期及DDL SHA的精确绑定，暂存三个受审Python文件及绑定；只暂存不执行。规范DDL已从e3aec6d的37个Git blob、精确PostgreSQL17.11镜像隔离生成，摘要06e1212069ef21df207d241421384da4fe47b050646f704c91d06de1c2d80142；合成DB已按不可变ID清理。原容器/版本改变时重新审查，不能覆盖他人更新。
4. 将最新绑定文件、暂存及宿主只读证据、全部源码、实际包装器、规范DDL来源和watchdog锁/子进程/Docker中断机制证据一起独审。核对远端暂存文件SHA/路径/属主、image实际字节及37迁移、资源和看门狗配置；必须得到该精确绑定 `PASS / executionEligible=true` 才运行包装器 `--execute`。当前 `recover_original` 共享45秒清理、110秒整次预算，systemd115秒运行+5秒终止等待，持续失败重试每20秒；这不是重试总时长上限。直接恢复也通过同一个受监督服务，最多112秒观察且收缩到父操作剩余时间，未知时保留armed状态。创建资源到记录ID之间的小窗口仅允许未启动/未连接资源保留，不自动认领未知对象。失败或未知先读远端 `isolated-rehearsal-report.json`、公网、原容器和恢复unit，不重派相同演练。

   最终网络顺序为每个容器 `create --network none` → 核验ID/name/image/label并fsync → 核验并仅将该ID从none断开 → 核验内部network不可变ID后connect → 再核验归属/仅有私有网络 → start。Docker禁止none与其他网络同时连接，直接connect红测已保留，none断开后连接/启动的真实本地Docker探针通过；运行应用的NetworkID还须与持久记录一致。停止/连接中被中断的模拟恢复测试已通过。实际服务器两处中断的sleep容器测试也通过，但不替代完整当前恢复操作。
5. 恢复演练实际成功后记录范围：是原生产备份到原服务器私有库、旧/新串行启动、原公网恢复，不是新版本生产发布或学生接受。继续取得9笔可映射费用与当前授权原额度，再只补未通过、与当前源码有关的真实云样本及正常宿主五Skill、SMTP实际收信/学生价值门槛。原已通过付费样本不重跑，已曝光结果不当盲测。全部最终门槛通过后才发布并读回；当前不得发布。

## 私有证据与长期推进

当前实际账单AX与截图、只读线上绑定、4项守卫日志、独审原件及源文件SHA都在 `.local/continuation-20261013/`；这些文件不含新授权或可伪造的成功替代物。账单/账本/环境/备份保持私有，不能整体上传或提交。唯一私有转运脚本在该目录，作为当前同一镜像操作的继续文件保留。

当前线程已创建小时级heartbeat自动化 `lifeos`（LifeOS 最终云验收与发布推进），沿本断点继续；无变化时安静，只在实际推进、完成、失败或确需用户动作时通知。普通工程与原权限无需再询问；权限不能替代缺失账单、实际验收或工具安全门槛。
