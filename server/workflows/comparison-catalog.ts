// Editorial comparison questions, never assertions about this student's facts
// or current official requirements. Diagnostic errors belong only to the critic.
const fit='本次探索与本人当前目标是否匹配，仍按实际尝试反馈核对；不推断长期适配。'
export const pathUnknowns:Record<string,Record<string,string>>={
 research_exploration:{fit,unknown:'想了解的研究问题、实际任务、可联系的实验室和回应分别核对；不以联系意愿推断已经联系或获接收，不默认申请推免。'},
 employment:{fit,role_evidence:'岗位实际要求与本人可展示证据是否对应仍需核对；未报告作品时不假定存在。',unknown:'若地点、工作内容、收入或申请期限尚未明确，先核对；已明确的偏好继续作为筛选条件。'},
 postgraduate_exam:{fit,motivation:'若读研想解决的问题尚不清楚，先核对；已明确的目的不重复询问。',unknown:'目标院校、当期报考条件、完整准备量与退出代价需查实际资料，不把小探索当完整备考。'},
 postgraduate_recommendation:{fit,motivation:'科研体验和推免意向分开；想了解研究不等于已经选择保研。',unknown:'若考虑申请推免，本校当期资格、排名、材料与期限需正式核对；不据兴趣或成绩片段保证资格。'},
 independent_development:{fit,unknown:'具体使用场景、用户任务和可停止的原型范围仍需核对。',adoption:'若已有原型，实际试用与反馈分别核对；未报告原型就不假定已经做出或有人使用。'},
 entrepreneurship:{fit,unknown:'要验证的用户问题、可承受投入和退出边界仍需核对。',adoption:'兴趣表达、实际使用、付款和重复使用分别看；未发生的行为不补猜。'},
 freelance:{fit,unknown:'拟交付的范围、本人承担的部分、时间及可承受现金波动需核对。',adoption:'交付、采用、付款分别以本人报告为准；已明确项保留，只问缺项。',repeatability:'有一次付费任务也不能证明后续任务或稳定收入；尚无付费任务时不假定已有收入。'},
 overseas_study:{fit,unknown:'项目目标、申请条件、资金与退出代价需实际来源；未核实金额不填写。'},
 public_service:{fit,unknown:'实际工作内容和当期正式岗位、资格、期限仍需核对；不了解时不承诺可报名。'},
 undergraduate_upgrade:{fit,unknown:'本人教育阶段、当地当期政策、科目与完整准备量仍需正式核对。'},
}
export const comparisonFrames:Record<string,{goal:string;tradeoffs:string[]}>=Object.fromEntries([
 ['research_exploration','先体验研究问题与任务，科研探索本身不等于保研、考研或已被实验室接收。','读实际课题或摘要；本人愿意联系时可以先拟问题，是否发送与是否回应分别记。','先做可停止的内容体验，不把探索投入当申请或长期科研承诺。','对问题与任务有兴趣再了解下一步；没有回应时保留其他公开材料，不推断能力或资格。'],
 ['employment','若当前优先了解实际工作与岗位机会，就核对工作内容和本人地点、收入等约束。','只按真实岗位说明核对要求与可展示证据。','比较找岗位、准备材料的总投入；一次小探索不等于求职完成。','有符合本人约束的岗位再推进；范围不合适时可暂缓并保留重查条件。'],
 ['postgraduate_exam','先区分想解决的研究、学历或职业问题；若目的未知，先了解内容。','院校科目与当期报考要求只按正式来源核对。','完整备考投入与其他当前重点如何冲突仍需核对，不把15分钟探索当总投入。','目的和条件明确且本人愿意承担准备量时再推进，否则保留暂缓和重开条件。'],
 ['postgraduate_recommendation','科研体验与申请推免是两项选择；只想体验研究时不默认转成保研目标。','先核对研究内容；若要申请，再查本校当期正式资格、排名、材料与期限。','分别比较研究体验和申请准备的投入，不用兴趣代替资格或适配结论。','体验后再决定是否申请；资格或时间不合适时可只保留研究探索。'],
 ['independent_development','先核对希望解决哪种具体使用场景；探索不默认等于商业化。','用真实用户任务和可停止原型范围核对条件，不假定已有作品或用户。','比较原型、验证和维护可能占用的时间；完整工作量未核实前不扩范围。','得到实际反馈后再决定保留、缩小或停止；有新场景与时间时可重开。'],
 ['entrepreneurship','先核对要解决谁的实际问题；表达兴趣不等于需求已经成立。','分别核对已有做法、真实使用、付款与重复行为，未提供就保持未知。','把验证、执行与可承受损失分开比较，先不承诺扩大投入。','出现预先约定的行为证据再考虑继续；证据不足或超过边界时可停止或调整。'],
 ['freelance','先核对拟交付内容、本人分工和短期现金需要，不默认选择长期自由职业。','交付范围、采用、付款与后续任务分别核对，不把一次付费推成稳定收入。','比较可用时间、履约与现金波动；完整投入未明时不接更多任务。','边界或资源不合适可以暂缓；有明确范围和本人愿意承担的条件时再考虑。'],
 ['overseas_study','先核对项目为何服务本人目标；兴趣不等于已经决定出国。','项目内容、申请条件和资金只按实际材料核对。','比较申请与就读的完整时间、资金和退出代价，未核实数字留空。','目的、条件和可承担投入明确后再推进；不足时保留国内路径与重开条件。'],
 ['public_service','先了解实际工作是否符合本人希望的生活与任务，不默认已经选定。','当期岗位、资格和期限只查正式公告，不承诺可报。','比较了解工作、报考与准备的完整投入，不用一次查阅代表全部准备。','本人确认目标且条件可行再推进；不匹配时暂缓，未来条件变化可重开。'],
 ['undergraduate_upgrade','先核对进一步学习想解决的问题及本人教育阶段。','当地当期正式政策和科目要求需核对，不用通用方法替代。','比较完整准备量与当前课程、工作等本人已报告的约束。','目标和条件明确时再推进；暂不具备条件时保留缺项与重开条件。'],
].map(([id,goal,conditions,investment,reopen])=>[id,{goal:'比较目的（编辑框架，非本人情况）：'+goal,tradeoffs:['条件与证据（编辑框架）：'+conditions,'投入与机会成本（编辑框架）：'+investment,'退出与重开（编辑框架）：'+reopen]}]))

