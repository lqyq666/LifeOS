# GLM 开发交接

工作区为 D:\aaaLife\LifeOS。当前 LifeOS V1.3 精简源码仓库（运行源码、测试、当前目标与部署文件；无旧状态日志、历史交付包或 Git 旧历史）。默认模型保持 qwen3.8-flash。整体状态 WIP_NOT_READY（核心 A01/A05/A06 已真实通过）；**生产已部署上线 https://lqynb.xyz（2026-10-05）**，正式验收（A02–A08、速度、正式浏览器）仍未完成。

## 2026-10-05 生产部署（用户两次明确授权：删除海闻、部署 LifeOS）

- 服务器 8.137.181.86 经本机 SSH 密钥 root 直达（与阿里云 API 无关——所给 AccessKey 的主账号名下无任何 ECS，实例属其他账号）。
- **海闻已删除，删除前完整备份**于服务器 `/root/backups/haiwen-20261005/`：pg_dump（haiwen-db.dump，已验证可读）、/opt/campus-haiwen 配置包、campus-data 卷、容器 inspect、compose 文件、nginx 原配置。回滚：恢复备份目录 + `cd /opt/campus-haiwen/releases/20260916-review-gate && docker compose -f compose.yml -f ../../20260831/compose.yml up -d` + 还原 nginx 配置。8001 端口的 campus-advisor 服务不属于海闻，未受影响。
- 镜像 lifeos:v1.3-glm-52a4e47（本地构建：锁定的 Linux CPU wheels 41 包 + 固定 revision BGE 模型 + 最新能力证据，非 root、只读根、资源限额），docker save|gzip|ssh 载入服务器。
- /opt/lifeos：compose.yaml（镜像 tag 已改、挂载 /opt/lifeos/evidence/qwen-default 供 LIFEOS_EVIDENCE 覆盖最新 PASS 能力报告——镜像内旧报告接口签名不匹配）、.env.production（600：随机 DB 密码/认证密钥、百炼 Key、LIFEOS_ORIGIN=https://lqynb.xyz、LIFEOS_TRUSTED_PROXY=172.20.0.1、显式 LIFEOS_MODEL_PRICING_JSON——compose 默认值含字面单引号会导致 PROVIDER_PRICE_REQUIRED）。
- 生产预算 production-20261005 初始 ¥10（manage-provider-budget set；熔断上限，可调）。权益门开启：无 grant 不能调用模型。
- nginx：lqynb.xyz（LE 证书至 2026-12-19，DNS 已指向）→ 127.0.0.1:8787，SSE 无缓冲、240s 读超时；default_server 改 404；acme-challenge 保留。原配置备份同上。
- **上线验证**（全部真实）：/api/ready 通过；外部 https://lqynb.xyz 注册（signup 当前开启）→ 授权益 100 次 → 真实 SSE 对话 2 条（qwen3.8-flash 各 1 次调用，回复正常，首事件约 1.7-1.9s）；app 重启后消息持久（7 条）、容器内存 app 557MB/1GiB、db 59MB/256MiB，磁盘余 16GB。
- 冒烟账号 smoke-20261005@lifeos.local（userId DfzGDviO…）。**signup 仍开启**（权益门兜底：新注册无 grant 不能用模型）；正式创始人账号建好后应设 LIFEOS_SIGNUP_ENABLED=false 重建。

## 2026-10-05 真实模型验证与修复（本轮 GLM）

用户以主账号 AccessKey（存于 .local/aliyun.env，gitignored）授权全部云端权限并要求执行真实测试。核验结果：凭证属主账号 root（账号 1888682659551660），但**该账号 33 个地域名下没有任何 ECS 实例**——候选部署目标 8.137.181.86（Ubuntu-zhla，cn-chengdu）不在此账号名下，此 Key 无法管理它；部署需服务器归属账号另行授权或在该账号下新建实例（费用须确认）。DNS 在 Cloudflare，与阿里云无关。

真实调用准备（无代码改动部分）：
- 百炼 Key 经原工作区 DPAPI 包装脚本（with-bailian-key.ps1，经 .local/run-with-bailian.ps1 调用）注入，未落盘明文。
- 唯一 Provider 账本已从原工作区**移入**本工作区 .local/v1.3-action-coach/paid/（复制后 SHA 校验一致再删除原件；原工作区该目录已清空）。研究 PDF（hash 483a83e7…）同样移入。
- 每轮真实运行先 freeze-action-coach.ts 建源冻结；探针与轨迹运行全程断言冻结一致。
- .env.server 增加本地限流放宽（LIFEOS_MESSAGES_PER_MINUTE/DAY=10000，用户明确要求取消 3/分钟限流）；生产部署必须重新设置真实限流。

