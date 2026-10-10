# 当前本地验收增量

候选workflow-v2-integration-c373290f0265；代码/验收提交b66b29a（后续报告提交不改变产品代码）。6次本地增量提交，无push/合并/部署。当前source436文件、内容、索引与实际测试分别由SOURCE_MANIFEST.json、CONTENT_MANIFEST.json、INDEX_BINDING.json及RUN_BINDING.json绑定；旧0670清单/结果按原字节保存在evidence/acceptance-20261010/baseline-0670，旧评估协议未改。

| 验收项 | 当前实际结果 | 证据，均位于evidence/acceptance-20261010 |
|---|---|---|
| 根测试 | 117/117，原113及后续绿测保持 | root-final3.log |
| 原相关九套 | 96/96；其中核心44在最终修复后再次通过，其余52为本轮前段通过，不能累加独立总数 | related-*.log、wish-backend-final2.log |
| 本轮最终隔离后端 | 73/73：安全18、原核心44、新专项6、原星图5；范围重叠 | wish-backend-final2.log |
| 检索与工作流安全 | 14/14 | retrieval-safety-final.log |
| 正常HTTP/Chrome | 3/3，1440/390无横向溢出；不是实体手机 | browser-demo-final4.log |
| 四条连续链 | 每条6轮/3会话，共24轮/12会话，逐轮实际保存回复与状态读回 | round-readback-final.log、FOUR_ROUND_READBACKS.json、round-readback/FOUR_TRAJECTORIES.json |
| 类型/构建 | 前后端PASS、build PASS，既有Three chunk警告保留 | server-final3.log、server-readback-final.log、frontend-final3.log、build-final3.log |
| 演示 | 185秒，H264，持续标明模拟Provider；方向→行动反馈→星图→更新后的帮助 | demo/local-campus-story.mp4、demo/TIMELINE.json、demo/VIDEO_VERIFICATION.json |

这些是本地合同、来源门禁、状态提交、跨会话与界面证据。脚本夹具的stateCorrect标志不是独立语义评审；模拟token、费用与模型名不是实际付费数据。20组真实单/多Agent收益、20普通真实性能及真实学生签收均不得据此推为通过。

| 用户验收目标 | 本轮可证明的结果 | 尚未通过 |
|---|---|---|
| A 连续使用 | 四条各3会话、短答接回原任务、更正/拒绝、事件/反馈分开，逐轮消息持久读回；相似对象不自动选定 | 真实模型连续语义与学生使用签收 |
| B 多Agent价值 | A/B/C同预算连接不同个人原话与缺口，越权依据拒绝；分析不改目标、采纳仅计划，快速路径保留 | 预声明20组真实收益盲评与全部实测成本/时延 |
| C 星图影响帮助 | 有效时间/来源状态共用；愿望不算经历、退出路径不算优先追求；更正/遗忘/Memory OFF/跨账号原保护通过 | 真实学生是否理解变化、真实模型是否正确使用更新 |
| D 攻略适用与复盘 | approved原修订/步骤承接到受阻/等待/拒绝分支，编辑适配与来源主张分开；112逐项去向保留 | 59来源缺口、16待审、新候选独立审核未取得 |
| E Skill与扣子 | 五Skill正常本地任务实际版本、SHA、能力执行与读回；缺失/替换及可选解释降级测试 | 云端两项目及五Skill真实发现、加载、取消/异常兼容 |
| F 最终验收 | 技术绿测、来源门禁、合法状态实际提交与界面证据；本轮真实费用0，首次失败/取消全保留 | 同一版本20真实普通样本性能、最终学生验收 |

资料核查：四条链实际approved卡的原文短引文、revision、位置、scope/limitations及编辑适配分开保存于CURRENT_MAINLINE_SOURCE_AUDIT.json；NSF/Upwork的context是中文摘要，未把它冒充英文原文上下文。另实际重读本机已保存的MIT就业/升学原HTML，正文/引文位置及hash匹配，CURRENT_ARCHIVED_BODY_REOPEN.json；对应候选仍needs_review。53覆盖、59来源缺口、16待审及112逐项去向不变，未自批或发布。

仓库主Skill1.2.2-candidate、五业务Skill0.2.0-candidate；用户安装主Skill1.2.0只读未覆盖；云1.2.0仅历史记录，未取得新hash。验收临时HTTP进程真实读回指纹并已关闭；8787无服务、3001版本接口404，常驻新服务未经核验。各进程分别绑定，不把读模块当部署。

旧保存失败13/13和原专项65继续保留为起点证据，未重新混算当前分数。首版停首页、第二版愿望误收、第三版退出方向误投影的原视频、全部红测、夹具失败及安全进程清理问题均保留。当前唯一真实付费账本SHA未变，新增真实模型/云调用0、真实预算0、收费重试0。

起点提交：42a255f4790c875630b547a19eb1b9acb698d37f。原0670候选24轮保留为SCRIPTED本地集成基线，不改写为真实模型效果。

## 攻略跨会话反馈承接

