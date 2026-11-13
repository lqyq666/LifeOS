import {useEffect,useState} from 'react'
import {api,explainError} from '../../backend/client'
import {WorkspaceIcon as Icon} from './WorkspaceIcon'
import type {Message} from './flow'

type ReferenceView={recorded:boolean;items:{kind:'memory'|'experience'|'growth';id:string;text:string;source:string}[];unavailableCount:number;notice:string}
export function ReplyActions({message,disabled,copying,onCopy}:{message:Message;disabled:boolean;copying:boolean;onCopy:()=>Promise<boolean|void>}){
 const [open,setOpen]=useState(false),[view,setView]=useState<ReferenceView|null>(null),[error,setError]=useState('')
 const [copied,setCopied]=useState(false)
 useEffect(()=>{setCopied(false)},[message.sourceId])
 useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),2000);return()=>clearTimeout(timer)},[copied])
 useEffect(()=>{if(!open||!message.sourceId)return;let current=true;setView(null);setError('')
  api<ReferenceView>('/api/messages/'+message.sourceId+'/memory-references').then(value=>{if(current)setView(value)}).catch(e=>{if(current)setError(explainError(e))})
  return()=>{current=false}
 },[open,message.sourceId])
 const label=message.memoryReferenceCount===undefined?'记忆引用':`${message.memoryReferenceCount} 条记忆引用`
 const panelId='qa-references-'+(message.sourceId??message.id)
 return <>
  <div className="qa-reply-actions">
   <button type="button" className={copying?'is-copying':''} disabled={disabled} onClick={()=>{void onCopy().then(success=>{if(success)setCopied(true)})}} aria-label={copying?'正在复制完整回复':copied?'已复制完整回复':'复制完整回复'} title={copying?'正在复制…':copied?'已复制':'复制完整回复'}><Icon name={copied?'check':'copy'} size={18}/></button>
   <button type="button" disabled={disabled||!message.sourceId} aria-label={label} aria-expanded={open} aria-controls={panelId} title="查看本轮实际提供给模型的个人依据" onClick={()=>setOpen(value=>!value)}><Icon name="memory" size={19}/><span>{label}</span></button>
  </div>
  {open&&<section className="qa-references" id={panelId} aria-label="本轮记忆依据" onKeyDown={event=>{if(event.key==='Escape')setOpen(false)}}>
   {!view&&!error&&<p role="status">正在核对引用来源…</p>}
   {error&&<p role="alert">{error}</p>}
   {view&&<><p className="qa-references-note">{view.notice}</p><ul>{view.items.map(item=><li key={item.kind+item.id}><small>{item.kind==='memory'?'长期资料':item.kind==='experience'?'过往经历':'个人记录'} · {item.source}</small><p>{item.text}</p></li>)}</ul>{view.unavailableCount>0&&<p className="qa-references-note">{view.unavailableCount} 条依据已改变或不可用，未展示原文。</p>}{view.recorded&&!view.items.length&&!view.unavailableCount&&<p>本轮没有提供个人记忆依据。</p>}</>}
  </section>}
 </>
}
