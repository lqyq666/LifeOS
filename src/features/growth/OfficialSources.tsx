import {useEffect,useState} from 'react'
import {api,explainError} from '../../backend/client'

type Source={id:string;revision:number;status:'fetched'|'partial'|'fetch_failed';synthetic:boolean;url:string;publisher:string;issuer:string;checkedAt:string;title:string|null;publishedOn:string|null;issuedOn:string|null;applicableYear:string|null;textPreview:string|null;unknowns:string[];attachments:{title:string;url:string;status:'not_read'}[];deadlines:{action:'registration'|'preregistration';startDate:string;endDate:string;status:'requires_review'}[];claims:{id:string;revision:number;status:string;title:string;claim:string;scope:string;limitations:string;validUntil:string|null}[]}
const statusLabels={fetched:'正文已读取 · 适用条件仍需核对',partial:'正文不完整 · 暂不作依据',fetch_failed:'本次读取失败 · 暂不作依据'}
export function OfficialSources(){
  const [sources,setSources]=useState<Source[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now())
  useEffect(()=>{let alive=true;api<{sources:Source[]}>('/api/official-sources').then(view=>{if(alive)setSources(view.sources)}).catch(reason=>{if(alive)setError(explainError(reason))});return()=>{alive=false}},[])
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer)},[])
  async function refresh(){if(busy)return;setBusy(true);try{setSources((await api<{sources:Source[]}>('/api/official-sources')).sources);setError('');setNow(Date.now())}catch(reason){setError(explainError(reason))}finally{setBusy(false)}}
  return <section className="growth-official" aria-label="官方资料与适用边界">
    <h2>官方资料与适用边界</h2>
    <button disabled={busy} onClick={()=>void refresh()}>{busy?'读取中…':'刷新资料状态'}</button>
    <p>国家时段和学校资格分开核对。读到正文不等于你符合报名条件；未读附件与未知范围不会被当作已确认依据。</p>
    {error&&<p role="status">{error}</p>}
    {!sources&&!error&&<p role="status">正在读取资料状态…</p>}
    {sources?.length===0&&<p>还没有完成来源读取和核验。不会用示例政策代替你的实际学校、年度或项目条件。</p>}
    {sources?.map(source=><article key={source.id} className="growth-card">
      <h3>{source.title??'官方来源待重新读取'}{source.synthetic?'（合成测试来源）':''}</h3>
      <p className={source.status==='fetched'?'':'growth-stale'}>{statusLabels[source.status]}</p>
      <p><a href={source.url} target="_blank" rel="noopener noreferrer">打开官方原文</a> · 来源版本 {source.revision}</p>
      <dl><dt>发布平台／发文机构</dt><dd>{source.publisher}／{source.issuer}</dd><dt>网页发布日期</dt><dd>{source.publishedOn??'未知'}</dd><dt>文件落款日期</dt><dd>{source.issuedOn??'未知'}</dd><dt>适用年度</dt><dd>{source.applicableYear??'未知，不推断为当前年度'}</dd><dt>最近读取</dt><dd>{new Date(source.checkedAt).toLocaleString('zh-CN')}</dd></dl>
      {source.status==='fetch_failed'&&<p>读取失败不代表政策没有发布。相关旧依据暂停使用，待重新读取并核验。</p>}
      {!!source.deadlines.length&&<details><summary>从原文识别的时间（待核验）</summary>{source.deadlines.map((event,index)=><p key={index}>{event.action==='preregistration'?'预报名':'正式报名'}：{event.startDate} 至 {event.endDate}。仍须核对省级安排与适用条件。</p>)}</details>}
      {!!source.attachments.length&&<details><summary>未读附件（{source.attachments.length}）</summary>{source.attachments.map((attachment,index)=><p key={index}><a href={attachment.url} target="_blank" rel="noopener noreferrer">{attachment.title||'官方附件'}</a> · 未读取，未认证附件内条件</p>)}</details>}
      {source.claims.map(claim=><div key={claim.id}><h4>{claim.title}</h4><p>{claim.status==='verified'&&claim.validUntil&&Date.parse(claim.validUntil)>now?'维护核验有效':claim.status==='expired'||claim.status==='verified'?'核验已过期':'依据已暂停，需重新核验'} · 命题版本 {claim.revision}</p><p>{claim.claim}</p><p>范围：{claim.scope}</p><p>限制：{claim.limitations}</p><p>核验有效至：{claim.validUntil?new Date(claim.validUntil).toLocaleString('zh-CN'):'未知'}</p></div>)}
      <details><summary>尚未核实的内容</summary><ul>{source.unknowns.map(item=><li key={item}>{item}</li>)}</ul></details>
      {source.textPreview&&<details><summary>已读正文片段</summary><p className="growth-source-preview">{source.textPreview}</p></details>}
    </article>)}
  </section>
}
