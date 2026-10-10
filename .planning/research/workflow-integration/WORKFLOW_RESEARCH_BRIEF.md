# 持久调用与来源实现依据

复用原PostgreSQL/RequestScheduler/native SDK/CoachProviderBudget，未安装新队列库或重写工作流。调研pg-boss主仓库commit aa3b4f3ccb68fa610caf62ba04985deb9bc801b1的src/plans.ts：事务内claim与冲突幂等的模式可参考，MIT；没有复制其源码或新增依赖。PostgreSQL官方SELECT文档说明FOR UPDATE及SKIP LOCKED语义；本实现按稳定actor/requestId行锁竞争，不冒称实现了自动跨进程恢复队列。

Primary sources: [pg-boss repository](https://github.com/timgit/pg-boss/tree/aa3b4f3ccb68fa610caf62ba04985deb9bc801b1)；[PostgreSQL SELECT](https://www.postgresql.org/docs/current/sql-select.html)。

模型与收费沿用项目实际runtime和原唯一账本；[阿里云Qwen3.8 Flash官方说明](https://help.aliyun.com/zh/model-studio/qwen3-8-flash)已核对，但不替代当前授权或账户余额。每次冻结实际model签名、token cap与本机pricing；不因网页价格另增预算。

公开攻略只读取[IES Organizing Instruction and Study](https://ies.ed.gov/ncee/wwc/PracticeGuide/1)，保存原HTML、SHA、Recommendations 5a/5b位置和7词引文；具体校园操作清晰标注editorial adaptation。后续一次网络ECONNRESET保留失败日志，复用已验证捕获正文，并标capturedOriginalReused=true，没有假称第二次HTTP成功。独立审批未获得，needs_review不能变approved。

追加实际待审卡核查：exam-diagnosis（d259a5aa-ec96-43f7-89ab-5f5c87031f1c）原状态needs_review。本轮对同一已捕获IES原文提炼候选revision2，技术审阅明确发现该原文不能支持四类错误诊断及科研/任务归因。原四分支保留awaiting_source，独立审批不足，隔离导入读回仍被学生API拒绝。没有将该来源缺口冒充解决，原53/112覆盖与59缺口不变。证据：public-card/needs-review-candidate.json、PUBLIC_CARD_CHAIN.json、public-card-final.log。

## 继续集成核验（2026-10-10）

当前链来源补充：[MIT读研目的](https://capd.mit.edu/channels/prepare-for-graduate-professional-school/)支持核对学位与职业目标、动机及个人条件；[MIT简历证据](https://capd.mit.edu/resources/resumes-writing-about-your-skills/)支持用项目/动作/真实结果对应岗位说明。实际直接正文、hash和引文定位见evidence/continuation/sources/SOURCE_EVIDENCE.json。来源不支持中国考研资格、30/35分钟效果或个人适配判定；两个canonical revision2草案仍needs_review，不关闭原59缺口。
