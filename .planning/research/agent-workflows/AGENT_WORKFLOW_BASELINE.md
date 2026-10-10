# G0 基线保护
原始状态：READY_FOR_CONTRACT_ONLY / INTEGRATION_BLOCKED。当前：CHECKPOINT_VERIFIED / MINIMAL_INTEGRATION_TESTED。

HEAD 基线 70914b1cbd55b75a4d0f74785163d33519f70f71；分支 fix/campus-acceptance-contract-20261006。G0_BASELINE.json 冻结85个既有脏文件。CHECKPOINT_VERIFICATION.json 核实已有 Coze/evergreen 可恢复包85/85完全一致，包 SHA256 为 4f81bf2c8443a1decd478bd6d8a48beba4a37e585cc1f14b8029c544c9b99fd7。据此由当前单一集成者改 turn-engine.ts 最小连接点；其他原脏文件不得批量暂存或覆盖。INTEGRATION_PATCH.diff 保存相对原检查点的精确修改。

初始全服务端62条诊断/38类，见 evidence/g0-server-typecheck.log。最终对照另存 SERVER_BASELINE_COMPARISON.json；类型收口尚未完成。知识16 approved /16 needs_review，53/112覆盖、59待来源，独立人工最终审查未通过。本轮不改这些审核状态。

唯一付费账本2022条：2021 finished、1 reserved。只做摘要和哈希，不复制、重置或补零。历史账面剩余额度约11.267元，不能当实际可用余额。未结算调用终态及真实余额核实前，新增真实收费调用为0；该门槛同样适用于云开发消息。

现有 Coze 项目、部署、开发任务、技能与版本：evidence/coze-baseline.json、coze-tasks-skills.json。两项目管理读取成功，旧部署 Succeeded 不证明本候选已部署。完整计划保存在 DEVELOPMENT_SPEC.md。端口/API指纹记录只是本轮只读快照，不代表当前候选已在线运行。
