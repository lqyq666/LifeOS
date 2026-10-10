当前记录：本轮连续链真实图读回发现经验之间边被标为RELATES_TO_VALUE而导致UI加载失败；已改RELATES_TO_EXPERIENCE，历史兼容只接受明确experience_relation证据且两端均experience。保存图红测→root114绿测→四链24轮正常UI，证据见evidence/local-time-20261010。

以下为历史候选workflow-v2-integration-ee442ef15ffa记录：

# 本人提交到星图及下一次帮助

实际证据：evidence/STARMAP_BEFORE_AFTER.json为隔离数据库的真实API before/after与原finishRun回执；HTTP_CHAIN.json列出逐步断言。生成部分为模拟，不是实际学生使用效果。

| 动作 | 权威状态 | 星图/下一会话 |
|---|---|---|
| 深度分析完成 | proposed，无个人事实写入 | 目标未变 |
| 只采纳小行动 | priority/user_edit，尚未执行 | 对话回执与任务刷新/新会话读回 |
| 明确确认就业优先 | 原goal事务，真实changedThemeIds | cognition主题与时间轴变化；下一普通SDK上下文读到该goal ID |
| 报告交付海报收到300元 | 原stageCandidate来源校验，finishRun确认经历 | 实际experience节点、growthDiff和经验Skill hash；稳定能力未知，未定级 |
| 删除该经历 | 原授权API expectedRevision=2 | 旧growthDiff泛化失效，不重现300元原话；节点退出 |
| 更正原已回复/采用 | 事件字段false，sent/read保留 | GET刷新及新会话false/false，依赖效果清除，旧错误节点标记superseded |

曾生成建议不等于已行动，已付款不自动推对方采用，已记录一次任务不生成稳定人格。已确认目标的后续帮助只验证当前引用与原生事务承接；真实模型是否给出更有用建议、完整“一周5小时→就业优先”的学生纵向案例仍未验收。没有以合成措辞替代语义盲评。

追加实际待审卡核查：exam-diagnosis（d259a5aa-ec96-43f7-89ab-5f5c87031f1c）原状态needs_review。本轮对同一已捕获IES原文提炼候选revision2，技术审阅明确发现该原文不能支持四类错误诊断及科研/任务归因。原四分支保留awaiting_source，独立审批不足，隔离导入读回仍被学生API拒绝。没有将该来源缺口冒充解决，原53/112覆盖与59缺口不变。证据：public-card/needs-review-candidate.json、PUBLIC_CARD_CHAIN.json、public-card-final.log。

身份来源同步补充：合成用户通过已有成长创建 API 明确自述后中央身份读到本人描述；通过已有授权更正 API 改为“先查证再行动”后旧描述退出当前星图；遗忘该来源后新旧自述及已退休事件引文均停止可见。用户后来通过身份授权 API 的独立明确编辑保留自身来源，不因旧事实遗忘而丢失。假设、疑问、第三方与引用不投影为用户身份。证据：starmap-g1.test.ts 和 HTTP_CHAIN.json 的 owned identity edit/correct/forget 检查。
