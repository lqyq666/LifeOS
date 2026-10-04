import { useMemo, useEffect, useRef } from 'react'
import { Environment, Lightformer } from '@react-three/drei'
import * as THREE from 'three'
import { ControlledReflection } from './ControlledReflection'
const haloVertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`

export function ReflectionFloor({ mobile, enabled = true }: { mobile: boolean; enabled?: boolean }) {
  const mesh = useRef<THREE.Mesh>(null)
  const fade = useMemo(() => {
    const data = new Uint8Array(64 * 64 * 4)
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const d = Math.hypot((x - 31.5) / 31.5, (y - 31.5) / 31.5)
      const a = Math.round(Math.pow(Math.max(0, 1 - d), 1.5) * 255)
      data.set([255, a, 255, 255], (y * 64 + x) * 4)
    }
    const texture = new THREE.DataTexture(data, 64, 64, THREE.RGBAFormat)
    texture.needsUpdate = true
    return texture
  }, [])
  useEffect(() => () => fade.dispose(), [fade])
  return <group position={[0, -2.9, 0]} scale={[1, 1, 0.55]}>
    <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[24, 24]} />
      <ControlledReflection mesh={mesh} mobile={mobile} fade={fade} enabled={enabled}/>
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
      <planeGeometry args={[9, 9]} />
      <shaderMaterial vertexShader={haloVertex} transparent depthWrite={false}
        blending={THREE.AdditiveBlending} toneMapped={false}
        fragmentShader={`varying vec2 vUv;
          void main(){
            vec2 p=(vUv-.5)*9.0;float r=length(p);
            float ring=exp(-pow((r-1.86)/.015,2.0));
            float glow=exp(-pow((r-1.86)/.075,2.0))*.48;
            float ripple=exp(-pow((r-2.14)/.015,2.0))*.09+exp(-pow((r-2.64)/.012,2.0))*.07;
            float spill=exp(-pow((r-2.0)/.65,2.0))*.055;
            float reflection=exp(-p.x*p.x*8.0)*exp(-pow((p.y+1.2)*.5,2.0))*(1.0-smoothstep(-1.0,.35,p.y));
            reflection*=.14+.035*sin(p.y*84.0)+.018*sin(p.y*133.0);
            vec3 color=mix(vec3(.27,.33,.8),vec3(.72,.7,1.0),ring);
            color=mix(color,vec3(.61,.46,.85),smoothstep(.01,.15,reflection));
            gl_FragColor=vec4(color,ring*.95+glow+ripple+spill+reflection);
          }`} />
    </mesh>
  </group>
}

export function FlywheelEnvironment() {
  return <>
    <ambientLight intensity={0.25} />
    <directionalLight position={[2, 4, 3]} intensity={1.1} color="#d6d6ff" />
    <pointLight position={[-3, 1, 2]} intensity={7} color="#706cff" />
    <pointLight position={[2, -1, 1]} intensity={5} color="#9abfff" />
    <Environment resolution={256} frames={1}>
      <Lightformer form="rect" intensity={8} color="#f0eaff" position={[-3, 4, 3]} scale={[0.6, 5, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={5} color="#b4bfff" position={[4, -1, 2]} scale={[0.3, 6, 1]} target={[0, 0, 0]} />
      <Lightformer form="rect" intensity={6} color="#ddcafa" position={[0, 4, -3]} scale={[4, 0.8, 1]} target={[0, 0, 0]} />
    </Environment>
  </>
}
