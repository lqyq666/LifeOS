import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import type { CoreSlot } from './Core'
import { CognitionScene, type LandingInteraction } from '../../features/cognition/CognitionScene'
import { CognitionController } from '../../features/cognition/state.ts'
import { graph } from '../../features/cognition/graph.ts'
import { useOrbitInput } from '../../features/cognition/useOrbitInput'

export interface LifeFlywheelProps {
  core?: CoreSlot
  paused?: boolean
  reducedMotion?: boolean
  stage?: number
  className?: string
  controller: CognitionController
}

function supportsWebGL(){
  try{
    const canvas=document.createElement('canvas'),context=canvas.getContext('webgl2')
    if(!context)return false
    context.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  }catch{return false}
}

function SceneError({retry,controller}:{retry:()=>void;controller:CognitionController}) {
  const view=useSyncExternalStore(controller.subscribe,controller.getSnapshot)
  // There is no Canvas to finish the camera transition after WebGL failure.
  useEffect(()=>{if(view.transitioning)controller.update({transitioning:false})},[controller,view.transitioning])
  const nodes=graph.data.nodes.filter(node=>node.type!=='self'&&(!view.focusValueId||controller.candidates().includes(node.id)))
  return <div className="scene-error"><h2>三维空间暂时无法打开</h2><p>你仍可查看主题、经历与依据，也可以重试三维场景。</p>
    {view.mode!=='LANDING'&&view.mode!=='EXPERIENCE_DETAIL'&&<nav className="scene-fallback-records" aria-label="主题与经历列表">{nodes.length?nodes.map(node=><button key={node.id} onClick={()=>controller.open(node.id)}>{node.title}<span>{node.type==='value'?'查看主题':'阅读经历'} ↗</span></button>):<p>暂无有效关联，可返回全景查看其他主题。</p>}</nav>}
    <button onClick={retry}>重试三维场景</button></div>
}
class SceneBoundary extends Component<{children:ReactNode;onRetry:()=>void;controller:CognitionController},{failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?<SceneError controller={this.props.controller} retry={()=>{this.setState({failed:false});this.props.onRetry()}}/>:this.props.children}
}

