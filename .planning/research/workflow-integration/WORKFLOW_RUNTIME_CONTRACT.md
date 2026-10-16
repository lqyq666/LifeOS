# 工作流候选运行契约

唯一入口为LifeOS聊天。业务Skill不拥有学生身份、记忆或事实写权限。浏览器仅传稳定requestId、所属conversationId/currentMessageId、2–3支持路径和consent=true；actor、证据、memory/停荐/禁荐、时间和费用限制均由host读取。真实时间依据未知时waiting_user、0调用。

原认证体系绑定actor；跨账号404；Memory OFF跨会话403。只用最小相关已授权消息/growth；私人上下文不上传扣子。公共方法须来自当前approved卡；单次交付、对方采用、付款、认可与稳定能力分别核对。

## 任务与调用

`POST /api/workflows`创建，`GET /api/workflows/:id`及conversation过滤列表读回；`POST /api/workflows/:id/cancel`取消，`POST /api/workflows/:id/actions`明确小行动/阶段方向/拒绝。数据库内部queued/running/finished；外部另映射waiting_user/proposed/cancelled/failed/rejected/plan_saved/direction_saved。

原唯一CoachProviderBudget在同一个文件锁中整图原子预留；同logicalCallId永不重发。每个节点的callId同时是稳定单次attempt标识，PG主键actor+requestId+nodeId阻止第二派发，记录源input/output摘要、真实原SDKrequest响应ID、usage、cost或null。普通0–1次，深度2–3analyst+critic+synthesis最多5次，没有第6次复述/生成。SDK maxRetries=0；usage缺失或不完整保留unknown及保守预留。仅已证实未发节点可not_sent/0。

共享任务journal在节点调用前持久派发；worker/重复HTTP/重启只能读相同请求的记录。进程Map仅缓存活跃promise，完成项退出内存，持久记录不清空。启动时不自动重发running未知调用；无人处理的队列在原deadline到期失败降级，本轮没有自动恢复收费任务。多worker同ID按PG事务抢占；没有引入新的队列依赖。

取消和120秒任务deadline阻止后续波次，signal停止SDK；已经派发而无usage的费用不能置零。过期状态由PG回执冻结；迟到结果不能覆写终态或提交方案。版本/权限/来源变化时GET清除旧候选与私人解释。

## 事实与审阅

行动字段true=本人证实发生，false=明确未发生，null=未知；每字段绑定当前原文、消息ID和event revision，不能由已发送推已读或采用。更正旧采用前提时效果清除；旧事实历史保留但标记superseded并退出当前提示。更正/未知处理复用原子句scanner，排除假设、反问、第三方与引号文本。

critic问题输出category/severity/affectedClaims/evidenceRefs/resolution；旧字符串按一般未知兼容保留。blocker阻止综合，关键未知追问或保留独立成立部分，一般未知保留探索。阻断回执保留审阅问题。最终综合只能排序已审alternatives与选择已审动作，服务端比对所有可见字段、源引用与限时；合法引用ID不授权新增个人数字或承诺。是否语义上有用仍要独立真实评测。

分析完成没有个人变化。采纳小行动通过原startRun→finishRun快照与事务写入user_edit的priority，明确尚未执行；确认方向才写阶段goal。重复确认相同选择返回原提交，不重复写入。取消、拒绝、来源/版本/控制变化禁止提交。

WF-C只读真实同事务提交前后growth/confirmed experience快照；模型观察或proposed需核对，本人已确认记录无需重复确认。时间轴当前文本来自有效原投影，旧更正泛化说明，撤回不展示旧原话；回执GET重新校验revision，删除经历也失效。记录数量不给中央身份定级。

WF-D实际正文与引文位置/摘要绑定canonicalId/revision/hash。实际上读到网页不代表获批；`actuallyRead:true`不足够。单卡revision2仅隔离导入，独立审批/已认证发布授权不足即needs_review，学生API拒绝。

## 版本与回滚

/api/run/version返回进程启动时HEAD、sourceDigest、sourceFreezeDigest、mainSkillDigest及5Skill hash；不能靠当前磁盘HEAD冒充运行版本。每任务绑定controls/runtime摘要。所有生产开关默认关闭，当前仅隔离测试；回滚关闭候选开关并保留账本，不能删幂等记录或未知预留。既有G0备份可在独立目录恢复，不直接覆盖原工作区。

身份投影沿原成长/身份授权事务同步；来源有效性采用当前修订文本，历史引文仅作历史证据，不能复活当前身份。明确的后来本人身份编辑是独立 user_edit 来源。遗忘来源清除包含旧引文的退休变更事件，保留不含原话的技术回执。

## 继续集成核验（2026-10-10）

新增 POST /api/workflows/:id/resume，浏览器传conversationId与已保存补充的currentMessageId，不接收actor/自填预算。原任务行FOR UPDATE，仅finished+waiting_user且无节点/费用预留时能重开；验证原runtime/controls及消息来源，当周准确本人预算更新原request_payload，原问题、方向和requestId保留。相同补充重复请求只读回，未知/已派发/取消图不重发。任务继续通过原scheduler和journal。短句时间解析限定完整“这周六小时”等表达，不含第三方、条件、引用、疑问、花费、近似和下周；当周来源时效按Asia/Shanghai核验。动作有多个选项和不同建议投入上限，均是待本人选择的操作建议；critic与最终closed事实约束仍生效。
