import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {execFileSync,spawn} from 'node:child_process'
import {once} from 'node:events'
import {createServer} from 'node:http'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {test} from 'node:test'

const root=resolve(fileURLToPath(new URL('..',import.meta.url)))
const script=resolve(root,'skills/lifeos-personal-companion/examples/multirun.mjs')
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
const mainSkillDigest=createHash('sha256').update(readFileSync(resolve(root,'skills/lifeos-personal-companion/SKILL.md'))).digest('hex')

async function runWithVersion(version:Record<string,unknown>|null){
 const requests:string[]=[],signedIn={value:false}
 const server=createServer((req,res)=>{
  requests.push(`${req.method} ${req.url}`)
  const send=(status:number,value:unknown,headers:Record<string,string>={})=>{res.writeHead(status,{'Content-Type':'application/json','Connection':'close',...headers});res.end(JSON.stringify(value))}
  if(req.url==='/api/run/version'){send(version?200:404,version??{code:'NOT_FOUND'});return}
  if(req.url==='/api/session'){send(signedIn.value?200:401,signedIn.value?{id:'synthetic-user'}:{code:'LOGIN_REQUIRED'});return}
  if(req.url==='/api/auth/sign-up/email'&&req.method==='POST'){signedIn.value=true;send(200,{user:{id:'synthetic-user'}},{'Set-Cookie':'session=stub; Path=/; HttpOnly'});return}
  if(req.url==='/api/conversations'&&req.method==='POST'){send(200,{ok:true});return}
  if(req.url?.startsWith('/api/growth?')){send(200,{items:[]});return}
  send(404,{code:'NOT_FOUND'})
 })
 server.listen(0,'127.0.0.1')
 await once(server,'listening')
 const address=server.address()
 assert.ok(address&&typeof address==='object')
 const origin=`http://127.0.0.1:${address.port}`
 try{
  const child=spawn(process.execPath,[script,'--origin',origin],{cwd:root,stdio:['ignore','pipe','pipe']})
  let stdout='',stderr=''
  child.stdout.setEncoding('utf8').on('data',chunk=>stdout+=chunk)
  child.stderr.setEncoding('utf8').on('data',chunk=>stderr+=chunk)
  const timer=setTimeout(()=>child.kill('SIGKILL'),5000)
  const [code]=await once(child,'close') as [number|null]
  clearTimeout(timer)
  return {code,stdout,stderr,requests}
 }finally{
  server.closeAllConnections()
  await new Promise<void>((resolveClose,reject)=>server.close(error=>error?reject(error):resolveClose()))
 }
}

test('personal companion multirun blocks every state write on a stale runtime before signup',async()=>{
 const run=await runWithVersion({service:'LifeOS',head:'deadbee',skillVersion:'1.2.2-candidate',contractGeneration:'p4+workflow-v2',mainSkillDigest})
 assert.equal(run.code,2)
 assert.deepEqual(run.requests,['GET /api/run/version'],`exit=${run.code}; stderr=${run.stderr}`)
 assert.match(run.stderr,/RUNTIME_FINGERPRINT_BLOCKED/)
})

test('personal companion multirun blocks state writes when the runtime fingerprint endpoint is absent',async()=>{
 const run=await runWithVersion(null)
 assert.equal(run.code,2)
 assert.deepEqual(run.requests,['GET /api/run/version'],`exit=${run.code}; stderr=${run.stderr}`)
 assert.match(run.stderr,/RUNTIME_FINGERPRINT_BLOCKED/)
})

test('personal companion multirun checks the current runtime before its synthetic free path',async()=>{
 const run=await runWithVersion({service:'LifeOS',head,skillVersion:'1.2.2-candidate',contractGeneration:'p4+workflow-v2',mainSkillDigest})
 assert.equal(run.code,0,`stderr=${run.stderr}`)
 assert.match(run.stdout,/Free checks OK/)
 assert.equal(run.requests[0],'GET /api/run/version')
 assert.ok(run.requests.includes('POST /api/auth/sign-up/email'))
 assert.ok(run.requests.includes('POST /api/conversations'))
 assert.ok(!run.requests.some(request=>request.includes('/messages')))
})
