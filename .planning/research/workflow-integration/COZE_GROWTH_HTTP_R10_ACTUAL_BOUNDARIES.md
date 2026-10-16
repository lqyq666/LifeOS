# LIFEOS_COZE_CORE_20261011_GROWTH_R10_ACTUAL_BOUNDARIES

继续原成长项目7693388932939300905，实际R9 HEAD 37202e2f3e21b73c69c0d107209394bbc83c4b10。主端已实际下载三源，hash与云终端逐字匹配。附件保留R9首次12项11PASS/1FAIL、追加7项1PASS/6FAIL；追加中的总时长用错动作id，该项不作充分证据，另附正确获准目录 employment:requirements20 + freelance:delivery15，实际上限30却产生35的首次FAIL。禁止修改这些首次记录或用自己的boolean覆盖。

本批最多预留30000原有开发积分，产品模型零调用、真实云模型零调用、不部署、不新增Agent或项目、不改生产治理。修复轮数不限。请完成实际机制修复并对真实函数/本地慢HTTP/原SQL账本做免费检查，不止写测试报告：

1. Host真正的时间结构是 request.budget={period,amountMinutes,source,scope,qualification,quote}，见附件contracts.ts。从已通过HMAC且授权本人/current事件的budget读取，0保持0、null保持未知，bool拒绝。保留可验证相等的内部兼容字段，不允许旧top-level字段覆盖结构化预算/跨事件预算。未知不编10080，输出weeklyMinutes需允许null；零时间不选正时长行动，仍允许无行动的合法方向比较。先通用检查所有array唯一性再走0分支（现0分支跳过重复tradeoff）。
2. `_build_proposal`以最终已选、已去重nextActions实际目录estimatedMinutes总和检查整体上限，不用候选各自weeklyMinutes之和；候选是备选路径，不能强迫把所有备选预算一起执行。未知持续未知。_next_actions不得缺basis回退全部事实、缺目录编genericaction、缺时长回退整周。选择缺实际依据/缺目录/缺合法stop/stage一律拒绝，支持/限制/未知分开且逐行动绑定。与主端当前provider-adapter.ts语义保持一致，当前就业优先暂停接单不能归为扩大接单支持。
3. `run_http_entry`开始验证之前创建一个absolute monotonic deadline，verify/reserve/client初始化花费均计入同一值，transport继承同一绝对值，不能max(1,remaining)续期。所有模式（包括critic/synthesis/action_review）CancelledError显式处理并在finally关闭，等待所有Task与client关闭，从实际唯一SQL账本读已started计数与未知fee/reserve再返回。已有started/replay不能zero_model_receipt。
4. `run_http_entry_sync`实际线程已结束才交付回执。原R9取消例返回0，slow finally sleep4秒时约3秒就返回且worker未结束；不能只在注释写等待。保留真实loop/task，取消一次，不重发；取消清理可以超过派发截止但期间禁止新POST，并明确报告清理耗时，不能提前回0伪装满足截止。工作线程异常也必须读取原账本，不知道费用保持null。先检查真实worker完成，再finalize。无法安全结束就明确失败，不能后台继续消费。

验证至少包括：0/null/bool/cross-event、actual35>30、两备选各可用预算但只选一个行动、所有selector重复、basis和catalogue缺失、阶段方向改变、验证/reserve延迟、每POST remaining、三个模式取消、slow client.close、worker异常、started后重复请求、两个进程SQL同slot不重复派发。保存原输入/实际产物/源码hash/云commit/实际Skill指令版本。无需收费模型可做这些。正确源/version/HMAC/权限/来源/唯一账本/5调用上限不降低。主端会再次读实际源码与回执核对，未通过仍NOT_TESTED真实云且WIP_NOT_READY。
