import { Suspense, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'
import * as THREE from 'three'
import { CrystalCore, type CoreSlot } from './Core'

import { FLYWHEEL_RINGS as RINGS } from './flywheelRings.ts'

export type RingRig = {frame: THREE.Group; surface: THREE.Group; home: THREE.Quaternion}

const haloVertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`
const haloFragment = `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uOpacity;
  void main() {
    float d = length((vUv - 0.5) * 2.0);
    float glow = exp(-d * d * 6.5) * (1.0 - smoothstep(0.45, 1.0, d));
    gl_FragColor = vec4(uColor, glow * uOpacity);
  }
`

function Halo({ size, opacity, color, position = [0, 0, -0.8] }: {
  size: number; opacity: number; color: string; position?: [number, number, number]
}) {
  const uniforms = useMemo(() => ({ uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } }), [color, opacity])
  return <Billboard position={position}><mesh>
    <planeGeometry args={[size, size]} />
    <shaderMaterial uniforms={uniforms} vertexShader={haloVertex} fragmentShader={haloFragment}
      transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
  </mesh></Billboard>
}

function GlassRing({ index, active, stage, rigs, children }: {
  index: number; active: boolean; stage: number; rigs: Map<number, RingRig>; children?: ReactNode
}) {
  const group = useRef<THREE.Group>(null)
  const spin = useRef<THREE.Group>(null)
  const material = useRef<THREE.MeshPhysicalMaterial>(null)
  const glow = useRef<THREE.ShaderMaterial>(null)
  const rimMaterials = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const time = useRef(0)
  const config = RINGS[index]
  const home = useMemo(() => new THREE.Quaternion(), [])
  const homeEuler = useMemo(() => new THREE.Euler(), [])
  const ringUniforms = useMemo(() => ({uPhase: {value: index * 0.9}, uExpansion: {value: 0}}), [index])
  useEffect(() => {rigs.set(index, {frame: group.current!, surface: spin.current!, home}); return () => {rigs.delete(index)}}, [rigs, index, home])
  const geometry = useMemo(() => {
    // A bevelled ribbon cross section, derived from TorusGeometry, rather than round tubing.
    const torus = new THREE.TorusGeometry(config.radius, config.tube, 16, 192)
    const uv = torus.getAttribute('uv')
    const vertices = torus.getAttribute('position')
    for (let i = 0; i < vertices.count; i++) {
      const angle = uv.getX(i) * Math.PI * 2
      const section = uv.getY(i) * Math.PI * 2
      const c = Math.cos(section), s = Math.sin(section)
      const radial = config.radius + Math.sign(c) * Math.pow(Math.abs(c), 0.45) * config.tube
      const depth = Math.sign(s) * Math.pow(Math.abs(s), 0.45) * config.tube * 0.28
      vertices.setXYZ(i, radial * Math.cos(angle), radial * Math.sin(angle), depth)
    }
    torus.computeVertexNormals()
    const colors = new Float32Array(vertices.count * 3)
    const blue = new THREE.Color('#5c6488')
    const violet = new THREE.Color('#8b7a9a')
    const color = new THREE.Color()
    for (let i = 0; i < vertices.count; i++) {
      const angle = Math.atan2(vertices.getY(i), vertices.getX(i))
      color.copy(blue).lerp(violet, (Math.sin(angle + index) + 1) * 0.5)
      color.toArray(colors, i * 3)
    }
    torus.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return torus
  }, [config, index])
  const edges = useMemo(() => [-1, 1].map(side => new THREE.TorusGeometry(config.radius + side * config.tube * 0.98, 0.0038, 4, 160)), [config])
  useEffect(() => () => {geometry.dispose(); edges.forEach(g => g.dispose())}, [geometry, edges])
  // Fade the same homepage ring surfaces into soft orbital traces after the
  // scene's transform writer runs. This does not blur the satellites or UI.
  useFrame(() => {
    const expansion = THREE.MathUtils.clamp(((group.current?.parent?.scale.x ?? 1) - 1) / 0.72, 0, 1)
    if (material.current) {
      material.current.opacity = THREE.MathUtils.lerp(0.9, 0.016, expansion)
      material.current.roughness = THREE.MathUtils.lerp(0.15, 0.8, expansion)
    }
    if (glow.current) glow.current.uniforms.uExpansion.value = expansion
    rimMaterials.current.forEach(m => {if (m) m.opacity = THREE.MathUtils.lerp(index === 2 ? 0.68 : 0.38, 0.008, expansion)})
    if (spin.current) spin.current.userData.orbitOpacity = material.current?.opacity
  }, -5)

  useFrame((_, delta) => {
    if (active) time.current += Math.min(delta, 0.05)
    home.setFromEuler(homeEuler.set(
      config.rotation[0] + Math.sin(time.current * 0.12 + index) * 0.065,
      config.rotation[1] + Math.sin(time.current * 0.09) * 0.1,
      config.rotation[2] + Math.sin(time.current * config.speed) * 0.16, 'ZYX',
    ))
    if (spin.current) spin.current.rotation.z = time.current * config.speed
    if (material.current) material.current.emissiveIntensity = THREE.MathUtils.damp(
      material.current.emissiveIntensity, stage % 3 === index ? 0.04 : 0.012, 3, delta,
    )
  }, -30)

  return <group ref={group} rotation={[...config.rotation, 'ZYX']} scale={index === 0 ? [1, 1.38, 1] : [1, 1, 1]}>
    <group ref={spin}>
    <mesh geometry={geometry}>
      <meshPhysicalMaterial ref={material} vertexColors transmission={0.8} roughness={0.15}
        metalness={0.3} clearcoat={1} clearcoatRoughness={0.1} ior={1.46}
        thickness={0.4} envMapIntensity={1.55} emissive="#817ed5" emissiveIntensity={0.02}
        transparent opacity={0.9} depthWrite={false}
        onBeforeCompile={shader => {
          shader.vertexShader = 'varying vec2 vRibbonUv;\n' + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvRibbonUv = uv;')
          shader.fragmentShader = 'varying vec2 vRibbonUv;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', `
            float ribbonAngle = vRibbonUv.x * 6.283185;
            float bevel = pow(abs(cos(vRibbonUv.y * 6.283185)), 10.0);
            float strip = pow(max(0.0, sin(ribbonAngle + 0.6)), 12.0)
                        + 0.6 * pow(max(0.0, cos(ribbonAngle + 0.8)), 20.0);
            float rim = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);
            outgoingLight = outgoingLight * 0.62 + vec3(0.61, 0.51, 0.78) * (strip * (0.17 + bevel * 0.8) + rim * 0.16);
            #include <opaque_fragment>
          `)
        }} />
    </mesh>
    <mesh geometry={geometry}>
      <shaderMaterial ref={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending}
        uniforms={ringUniforms}
        vertexShader={`varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){vUv=uv;vec4 p=modelViewMatrix*vec4(position,1.0);vN=normalize(normalMatrix*normal);
          vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`}
        fragmentShader={`varying vec2 vUv;varying vec3 vN;varying vec3 vV;uniform float uPhase;uniform float uExpansion;
          void main(){
            float a=vUv.x*6.283185;
            float edge=pow(abs(cos(vUv.y*6.283185)),16.0);
            float strip=pow(max(0.0,sin(a+uPhase)),18.0);
            float wide=pow(max(0.0,cos(a+uPhase+1.8)),8.0);
            float fres=pow(1.0-abs(dot(normalize(vN),normalize(vV))),3.0);
            float alpha=(strip*.9+wide*.42)*(0.45+edge*.55)+fres*edge*.28;
            // Gaussian falloff across the original ribbon cross section;
            // edge softness is generated from geometry, without a blur texture.
            float radial=cos(vUv.y*6.283185);
            float mist=exp(-radial*radial*8.0)*(0.055+0.025*wide);
            gl_FragColor=vec4(mix(vec3(.52,.49,.9),vec3(.92,.82,1.0),strip),mix(alpha,mist,uExpansion));
          }`} />
    </mesh>
    {edges.map((edge, i) => <mesh key={i} geometry={edge}>
      <meshBasicMaterial ref={m => {rimMaterials.current[i] = m}} color={index === 2 ? '#b2c7ff' : '#c6b8f3'}
        transparent opacity={index === 2 ? 0.68 : 0.38} toneMapped={false} />
    </mesh>)}
    {children}
    </group>
  </group>
}

function OrbitParticles({ active, mobile }: { active: boolean; mobile: boolean }) {
  const count = mobile ? 96 : 180
  const time = useRef(0)
  const { geometry, phases, orientations, scratch } = useMemo(() => {
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const phases = Array.from({ length: count }, (_, i) => ({
      angle: i * 2.3999632297,
      radius: RINGS[i % 3].radius + Math.sin(i * 7.31) * 0.11,
      speed: 0.025 + (i % 7) * 0.003,
    }))
    const color = new THREE.Color()
    for (let i = 0; i < count; i++) {
      color.set(i % 3 === 0 ? '#afa1f6' : '#9bbcff')
      color.multiplyScalar(0.4 + (i % 5) * 0.12).toArray(colors, i * 3)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3.1)
    return { geometry, phases, orientations: RINGS.map(r => new THREE.Euler(r.rotation[0], r.rotation[1], r.rotation[2], 'ZYX')), scratch: new THREE.Vector3() }
  }, [count])
  useEffect(() => () => geometry.dispose(), [geometry])
  useFrame((_, delta) => {
    if (active) time.current += Math.min(delta, 0.05)
    const position = geometry.getAttribute('position') as THREE.BufferAttribute
    phases.forEach((p, i) => {
      const config = RINGS[i % 3]
      const t = time.current
      const angle = p.angle + t * p.speed * (i % 2 ? 1 : -1)
      const rotation = orientations[i % 3]
      rotation.set(config.rotation[0] + Math.sin(t * 0.12 + i % 3) * 0.065,
        config.rotation[1] + Math.sin(t * 0.09) * 0.1, config.rotation[2] + Math.sin(t * config.speed) * 0.16, 'ZYX')
      scratch.set(Math.cos(angle) * p.radius, Math.sin(angle) * p.radius * (i % 3 === 0 ? 1.38 : 1), Math.sin(i * 5.3) * 0.1).applyEuler(rotation)
      position.setXYZ(i, scratch.x, scratch.y, scratch.z)
    })
    position.needsUpdate = true
  })
  return <points geometry={geometry}>
    <shaderMaterial transparent depthWrite={false} vertexColors blending={THREE.AdditiveBlending}
      uniforms={{ uSize: { value: mobile ? 15 : 19 } }}
      vertexShader={`varying vec3 vColor; uniform float uSize;
        void main(){vColor=color;vec4 p=modelViewMatrix*vec4(position,1.0);
        gl_PointSize=clamp(uSize/-p.z,1.0,3.5);gl_Position=projectionMatrix*p;}`}
      fragmentShader={`varying vec3 vColor;void main(){float d=length(gl_PointCoord-0.5)*2.0;
        gl_FragColor=vec4(vColor,pow(max(0.0,1.0-d),1.5)*0.78);}`} />
  </points>
}

export function FlywheelModel({ core, active, stage, mobile, landing, rigs, coreRef, ringContent }: {
  core?: CoreSlot; active: boolean; stage: number; mobile: boolean; landing: boolean;
  rigs: Map<number, RingRig>; coreRef: RefObject<THREE.Group | null>; ringContent: (index: number) => ReactNode
}) {
  return <>
    <Halo size={6} opacity={0.15} color="#5b46c2" />
    {RINGS.map((_, i) => <GlassRing key={i} index={i} active={active} stage={stage} rigs={rigs}>{ringContent(i)}</GlassRing>)}
    <group ref={coreRef} name="self-current" userData={{contentId:'self-current'}}>
      <Halo size={2.8} opacity={0.3} color="#6559dd" />
      <Suspense fallback={<CrystalCore active={active} energy={stage} />}>
        {core ?? <CrystalCore active={active} energy={stage} />}
      </Suspense>
    </group>
    <group visible={landing}><OrbitParticles active={active} mobile={mobile} /></group>
  </>
}
