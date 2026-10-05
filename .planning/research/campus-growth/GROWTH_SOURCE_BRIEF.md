# 成长本人陈述的单一原文协议

问题证据见COMPARISON_REVIEW：6份真实非思考输出的重复text/quote概括或拼接导致严格来源拒绝。原失败不得改写成成功。

先核对本仓库成熟局部实现：action-coach-contracts.reportedNode只要求source；action-coach-events.currentSource校验本轮连续原文，节点content由服务器使用source.quote，没有第二份模型改写。growth.ts现有事务、撤回与更正机制可复用，不引入框架/依赖。现有TypeBox运行时验证及Type.Optional已经广泛使用，保持固定版本和许可。

方案：user_reported允许省略重复text，只选择一项本人原文source.quote；服务器先核验消息归属、本轮身份、连续原文及未撤回，再由该已验证quote导出持久text。旧客户端/模型带text继续要求其严格属于quote，绝不自动修复其改写/省略号。AI观察与unknown仍必须给text，依赖/局限/时间/反馈状态仍按原边界。超4000字不自动裁剪，不创建无依据稳定能力。持久结构与迁移不变。

回归须覆盖实际隔离事务：省略重复text保存原话与同一source；旧改写仍拒绝、拼接/省略号仍拒绝、消息错绑/撤回仍拒绝；短约束/问句来源、替换CAS、忘记仍保留。原8份回答免费重放仍保持原始失败，不能通过补字段或删字段凑过。

新协议真实模型、真实模型浏览器与性能未验证，本轮8次次数已耗尽。免费协议回归不能称整体验收，默认Flash0不变。
