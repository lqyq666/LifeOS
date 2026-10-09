import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { graph } from './graph.ts'
import type { CognitionController } from './state.ts'

export function nodeRing(id: string) {
  return graph.getNode(id)?.type === 'value' ? 0 : 1 + graph.experiences.indexOf(id) % 2
}

// Solid spheres and a procedural volume falloff. No image, text texture,
// billboard, or painted plane stands in for the satellite geometry.
export function SatelliteNode({id, registry, controller}: {id: string; registry: Map<string, THREE.Group>; controller: CognitionController}) {
  const root = useRef<THREE.Group>(null), node = graph.getNode(id)!, value = node.type === 'value'
  const radius = value ? 0.085 : 0.038
  // 类别色彩体系：卡住=橙、含能力证据=绿、含外部反馈=青、普通经历=蓝、主题=紫
  const isBlocked = !!(node as any).blocked
  const hasExternal = !!(node as any).externalFeedback
  const hasSkills = Array.isArray((node as any).skillTags) && (node as any).skillTags.length > 0
  const NODE_COLORS = { blocked: '#e8a04c', skill: '#7ed491', external: '#5cc8d4', experience: '#7ba7d4', theme: '#b89ad6' }
  const color = value
    ? NODE_COLORS.theme
    : isBlocked ? NODE_COLORS.blocked
    : hasSkills ? NODE_COLORS.skill
    : hasExternal ? NODE_COLORS.external
    : NODE_COLORS.experience
  const uniforms = useMemo(() => ({uColor: {value: new THREE.Color(color)}, uStrength: {value: 0.55}}), [color])
  // 新节点出现时短暂脉冲（类别色发光增强后回落），reduced-motion 不动。
  const bodyRef = useRef<THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>>(null)
  useEffect(() => {
    const material = bodyRef.current?.material
    if (!material || controller.reducedMotion) return
    const start = performance.now(), duration = 2400
    let raf = 0
    const pulse = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      material.emissiveIntensity = 0.65 + Math.sin(t * Math.PI) * 0.8
      controller.invalidate()
      if (t < 1) raf = requestAnimationFrame(pulse)
      else material.emissiveIntensity = 0.65
    }
    raf = requestAnimationFrame(pulse)
    return () => { cancelAnimationFrame(raf); material.emissiveIntensity = 0.65 }
  }, [controller])
  useEffect(() => {
    const object = root.current!
    registry.set(id, object)
    return () => { if (registry.get(id) === object) registry.delete(id) }
  }, [registry, id])
  return <group ref={root} name={id} visible={false} matrixAutoUpdate={false} userData={{contentId: id, ring: nodeRing(id), representation: 'satellite'}}
    onPointerOver={event => {if (root.current?.userData.interactive) {event.stopPropagation(); controller.hoverId = id; controller.invalidate()}}}
    onPointerOut={() => {if (controller.hoverId === id) {controller.hoverId = null; controller.invalidate()}}}
    onClick={event => {if (root.current?.userData.interactive) {event.stopPropagation(); controller.open(id)}}}>
    <group name="satellite-visual" matrixAutoUpdate={false}>
    <mesh name="satellite-body" ref={bodyRef}>
      <sphereGeometry args={[radius, 24, 16]}/>
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.65} metalness={0.2} roughness={0.3} transparent/>
    </mesh>
    <mesh name="satellite-corona" raycast={() => {}}>
      <sphereGeometry args={[radius * (value ? 4.5 : 5), 24, 16]}/>
      <shaderMaterial uniforms={uniforms} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending}
        vertexShader={`varying vec3 vNormal; varying vec3 vView;
          void main(){vec4 p=modelViewMatrix*vec4(position,1.0);
            vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`}
        fragmentShader={`uniform vec3 uColor;uniform float uStrength;varying vec3 vNormal;varying vec3 vView;
          void main(){float facing=max(0.0,dot(normalize(vNormal),normalize(vView)));
            float glow=pow(facing,5.0)*0.3+pow(facing,14.0)*0.22;
            gl_FragColor=vec4(uColor,glow*uStrength);}`}/>
    </mesh>
    </group>
    <mesh name="satellite-hit-target" visible={false}>
      <sphereGeometry args={[value ? 0.22 : 0.18, 12, 8]}/><meshBasicMaterial/>
    </mesh>
  </group>
}
