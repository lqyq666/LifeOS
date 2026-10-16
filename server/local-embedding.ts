import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { HttpError } from './db.ts'

import {embeddingSignature} from './embedding-signature.ts'
export {embeddingSignature} from './embedding-signature.ts'
type Pending={resolve:(vectors:number[][])=>void;reject:(error:Error)=>void;cancelled:boolean;cleanup:()=>void}
export class LocalEmbedding {
  private child?:ChildProcessWithoutNullStreams
  private ready?:Promise<void>
  private sequence=0
  private initialized=false
  private pending=new Map<number,Pending>()
  start():Promise<void>{
    if(this.ready)return this.ready
    this.ready=new Promise<void>((accept,reject)=>{
      const child=spawn(process.env.LIFEOS_EMBEDDING_PYTHON||'python',['-u',resolve('server/coach-embedding-worker.py')],{windowsHide:true,stdio:'pipe',env:{...process.env,PYTHONIOENCODING:'utf-8'}})
      this.child=child
      const timeout=setTimeout(()=>{reject(new HttpError(503,'LOCAL_EMBEDDING_UNAVAILABLE'));child.kill()},30000)
      const lines=createInterface({input:child.stdout})
      child.stderr.resume() // Never echo Python diagnostics containing task text.
      lines.on('line',line=>{
        try{
          const message=JSON.parse(line)
          if(message.ready===true){
            if(message.signature!==embeddingSignature)throw new Error('signature')
            clearTimeout(timeout);this.initialized=true;accept();return
          }
          const request=this.pending.get(message.id)
          if(!request)return
          this.pending.delete(message.id);request.cleanup()
          if(request.cancelled)return
          if(message.signature!==embeddingSignature||!Array.isArray(message.vectors)||message.vectors.some((vector:unknown)=>!Array.isArray(vector)||vector.length!==512||vector.some(value=>typeof value!=='number'||!Number.isFinite(value))))request.reject(new HttpError(503,'LOCAL_EMBEDDING_FAILED'))
          else request.resolve(message.vectors)
        }catch{reject(new HttpError(503,'LOCAL_EMBEDDING_FAILED'));child.kill()}
      })
      const failed=()=>{
        this.initialized=false
        clearTimeout(timeout);reject(new HttpError(503,'LOCAL_EMBEDDING_UNAVAILABLE'))
        for(const request of this.pending.values()){request.cleanup();if(!request.cancelled)request.reject(new HttpError(503,'LOCAL_EMBEDDING_UNAVAILABLE'))}
        this.pending.clear();this.child=undefined;this.ready=undefined;lines.close()
      }
      child.once('error',failed);child.once('close',failed)
    })
    return this.ready
  }
  async encode(texts:string[],query=false,signal?:AbortSignal):Promise<number[][]>{
    signal?.throwIfAborted()
    if(texts.length<1||texts.length>32||texts.some(text=>!text.trim()||text.length>16000))throw new HttpError(400,'LOCAL_EMBEDDING_INPUT_LIMIT')
    await this.start();signal?.throwIfAborted()
    if(this.pending.size>=32)throw new HttpError(503,'LOCAL_EMBEDDING_QUEUE_FULL')
    return new Promise((accept,reject)=>{
      const id=++this.sequence
      const cancel=()=>{const item=this.pending.get(id);if(item&&!item.cancelled){item.cancelled=true;item.reject(new HttpError(409,'CANCELLED'))}}
      const timeout=setTimeout(()=>{const item=this.pending.get(id);if(item&&!item.cancelled){item.cancelled=true;item.reject(new HttpError(503,'LOCAL_EMBEDDING_TIMEOUT'))}},30000)
      const cleanup=()=>{clearTimeout(timeout);signal?.removeEventListener('abort',cancel)}
      this.pending.set(id,{resolve:accept,reject,cancelled:false,cleanup})
      signal?.addEventListener('abort',cancel,{once:true})
      this.child!.stdin.write(JSON.stringify({id,texts,query})+'\n',error=>{if(error){const item=this.pending.get(id);this.pending.delete(id);cleanup();if(item&&!item.cancelled)reject(new HttpError(503,'LOCAL_EMBEDDING_FAILED'))}})
    })
  }
  get pid(){return this.child?.pid}
  get healthy(){return this.initialized&&Boolean(this.child&&!this.child.killed)}
  close():Promise<void>{
    const child=this.child
    if(!child)return Promise.resolve()
    return new Promise(resolve=>{child.once('close',()=>resolve());child.kill()})
  }
}
export const localEmbedding=new LocalEmbedding()
