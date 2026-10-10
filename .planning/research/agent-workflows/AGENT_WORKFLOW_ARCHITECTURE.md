# 唯一主伙伴与四条工作流
代码位于 server/workflows/；契约版本2、专业 Skill 0.1.0-candidate。学生入口继续是现有 LifeOS 主 Agent。所有专业角色为内部执行角色，不增加机器人选择器。

WF-A：host意图/权限 → 同事件只读快照 → 确定性状态分解 → 候选回复与停止条件 → 原本那一次主模型 → 原生 clause handles 校验 → finishRun 事务。自动候选已接入开关；只在合成Provider+实际SDK+隔离PG验收。ordinary/control/listening/refusal不启动额外Agent；候选读取总截止250ms，失败退回已有路径。

WF-B：明确深入同意+服务器授权预算 → 2–3个 path_analyst 并行 → constraints独立程序校验 → independent_critic → critic_check独立程序校验 → decision_synthesizer → 最终来源/预算复验 → proposed。三路径5次、两路径4次；整图调用和费用预检、逐并行波次预留、硬截止、取消、不自动重试。本地编排可执行；真实Provider适配器显式 unavailable，未接学生产品深度入口。

WF-C：合法 host committed receipt+前后revision → growthDiff → 原权威事实引用 → 过去/新增证据/现在/未知/待确认。确定性0模型；只完成独立候选计算与测试，尚未连接实际星图提交后的UI。experience-insight.ts 收回单次任务证明稳定能力、反馈自动视作认可和强制身份升级表述。

WF-D：既有 evergreen来源读取 → 主张/覆盖审计 → 独立skeptic → 版本hash → 认证人工release检查 → 原发布器。当前新增模块只实施审计门禁，不宣称多个真实研究Agent已经联网执行。guide-application读当前approved卡，输出有依据、有分钟、有停止条件的候选步骤；未审/退役拒绝。原16 needs_review不被升级。

权威层仍为现有 growth_items/coach_events/experiences/user_themes/identity_claims/identity_change_events/kb_guide_usage。没有新增画像或事实表，模型与专业Skill没有写身份/事实工具。收据只有host实际事务证明才可成为persisted。工作流内存幂等只在一个编排实例进程内有效，持久提交幂等继续归原request_id。

trace记录真正执行的角色、状态、耗时、调用、预留、已知/未知费用和HMAC引用摘要。引用摘要使用进程随机密钥；不写私人原文、账号、连接串、token或原始异常。合成数据证据另行明确标注，不能用于真实效果或p95声明。
