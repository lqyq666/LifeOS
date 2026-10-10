# Coze 已有项目的候选变更包
本轮只有只读审计，无云端写入、部署或新项目。
项目7693388932939300905：旧正式部署Succeeded，commit 4aa53641b7177604cfa96631b9584de991531324。
项目7693465311558795327：旧正式部署Succeeded，commit 04849caa93a33f4584ce5637acba864e97757a46。
CLI/开发Skill均0.3.11；两项目开发任务done，平台内置Skill读取成功。原始摘要见coze-baseline.json/coze-tasks-skills.json。旧部署与本地0.1.0业务Skill的指纹不同。

候选状态 NOT_WRITTEN_BUDGET_GATE。现有CLI code message属于AI开发请求，可能收费；唯一账本有未结算调用且没有真实余额证明，本计划要求先核实，因此不发送此消息。没有把“没有发布生产”误当“已经建立云候选”。纯管理读已完成，尚无本候选真实云执行日志。

准备好的候选约束：
1. 在增长项目保留v1 intent_router/control/fact/companion/guide兼容入口。仅新增独立v2 synthetic实验入口，输入synthetic=true；private event/message/真实学生资料拒绝。
2. WF-A使用合成event fixture与usage七态，节点执行输出独立引用/阶段/候选receipt，不能persisted。
3. WF-B使用本地contracts同字段，2–3分析并行+程序约束+独立critic+程序critic_check+综合；maxCalls≤5，deadline/cancel，费用未知不填0，不自动重试。
4. 每节点输出脱敏执行trace，图执行事实与合成模型结果分开；现有部署不替换。
5. 公共检索项目保留旧入口，候选source_read/claim_skeptic/coverage/dedupe返回needs_review。镜像目标Dataset ID与授权未确认，不能写入或发布approved。
6. 运行仅附带 tests/workflows 合成成年fixture，不附真实PG/消息/身份/账本/token。
7. 接真实LifeOS前仍需私有adapter预算账本/签名API/版本快照验证；云编排不得直接写私人状态。

下一步：核实pending调用终态与账户余额后，仍在已有项目开发版本内实施以上内容并保存任务ID、候选commit、真实运行trace、失败/取消回执。若云开发预算仍不可确认，保留可运行本地候选，不能宣布Coze完成。