最新连续链还逐轮核对实际已提交助手消息，24轮全部通过（round-readback-final.log及round-readback/FOUR_TRAJECTORIES.json）。已去掉原先比较两个未提供reply字段的无效断言；回复、事件revision、攻略使用、成长状态与实际Skill trace一起保存，避免只看run completed。3分05秒演示的原录屏来自修复后同一产品代码；录屏后的增量只完善该验收脚本，两个进程指纹分别记录。

正常认证HTTP、隔离PG、原SDK的三会话链：采纳 → 未开始且材料打不开 → 拒绝继续。保持实际guide/revision/branch/step，受阻提示只带对应反馈分支，不重送入门教程；当前本人反馈与第三方/引用分开。没有回复为waiting_result，不误记completed。待审卡、已撤回来源和不同任务不会获得承接授权；同义去重沿用原机制。

红证据：evidence/acceptance-20261010/guide-context-red.log、guide-feedback-red.log。后续quote保护及拒绝提示失败也保留在guide-pg-green.log、guide-http-green.log。

绿证据：guide-final.log（新增2项、原main-entry1项、原guide-usage-http1项），GUIDE_CONTINUATION_HTTP.json实际三会话读回；root-guide.log 115/115，server-guide.log、frontend-guide.log、build-guide.log通过。模型响应来自loopback脚本；token/估算成本是合同字段，不是真实付费。未新增依赖、Agent或预算，未改公共攻略审批。

## 专业Skill实际执行与降级

五个专业Skill在进程启动时冻结版本及SHA，每次执行重新读取并核对；缺失/替换失败记录零调用trace，不用变更后的指令。可选成长解释不可用时返回空解释和unavailable状态，不丢弃合法主状态。

skill-red.log、skill-fallback-red.log保留版本缺失及失败解释原红测；skill-final.log通过。正常宿主24轮中实际记录guide-application 4次、action-review 5次、growth-diff及experience-evidence各21次；深入任务direction-analysis通过原SDK调用和持久回执读回。SKILL_HOST_EXECUTIONS.json及DIRECTION_SKILL_EXECUTION.json明确为本地脚本Provider，不证明真实模型遵循全部Skill。

root-final.log 115/115、原九套相关96/96、前后端类型/build通过；retrieval-safety-final.log补跑相似对象、更正、遗忘、撤回和工作流边界14项通过。四条各3会话、共24轮及Chrome1440/390再次通过。录屏首版误停首页的原视频保留；正常认知空间入口的第二版通过，画面核查另发现愿望句被误收经历，继续修复后才能交付最终演示。

## 星图采用同一有效状态

录屏核查新增两处真实误投影已修复：愿望“我想先确认需求与交付范围”不会再变成已发生经历；“不再把自由职业作为主线”留作原话边界，不占当前追求。已有主题也按同一规则退出，即使用户锁定过标题；已交付仍可记录，“不再熬夜”这类本人积极习惯目标继续保留。个人依据截取时显式标明原话片段与省略号，完整条件仍在引用中。

experience-wish-red.log、starmap-ended-path-red.log保留原失败，纯函数绿测及wish-backend-final2.log通过；后者含安全18、原核心44、新专项6、原星图trust/g1回归，所有断言通过后正常退出。前次安全检查通过后因测试未关闭embedding子进程挂起，已核对仅关闭本次测试子进程；该日志保留，测试补上正常清理后重新完整通过。root-final3.log 117/117、前后端typecheck与build通过。

已复现星图决策上下文直接读取raw active约束，导致过期“零小时”和尚未生效“下周六小时”同时进入当前帮助。改为复用growthView已有来源/时间窗口/依赖/暂停门禁；过期目标不能凭主题投影继续生效。没有增加另一套时间解析或星图事实。

starmap-time-red.log保留原失败；starmap-green.log含新增时间项、原trust/g1与growth-knowledge回归通过，starmap-types.log与root-starmap.log通过。Memory OFF、跨账号、遗忘、连线撤销与快照冲突原保护继续成立。

## 个人依据与行动缺口

路径分析沿用原SDK、4–5次调用和现有候选动作。新增可校验的actionBasis选择：每个动作只可连接已选个人证据及已选未知；综合者继续只选已审候选，不编写新事实。UI现有停止条件展示实际原话与缺口；未给具体连接时诚实提示尚未说明。

A/B/C保持相同120分钟：A把作品/多次客户反馈连接到岗位证据缺口；B核对单次交付的采用与反馈；C保留就业优先与暂停扩大接单，在自由职业取舍中呈现限制。原话仍有support/limit/unknown分类，分析不自动改目标，采纳仍仅计划。

证据：PERSONAL_BASIS_ABC.json、basis-green-attempt2.log（新增1项与原personalization/zero/runtime共4项通过）、basis-types.log。原已提交适配器回放actionBasis契约红测在basis-old-contract-red.log；测试夹具的scope/quote初始失败仍保留。SDK选择是固定脚本，不证明真实模型产生上述收益，20组真实对照不得标绿。

整体WIP_NOT_READY。真实模型、扣子两项目、云Skill、20组盲配对、20真实普通样本性能与学生签收均PAUSED_NOT_RUN。授权缺口一次汇总：须明确恢复已有真实模型/扣子暂停，继续开发或提交不构成恢复。本轮保持暂停，继续其他本地验收。
