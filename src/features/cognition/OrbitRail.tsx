import { useSyncExternalStore } from 'react'
import { graph } from './graph.ts'
import type { CognitionController } from './state.ts'
import { useOrbitInput } from './useOrbitInput'

export function OrbitRail({controller}:{controller:CognitionController}) {
  const view=useSyncExternalStore(controller.subscribe,controller.getSnapshot)
  const input=useOrbitInput(controller),ids=controller.candidates()
  const node=view.previewNodeId?graph.getNode(view.previewNodeId):null
  return <div className="orbit-controls" aria-label="轨道浏览" inert={view.transitioning||view.mode==='EXPERIENCE_DETAIL'}>
    <p className="orbit-instruction">{ids.length>1?'横向滑动，让星点沿轨道运行':ids.length===1?'当前只有一条关联经历':'暂无有效关联，可返回全景继续浏览'}</p>
    <div className="orbit-rail-row">
      <button className="rail-step" aria-label="上一项" disabled={ids.length<2} onClick={()=>controller.step(-1)}>←</button>
      <div className="orbit-rail" tabIndex={ids.length>1?0:-1} role="group" aria-label="循环轨道，左右键浏览，Enter 打开" {...input}
        data-focus-key="rail" onKeyDown={event=>{
          if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();controller.step(event.key==='ArrowRight'?1:-1)}
          if(event.key==='Enter'&&view.previewNodeId){event.preventDefault();controller.open(view.previewNodeId,'rail')}
        }}>
        <div className="rail-ticks" ref={el=>{controller.railTicks=el}} aria-hidden="true">{Array.from({length:65},(_,i)=><i key={i} className={i%4===0?'major':''}/>)}</div>
        <span className="rail-marker" aria-hidden="true"/>
      </div>
      <button className="rail-step" aria-label="下一项" disabled={ids.length<2} onClick={()=>controller.step(1)}>→</button>
    </div>
    <button className="rail-preview" data-focus-key="preview" onClick={()=>view.previewNodeId&&controller.open(view.previewNodeId,'preview')} disabled={!node}>
      <span aria-live="polite">{node?.title??'关联待核对'}</span>{node&&<span aria-hidden="true">↗</span>}
    </button>
  </div>
}
