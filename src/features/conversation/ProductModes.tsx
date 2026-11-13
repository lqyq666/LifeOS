import {useState} from 'react'
import {WorkspaceIcon as Icon} from './WorkspaceIcon'
import {PRODUCT_MODES,productModeOpeningPrompt,type ProductMode} from './product-modes'
import './product-modes.css'

export function ProductModes({disabled,onSend}:{disabled:boolean;onSend:(text:string)=>void}){
 const [mode,setMode]=useState<ProductMode|null>(null)
 return <section className="qa-mode-entry" aria-label="LifeOS 三种模式">
  <div className="qa-mode-tabs" aria-label="选择服务模式">{PRODUCT_MODES.map(item=><button type="button" key={item.id} aria-pressed={mode===item.id} disabled={disabled} onClick={()=>{if(disabled)return;setMode(item.id);onSend(productModeOpeningPrompt(item.id))}}><Icon name={item.icon} size={18}/><span><strong>{item.title}</strong><small>{item.description}</small></span></button>)}</div>
 </section>
}
