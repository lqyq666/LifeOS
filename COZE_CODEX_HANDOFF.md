# LifeOS / Coze / Codex 接手结果

2026-10-10。本轮依据用户“按文档继续做”，采用
`LifeOS_Coze_Codex_Access_Audit_20261010.md` 的接手范围。
本轮结果：**MODIFIED / TESTED；整体 WIP_NOT_READY**。
Coze 云项目的 Succeeded 是既有部署状态；本轮没有部署、收费开发消息、
运行 Token 调用、私人数据上传或云端知识同步。

## 当前机器与工具事实

- 仓库：`D:\aaaLife\LifeOS`。
- 分支：`fix/campus-acceptance-contract-20261006`。
- HEAD：`70914b1cbd55b75a4d0f74785163d33519f70f71`。
- 已有 evergreen 未提交修改全部保留；本轮增量仍未提交，未 reset/clean/push。
- CLI：0.3.11。本轮没有重装 CLI，未重新查询 npm 最新版本。
- OAuth：当前会话 `logged_in=true`；两项目元数据、部署及 dev/prod 显式环境
  变量查询全部成功。仅证明本次管理读取权限，不证明业务运行 Token 有效。
- 安装前：配套技能记录 0.3.6，六项 missing。
- 执行 `coze self skill install --target codex` 成功，未使用 force/all。
  安装后 CLI/skill 都为 0.3.11，versionMatch=true，六项 ok。
- 安装前后仓库和用户级 `lifeos-personal-companion/SKILL.md` 哈希均相同。
  随后仅主动更新了仓库业务 Skill，用户级副本没有覆盖。
- 安装器共享 `.agents/skills`，也报告 Gemini CLI、GitHub Copilot、OpenCode
  可读取。实际顶层入口为 `using-coze-cli` 与 `coze-agent-collaboration`；
  code/claw/file/generate 为 using-coze-cli 下的 MODULE.md，并非六个顶层 Skill。
- 当前会话已直接找到、读取 `using-coze-cli/SKILL.md`、
  `coze-code/MODULE.md` 及 project/deploy/env references，并成功使用 CLI。
  当前提示中的技能目录不会因此自动重写；未声称全部模块已自动触发，未重启应用。

可复查证据：`.planning/research/coze-codex/COZE_ACCESS_AUDIT.json`。
只读复查脚本：`scripts/coze-access-audit.ps1`，默认只保存白名单字段，原始
OAuth/项目/变量响应不落盘、不打印凭据。

## 四个职责与云版本

| 层 | 当前职责与证据 |
|---|---|
| 本地 LifeOS 产品 | 用户身份、私人记忆、星图、事件、攻略使用日志由真实后端管理；本轮仅在临时隔离 DB 验证，未迁移主库 |
| Coze 多智能体成长工作流 | 参赛演示，历史设计为合成学生，不能替代本地真实用户数据链 |
| Coze 公共资料检索工作流 | 公共候选检索，经本地绑定和来源核验后使用，不读取私人记忆 |
| LifeOS 业务 Skill | 驱动真实产品 API；不可达、版本不符或未授权时纯对话降级 |

| 云项目 | type / space | 当前部署 | commitHash | deployHistoryId |
|---|---|---|---|---|
| 多智能体成长工作流 `7693388932939300905` | workflow / `7651603600241836078` | Succeeded | `4aa53641b7177604cfa96631b9584de991531324` | `7693916256591740928` |
| 公共资料检索工作流 `7693465311558795327` | workflow / `7651603600241836078` | Succeeded | `04849caa93a33f4584ce5637acba864e97757a46` | `7693833432106991651` |

两个项目 dev/prod 的 `code env list` 均返回空列表，只代表该命令可见的
显式变量列表为空。不是“没有平台配置/数据库/运行 Token”的证明。
读取的是代码 workflow 元数据，没有把它写成低代码画布验收。
本轮没有使用 agent file 读取 workflow，也没有发送云端审计开发消息。

## 本地业务接线与本轮实现

- `.env.server` 中未检出九项 Coze 接线变量；本次终端继承环境也均无非空值。
  `server/turn-engine.ts` 的 Coze 配置来自 process.env；`server/config.ts`
  自己读取 `.env.server` 不等于把 Coze 变量注入 process.env。
- `.local/coze-competition/runtime-token.txt` 与
  `.local/coze-automation/runtime-token.txt` 均存在且文件非空。未读取或调用 Token，
  不判断授权范围、到期时间或有效性。现有产品适配器不会因为文件存在自动加载它们。
- 本次 5173、8787 的 `/api/run/version` 都未返回有效 JSON 指纹。
  未启动主库服务、未改现有进程环境。其他服务进程的环境未读取，不能据当前终端
  推断生产配置。正常产品 Coze 链路保持 **未验证**。
- 新增认证只读 API：
  `GET /api/conversations/{conversationId}/guide-usage?event={eventId}`。
  必须是当前账号拥有的会话；跨会话事件读取服从 memory 开关，来源撤回与遗忘
  过滤沿用后端规则。没有开放攻略日志直接写接口。
- 同事务攻略提交回执新增 `stateChange.guideUsage`，标明 applied/not_requested，
  带规范 guideId/revision/branch/stepId/status/eventId，不复制个人反馈原话。
- 仓库业务 Skill 文档更新到 **1.2.1 local WIP**：完整方法读取、来源与编辑适配
  区分、使用状态与反馈读回、星图更正接口；校正 origin 与短 Git head 的说明。
  后端指纹仍报告 1.2.0，用户级业务 Skill 仍是 1.2.0；本轮未发布 Coze Skill。
