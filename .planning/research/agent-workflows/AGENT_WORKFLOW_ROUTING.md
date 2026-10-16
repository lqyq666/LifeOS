# 路由与反例
开关LIFEOS_ADVANCED_WORKFLOWS默认关闭。唯一共享连接点server/workflows/host.ts。顺序：记忆控制 → 倾听 → 拒绝 → 暂停 → 开关 → 足够授权上下文。不能以模型判断覆盖当前学生意图。

16类冻结夹具见 tests/fixtures/workflow-routing-v2.json，contracts套件执行。覆盖普通聊天、倾听、Memory OFF、本次遗忘、停止推荐、深度预算缺失、单路径、两/三方向、拒绝方向、行动反馈、无事件、缺同意、成长/后台保留入口。夹具中的controls是可信host结果，不等于已经完成所有自然语言表达的理解验收。

自动WF-A还须原classifyGuideFeedback、feedbackMatchesCurrent、唯一当前/历史事件、非歧义。没有匹配就沿原入口，不猜相似标题。拒绝走现有路径。跨会话guide_usage延续只在原生模型的continuedEvent通过host校验后，且一个历史事件/无竞争当前事件时执行。

正例：我愿意试 → accepted不算attempt；我发了还没回复 → waiting_result原因未知；我不想继续 → declined之后不改话术催促。
负例：如果我发了没人回怎么办、同学说他发了、引用别人消息、代码块 → 不记本人执行。普通“考研还是就业好”不自动启动多模型。
WF-B必须明确深入+至少2真实候选方向+合法时间预算。禁止方向排除；剩余不足2就退回。当前只有可调用本地候选API，无真实深度UI或私有Provider启用。
