import { useEffect, useMemo, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { MeshReflectorMaterial } from '@react-three/drei/materials/MeshReflectorMaterial.js'
import { BlurPass } from '@react-three/drei/materials/BlurPass.js'

/** The existing drei reflector shader/blur, with a visibility gate and explicit FBO cleanup.
 * Oblique mirror projection follows the installed drei 10.7.9 implementation.
 * Its stock component renders even when an ancestor is hidden, so it cannot own this pass.
 */
export function ControlledReflection({mesh,mobile,fade,enabled}:{mesh:RefObject<THREE.Mesh|null>;mobile:boolean;fade:THREE.Texture;enabled:boolean}) {
  const {gl,camera,scene}=useThree()
  const resource=useMemo(()=>{
    const resolution=mobile?192:256
    const target=new THREE.WebGLRenderTarget(resolution,resolution,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter})
    target.depthTexture=new THREE.DepthTexture(resolution,resolution,THREE.UnsignedShortType)
    const blurred=new THREE.WebGLRenderTarget(resolution,resolution,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter})
    const blur=new BlurPass({gl,resolution,width:130,height:55,minDepthThreshold:0.7,maxDepthThreshold:1.2,depthScale:0,depthToBlurRatioBias:0.3})
    const textureMatrix=new THREE.Matrix4()
    const material=new MeshReflectorMaterial({color:'#77708e',metalness:0.15,roughness:0.85,transparent:true,alphaMap:fade,opacity:0.78,depthWrite:false}) as MeshReflectorMaterial & {defines:Record<string,string>}
    Object.assign(material,{mirror:1,textureMatrix,mixBlur:1,tDiffuse:target.texture,tDepth:target.depthTexture,tDiffuseBlur:blurred.texture,hasBlur:true,mixStrength:4,minDepthThreshold:0.7,maxDepthThreshold:1.2,depthScale:0,depthToBlurRatioBias:0.3,distortion:1,mixContrast:1})
    material.defines={...material.defines,USE_BLUR:''}
    return {target,blurred,blur,textureMatrix,material,virtual:new THREE.PerspectiveCamera(),plane:new THREE.Plane(),normal:new THREE.Vector3(),position:new THREE.Vector3(),eye:new THREE.Vector3(),rotation:new THREE.Matrix4(),view:new THREE.Vector3(),look:new THREE.Vector3(),destination:new THREE.Vector3(),clip:new THREE.Vector4(),q:new THREE.Vector4()}
  },[gl,mobile,fade])
  useEffect(()=>()=>{
    resource.target.dispose();resource.blurred.dispose();resource.material.dispose()
    resource.blur.renderTargetA.dispose();resource.blur.renderTargetB.dispose();resource.blur.convolutionMaterial.dispose();resource.blur.screen.geometry.dispose()
  },[resource])
  useFrame(()=>{
    const parent=mesh.current
    if(!enabled||!parent)return
    for(let ancestor:THREE.Object3D|null=parent;ancestor;ancestor=ancestor.parent)if(!ancestor.visible)return
    const r=resource
    r.position.setFromMatrixPosition(parent.matrixWorld);r.eye.setFromMatrixPosition(camera.matrixWorld)
    r.rotation.extractRotation(parent.matrixWorld);r.normal.set(0,0,1).applyMatrix4(r.rotation)
    r.view.subVectors(r.position,r.eye)
    if(r.view.dot(r.normal)>0)return
    r.view.reflect(r.normal).negate().add(r.position)
    r.rotation.extractRotation(camera.matrixWorld);r.look.set(0,0,-1).applyMatrix4(r.rotation).add(r.eye)
    r.destination.subVectors(r.position,r.look).reflect(r.normal).negate().add(r.position)
    r.virtual.position.copy(r.view);r.virtual.up.set(0,1,0).applyMatrix4(r.rotation).reflect(r.normal);r.virtual.lookAt(r.destination)
    r.virtual.far=(camera as THREE.PerspectiveCamera).far;r.virtual.updateMatrixWorld();r.virtual.projectionMatrix.copy(camera.projectionMatrix)
    r.textureMatrix.set(0.5,0,0,0.5,0,0.5,0,0.5,0,0,0.5,0.5,0,0,0,1)
    r.textureMatrix.multiply(r.virtual.projectionMatrix).multiply(r.virtual.matrixWorldInverse).multiply(parent.matrixWorld)
    r.plane.setFromNormalAndCoplanarPoint(r.normal,r.position).applyMatrix4(r.virtual.matrixWorldInverse)
    r.clip.set(r.plane.normal.x,r.plane.normal.y,r.plane.normal.z,r.plane.constant)
    const matrix=r.virtual.projectionMatrix.elements
    r.q.set((Math.sign(r.clip.x)+matrix[8])/matrix[0],(Math.sign(r.clip.y)+matrix[9])/matrix[5],-1,(1+matrix[10])/matrix[14])
    r.clip.multiplyScalar(2/r.clip.dot(r.q));matrix[2]=r.clip.x;matrix[6]=r.clip.y;matrix[10]=r.clip.z+1;matrix[14]=r.clip.w
    const target=gl.getRenderTarget(),xr=gl.xr.enabled,shadow=gl.shadowMap.autoUpdate
    parent.visible=false
    try {gl.xr.enabled=false;gl.shadowMap.autoUpdate=false;gl.setRenderTarget(r.target);gl.state.buffers.depth.setMask(true);if(!gl.autoClear)gl.clear();gl.render(scene,r.virtual);r.blur.render(gl,r.target,r.blurred)}
    finally {parent.visible=true;gl.xr.enabled=xr;gl.shadowMap.autoUpdate=shadow;gl.setRenderTarget(target)}
  })
  return <primitive object={resource.material} attach="material" dispose={null}/>
}
