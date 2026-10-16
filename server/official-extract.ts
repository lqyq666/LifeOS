import {createHash} from 'node:crypto'
import {loadBuffer} from 'cheerio'
import {officialAttachmentUrl} from './official-fetch.ts'

export type RecommendationMilestone={action:'volunteer_application'|'interview_confirmation'|'admission_confirmation';startDate:string;endDate:string|null;startTime:string|null;sourceQuote:string;status:'requires_review'}
export type OfficialExtraction={status:'fetched'|'partial';hash:string;title:string;text:string;publishedOn:string|null;issuedOn:string|null;applicableYear:string|null;attachments:{title:string;url:string;status:'not_read'}[];deadlineCandidates:{action:'registration'|'preregistration';startDate:string;endDate:string;sourceQuote:string;status:'requires_review'}[];milestones?:RecommendationMilestone[];unknowns:string[]}
const dateSource='((?:\\d\\s*){4})年\\s*((?:\\d\\s*){1,2})月\\s*((?:\\d\\s*){1,2})日'
function date(match:RegExpMatchArray|null){
  if(!match)return null
  const value=[match[1],match[2],match[3]].map((part,index)=>part.replaceAll(/\s/g,'').padStart(index?2:4,'0')).join('-')
  return Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value?value:null
}
export function extractOfficialDocument(bytes:Buffer,url:string,contentType='text/html'):OfficialExtraction{
  const charset=/charset\s*=\s*([\w-]+)/i.exec(contentType)?.[1]
  const $=loadBuffer(bytes,{encoding:{defaultEncoding:'utf-8',...(charset?{transportLayerEncodingLabel:charset}:{})}})
  $('script,style,noscript,iframe,nav,footer').remove()
  const title=($('h1').first().text()||$('h2').first().text()||$('title').text()).replace(/\s+/g,' ').trim()
  const isRecommendation=new URL(url).hostname==='yz.chsi.com.cn'&&new URL(url).pathname==='/tm/'
  const adapter=isRecommendation?$('.top-right-content').first():new URL(url).hostname==='yz.chsi.com.cn'?$('.detail[id^="article_"]').first():new URL(url).hostname==='www.zjzs.net'?$('.zjhz-article-main_section').first():null
  const article=adapter?.length?adapter:$('article,.TRS_Editor,#zoom,.news-content,.article-content,.content-article,.news-text').first()
  article.find('br').replaceWith('\n');article.find('p,div,li').append('\n')
  const bodyText=article.text().replace(/[\t\r\u00a0 ]+/g,' ').replace(/\n\s*\n/g,'\n').trim()
  const text=bodyText.includes(title)?bodyText:[title,bodyText].filter(Boolean).join('\n')
  const pageText=$('body').text().replace(/[\t\r\u00a0 ]+/g,' ').trim()
  const publishedMeta=$('meta[name="PubDate"],meta[name="pubdate"],meta[name="publishdate"],meta[property="article:published_time"]').first().attr('content')
  const iso=publishedMeta?.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1]
  const publishedOn=iso&&Number.isFinite(Date.parse(iso))&&new Date(iso).toISOString().slice(0,10)===iso?iso:date(pageText.match(new RegExp('(?:发布时间|发布日期)[：:]?\\s*'+dateSource)))??date(pageText.match(new RegExp(dateSource+'\\s*来源[：:]')))
  const issuedOn=date(text.match(new RegExp('(?:教\\s*育\\s*部|浙江省教育考试院)\\s*'+dateSource)))
  const years=[...new Set(isRecommendation?[...bodyText.matchAll(/(20\d{2})年推免生于/g)].map(match=>match[1]):[...title.matchAll(/(20\d{2})年/g)].map(match=>match[1]))]
  const attachments:OfficialExtraction['attachments']=[]
  article.find('a[href]').each((_index,node)=>{
    try{const link=officialAttachmentUrl(new URL($(node).attr('href')!,url).href);if(/\.(?:pdf|docx?|xlsx?)(?:$)/i.test(link.pathname)||link.pathname==='/module/download/downfile.jsp')attachments.push({title:$(node).text().trim(),url:link.href,status:'not_read'})}catch{}
  })
  const deadlineCandidates:OfficialExtraction['deadlineCandidates']=[]
  for(const match of text.matchAll(/(预报名|报名)时间为(20\d{2})年(\d{1,2})月(\d{1,2})日至(?:(20\d{2})年)?(?:(\d{1,2})月)?(\d{1,2})日/g)){
    const startDate=`${match[2]}-${match[3].padStart(2,'0')}-${match[4].padStart(2,'0')}`,endDate=`${match[5]??match[2]}-${(match[6]??match[3]).padStart(2,'0')}-${match[7].padStart(2,'0')}`
    if([startDate,endDate].every(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value)&&endDate>=startDate)deadlineCandidates.push({action:match[1]==='预报名'?'preregistration':'registration',startDate,endDate,sourceQuote:match[0],status:'requires_review'})
  }
  const unknowns=['个人资格和具体学校/项目条件尚未核实','范围与期限候选仍须维护核验']
  const milestones:RecommendationMilestone[]=[]
  if(isRecommendation&&years.length===1){
    const valid=(value:string)=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value
    const application=bodyText.match(/20\d{2}年推免生于(20\d{2})年(\d{1,2})月(\d{1,2})日至(\d{1,2})月(\d{1,2})日，可自主[^。]*填写[^。]*报考志愿/)
    if(application){const startDate=`${application[1]}-${application[2].padStart(2,'0')}-${application[3].padStart(2,'0')}`,endDate=`${application[1]}-${application[4].padStart(2,'0')}-${application[5].padStart(2,'0')}`;if(valid(startDate)&&valid(endDate)&&endDate>=startDate)milestones.push({action:'volunteer_application',startDate,endDate,startTime:null,sourceQuote:application[0],status:'requires_review'})}
    const paragraph=bodyText.split('\n').map(line=>line.trim()).find(line=>/^（二）20\d{2}年/.test(line))
    const year=paragraph?.match(/^（二）(20\d{2})年/)?.[1]
    if(paragraph&&year&&new Set([...paragraph.matchAll(/(20\d{2})年/g)].map(match=>match[1])).size===1)for(const match of paragraph.matchAll(/(\d{1,2})月(\d{1,2})日(\d{1,2}):(\d{2})开始确认招生单位发送的(复试|待录取)通知/g)){
      const startDate=`${year}-${match[1].padStart(2,'0')}-${match[2].padStart(2,'0')}`,startTime=match[3].padStart(2,'0')+':'+match[4]
      if(valid(startDate)&&Number(match[3])<24&&Number(match[4])<60)milestones.push({action:match[5]==='复试'?'interview_confirmation':'admission_confirmation',startDate,startTime,endDate:null,sourceQuote:paragraph,status:'requires_review'})
    }
    unknowns.push('复试及待录取具体通知的确认截止未知，不把平台总体窗口当各通知截止','本校推荐资格及招生单位接收办法尚未核实')
  }
  if(!publishedOn)unknowns.push('发布日期未知');if(!issuedOn)unknowns.push('文件落款日期未知');if(years.length!==1)unknowns.push('适用年度未知');if(attachments.length)unknowns.push('附件未读取，不能推断附件内条件')
  return {status:bodyText.length>=60?'fetched':'partial',hash:createHash('sha256').update(bytes).digest('hex'),title,text,publishedOn,issuedOn,applicableYear:years.length===1?years[0]:null,attachments,deadlineCandidates,...(isRecommendation?{milestones}:{}),unknowns}
}
