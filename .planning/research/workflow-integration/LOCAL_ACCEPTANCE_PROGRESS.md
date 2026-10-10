# 当前本地验收增量

起点提交：42a255f4790c875630b547a19eb1b9acb698d37f。原0670候选24轮保留为SCRIPTED本地集成基线，不改写为真实模型效果。

## 攻略跨会话反馈承接

正常认证HTTP、隔离PG、原SDK的三会话链：采纳 → 未开始且材料打不开 → 拒绝继续。保持实际guide/revision/branch/step，受阻提示只带对应反馈分支，不重送入门教程；当前本人反馈与第三方/引用分开。没有回复为waiting_result，不误记completed。待审卡、已撤回来源和不同任务不会获得承接授权；同义去重沿用原机制。

红证据：evidence/acceptance-20261010/guide-context-red.log、guide-feedback-red.log。后续quote保护及拒绝提示失败也保留在guide-pg-green.log、guide-http-green.log。

绿证据：guide-final.log（新增2项、原main-entry1项、原guide-usage-http1项），GUIDE_CONTINUATION_HTTP.json实际三会话读回；root-guide.log 115/115，server-guide.log、frontend-guide.log、build-guide.log通过。模型响应来自loopback脚本；token/估算成本是合同字段，不是真实付费。未新增依赖、Agent或预算，未改公共攻略审批。

## 星图采用同一有效状态

已复现星图决策上下文直接读取raw active约束，导致过期“零小时”和尚未生效“下周六小时”同时进入当前帮助。改为复用growthView已有来源/时间窗口/依赖/暂停门禁；过期目标不能凭主题投影继续生效。没有增加另一套时间解析或星图事实。

starmap-time-red.log保留原失败；starmap-green.log含新增时间项、原trust/g1与growth-knowledge回归通过，starmap-types.log与root-starmap.log通过。Memory OFF、跨账号、遗忘、连线撤销与快照冲突原保护继续成立。

## 个人依据与行动缺口

路径分析沿用原SDK、4–5次调用和现有候选动作。新增可校验的actionBasis选择：每个动作只可连接已选个人证据及已选未知；综合者继续只选已审候选，不编写新事实。UI现有停止条件展示实际原话与缺口；未给具体连接时诚实提示尚未说明。

A/B/C保持相同120分钟：A把作品/多次客户反馈连接到岗位证据缺口；B核对单次交付的采用与反馈；C保留就业优先与暂停扩大接单，在自由职业取舍中呈现限制。原话仍有support/limit/unknown分类，分析不自动改目标，采纳仍仅计划。

证据：PERSONAL_BASIS_ABC.json、basis-green-attempt2.log（新增1项与原personalization/zero/runtime共4项通过）、basis-types.log。原已提交适配器回放actionBasis契约红测在basis-old-contract-red.log；测试夹具的scope/quote初始失败仍保留。SDK选择是固定脚本，不证明真实模型产生上述收益，20组真实对照不得标绿。

整体WIP_NOT_READY。真实模型、扣子两项目、云Skill、20组盲配对、20真实普通样本性能与学生签收均PAUSED_NOT_RUN。授权缺口一次汇总：须明确恢复已有真实模型/扣子暂停，继续开发或提交不构成恢复。本轮保持暂停，继续其他本地验收。