- 历史 Coze 业务 Skill：`7693950576408805422`，v2 deploy
  `7693961393296490505`，历史发布名“LifeOS个人伙伴 v1.2”。这些信息仅来自
  `FINAL_SKILL_COZE_EVIDENCE.md` 等本地记录，本轮未重新访问技能页面或触发对话。

## 公共知识权威与镜像方案

本地仍为 32 张结构化卡，其中 16 approved、16 needs_review；112 候选问题中
53 已有内容覆盖、59 awaiting_source。approved 表示本地 Codex 原文语义审阅结果，
不等于独立人工最终验收、真实效果或完整内容完成。

旧公共工作流记录为 8 张自编方法卡，现有本地 Coze 注册表绑定保留。没有据项目
部署 Succeeded 推断新常青库已同步，也没有静默把旧 revision 指向新内容。

已生成 **LOCAL_PLAN_NOT_SYNCED**：
`.planning/research/coze-codex/COZE_MIRROR_PLAN.json`。
仅从公共 KB 文件导出 16 张 approved 卡，排除 16 张未审卡，保留完整公开卡内容、
canonicalId/revision/guideContentHash/sourceHash、审阅锁定的来源 revision 与证据。
远端 datasetId 尚未确认，全部 remoteConfirmed=false、registryEnabled=false。
脚本 `scripts/coze-prepare-mirror.ts` 无 CLI/网络/数据库/凭据读取。
原文阅读及编辑适配的保存范围仍由公共来源注册表约束，不得上传学生记忆与使用日志。

真正同步前需确认该公共镜像的写入授权、实际 dataset 与版本，再做幂等导入、
远端读回比较和注册表启用。当前仅暂停云端写入项；本地开发已经继续。

## 当前验证与限制

| 验证 | 本轮证据 / 结果 |
|---|---|
| CLI / 云读取 | 当前会话真实成功，10 条 JSON 管理读取均 exit=0，审计 JSON 保存安全字段 |
| 本地攻略、Coze 适配、growth | 28 项通过；真实临时 PostgreSQL、真实离线 BGE、真实 HTTP 身份与 API；Coze 传输边缘用本地模拟服务，不是新云业务调用 |
| 账号 / 跨会话 | 未登录拒绝、他人账号与不存在会话拒绝、memory 开关前后访问控制通过 |
| 攻略使用 / 反馈 | 建议与本人 blocked 报告保存及回执、HTTP 读回、来源撤回隐藏通过；写入场景由测试明确暂存，未称正常 LLM 触发 |
| 星图 / 更正 | 6 项真实隔离 DB 回归通过：来源有效性、更正、遗忘、连线确认/撤销、快照并发失效；不等于 Coze Skill 真实端到端验收 |
| 纯函数知识边界 | 5 项通过，仍是已有冻结/后续回归，非新未见 holdout |
| 前端 typecheck | 通过；本轮未重复 build，前轮 build 证据在 evergreen 文件夹 |
| 服务端 typecheck | 未通过：38 类既有错误，与前轮归一化比对差异为空；完整日志保留 |
| diff | git diff --check 通过；原修改与新增文件均保留 |
| 付费账本 | 唯一账本只读核对：2022 笔，1 未结清，余额估算 11.2603398 元；本轮 0 新付费调用 |

测试修正：旧 Coze 排除机制测试的模拟向量由 32 改为 512 维，以符合真实索引
契约，未降低生产校验。星图旧测试遗漏离线编码进程关闭；补 after 清理后重新运行
6 项自然结束通过。首次旧测试阻塞记录仍保留，只关闭了经 PID/父进程/命令核验的
本轮测试 worker，没有停止其他服务。镜像 Review 补齐一项额外审阅来源的 metadata，
并加入证据存在与来源 revision 的失败保护。

证据路径：`.planning/research/coze-codex/evidence/` 下
`backend-round2.log`、`starmap-final.log`、`evergreen-pure.log`、
`frontend-typecheck.log`、`server-typecheck.log`。首次失败/阻塞输出也保留。

以下仍未完成：正常模型/业务 Skill 自动触发；当前入口纯对话降级行为实测；Coze
Skill 到真实本地产品的读写、跨会话记忆、星图更正、攻略反馈整链；新库远端同步；
32 全获审、112 完整覆盖、未见 holdout、4 条跨 3 会话真实链、13 条 D-gate 回放、
20 条真实延迟/成本样本。旧触发与旧部署证据没有替代这些验收。

## 继续执行

1. 从 `KB_GAPS.md` 的任务对应原文缺口继续补卡及审阅，再在隔离 DB 验证；
   本地 approved 内容是权威，当前云镜像方案为审阅件。
2. 先处理服务端既有检查与未结清收据；保持付费账本唯一，不重发旧请求掩盖失败。
3. 运行正常产品前先检查主库迁移版本与恢复路径，使用配置 origin 与真实账号授权；
   不能把临时测试 DB 的通过或相同 HEAD 当作正常 WIP 已上线。
4. 使用真实业务入口逐项验证触发/降级/读写/记忆/更正/反馈，得到当前提交回执再
   报告保存成功。云端资源修改按对应明确授权执行，本轮未自行发布。

当前增量指纹见 `.planning/research/coze-codex/COZE_INTEGRATION_FREEZE.json`。
前轮 `KB_IMPLEMENTATION_FREEZE.json` 和旧 ZIP 是历史检查点，不覆盖本轮增量。
本目录源码、公共镜像方案和原始验证输出随交付包一起保存；无需依赖对话历史继续。
