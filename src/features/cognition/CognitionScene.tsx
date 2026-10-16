import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FlywheelModel, type RingRig } from '../../components/three/FlywheelModel'
import { FLYWHEEL_RINGS, OPEN_RING_ROTATIONS, FOCUS_RING_ROTATIONS, ringSeat } from '../../components/three/flywheelRings.ts'
import { FlywheelEnvironment, ReflectionFloor } from '../../components/three/FlywheelEnvironment'
import type { CoreSlot } from '../../components/three/Core'
import { SatelliteNode, nodeRing } from './SatelliteNode'
import { graph } from './graph.ts'
import { mod, TAU } from './orbit.ts'
import type { CognitionController } from './state.ts'

export type LandingInteraction={x:number;y:number;dragging:boolean;lastX:number;lastY:number}
type Pose={position:THREE.Vector3;scale:THREE.Vector3;quaternion:THREE.Quaternion}
const pose=(matrix:THREE.Matrix4):Pose=>{
  const p={position:new THREE.Vector3(),scale:new THREE.Vector3(),quaternion:new THREE.Quaternion()}
  matrix.decompose(p.position,p.quaternion,p.scale);return p
}
const noRaycast=()=>{}

export function CognitionScene({controller,labels,active,reducedMotion,mobile,interaction,core,stage=0}: {
  controller:CognitionController;labels:Map<string,HTMLElement>;active:boolean;reducedMotion:boolean;mobile:boolean;
  interaction:RefObject<LandingInteraction>;core?:CoreSlot;stage?:number
}) {
  const {camera:baseCamera,size,invalidate,gl,scene}=useThree()
  const camera=baseCamera as THREE.PerspectiveCamera
  const self=useRef<THREE.Group>(null),model=useRef<THREE.Group>(null),floor=useRef<THREE.Group>(null)
  const registry=useMemo(()=>new Map<string,THREE.Group>(),[]),rigs=useMemo(()=>new Map<number,RingRig>(),[])
  const elapsed=useRef(0),intro=useRef(0),serial=useRef(-1),transitionTime=useRef(0)
  const startPoses=useRef(new Map<string,Pose>()),startRings=useRef(new Map<number,THREE.Quaternion>())
  const startModel=useRef<Pose>(pose(new THREE.Matrix4()))
  const startCamera=useRef({position:camera.position.clone(),quaternion:camera.quaternion.clone()})
  const tmp=useMemo(()=>({p:new THREE.Vector3(),q:new THREE.Quaternion(),s:new THREE.Vector3(),project:new THREE.Vector3(),camera:new THREE.PerspectiveCamera(),from:new THREE.Vector3(),to:new THREE.Vector3(),local:new THREE.Matrix4(),world:new THREE.Matrix4(),inverse:new THREE.Matrix4(),rotation:new THREE.Euler(),axis:new THREE.Vector3(0,0,1),target:pose(new THREE.Matrix4())}),[])
  const relations=useMemo(()=>graph.data.edges.map(edge=>{
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3))
    geometry.setAttribute('lineDistance',new THREE.BufferAttribute(new Float32Array(2),1))
    const params={color:graph.getNode(edge.targetId)?.accent??'#9c93be',transparent:true,opacity:0.06,depthWrite:false}
    const material=edge.type==='HAS_VALUE'?new THREE.LineBasicMaterial(params):new THREE.LineDashedMaterial({...params,dashSize:0.075,gapSize:0.065})
    const line=new THREE.Line(geometry,material)
    line.name=edge.id;line.frustumCulled=false;line.raycast=noRaycast;return line
  }),[graph.data])
  useEffect(()=>()=>{relations.forEach(l=>{l.geometry.dispose();l.material.dispose()});delete window.__lifeosInspect},[relations])
  useEffect(()=>{
    registry.set(graph.data.rootId,self.current!)
    controller.invalidate=invalidate
    controller.capture=()=>({position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,zoom:camera.zoom,viewport:[size.width,size.height],selfPosition:model.current!.position.toArray(),selfRotation:model.current!.rotation.toArray().slice(0,3) as number[]})
    return()=>{controller.capture=undefined}
  },[controller,camera,invalidate,registry,size])

  useFrame((_,rawDelta)=>{
    if(!model.current||!self.current||rigs.size!==3)return
    const view=controller.view,mode=controller.backgroundMode,landing=mode==='LANDING'
    const step=Math.min(rawDelta,0.05)
    let moving=controller.tick(step)
    if(serial.current!==view.serial) {
      serial.current=view.serial;transitionTime.current=0
      scene.updateMatrixWorld(true)
      startPoses.current=new Map([...registry].map(([id,o])=>[id,pose(o.matrixWorld)]))
      startRings.current=new Map([...rigs].map(([i,r])=>[i,r.frame.quaternion.clone()]))
      startModel.current=pose(model.current.matrix)
      startCamera.current={position:camera.position.clone(),quaternion:camera.quaternion.clone()}
    }
    if(!controller.hidden)transitionTime.current+=step
    const t=view.transitioning ? Math.min(transitionTime.current/0.85,1) : 1,ease=1-Math.pow(1-t,3)
    if(landing&&active&&!view.transitioning)elapsed.current+=step
    if(landing&&(active||reducedMotion)&&!view.transitioning)intro.current=reducedMotion?3:intro.current+step
    const homeZ=13.8-(1-Math.pow(1-Math.min(intro.current/2.7,1),3))*2.8,restore=controller.restoreRuntime
    if(landing) {
      tmp.camera.position.set(0,0.75,homeZ);tmp.camera.lookAt(0,-0.48,0)
      if(restore){tmp.camera.position.fromArray(restore.position);tmp.camera.quaternion.fromArray(restore.quaternion)}
    } else {
      const aspect=size.width/size.height
      const distance=Math.max(16.7,5.7/(Math.tan(35*Math.PI/360)*aspect))
      tmp.camera.position.set(0,0.4,distance);tmp.camera.lookAt(0,0,0)
      if(restore&&restore.viewport[0]===size.width&&restore.viewport[1]===size.height){tmp.camera.position.fromArray(restore.position);tmp.camera.quaternion.fromArray(restore.quaternion)}
    }
    camera.position.copy(startCamera.current.position).lerp(tmp.camera.position,ease)
    camera.quaternion.copy(startCamera.current.quaternion).slerp(tmp.camera.quaternion,ease)
    camera.fov=restore?.fov??35;camera.zoom=restore?.zoom??1;camera.far=landing?50:150;camera.updateProjectionMatrix();camera.updateMatrixWorld()

    // The original assembly opens up. The very same three ribbon meshes remain
    // the content tracks. Only content phase changes when the user slides.
    tmp.p.set(0,landing?Math.sin(elapsed.current*0.38)*0.045:0,0);tmp.q.identity();tmp.s.setScalar(landing?1:1.72)
    if(landing) {
      if(!view.transitioning){model.current.rotation.x=active?THREE.MathUtils.damp(model.current.rotation.x,interaction.current.x,3,step):interaction.current.x;model.current.rotation.y=active?THREE.MathUtils.damp(model.current.rotation.y,interaction.current.y,3,step):interaction.current.y}
      tmp.q.copy(model.current.quaternion)
      if(restore&&view.transitioning){tmp.p.fromArray(restore.selfPosition);tmp.q.setFromEuler(tmp.rotation.set(...restore.selfRotation as [number,number,number]))}
    }
    model.current.position.copy(startModel.current.position).lerp(tmp.p,ease)
    model.current.quaternion.copy(startModel.current.quaternion).slerp(tmp.q,ease)
    model.current.scale.copy(startModel.current.scale).lerp(tmp.s,ease)
    rigs.forEach((rig,index)=>{
      const rotations=mode==='VALUE_FOCUS'?FOCUS_RING_ROTATIONS:OPEN_RING_ROTATIONS
      if(landing)tmp.q.copy(rig.home);else tmp.q.setFromEuler(tmp.rotation.set(rotations[index][0],rotations[index][1],rotations[index][2],'ZYX'))
      rig.frame.quaternion.copy(startRings.current.get(index)??tmp.q).slerp(tmp.q,ease)
    })
    model.current.updateMatrixWorld(true)
    const layoutReviews=view.mode==='EXPERIENCE_DETAIL' ? controller.navigationStack.at(-1)?.view.reviews??view.reviews : view.reviews
    const focusIds=view.focusValueId?graph.getExperiencesForValue(view.focusValueId,layoutReviews):[]
    const effectiveEdges=graph.effectiveEdges(view.reviews),effective=new Set(effectiveEdges.map(e=>e.id))
    const activeNode=controller.hoverId??view.activeRecordId??view.previewNodeId
    const connected=new Set<string>(activeNode?[activeNode]:[])
    effectiveEdges.forEach(edge=>{if(edge.sourceId===activeNode||edge.targetId===activeNode){connected.add(edge.sourceId);connected.add(edge.targetId)}})
    for(const [id,root] of registry) {
      const node=graph.getNode(id)
      if(!node||!root.parent)continue
      const isSelf=node.type==='self'
      let visible=true,scale=1,attached=!isSelf
      tmp.q.identity();tmp.p.set(0,0,0)
      if(isSelf) {visible=landing||mode==='OVERVIEW';scale=visible?(landing?1:0.45):0.001;attached=false}
      else {
        const ids=node.type==='value'?graph.values:mode==='VALUE_FOCUS'?focusIds:graph.experiences,index=ids.indexOf(id)
        const angle=Math.PI/2+Math.max(0,index)*TAU/Math.max(1,ids.length)+(mode==='VALUE_FOCUS'?controller.phase:controller.overviewPhase)
        tmp.p.fromArray(ringSeat(FLYWHEEL_RINGS[nodeRing(id)].radius,angle));tmp.q.setFromAxisAngle(tmp.axis,angle-Math.PI/2)
        root.userData.seatAngle=angle
        visible=!landing&&index>=0
        if(node.type==='value'&&mode==='VALUE_FOCUS'){visible=id===view.focusValueId;attached=false}
        if(!visible)scale=0.001
      }
      tmp.s.setScalar(scale);tmp.local.compose(tmp.p,tmp.q,tmp.s)
      tmp.world.multiplyMatrices(root.parent!.matrixWorld,tmp.local)
      if(!isSelf&&node.type==='value'&&mode==='VALUE_FOCUS') {
        tmp.p.set(0,0,0);tmp.q.setFromEuler(tmp.rotation.set(0.15,-0.2,0));tmp.s.setScalar(visible?2.05:0.001)
        tmp.world.compose(tmp.p,tmp.q,tmp.s)
      }
      const start=startPoses.current.get(id)
      if(start&&t<1) {
        tmp.world.decompose(tmp.target.position,tmp.target.quaternion,tmp.target.scale)
        tmp.p.copy(start.position).lerp(tmp.target.position,ease);tmp.q.copy(start.quaternion).slerp(tmp.target.quaternion,ease);tmp.s.copy(start.scale).lerp(tmp.target.scale,ease)
        tmp.world.compose(tmp.p,tmp.q,tmp.s)
      }
      // Retain full matrices: decomposing the inner ring's ellipse would lose
      // its inherited shear and cause nodes to drift from the original orbit.
      root.matrixAutoUpdate=false;root.matrix.multiplyMatrices(tmp.inverse.copy(root.parent!.matrixWorld).invert(),tmp.world)
      root.matrixWorldNeedsUpdate=true;root.updateMatrixWorld(true)
      root.visible=visible||(t<1&&tmp.s.x>0.01)
      const satellite=root.getObjectByName('satellite-visual')
      if(satellite){
        // The original inner track is stretched into an ellipse. Its path is
        // inherited, but planetary bodies must remain round instead of sheared.
        const uniformScale=Math.cbrt(Math.abs(root.matrixWorld.determinant())/(node.type==='value'&&attached?1.38:1))
        root.getWorldPosition(tmp.p);tmp.q.identity();tmp.s.setScalar(uniformScale);tmp.world.compose(tmp.p,tmp.q,tmp.s)
        satellite.matrix.multiplyMatrices(tmp.inverse.copy(root.matrixWorld).invert(),tmp.world)
        satellite.matrixWorldNeedsUpdate=true;satellite.updateMatrixWorld(true)
      }
      root.userData.attached=attached&&visible;root.userData.interactive=visible&&!view.transitioning&&view.mode!=='EXPERIENCE_DETAIL'&&!isSelf
      if(!isSelf)root.traverse(o=>{
        if(o instanceof THREE.Mesh){
          o.raycast=root.userData.interactive&&o.name!=='satellite-corona'?THREE.Mesh.prototype.raycast:noRaycast
          const primary=id===activeNode,related=connected.has(id)
          if(o.material instanceof THREE.MeshStandardMaterial){o.material.emissiveIntensity=primary?1.15:related?0.8:0.35;o.material.opacity=primary||related?1:0.66}
          if(o.material instanceof THREE.ShaderMaterial&&o.material.uniforms.uStrength)o.material.uniforms.uStrength.value=primary?1.25:related?0.85:0.3
        }
      })
    }
    if(floor.current){floor.current.visible=landing||t<1;floor.current.scale.setScalar(landing?1:1-ease)}
    relations.forEach(line=>{
      const edge=graph.data.edges.find(edge=>edge.id===line.name)
      if(!edge){line.visible=false;return}
      const source=registry.get(edge.sourceId),target=registry.get(edge.targetId)
      line.visible=!landing&&t>0.5&&effective.has(edge.id)&&!!source?.visible&&!!target?.visible
      if(!line.visible||!source||!target)return
      source.getWorldPosition(tmp.from);target.getWorldPosition(tmp.to)
      const positions=line.geometry.getAttribute('position') as THREE.BufferAttribute
      positions.setXYZ(0,tmp.from.x,tmp.from.y,tmp.from.z);positions.setXYZ(1,tmp.to.x,tmp.to.y,tmp.to.z);positions.needsUpdate=true
      const distances=line.geometry.getAttribute('lineDistance') as THREE.BufferAttribute
      distances.setX(0,0);distances.setX(1,tmp.from.distanceTo(tmp.to));distances.needsUpdate=true
      const highlighted=edge.targetId===activeNode||edge.sourceId===activeNode
      line.material.opacity=highlighted?0.5:edge.type==='HAS_VALUE'?0.17:mode==='VALUE_FOCUS'?0.15:0.035
    })
    const occupied:{x:number;y:number;w:number;h:number}[]=[]
    const labelOrder=[...registry].sort(([a],[b])=>{
      const priority=(id:string)=>id===controller.hoverId?6:id===view.activeRecordId?5:id===view.previewNodeId?4:graph.getNode(id)?.type==='value'?3:graph.getNode(id)?.type==='self'?2:1
      return priority(b)-priority(a)
    })
    for(const [id,root] of labelOrder) {
      const element=labels.get(id)
      if(!element)continue
      const node=graph.getNode(id)
      if(!node||!root.parent){element.hidden=true;continue}
      const isSelf=node.type==='self',selected=id===view.previewNodeId||id===view.activeRecordId||id===controller.hoverId
      root.getWorldPosition(tmp.project);const depth=tmp.project.z;tmp.project.project(camera)
      // Measure the current title and hint, including labels hidden by the previous frame.
      element.hidden=false
      element.dataset.selected=String(selected)
      const w=element.offsetWidth,h=element.offsetHeight
      const x=THREE.MathUtils.clamp((tmp.project.x+1)*size.width/2,w/2+8,size.width-w/2-8),y=(1-tmp.project.y)*size.height/2+(isSelf?39:node.type==='value'?18:9)
      const centerY=y+h/2
      const overlaps=occupied.some(r=>Math.abs(r.x-x)<(r.w+w)/2+4&&Math.abs(r.y-centerY)<(r.h+h)/2+3)
      const show=!landing&&!view.transitioning&&root.visible&&tmp.project.z<1&&!overlaps
      element.hidden=!show
      element.style.transform=`translate3d(${x}px,${y}px,0) translate(-50%,0)`
      element.style.opacity=String(selected||isSelf?1:THREE.MathUtils.clamp(0.72+depth*0.08,0.4,0.92))
      element.style.zIndex=String(selected?30:Math.round(depth+10))
      element.dataset.selected=String(selected);element.dataset.depth=tmp.project.z.toFixed(5)
      if(element instanceof HTMLButtonElement)element.disabled=view.mode==='EXPERIENCE_DETAIL'||isSelf||id===view.focusValueId
      if(show)occupied.push({x,y:centerY,w,h})
    }
    if(t===1&&view.transitioning){controller.update({transitioning:false});moving=true}
    if(controller.railTicks)controller.railTicks.style.transform=`translateX(${-mod(controller.phase*70,32)}px)`
    if(view.transitioning||moving)invalidate()
    window.__lifeosInspect=()=>({mode:controller.view.mode,transitioning:controller.view.transitioning,phase:controller.phase,overviewPhase:controller.overviewPhase,valuePhases:{...controller.valuePhases},preview:controller.view.previewNodeId,focus:controller.view.focusValueId,record:controller.view.activeRecordId,angle:controller.view.interpretationValueId,stackDepth:controller.navigationStack.length,velocity:controller.velocity,
      canvas:gl.domElement.dataset.instance,renderer:gl.domElement.dataset.renderer,three:THREE.REVISION,webgl2:gl.getContext() instanceof WebGL2RenderingContext,
      camera:{position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,zoom:camera.zoom},viewport:[size.width,size.height],
      rings:[...rigs].map(([index,r])=>({index,radius:FLYWHEEL_RINGS[index].radius,uuid:r.surface.uuid,meshUuid:r.surface.children.find(o=>o instanceof THREE.Mesh)?.uuid,opacity:r.surface.userData.orbitOpacity,matrixWorld:r.surface.matrixWorld.toArray()})),
      nodes:[...registry].filter(([id,o])=>o.parent&&graph.getNode(id)).map(([id,o])=>({id,uuid:o.uuid,visible:o.visible,ring:o.userData.ring,attached:o.userData.attached,parentUuid:o.parent?.uuid,representation:o.userData.representation,primitive:(o.getObjectByName('satellite-body') as THREE.Mesh|undefined)?.geometry.type,visualMatrix:o.getObjectByName('satellite-visual')?.matrixWorld.toArray(),textureMaps:(o.getObjectByName('satellite-body') as THREE.Mesh<THREE.BufferGeometry,THREE.MeshStandardMaterial>|undefined)?.material.map?1:0,world:o.getWorldPosition(new THREE.Vector3()).toArray(),projected:o.getWorldPosition(new THREE.Vector3()).project(camera).toArray(),matrixWorld:o.matrixWorld.toArray(),ringLocal:o.parent!.worldToLocal(o.getWorldPosition(new THREE.Vector3())).toArray(),normal:new THREE.Vector3(0,0,1).transformDirection(o.matrixWorld).toArray()})),
      edges:relations.filter(l=>l.visible).map(l=>({id:l.name,dashed:l.material instanceof THREE.LineDashedMaterial,opacity:l.material.opacity,positions:Array.from((l.geometry.getAttribute('position') as THREE.BufferAttribute).array)})),
      resources:{...gl.info.memory,programs:gl.info.programs?.length},sceneChildren:scene.children.length})
  },-10)
  return <>
    <FlywheelEnvironment />
    <group ref={model} name="persistent-flywheel">
      <FlywheelModel core={core} coreRef={self} rigs={rigs} landing={controller.backgroundMode==='LANDING'} active={active&&controller.view.mode==='LANDING'&&!controller.view.transitioning} stage={stage} mobile={mobile}
        ringContent={index=>[...graph.values,...graph.experiences].filter(id=>nodeRing(id)===index).map(id=><SatelliteNode key={id} id={id} registry={registry} controller={controller}/>)}/>
    </group>
    <group ref={floor}><ReflectionFloor mobile={mobile} enabled={controller.view.mode==='LANDING'||controller.view.transitioning}/></group>
    {relations.map(line=><primitive key={line.name} object={line}/>)}
    <RenderCoordinator />
  </>
}