// The model chooses an axis and an explicitly provisional probe order. The host
// renders bounded questions, never invented salary, eligibility or performance.
export const comparisonCriteria={tasks:'实际任务与兴趣',income:'收入需要与证据',credentials:'资格与准备门槛',reversibility:'投入、反馈与退出代价',location:'地点与生活约束'} as const
export const comparisonChecks:Record<string,Record<keyof typeof comparisonCriteria,string>>={
 employment:{tasks:'取一个真实岗位的任务，与本人愿意尝试的任务对照',income:'核对岗位公开待遇和本人最低需要，未核实数字留空',credentials:'核对岗位要求与本人已有证据，区分作品存在和符合要求',reversibility:'记录资料或材料准备量、最早可取得的岗位反馈与停止条件',location:'只查本人愿意考虑的地点范围内的岗位'},
 research_exploration:{tasks:'读一个真实课题或摘要，对照研究问题、方法与本人想追问的问题',income:'科研体验不能当作收入，是否有资助只按实际来源核对',credentials:'科研体验与申请资格分开，不能把联系意愿当作实验室接收',reversibility:'先体验一个问题；联系与回应分开，未回应可改查公开材料',location:'核对实际参与地点和远程可能性，不推断已有实验室机会'},
 postgraduate_exam:{tasks:'把研究内容体验与考试学习任务分开，核对本人真正想做哪一种',income:'核对完整学习成本和收入需求，不假设奖助或未来收入',credentials:'查目标院校当期条件、科目和实际准备缺口',reversibility:'比较完整备考投入与一次研究体验的反馈速度和退出代价',location:'核对本人愿意考虑的学习与后续生活地点'},
 postgraduate_recommendation:{tasks:'先了解研究任务，再决定是否考虑推免申请',income:'核对实际学习成本与资助，不推断已有资助',credentials:'当期本校推免资格、排名、材料和期限分别查正式来源',reversibility:'把研究体验与申请窗口分开，不用兴趣代替资格判断',location:'核对实际项目地点与本人生活约束'},
 freelance:{tasks:'把拟交付任务、本人负责部分和客户验收问题分开',income:'若本人明确报告收款，则保留该事实；否则收款仍未知；再核对后续任务和现金波动，不由交付推断付款',credentials:'核对可展示的交付与实际服务要求，不把一次任务推为长期能力',reversibility:'比较获客、履约和回款投入，先拟边界而不接新任务',location:'核对任务是否要求到场、时区或固定地点'},
 independent_development:{tasks:'把本人想解决的使用场景与一次真实用户任务对照',income:'采用、付款和持续收入分开，未发生的不补猜',credentials:'已有原型按本人报告保留，再查仍缺的使用证据',reversibility:'比较可停止原型、反馈取得和维护投入，不扩范围',location:'核对用户接触和使用条件是否受本人地点限制'},
 entrepreneurship:{tasks:'把用户实际问题与本人愿意承担的任务对照',income:'同学兴趣、实际使用、付款和重复行为分开核对',credentials:'按本人报告的实际互动类型核对支持了哪个问题；同学讨论不改称访谈，未报告访谈就保持未知，不据互动断言产品适配',reversibility:'先记录一个最小行为证据与可承受损失，再考虑是否继续',location:'核对验证场景和用户接触是否需要本人到场'},
 overseas_study:{tasks:'查真实项目课程与研究任务，核对是否服务本人目标',income:'学费、生活费、资金来源分别查实际资料，未核实金额留空',credentials:'查项目当期申请要求与本人已明确的材料差距',reversibility:'比较申请、就读的完整投入和放弃期限，保留国内路径',location:'查实际项目地点并核对本人可接受的生活范围'},
 public_service:{tasks:'读一个真实岗位职责，与本人愿意承担的任务对照',income:'只按正式岗位资料核对待遇与本人最低需要',credentials:'查当期正式岗位资格和期限，不承诺可报名',reversibility:'比较报名与准备投入和岗位反馈，不把查阅当完整准备',location:'只查本人愿意考虑的地点范围内的正式岗位'},
 undergraduate_upgrade:{tasks:'对照目标专业学习任务与本人想解决的问题',income:'核对学习成本和直接工作收入需要，未知数字留空',credentials:'保留本人已明确的教育阶段，查当地当期正式条件',reversibility:'比较完整准备量与直接求职机会成本，设重查条件',location:'核对本人与招生说明适用地区，未知地区先补充'},
}