export default function LifeFlywheel({core,paused=false,reducedMotion=false,stage=0,className='',controller}:LifeFlywheelProps) {
  const view=useSyncExternalStore(controller.subscribe,controller.getSnapshot)
  const host=useRef<HTMLDivElement>(null)
  const interaction=useRef<LandingInteraction>({x:0,y:0,dragging:false,lastX:0,lastY:0})
  const labels=useMemo(()=>new Map<string,HTMLElement>(),[])
  const [pageVisible,setPageVisible]=useState(!document.hidden)
  const [mobile,setMobile]=useState(()=>matchMedia('(max-width: 600px)').matches)
  const [attempt,setAttempt]=useState(0),[lost,setLost]=useState(()=>!supportsWebGL())
  const contextListeners=useRef<AbortController|null>(null)
  const orbitInput=useOrbitInput(controller)
  const landing=view.mode==='LANDING'
  const active=landing&&!view.transitioning&&!paused&&!reducedMotion&&pageVisible
  controller.reducedMotion=reducedMotion
  useEffect(()=>{
    const query=matchMedia('(max-width: 600px)')
    const resize=()=>setMobile(query.matches)
    const visibility=()=>{controller.hidden=document.hidden;controller.cancelDrag();interaction.current.dragging=false;setPageVisible(!document.hidden);if(!document.hidden)controller.invalidate()}
    query.addEventListener('change',resize);document.addEventListener('visibilitychange',visibility)
    return()=>{query.removeEventListener('change',resize);document.removeEventListener('visibilitychange',visibility);contextListeners.current?.abort()}
  },[controller])
  const retry=()=>{contextListeners.current?.abort();setLost(!supportsWebGL());setAttempt(n=>n+1)}
  return <div ref={host} className={`life-flywheel ${className}`} tabIndex={landing?0:-1} {...orbitInput}
    role="group" aria-label={landing?'交互式成长飞轮。拖动或使用方向键旋转，Home 键复位。':'认知空间。横向拖动沿轨道浏览，点击价值观或经历。'}
    onKeyDown={event=>{
      if(!landing)return
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key))return
      event.preventDefault()
      if(event.key==='Home'){interaction.current.x=0;interaction.current.y=0}
      if(event.key==='ArrowLeft')interaction.current.y-=0.15
      if(event.key==='ArrowRight')interaction.current.y+=0.15
      if(event.key==='ArrowUp')interaction.current.x-=0.1
      if(event.key==='ArrowDown')interaction.current.x+=0.1
      controller.restoreRuntime=undefined;controller.invalidate()
    }}
    onPointerDown={event=>{if(!landing)return;interaction.current.dragging=true;interaction.current.lastX=event.clientX;interaction.current.lastY=event.clientY;event.currentTarget.setPointerCapture(event.pointerId)}}
    onPointerMove={event=>{
      if(!landing||view.transitioning)return
      if(event.pointerType==='touch'&&!interaction.current.dragging)return
      const target=interaction.current
      if(target.dragging){target.y+=(event.clientX-target.lastX)*0.005;target.x=THREE.MathUtils.clamp(target.x+(event.clientY-target.lastY)*0.003,-0.5,0.5);target.lastX=event.clientX;target.lastY=event.clientY}
      else if(!reducedMotion){const bounds=event.currentTarget.getBoundingClientRect();target.y=((event.clientX-bounds.left)/bounds.width-0.5)*0.19;target.x=((event.clientY-bounds.top)/bounds.height-0.5)*0.1}
      controller.restoreRuntime=undefined;controller.invalidate()
    }}
    onPointerUp={event=>{if(!landing)return;interaction.current.dragging=false;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}}
    onPointerCancel={()=>{interaction.current.dragging=false;orbitInput.onPointerCancel()}}
    onLostPointerCapture={()=>{interaction.current.dragging=false;orbitInput.onLostPointerCapture()}}
    onPointerLeave={()=>{if(landing&&!interaction.current.dragging){interaction.current.x=0;interaction.current.y=0;controller.invalidate()}}}>
    {lost?<SceneError retry={retry} controller={controller}/>:<SceneBoundary onRetry={retry} controller={controller}>
      <Canvas key={attempt} resize={{debounce:0}} camera={{position:[0,0,14.3],fov:35,near:0.1,far:150}}
        dpr={mobile?[1,1.25]:[1,1.5]} frameloop={active?'always':'demand'}
        gl={{antialias:true,alpha:true,powerPreference:'high-performance',toneMapping:THREE.ACESFilmicToneMapping,toneMappingExposure:1.1}}
        fallback={null} onCreated={state=>{
          controller.invalidate=state.invalidate
          state.gl.setClearColor('#070910',0);state.gl.transmissionResolutionScale=mobile?0.5:0.65
          state.gl.domElement.dataset.instance=crypto.randomUUID();state.gl.domElement.dataset.renderer=crypto.randomUUID()
          contextListeners.current?.abort();contextListeners.current=new AbortController()
          state.gl.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();controller.stop();setLost(true)},{signal:contextListeners.current.signal})
        }}>
        <CognitionScene controller={controller} labels={labels} core={core} active={active} reducedMotion={reducedMotion} mobile={mobile} stage={stage} interaction={interaction}/>
      </Canvas>
      <div className="node-labels" aria-label="空间节点" inert={landing||view.transitioning||view.mode==='EXPERIENCE_DETAIL'}>
        {graph.data.nodes.map(node=>{
          // 类别色彩：卡住=orange、能力证据=green、外部反馈=cyan、经历=blue、主题=purple
          const category = node.type === 'value' ? 'theme'
            : node.type === 'self' ? 'self'
            : (node as any).blocked ? 'blocked'
            : Array.isArray((node as any).skillTags) && (node as any).skillTags.length > 0 ? 'skill'
            : (node as any).externalFeedback ? 'external'
            : 'experience'
          return <button key={node.id} hidden ref={el=>{if(el)labels.set(node.id,el);else labels.delete(node.id)}} data-node={node.id} data-type={node.type} data-category={category} data-focus-key={`node-${node.id}`} className="node-label"
          onPointerEnter={()=>{controller.hoverId=node.id;controller.invalidate()}}
          onPointerLeave={()=>{if(controller.hoverId===node.id){controller.hoverId=null;controller.invalidate()}}}
          onFocus={()=>{controller.hoverId=node.id;controller.invalidate()}}
          onBlur={()=>{if(controller.hoverId===node.id){controller.hoverId=null;controller.invalidate()}}}
          onClick={()=>controller.open(node.id)} aria-label={`${node.type==='experience'?'阅读':'聚焦'}${node.title}`}>
          <span className="node-label-title">{node.title}</span><span className="node-label-hint">{node.type==='experience'?'阅读记录 ↗':node.type==='value'?'探索经历 ↗':''}</span>
        </button>})}
      </div>
    </SceneBoundary>}
  </div>
}