declare global { interface Window { __lifeosInspect?:()=>unknown; __lifeosMetrics?:Record<string,unknown> } }

function RenderCoordinator() {
  const frames=useRef(0),samples=useRef<number[]>([]),previous=useRef(0)
  useFrame(({gl})=>{gl.info.autoReset=false;gl.info.reset()},-100)
  useFrame(({gl,scene,camera},delta)=>{
    gl.render(scene,camera);frames.current++
    const now=performance.now()
    // Full intervals, including slow frames. Demand-idle intervals are explicitly labelled.
    samples.current.push(previous.current?now-previous.current:delta*1000);previous.current=now
    if(samples.current.length>240)samples.current.shift()
    const sorted=[...samples.current].sort((a,b)=>a-b),context=gl.getContext(),ext=context.getExtension('WEBGL_debug_renderer_info')
    window.__lifeosMetrics={frames:frames.current,drawCalls:gl.info.render.calls,triangles:gl.info.render.triangles,dpr:gl.getPixelRatio(),renderer:ext?context.getParameter(ext.UNMASKED_RENDERER_WEBGL):context.getParameter(context.RENDERER),sampleCount:sorted.length,meanIntervalMs:samples.current.reduce((a,b)=>a+b,0)/samples.current.length,p95IntervalMs:sorted[Math.floor((sorted.length-1)*0.95)],maxIntervalMs:sorted.at(-1),sampling:'All rendered-frame intervals, including demand-idle and slow frames; not device FPS',passes:'Includes reflection and transmission passes'}
  },1)
  return null
}
