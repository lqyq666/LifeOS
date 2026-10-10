# G3 多方向协作
状态：TESTED_LOCAL_ACTUAL_DAG_SIMULATED_PROVIDER；云候选/真实模型 NOT_TESTED。
direction10/10通过。三个分析节点确实并行执行、独立critic和最终综合运行；不是仅打印预制流程图。执行trace见 G3_SIMULATED_RUNS.jsonl/WORKFLOW_EXECUTION_TRACES.jsonl，假Provider明确标simulated_provider。
三方向至多5次、两方向4次。程序独立检查来源/版本/预算期间及金额、禁止方向、冲突、最终路径完整性。取消、忽略Abort的挂起adapter、截止、迟到结果、缓存后的来源撤回、费用预检均覆盖。critic冲突后不调用综合。
模拟报价每次0.01元、预留每次0.02元仅为测试参数，实际新增付费0。已知或未知费用不能伪装真实计费。
曾失败：critic校验在收费节点内导致调用账不准确；拆成独立确定性critic_check后通过。保存初始失败与修复测试。
限制：真实Provider适配显式unavailable；深度用户入口/费用展示/取消按钮未接；20个冻结真实盲配对结果为空。本地合成DAG不能证明比单Agent更好。下一步见COZE_MULTIAGENT_CANDIDATE.md，禁止在未结算/未知预算下发云AI开发消息。
