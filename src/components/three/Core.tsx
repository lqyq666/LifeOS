import { useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

export interface CoreProps {
  active?: boolean
  energy?: number
}

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vEye;
  varying vec3 vPosition;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vEye = normalize(-viewPosition.xyz);
    vPosition = position;
    gl_Position = projectionMatrix * viewPosition;
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uEnergy;
  varying vec3 vNormal;
  varying vec3 vEye;
  varying vec3 vPosition;
  float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
  float noise(vec3 p){
    vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  void main() {
    float fresnel = pow(1.0 - max(dot(normalize(vNormal), normalize(vEye)), 0.0), 2.6);
    vec3 p=vPosition*3.3+vec3(0.0,uTime*.025,0.0);
    float flow = noise(p)*.6+noise(p*2.1)*.28+noise(p*4.2)*.12;
    float cloud = smoothstep(.25, .82, flow) * .6;
    vec3 blue = vec3(0.012, 0.032, 0.20);
    vec3 violet = vec3(0.15, 0.055, 0.36);
    vec3 color = mix(blue, violet, vPosition.y * 0.75 + 0.5 + cloud);
    color += vec3(0.18, 0.23, 0.63) * cloud;
    color += vec3(0.5, 0.59, 1.0) * fresnel * 1.8;
    float reflection=pow(max(0.0,dot(normalize(vNormal),normalize(vec3(-.4,.7,.6)))),32.0);
    color+=vec3(.62,.53,.87)*reflection*.7;
    float breath = 0.94 + sin(uTime * 0.65) * 0.06;
    gl_FragColor = vec4(color * breath * (1.0 + uEnergy * 0.05), 0.7 + fresnel * 0.28);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** Self-contained default core. The flywheel does not know its internal geometry. */
export function CrystalCore({ active = true, energy = 0 }: CoreProps) {
  const group = useRef<THREE.Group>(null)
  const light = useRef<THREE.PointLight>(null)
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uEnergy: { value: 0 } }), [])

  useFrame((_, delta) => {
    if (active) uniforms.uTime.value += Math.min(delta, 0.05)
    uniforms.uEnergy.value = THREE.MathUtils.damp(uniforms.uEnergy.value, energy, 3, delta)
    const breath = Math.sin(uniforms.uTime.value * 0.65)
    if (group.current) group.current.scale.setScalar(1.12 + breath * 0.014)
    if (light.current) light.current.intensity = 2.7 + breath * 0.3
  })

  return <group ref={group}>
    <mesh>
      <sphereGeometry args={[0.66, 48, 32]} />
      <meshPhysicalMaterial color="#696cb6" transmission={0.94} roughness={0.08}
        metalness={0.02} clearcoat={1} thickness={0.6} ior={1.38}
        envMapIntensity={0.16} emissive="#5556d9" emissiveIntensity={0.045} />
    </mesh>
    <mesh scale={1.004}>
      <sphereGeometry args={[0.66, 48, 32]} />
      <shaderMaterial vertexShader={vertexShader} fragmentShader={fragmentShader}
        uniforms={uniforms} transparent depthWrite={false} />
    </mesh>
    <mesh position={[-0.04, 0.02, 0.68]}>
      <planeGeometry args={[0.6, 0.6]} />
      <shaderMaterial transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false}
        vertexShader={`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`}
        fragmentShader={`varying vec2 vUv;void main(){vec2 p=abs(vUv-.5);float g=exp(-length(p)*25.0)*.6;
          float s=exp(-p.x*180.0-p.y*24.0)+exp(-p.y*180.0-p.x*24.0);
          gl_FragColor=vec4(vec3(.78,.78,1.0),min(1.0,g+s*.8));}`} />
    </mesh>
    <pointLight ref={light} color="#a29cff" intensity={2.7} distance={7} decay={2} />
  </group>
}

/** Optional asset adapter; mount inside Suspense and an error boundary. No asset fetched by default. */
export function ModelCore({ url = '/assets/models/center-core.glb', scale = 1 }: { url?: string; scale?: number }) {
  const { scene } = useGLTF(url)
  const instance = useMemo(() => scene.clone(true), [scene])
  return <primitive object={instance} scale={scale} />
}

export type CoreSlot = ReactNode
