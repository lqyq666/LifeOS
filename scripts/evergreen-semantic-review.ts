// Explicit first semantic review, performed against reopened original passages.
// This authoring script records decisions; hash equality is only a correspondence check.
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve('.planning/research/evergreen')
const cards=readFileSync(resolve(root,'KB_GUIDES.jsonl'),'utf8').trim().split('\n').map(s=>JSON.parse(s))
const observations:Record<string,[string,string]>={
 'campus-resource':['图书馆原文描述馆藏查询与电子资源获取实操；支持先找本人学校可核验入口。','不能推出他校权限或全校事务均由图书馆办理；按部门查入口是编辑适配。'],
 'course-frame':['清华转载学习材料提出写已知和未知、带问题积极阅读。','知识关系图、课程目标和助教求助是编辑适配，原文未验证其效果。'],
 'retrieval-practice':['IES推荐测验促进学习，原文推荐段说明主动提取。','不能推出个人最佳题量、复习时间或考试提分；合上材料的步骤属于编辑适配。'],
 'spaced-review':['IES第1项明确提出分散学习。','不继承原文几周至几月为个人最优间隔；安排按实际任务与反馈调整。'],
 'worked-example':['IES第2项要求已解示例与自行解题交替。','遮住一部分和相似题是编辑实施建议；不能保证迁移成功。'],
 'explain-understanding':['IES第7项提出深层解释性问题。','用自己的话、录音或写一句为校园适配；流畅表达不证明正确理解。'],
 'priority-budget':['清华PDF第12页展示优先排序、实际用时与反馈以及PDCA。','原文时间表是示例，不能赋给用户；保底必要事项和缩减推进项是编辑判断。'],
 'plan-review':['清华PDF第12页PDCA与计划反馈支持检查执行再修订。','停止任务与圈出假设是编辑适配，不声称这些是作者原句或科学效果。'],
 'experience-evidence':['长江大学原文明确STAR的背景、任务、行动、结果四部分。','不推出所有经历都证明能力；团队与个人分列、保留未知为防夸大编辑适配。'],
 'research-reading':['华东师大讲座原文分查找、整理、评论，提醒非官方资料局限并推荐数据库。','具体论文复现和未知术语处理是编辑适配；未读取的全文不可声称读完。'],
 'user-interview':['NSF原文描述与潜在客户、合作伙伴和相关方交流以评估商业潜力。','过去情境访谈为校园编辑步骤；喜欢不等于付款，未联系不算已执行，样本不推算成功率。'],
 'delivery-scope':['Upwork原句要求明确包含的修改次数与范围变更的定义。','只批准修改与范围对照机制；节点、完成标准为LifeOS适配，不输出合同效力、费用规则或付款保证。'],
 'project-story':['STAR教学原文明确情境、任务、本人行动与结果，支持在面试中有序介绍真实项目。','听众选择、困难处理与未知保留是编辑适配；不保证录用，与经历整理共用同一来源而非独立研究。'],
 'prototype-test':['清华经管作者要求亲自做最小可行产品，并强调是否付费无法由AI替代回答。','只采用真实行为验证与最小原型的机制；不继承一周、五人、报价或收入数字，不把试用认作付款。'],
 'boundary-request':['山大宿舍材料明确提出表达诉求、协商和共同建立学习生活边界。','保护安全、表达拒绝与事实请求分开是编辑适配；不能保证冲突解决或代替法律意见。'],
 'recovery-support':['上海应用技术大学材料提出平衡休息、运动、社交、学习并主动寻求帮助。','只是一般生活支持，不能解释病因、诊断或治疗；休息时长和求助方式由本人实际情境决定。'],
}
const gaps:Record<string,[string,string]>={
 'first-contact':['职业访谈准备与提纲设计有原文支持。','原文不能直接支持导师初次邮件、社交破冰、推荐请求和未回复跟进的全部分支；需要相关沟通原文。'],
 'fit-exploration':['了解自己后访谈职业信息有支持。','体验专业、海外学习和学术意愿的小接触决策仍缺相关来源，不能由一次活动报告推出适配机制。'],
 'skill-gap':['STAR可整理已有职责和成果。','能力缺口识别、跨专业迁移和小作品验证尚缺直接来源；目前只有编辑步骤，暂不批准。'],
 'exam-diagnosis':['PDCA支持检查与修订过程。','知识错误、操作错误、时间与外部未知的分类尚缺学习或考试诊断原文；不由通用管理框架自动批准。'],
 'restart-task':['PDF提供时间管理与PDCA框架。','中断后恢复上下文和环境调整不是所核对页面的机制，需要注意力/任务恢复相关来源。'],
 'start-small':['PDCA提供执行与反馈框架。','缩减动作缓解无法启动的步骤是原创适配，尚缺支持启动机制的相关原文。'],
 'research-task':['Upwork片段可确认项目目的和目标。','角色、依赖、验收人以及科研/社团的迁移缺少足够原文定位，8词片段不作为全套团队框架证据。'],
 'direction-comparison':['职业访谈报告支持加工职业信息。','稳定自主等选择因素与具体比较程序缺少相关原文，不将访谈报道扩大为全面方向评估方法。'],
 'application-match':['STAR支持面试自我陈述。','岗位、留学项目和付费服务是否值得投入的判断不是STAR证据，需要要求/代价核验来源。'],
 'job-feedback':['PDCA支持计划与实际对照。','招聘分阶段反馈与无回应处理缺乏相关原文；先不批准就业流程分支。'],
 'interview-unknown':['STAR支持组织已有经历。','不会回答时澄清与诚实说明未知并非本段原文机制，需要面试沟通来源。'],
 'delivery-review':['Upwork片段支持按目标确认交付物。','实际使用、满意、付款与再次委托分列的机制缺直接原文，目前为编辑启发。'],
 'income-ledger':['时间手册支持记录实际投入与反馈。','到账/未到账、直接成本、必要开支和净收益并非时间手册内容，需要一般预算/财务记录原文。'],
 'content-experiment':['MVP文章支持以真实客户行为验证假设。','内容表达主题、受众理解和平台创作反馈的迁移缺直接相关来源；不把商业付款机制等同内容机制。'],
 'team-contract':['Upwork已核对片段支持项目目的与目标。','目前未保存角色、依赖、延期、分歧处理的正文证据；不可只凭文章标题批准整套分工方法。'],
 'information-check':['华东师大材料强调查找/整理/评论文献与来源可靠性。','AI建议核验、合作风险和个人资料保护的全部分支仍缺相关原文；不能把文学检索讲座当作隐私合规指南。'],
}
const review={reviewer:'Codex original-body semantic review, round 2; not independent human acceptance',reviewed_at:new Date().toISOString(),cards:cards.map(c=>({guide_id:c.id,content_hash:c.guide.contentHash,disposition:observations[c.guide.canonicalKey]?'approved':'needs_review',reason:observations[c.guide.canonicalKey]?'原文机制支持与编辑实施步骤已分开；获准作为有边界的方法。':gaps[c.guide.canonicalKey][1],supports:[(observations[c.guide.canonicalKey]??gaps[c.guide.canonicalKey])[0]],cannot_infer:[(observations[c.guide.canonicalKey]??gaps[c.guide.canonicalKey])[1]]}))}
writeFileSync(resolve(root,'KB_SEMANTIC_REVIEW.json'),JSON.stringify(review,null,2)+'\n')
console.log('All 32 source-to-method decisions recorded: 12 benchmarks plus 4 bounded additions, 16 explicit source gaps.')
