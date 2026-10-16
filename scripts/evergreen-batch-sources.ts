import {readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {load} from 'cheerio'
import {kbHash} from '../server/evergreen-guide.ts'
import {sourceSpecs} from './evergreen-seed.ts'
const out='.planning/research/evergreen/',cache=resolve(tmpdir(),'lifeos-long-batch-public-20261010')
export const additions=[
 ['sdu-career-interview','https://www.epe.sdu.edu.cn/ndxydjpy/info/1083/5666.htm','山东大学能源与动力工程学院','生涯人物','职业访谈是间接职业体验；不代表全行业或保证适配。'],
 ['usst-mentor-email','https://iso.usst.edu.cn/_upload/article/files/68/6c/84fdceb9492f9af1c70e00d39c8a/b8031ad4-2fe0-4bc4-8bf6-7b667c45e030.pdf','上海理工大学国际学生办公室','研究方向','导师自荐邮件的背景、兴趣与选择原因；不含申请资格规则。'],
 ['shu-career-choice','https://auto.shu.edu.cn/info/1126/77312.htm','上海大学机电工程与自动化学院','价值观','生涯决策中的个人价值与平衡；讲座实践建议不是效果研究。'],
 ['nankai-team','https://news.nankai.edu.cn/dcxy/system/2020/04/12/030038707.shtml','南开大学新闻网','分工','共同目标、工作、人、定位、权限、计划；不含科研验收标准。'],
 ['tsinghua-delay','https://learning.tsinghua.edu.cn/__local/E/06/1A/144F5F355805DC78E8BD394C2AD_32FE08A7_30B023.pdf','清华大学学生学习与发展指导中心','逆向日程','拖延的任务起点与失败管理；不诊断疾病或保证启动成功。'],
 ['cmu-exam-wrapper','https://www.cmu.edu/teaching/designteach/teach/examwrappers/','Carnegie Mellon Eberly Center','preparation time','练习/考试反思准备、错误与后续学习；不等同科研原因诊断；原页面CC BY-NC-SA，商业适配另核权限。'],
 ['mit-recommendation','https://capd.mit.edu/resources/recommendation-letter-request-form/','MIT CAPD','recommendation','请求推荐前准备关系、材料和明确请求；不外推国内招生要求。'],
 ['mit-information-interview','https://capd.mit.edu/resources/informational-interviewing/','MIT CAPD','informational','职业访谈的准备与联系；不是找首批付费用户或导师申请。'],
 ['mit-job-interview','https://capd.mit.edu/resources/interviewing/','MIT CAPD','interview','面试准备与反馈核对；不承诺录用或支持编造经历。'],
 ['mit-skills','https://capd.mit.edu/resources/transferable-skills/','MIT CAPD','skills','迁移能力与岗位证据；一次作品不证明长期适配。'],
 ['upwork-feedback','https://www.upwork.com/resources/managing-client-expectations','Upwork','feedback','范围、角色、交付、反馈与进度；实践建议，非合同效力或效果研究。'],
 ['upwork-communication','https://www.upwork.com/resources/client-communication','Upwork','deliverables','交付约定与反馈沟通；付款、采用、效果仍须本人各项报告。'],
 ['sufe-product-case','https://qks.sufe.edu.cn/mv_html/j00002/202107/17097900-7129-41e1-8c5f-61cdfa17bf3e_WEB.htm','上海财经大学期刊社','最小可行','陶瓷企业个案的需求与原型反馈；个案不外推成功率或平台流量秘诀。'],
 ['sspai-freelance-case','https://sspai.com/post/87056','少数派','需求','个人职业转向与独立业务反思；仅作者个人经验。'],
 ['gov-budget-tool','https://www.consumerfinance.gov/consumer-tools/educator-tools/your-money-your-goals/toolkit/','CFPB','income','收入、支出、现金流记录的工具；非投资建议、不含中国权利规则。'],
 ['stanford-lateral-reading','https://cor.stanford.edu/curriculum/','Stanford Civic Online Reasoning','lateral','判断信息来源与交叉核对；不代替专业资格判断。'],
 ['ncsc-phishing','https://www.ncsc.gov.uk/collection/phishing-scams','UK NCSC','phishing','可疑信息与敏感资料的安全核对；不推断中国合同权利。'],
 ['buffer-content','https://buffer.com/resources/content-strategy/','Buffer','audience','内容目标、受众与反馈；厂商实践建议，不保证平台推荐或增长。'],
 ['cornell-focus','https://lsc.cornell.edu/how-to-study/study-skills/','Cornell Learning Strategies Center','study','学习策略与任务安排；不诊断个人注意力或保证效率。'],
 ['csu-interview-clarify','https://mpb.csu.edu.cn/info/1116/1271.htm','中南大学资源加工与生物工程学院','将问题复述','面试提问不清时复述核对；不是录用保证。'],
 ['uibe-interview-unknown','https://aeo.uibe.edu.cn/front/showContent.jspa?channelId=641&contentId=4117','对外经济贸易大学就业网','不知为不知','个人面试经验强调诚实承认未知；不能推出必然被录用。'],
 ['htu-content-feedback','https://www.htu.edu.cn/stu/2026/0423/c9611a381156/page.htm','河南师范大学学生处','受众反馈','校园新闻实践重视受众反馈与真实性；不是全平台流量策略。'],
] as const
export async function acquireBatchSources(){
 mkdirSync(cache,{recursive:true});const previous=process.argv.includes('--ids')?JSON.parse(readFileSync(out+'KB_BATCH_SOURCE_READINGS.json','utf8')):{attempts:[],captures:[]},attempts:any[]=[...previous.attempts],captures:any[]=[...previous.captures]
 const ids=process.argv.includes('--ids')?process.argv[process.argv.indexOf('--ids')+1].split(','):null
 const specs=[...sourceSpecs.map(s=>({id:s.id,url:s.url,publisher:s.publisher,needle:s.quote,scope:s.supports,limit:s.excludes,existing:true})),...additions.map(([id,url,publisher,needle,scope])=>({id,url,publisher,needle,scope,limit:scope,existing:false}))].filter(s=>!ids||ids.includes(s.id))
 for(let n=0;n<specs.length;n+=4)await Promise.all(specs.slice(n,n+4).map(async s=>{
  const at=new Date().toISOString()
  try{
   const r=await fetch(s.url,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error('HTTP_'+r.status)
   const bytes=Buffer.from(await r.arrayBuffer());let body:string,title=s.publisher
   if(bytes.subarray(0,5).toString()==='%PDF-'){
    const file=resolve(cache,s.id+'.pdf');writeFileSync(file,bytes)
    const p=spawnSync('python',['-c','import sys,pymupdf; d=pymupdf.open(sys.argv[1]); print("\\n".join("PAGE "+str(i+1)+"\\n"+p.get_text() for i,p in enumerate(d)))',file],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},windowsHide:true,timeout:20000,maxBuffer:8*1024*1024});if(p.status!==0)throw new Error('PDF_READ_FAILED');body=p.stdout
   }else{
    const charset=/charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(r.headers.get('content-type')+' '+bytes.toString().slice(0,2500))?.[1]??'utf-8',html=new TextDecoder(charset).decode(bytes),$=load(html);title=$('title').text().trim()||s.publisher;$('script,style,noscript,nav,header,footer').remove();const node=new URL(s.url).hostname==='capd.mit.edu'?$('.entry-content').first():$('body');body=node.text().replace(/[ \t\r]+/g,' ').replace(/\n\s*\n/g,'\n')
   }
   const lower=body.toLowerCase(),offset=lower.indexOf(s.needle.toLowerCase());if(offset<0||body.length<150)throw new Error('REQUESTED_BODY_NOT_FOUND')
   writeFileSync(resolve(cache,s.id+'.txt'),body)
   // Reproduction ships a short located excerpt, never requires this temporary full body.
   const start=Math.max(0,offset-70),end=Math.min(body.length,offset+s.needle.length+230),excerpt=body.slice(start,end)
   captures.push({...s,title,at,bodySha256:kbHash(body),bodyLength:body.length,excerpt,excerptSha256:kbHash(excerpt),locator:{url:s.url,start,end,line:body.slice(0,start).split('\n').length,pdfPage:body.slice(0,start).match(/PAGE \d+/g)?.at(-1)??null},bodyRead:true,independentReview:null,humanApproval:null})
   attempts.push({id:s.id,url:s.url,at,status:'BODY_READ',bodyLength:body.length,bodySha256:kbHash(body)});console.log(JSON.stringify({id:s.id,status:'BODY_READ',length:body.length}))
  }catch(e){attempts.push({id:s.id,url:s.url,at,status:'FAILED',reason:e instanceof Error?e.message:'UNKNOWN'});console.log(JSON.stringify(attempts.at(-1)))}
 }))
 const sort=(a:any,b:any)=>a.id.localeCompare(b.id);writeFileSync(out+'KB_BATCH_SOURCE_READINGS.json',JSON.stringify({at:new Date().toISOString(),acquisition:'Agent-Reach Exa free limit, Jina401 retained; public original GET and cheerio/PyMuPDF. No video watched.',attempts:attempts.sort(sort),captures:captures.sort(sort),realModelCalls:0,cloudWrites:0},null,2)+'\n')
 return {attempted:specs.length,read:captures.length,failed:attempts.filter(a=>a.status==='FAILED').length}
}
if(process.argv.includes('--fetch'))console.log(JSON.stringify(await acquireBatchSources()))
