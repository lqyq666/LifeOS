# LIFEOS_COZE_CORE_20261011_GROWTH_R7_REPAIR

继续原项目7693388932939300905、原HTTP路线，不新增项目/Agent/节点。本人已取消修复轮数上限；继续修复、验证、Review，不按两轮停止。沿用既有积分及CNY账本，不新增预算，不自动重试收费请求，本轮开发和测试零真实百炼调用、不部署，不修改治理文件。R6实际云提交b8a95308ee60962b086e695061669a77ca732383。四文件实际终端SHA与下载一致；transport旧缓存已另存，不拿旧文件冒充当前源码。R6自测22/22、R5自测31/31不是核心业务验收。主端真实AST函数回放附件保存了7项新失败。

保留已通过的wire ISO/ASCII HMAC/原UUID槽位、SQL无隐式内存回退、原方向ID、综合方案只保留已选项、异步cancel+await close。不重写已通过模块。

## 修复实际缺陷

1. `_build_proposal`方案只选a，但`_next_actions`仍遍历全部kept，使未选b的行动复活。只能给实际选择的方向/行动生成结果，非法/空综合返回诚实invalid_contract；不恢复拒绝或暂停方向。未知时长不得默认30，也不能把全部周预算反复分配给每条行动。
2. `_parse_analyst`只校验证据ID，任意actionIds、support、limits、tradeoffs、stopCondition和weeklyMinutes均可自编。复用附件宿主provider-adapter已有有界编辑选择器，或兼容其同一输入目录；模型只能选择服务器给出的行动/取舍/未知/阶段理由ID、合法个人证据关系及actionBasis。不要复制第二套完整攻略，不把任意模型断言加编辑适配标签就合法。正式公共方法必须精确16卡合法版本/hash片段；没有绑定攻略的小行动明确编辑建议，不造guideId。关键行动必须能解释支持/限制/未知依据、当前阶段、下一步核实与改建议条件。暂停扩大接单、一次交付但采用/付款未知、已有多次反馈和零实践需合理不同；不以模板+40字片段+默认分钟算个性化。
3. `_validated_records`接受sourceKind=public/tool且role=user的资料成为个人依据；没有核对text与ref.quote实际一致。拒绝公共案例/工具/AI推断/撤回/错版本/跨账号/跨事件/被遗忘资料。允许本人合法原文，保留来源字段；不能凭role字符串覆盖真实provenance。不能仅接受所有合成测试的同一sourceKind而拒绝真实宿主合法消息/经历。
4. `_build_review`把任意entries字典str()塞进alternatives，channel任意（实际输入“人为批准”、entries“已经采用、付款且有效”被接受）。action_review按实际反馈分开未开始/交付/采用/付款/效果及未知，只提供获准证据支持的调整，不重新发送整套入门。kb_maintenance只编辑准备，不产独审/真人批准/发布回执；其结构结果需要与主端实际合同兼容，不用假方向冒充审稿。growth_diff对实际before/after授权证据给有意义的变化/认识/未知说明；无新事实才诚实无变化，不一律空白。正常入口读回各模式实际产物与Skill对应版本，不能靠_mock固定文本/布尔值证明。
5. `_finalize`仅result非None时带totals；异常/invalid_contract/SQL finish失败后已派发2次会返回providerCalls=0/reserve=0。已started槽位、usage未知/null及足额预留必须始终实际读回，禁止凭错误途径抹成零。`run_http_entry`异常路径读取真实账本并保留原failure，不能把所有错误改cancelled。SQL写失败不能伪称已finish，也不能再派发原请求。
6. `thread.join(600)`仍违背签名总deadline<=120s；transport仅第一次从现在+deadlineMs设截止，各顺序阶段使用完整call_timeout，允许累计超过图总截止。统一monotonic图截止（含验证/预留/加载/全部调用/关闭），每POST超时取剩余时间，deadline结束cancel并await全部请求，再形成回执。不留下daemon后台收费任务。使用httpx.MockTransport/本地合成慢HTTP验证超时与取消，不跑百炼。
7. `_prompt_over_limit`算的是messages而transport算完整body，且预检用实际schema对象，POST传schema标签；两者不是相同字节。统一同一build_request_body返回的真实UTF8字节，在CAS开始前检查12000；真正POST同一bytes。超限零POST/零providerCalls，不虚记已派发；实际promptBytes记录请求bytes而不是响应长度。不能靠短fixture不越界掩盖12000附近真实差异。
8. runtime_binding资产缺失/全库与批准子集unknown不得继续模型。正常/run绑定最终实际完整commit/hash；只报告实际用到的5专业Skill与校园伙伴，不把未消费的技能算运行成功。源冲突、取消、错版本、未知费用与恶意模型输出都保留失败，不降低门槛。

## 最小验证与交付

先回放附件真实失败并保留，再执行修复后同断言；数据容器shim仅用于纯函数，不代替真实SQL/HTTP。两进程SQL CAS/重启不可重派、统一字节门/截止/close任务归零；action_review/growth_diff/kb_maintenance正常入口与真实Skill文本进入请求及有效产物读回。关键取舍四个不同证据样本有可解释差异，模型只选择合法目录，坏输出诚实拒绝。请求+整图槽位不变、最多5生成、不重试原请求。最终源码本地提交、实际runtime_readback与原始执行日志；正常协作需后续获准真实模型验收，不自行声明通过或发布。

R6原消费6932.18积分取整6933，已在主端唯一账本结算，剩余原获准109162积分，本次只在该池内开发。历史首次失败全部保留。