代码修复（全部先本地红绿再真实验证；typecheck×2、客户端 44/44、隔离后端 29 文件、test:db-recovery 全绿）：
1. turn-prompt：event 默认省略门控前置（修复纯知识/倾听建事件——R2 探针两次复现后 4/4 PASS）；首次报告本人经历当轮建事件（修复延迟补建错引）；新增节点 quote 必须逐字取自本轮最后一条用户消息；action 仅限真实成品交付、不改不重发。
2. model-payload/turn-engine：schema enum 绑定扩展——resolveUnknowns/declineUnknowns 绑定仍为 active 的 unknown 节点、corrections.nodeId 绑定既有节点、modify/reuse/close 的 actionId 绑定既有行动。编造/过期 ID 在约束解码下不可表达，整类 COACH_UNKNOWN_NOT_FOUND/COACH_NODE_NOT_FOUND 失败消除。
3. action-coach-events：COACH_SOURCE_INVALID 附具体错引与当前消息全文（HttpError.details，修复调用可对照）；与已存节点逐字相同的冗余重发原话跳过而非整轮失败（不写新内容、不改回复；其余错引仍阻断）。turn-engine 将对照注入修复指引。
4. 测试：engine 测试按上下文动态断言 messageId 绑定数并校验 corrections 枚举只含授权节点；history-fixture 测试显式固定限流值，避免本地放宽配置跳过断言。

真实轨迹结果（runId 均在 evidence/v1.3-action-coach/real/，报告+私有 raw 落盘；隔离库保留供正式 UI 审阅）：
- 能力探针 4/4 PASS ×3 轮（接口变化后重验，符合"接口实际变化只验证受影响能力"）。
- A01 coach-8817402e：10 轮全 SAVED；8 节点事实正确（goal 恰当记为 user_interpretation）；唯一 proposed 行动为可发送确认消息（含"不需要也没关系，不用特意回我"退出）；区分打不开≠内容无效；仅 1 轮修复。**通过**（此前 7 次运行暴露并修复上述各类失败）。
- A05 coach-46fba1bf：不盘问直接起草；"再短一点"落实为同一 action 0c805ec7 rev1→rev2 实际改短。**通过**。
- A06 coach-07310002：纯倾听，零事件/节点/行动，尊重拒答。**通过**。
- 速度（同一最终配置真实 SSE）：普通追问有效内容 p50≈7.1s、p95≈14.7s、完成 p95≈14.7s——**未达标**（目标 3/5/15s），仅完成 p95 边缘达标；属里程碑 5.1 已知问题，未动。
- 账本：今日共 93 次真实调用（探针 13 + 轨迹迭代 80），追加 ¥15 计划余 ¥12.88；非追加额度 21 次未动。无 pending 调用。
- 一次 A05 运行因操作者传错开场白被即时中止（coach-f75bb698，0 调用）；一次传输层 MODEL_REQUEST_FAILED 瞬时失败重跑成功。

## 未完成项（保持 NOT_READY）

- 速度未达标（见上）；A02–A04、A07（跨会话/干扰）、A08 真实轨迹；≥20 条普通追问速度样本；真实来源撤销链路。
- 最终配置正式浏览器验收（1440/390/320）、最终源码全套+恢复复跑（本轮修复后已跑机制回归，但需与最终冻结一致再跑一遍）。
- 部署：目标服务器不在凭证账号名下；需要服务器归属账号授权，或在本账号新建实例（费用另确认）。生产限流/Origin/密钥须按 DEPLOYMENT_HANDOFF 重建。

先读本文件、AGENTS.md、docs/v1.3-action-coach/OBJECTIVE_V1_3_ACTION_COACH.md、docs/v1.3-action-coach/CODEX_FAST_LAUNCH_PLAN.md 和 DEPLOYMENT_HANDOFF.md。真实调用沿用本工作区 .local 的唯一账本；不切换模型、不擅自部署、完整验收前不宣称 READY。
