// N3.4: public-knowledge query whitelist. Only these structured fields ever
// leave for Coze — never the raw conversation, never names/grades/contacts or
// any private context. When a message cannot safely produce a public query,
// the result is null and the Coze path is skipped entirely.

export type PublicKnowledgeTopic='postgraduate_exam'|'postgraduate_recommendation'|'undergraduate_upgrade'|'public_service'|'overseas_study'|'employment'|'method'
export type PublicKnowledgeQuery={
  topic:PublicKnowledgeTopic
  year?:number
  region?:string
  institution?:string
  programme?:string
  questionKind:'requirements'|'schedule'|'materials'|'method'
}

export function renderPublicKnowledgeQuery(query:PublicKnowledgeQuery):string{
  const parts:string[]=[query.topic]
  if(query.year)parts.push(String(query.year))
  if(query.region)parts.push(query.region)
  if(query.institution)parts.push(query.institution)
  if(query.programme)parts.push(query.programme)
  parts.push(query.questionKind)
  return parts.filter(Boolean).join(' ')
}

const topics:readonly {topic:PublicKnowledgeTopic;pattern:RegExp}[]=[
  {topic:'postgraduate_recommendation',pattern:/(?:推免|保研)/},
  {topic:'postgraduate_exam',pattern:/(?:考研|研究生考试|读研)/},
  {topic:'undergraduate_upgrade',pattern:/(?:专升本|专接本|专插本)/},
  {topic:'public_service',pattern:/(?:考公|公务员|考编|编制)/},
  {topic:'overseas_study',pattern:/(?:留学|出境读研|出国读)/},
  {topic:'employment',pattern:/(?:就业|找工作|求职|实习|招聘)/},
]
const questionKinds:readonly {kind:PublicKnowledgeQuery['questionKind'];pattern:RegExp}[]=[
  {kind:'schedule',pattern:/(?:报名时间|时间安排|截止|几月|日程)/},
  {kind:'materials',pattern:/(?:材料|清单|要带什么|提交什么)/},
  {kind:'requirements',pattern:/(?:报名条件|资格|学历|专业要求)/},
  // P5c R04: method questions - how-to guidance about work, study, planning
  // or personal evidence. Checked BEFORE the generic condition words so a
  // method ask is never misfiled as an eligibility requirement.
  {kind:'method',pattern:/(?:怎么写|怎么安排|怎么准备|怎么做|怎么开始|如何写|如何安排|如何准备|如何开始|怎么整理|怎么规划|怎么复盘|如何处理|怎么提升|怎么联系|如何联系|方法|技巧|思路|步骤|怎么弄|怎么办)/},
  {kind:'requirements',pattern:/(?:条件|要求)/},
]
// P5c R04: method-question topical anchors - a method question without a
// direction topic still earns a safe topic when it names one of these
// campus-work nouns. No names, grades, contacts or story text enter the query.
const methodAnchors:readonly {topic:PublicKnowledgeTopic;pattern:RegExp}[]=[
  {topic:'employment',pattern:/(?:作品集|作品|简历|实习|面试|求职|兼职| portfolio)/},
  {topic:'postgraduate_exam',pattern:/(?:备考|考研|复习|刷题)/},
  {topic:'method',pattern:/(?:课程|学业|时间安排|方向|科研|项目|竞赛|比赛|社团|沟通|学习|规划)/},
]
// Scope values only from explicit patterns the user actually wrote; nothing is
// inferred from profile memory.
const yearPattern=/(20\d{2})\s*(?:年|届)?/
const regionPattern=/(北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)(?:省|市|自治区)?/
const institutionPattern=/(?:学校|大学|学院|院校)[:：]\s*([^\s，,。；;]{2,30})/
const programmePattern=/(?:专业|项目)[:：]\s*([^\s，,。；;]{2,30})/

// Conservative extractor: a message earns a public query only when it names a
// public topic; question kind defaults to requirements when nothing matches.
export function buildPublicKnowledgeQueryFromText(text:string):PublicKnowledgeQuery|null{
  const kindEntry=questionKinds.find(entry=>entry.pattern.test(text))
  const isMethod=kindEntry?.kind==='method'
  let topicEntry:(readonly {topic:PublicKnowledgeTopic;pattern:RegExp}[])[number]|{topic:PublicKnowledgeTopic}|undefined=topics.find(entry=>entry.pattern.test(text))
  // P5c R04: a method question may carry no direction topic - anchor it to the
  // generic method topic (or the employment/exam anchor noun) so the safe
  // whitelist query can still be built.
  if(!topicEntry&&isMethod)topicEntry=methodAnchors.find(entry=>entry.pattern.test(text)) as {topic:PublicKnowledgeTopic}|undefined
  if(!topicEntry)return null
  if(isMethod){
    // Method queries carry no scope values: no year/region/institution/
    // programme from the user text - just topic+kind.
    return {topic:topicEntry.topic,questionKind:'method'}
  }
  const yearMatch=yearPattern.exec(text)
  const regionMatch=regionPattern.exec(text)
  const institutionMatch=institutionPattern.exec(text)
  const programmeMatch=programmePattern.exec(text)
  return {
    topic:topicEntry.topic,
    ...(yearMatch?{year:Number(yearMatch[1])}:{}),
    ...(regionMatch?{region:regionMatch[0]}:{}),
    ...(institutionMatch?{institution:institutionMatch[1]}:{}),
    ...(programmeMatch?{programme:programmeMatch[1]}:{}),
    questionKind:kindEntry?kindEntry.kind:'requirements',
  }
}
