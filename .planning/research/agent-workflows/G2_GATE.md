# G2 行动复盘
状态：TESTED_REAL_HOST_ISOLATED_PG_SIMULATED_PROVIDER / NOT_ACCEPTED。
action6/6、主入口1/1通过；原action44/44、材料边界9/9、guide HTTP1/1回归通过。真实测试入口使用当前turn-engine、真实原SDK、隔离PG、合成SSE Provider。记录 G2_MAIN_ENTRY.jsonl 和 G2_CONTINUOUS_CHAIN.jsonl。额外覆盖异步读取期间调用方修改case/current引用不能改变已授权输入快照。
跨3会话同一event accepted → waiting_result → declined，经原finishRun保存、重复读回。相似事件不会串线；Memory OFF/跨账号/撤回来源失效；已发/已读/答复/使用/效果分开。已回答问题不再重复。拒绝后不以attempted覆盖，只有explicit accepted可重新开始。
主入口5个合成SDK调用：3次行动反馈+普通开关关/开各一次；每普通轮1次，新增调用0。实际付费0元。action候选额外读取总上限250ms，实际完整产品p50/p95未测试。
曾失败：测试素材不满足既有COACH_MATERIAL_NOT_VISIBLE；修正合成材料后重测。关键真实RED为跨会话guide状态未承接；新增continuedActionUsage仅在原host授权continue后连接原事务，最终通过。未绕过权限或更改store。
限制：测试Provider文本预设，未证明真实模型能稳定理解反馈；缺独立学生试用、4条真实连续链和桌面/390px验收。下一步不收费重试：先核实未结算调用/余额，再冻结真实小批验收。
