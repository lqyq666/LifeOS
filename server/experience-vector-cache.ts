import {createHash,randomUUID} from 'node:crypto'
import {constants} from 'node:fs'
import {mkdir,open,rename,unlink,readdir,stat} from 'node:fs/promises'
import {resolve,join} from 'node:path'

// Disposable offline vectors only, never original text or credentials.
// Current owner, consent, revision and sources are checked before this cache.
const MAX_ENTRIES=2048,MAX_BYTES=150_000,MAX_AGE=7*86_400_000
const lastPruned=new Map<string,number>()
const valid=(value:unknown):value is number[][]=>Array.isArray(value)&&value.length>0&&value.length<=4&&value.every(v=>Array.isArray(v)&&v.length===512&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1.0001))
const filename=(directory:string,key:string)=>join(resolve(directory),createHash('sha256').update(key).digest('hex')+'.json')
export async function readExperienceVectors(directory:string|undefined,key:string):Promise<number[][]|null>{
 if(!directory)return null
 try{const f=await open(filename(directory,key),constants.O_RDONLY|constants.O_NOFOLLOW)
  try{const s=await f.stat();if(!s.isFile()||s.size>MAX_BYTES||Date.now()-s.mtimeMs>MAX_AGE)return null
   const value=JSON.parse(await f.readFile('utf8'));return value.version===1&&valid(value.vectors)?value.vectors:null
  }finally{await f.close()}
 }catch{return null}
}
export async function writeExperienceVectors(directory:string|undefined,key:string,vectors:number[][]):Promise<void>{
 if(!directory||!valid(vectors))return
 const root=resolve(directory),target=filename(root,key),temporary=target+'.'+randomUUID()+'.tmp'
 try{await mkdir(root,{recursive:true,mode:0o700});const f=await open(temporary,'wx',0o600)
  try{await f.writeFile(JSON.stringify({version:1,vectors}))}finally{await f.close()}
  await rename(temporary,target)
  if(Date.now()-(lastPruned.get(root)??0)<60_000)return
  lastPruned.set(root,Date.now())
  const rows=await Promise.all((await readdir(root)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(async name=>({path:join(root,name),time:(await stat(join(root,name))).mtimeMs})))
  rows.sort((a,b)=>b.time-a.time)
  for(const [index,row] of rows.entries())if(index>=MAX_ENTRIES||Date.now()-row.time>MAX_AGE)await unlink(row.path).catch(()=>{})
 }catch{/* A disposable cache must never block retrieval or trigger paid calls. */}
 finally{await unlink(temporary).catch(()=>{})}
}
