import { graph, type Reviews, type Review } from './graph.ts'
import { dampOrbit, nearestIndex, shortestAngle, snapPhase, TAU } from './orbit.ts'

export type Mode = 'LANDING' | 'OVERVIEW' | 'VALUE_FOCUS' | 'EXPERIENCE_DETAIL'
export type View = { mode: Mode; focusValueId: string | null; previewNodeId: string | null; activeRecordId: string | null; interpretationValueId: string | null; transitioning: boolean; serial: number; reviews: Reviews; storageError: string | null }
export type CameraSnapshot = { position: number[]; quaternion: number[]; fov: number; zoom: number; viewport: number[]; selfPosition: number[]; selfRotation: number[] }
export type Snapshot = { view: View; overviewPhase: number; valuePhases: Record<string,number>; runtime?: CameraSnapshot; trigger: string | null }

export class CognitionController {
  view: View = {mode:'LANDING',focusValueId:null,previewNodeId:null,activeRecordId:null,interpretationValueId:null,transitioning:false,serial:0,reviews:{},storageError:null}
  overviewPhase=0
  valuePhases: Record<string,number> = {}
  velocity=0
  snapTarget: number | null=null
  inertiaAge=0
  dragging=false
  reducedMotion=false
  hidden=false
  suppressClickUntil=0
  hoverId: string | null=null
  railTicks: HTMLElement | null=null
  navigationStack: Snapshot[]=[]
  restoreRuntime: CameraSnapshot | undefined
  capture: (()=>CameraSnapshot) | undefined
  invalidate=()=>{}
  private listeners=new Set<()=>void>()
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return ()=>{this.listeners.delete(fn)}}
  getSnapshot=()=>this.view
  update(patch: Partial<View>) {this.view={...this.view,...patch};this.listeners.forEach(fn=>fn());this.invalidate()}
  get backgroundMode() {return this.view.mode==='EXPERIENCE_DETAIL' ? this.navigationStack.at(-1)?.view.mode ?? 'OVERVIEW' : this.view.mode}
  candidates() {return this.view.focusValueId ? graph.getExperiencesForValue(this.view.focusValueId,this.view.reviews) : graph.values}
  get phase() {return this.view.focusValueId ? this.valuePhases[this.view.focusValueId] ?? 0 : this.overviewPhase}
  set phase(value:number) {if(this.view.focusValueId)this.valuePhases[this.view.focusValueId]=value;else this.overviewPhase=value}
  get interactive() {return !this.hidden && !this.view.transitioning && (this.view.mode==='OVERVIEW'||this.view.mode==='VALUE_FOCUS')}
  stop() {this.velocity=0;this.snapTarget=null;this.dragging=false;this.inertiaAge=0}
  private save(trigger:string|null) {
    this.stop()
    this.hoverId=null
    this.navigationStack.push({view:{...this.view,transitioning:false},overviewPhase:this.overviewPhase,valuePhases:{...this.valuePhases},runtime:this.capture?.(),trigger})
    this.restoreRuntime=undefined
  }
  enter(trigger='entry') {
    if(this.view.mode!=='LANDING'||this.view.transitioning)return
    this.save(trigger)
    this.update({mode:'OVERVIEW',previewNodeId:graph.values[nearestIndex(this.overviewPhase,graph.values.length)],transitioning:!this.reducedMotion,serial:this.view.serial+1})
  }
  open(id:string,trigger:string|null=null) {
    if(!this.interactive || Date.now()<this.suppressClickUntil)return
    const node=graph.getNode(id)
    if(!node||node.type==='self')return
    if(this.view.focusValueId && node.type==='experience' && !this.candidates().includes(id))return
    if(this.view.focusValueId && node.type==='value')return
    this.save(trigger ?? `node-${id}`)
    if(node.type==='value') {
      const candidates=graph.getExperiencesForValue(id,this.view.reviews)
      this.update({mode:'VALUE_FOCUS',focusValueId:id,previewNodeId:candidates[nearestIndex(this.valuePhases[id]??0,candidates.length)]??null,transitioning:!this.reducedMotion,serial:this.view.serial+1})
    } else this.update({mode:'EXPERIENCE_DETAIL',activeRecordId:id,interpretationValueId:this.view.focusValueId,serial:this.view.serial+1})
  }
  back() {
    const snapshot=this.navigationStack.pop()
    if(!snapshot)return
    this.stop()
    this.hoverId=null
    this.overviewPhase=snapshot.overviewPhase;this.valuePhases={...snapshot.valuePhases};this.restoreRuntime=snapshot.runtime
    const wasDetail=this.view.mode==='EXPERIENCE_DETAIL'
    this.update({...snapshot.view,reviews:this.view.reviews,storageError:this.view.storageError,transitioning:!wasDetail&&!this.reducedMotion,serial:this.view.serial+1})
    this.reconcilePreview()
    return snapshot.trigger
  }
  reconcilePreview() {
    const ids=this.candidates()
    if(this.view.mode!=='LANDING' && !ids.includes(this.view.previewNodeId??''))this.update({previewNodeId:ids[nearestIndex(this.phase,ids.length)]??null})
  }
  changeAngle(id:string) {
    if(this.view.activeRecordId && graph.getRelationExplanation(this.view.activeRecordId,id))this.update({interpretationValueId:id})
  }
  review(edgeId:string,review:Review,save:(reviews:Reviews)=>void) {
    const reviews={...this.view.reviews,[edgeId]:{...this.view.reviews[edgeId],...review}}
    try {save(reviews);this.update({reviews,storageError:null})}
    catch {this.update({storageError:'保存失败。请允许浏览器本地存储后重试；本次修改尚未保存。'});return false}
    if(this.view.mode!=='EXPERIENCE_DETAIL')this.reconcilePreview()
    return true
  }
  startDrag() {if(!this.interactive||this.candidates().length<2)return false;this.stop();this.dragging=true;return true}
  drag(dx:number,dt:number) {
    if(!this.dragging)return
    this.phase+=dx*0.009
    this.velocity=Math.max(-12,Math.min(12,dx*0.009/Math.max(dt,0.008)))
    this.updatePreview();this.invalidate()
  }
  release() {
    if(!this.dragging)return
    this.dragging=false;this.suppressClickUntil=Date.now()+250;this.inertiaAge=0
    if(Math.abs(this.velocity)<0.025){this.velocity=0;this.snapTarget=snapPhase(this.phase,this.candidates().length)}
    if(this.reducedMotion){this.velocity=0;this.phase=snapPhase(this.phase,this.candidates().length);this.updatePreview()}
    this.invalidate()
  }
  cancelDrag() {if(this.dragging)this.suppressClickUntil=Date.now()+250;this.stop();this.invalidate()}
  step(direction:number) {
    if(!this.interactive||this.candidates().length<2)return
    this.stop()
    const n=this.candidates().length,index=nearestIndex(this.phase,n)
    this.snapTarget=this.phase+shortestAngle(this.phase,-index*TAU/n)-direction*TAU/n
    if(this.reducedMotion){this.phase=this.snapTarget;this.snapTarget=null;this.updatePreview()}
    this.invalidate()
  }
  private updatePreview() {
    const ids=this.candidates(),id=ids[nearestIndex(this.phase,ids.length)]??null
    if(id!==this.view.previewNodeId)this.update({previewNodeId:id})
  }
  tick(dt:number) {
    if(this.hidden||this.dragging||!this.interactive)return false
    dt=Math.min(dt,0.05)
    if(Math.abs(this.velocity)>0.025&&this.inertiaAge<0.8) {
      const next=dampOrbit(this.phase,this.velocity,dt);this.phase=next.phase;this.velocity=next.velocity;this.inertiaAge+=dt
    } else {
      if(this.velocity!==0){this.velocity=0;this.snapTarget=snapPhase(this.phase,this.candidates().length)}
      if(this.snapTarget!==null) {
        this.phase+=(this.snapTarget-this.phase)*(1-Math.exp(-22*dt))
        if(Math.abs(this.snapTarget-this.phase)<0.00001){this.phase=this.snapTarget;this.snapTarget=null}
      }
    }
    this.updatePreview()
    return this.velocity!==0||this.snapTarget!==null
  }
}
