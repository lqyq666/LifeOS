// Controlled corrections after reopening the originals. No status promotion.
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {kbHash} from '../server/evergreen-guide.ts'
const root=resolve('.planning/research/evergreen')
for(const name of ['KB_SOURCE_REGISTRY.jsonl','KB_SOURCE_REOPEN.jsonl']){
 const rows=readFileSync(resolve(root,name),'utf8').trim().split('\n').map(s=>JSON.parse(s)),ies=rows.find(s=>s.source_id==='ies-learning')
 const raw=readFileSync(resolve(tmpdir(),'lifeos-evergreen-source-review/ies-learning.txt'),'utf8')
 if(!raw.includes('Released: September 2007')||!raw.includes('Harold Pashler'))throw new Error('IES_METADATA_NOT_IN_ORIGINAL')
 ies.published_at='2007-09';ies.publication_date_precision='month';ies.author='Harold Pashler (Chair) and practice-guide panel';ies.author_locator='original body: panel listing'
 writeFileSync(resolve(root,name),rows.map(s=>JSON.stringify(s)).join('\n')+'\n')
}
for(const name of ['KB_EVIDENCE.jsonl','KB_EVIDENCE_REOPEN.jsonl']){
 const rows=readFileSync(resolve(root,name),'utf8').trim().split('\n').map(s=>JSON.parse(s))
 const ies=rows.find(e=>e.source_id==='ies-learning')
 const raw=readFileSync(resolve(tmpdir(),'lifeos-evergreen-source-review/ies-learning.txt'),'utf8')
 const snippets=['Space learning over time.','Interleave worked example solutions with problem-solving exercises.','Use quizzing to promote learning.','Ask deep explanatory questions.']
 if(snippets.some(s=>!raw.includes(s)))throw new Error('ORIGINAL_SNIPPET_MISSING')
 // 21 English words total from this original; surrounding context paraphrased.
 ies.quote=snippets.join('\n');ies.content_hash=kbHash(ies.quote)
 ies.locator={kind:'extracted_body_lines',lines:snippets.map(s=>raw.slice(0,raw.indexOf(s)).split('\n').length),reader_url:'https://ies.ed.gov/ncee/wwc/PracticeGuide/1'}
 ies.context='指南的四项推荐分别为分散学习、示例与独立练习交替、测验和解释性问题；大学生个人实施属于校园适配，不继承统一复习间隔。'
 const pdf=rows.find(e=>e.source_id==='tsinghua-efficiency');pdf.locator={...pdf.locator,kind:'pdf_page',page:12,visualChecked:true}
 const nsf=rows.find(e=>e.source_id==='nsf-interview'),nsfRaw=readFileSync(resolve(tmpdir(),'lifeos-evergreen-source-review/nsf-interview.txt'),'utf8'),nsfQuote='talking to potential customers, partners and other industry stakeholders'
 if(!nsfRaw.includes(nsfQuote))throw new Error('NSF_INTERVIEW_FRAGMENT_MISSING')
 nsf.quote=nsfQuote;nsf.content_hash=kbHash(nsf.quote);nsf.locator={...nsf.locator,line:nsfRaw.slice(0,nsfRaw.indexOf(nsfQuote)).split('\n').length}
 nsf.context='原段描述与潜在客户、合作伙伴及相关方交流，用访谈结果评估商业化潜力；不声称访谈人数或成功率。'
 const recovery=rows.find(e=>e.source_id==='situ-recovery'),recoveryRaw=readFileSync(resolve(tmpdir(),'lifeos-evergreen-source-review/situ-recovery.txt'),'utf8')
 if(!recoveryRaw.includes('勇敢求助'))throw new Error('RECOVERY_SOURCE_FRAGMENT_MISSING')
 recovery.quote='休息\n勇敢求助';recovery.content_hash=kbHash(recovery.quote)
 recovery.locator={kind:'extracted_body_lines',lines:['休息','勇敢求助'].map(s=>recoveryRaw.slice(0,recoveryRaw.indexOf(s)).split('\n').length),reader_url:recovery.locator.reader_url}
 recovery.context='原文生活平衡段提到休息，求助段提出在无法应对困扰时向学校老师、家人或朋友寻求支持；诊断和疗效内容不采用。'
 writeFileSync(resolve(root,name),rows.map(e=>JSON.stringify(e)).join('\n')+'\n')
}
console.log('Enriched locators and bounded source evidence; no approvals changed.')
