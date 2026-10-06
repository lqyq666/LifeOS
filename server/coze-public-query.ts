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
  {kind:'requirements',pattern:/(?:报名条件|资格|要求|条件|学历|专业要求)/},
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
  const topicEntry=topics.find(entry=>entry.pattern.test(text))
  if(!topicEntry)return null
  const kindEntry=questionKinds.find(entry=>entry.kind!=='method'&&entry.pattern.test(text))
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
