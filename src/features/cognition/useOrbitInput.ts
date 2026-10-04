import { useRef, type PointerEvent, type MouseEvent } from 'react'
import type { CognitionController } from './state.ts'

export function useOrbitInput(controller:CognitionController) {
  const pointer=useRef<{id:number;x:number;y:number;last:number;time:number;moved:boolean}|null>(null)
  return {
    onPointerDownCapture:(event:PointerEvent<HTMLElement>)=>{
      if(event.button!==0||!controller.interactive||controller.candidates().length<2)return
      controller.stop()
      pointer.current={id:event.pointerId,x:event.clientX,y:event.clientY,last:event.clientX,time:performance.now(),moved:false}
    },
    onPointerMoveCapture:(event:PointerEvent<HTMLElement>)=>{
      const p=pointer.current
      if(!p||p.id!==event.pointerId)return
      if(!p.moved) {
        if(Math.abs(event.clientY-p.y)>Math.abs(event.clientX-p.x)+7){pointer.current=null;return}
        if(Math.abs(event.clientX-p.x)<7)return
        if(!controller.startDrag()){pointer.current=null;return}
        p.moved=true;event.currentTarget.setPointerCapture(event.pointerId)
      }
      const now=performance.now()
      controller.drag(event.clientX-p.last,(now-p.time)/1000);p.last=event.clientX;p.time=now
    },
    onPointerUpCapture:(event:PointerEvent<HTMLElement>)=>{
      const p=pointer.current
      if(!p||p.id!==event.pointerId)return
      if(p.moved){if(performance.now()-p.time>120)controller.velocity=0;controller.release()}
      pointer.current=null
      if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)
    },
    onPointerCancel:()=>{pointer.current=null;controller.cancelDrag()},
    onLostPointerCapture:()=>{if(pointer.current?.moved){pointer.current=null;controller.cancelDrag()}},
    onClickCapture:(event:MouseEvent<HTMLElement>)=>{if(Date.now()<controller.suppressClickUntil){event.stopPropagation();event.preventDefault()}},
  }
}
