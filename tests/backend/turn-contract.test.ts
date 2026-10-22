import {buildClauseCatalogue} from '../../server/clause-catalogue.ts'
import {growthContext,stageGrowthUpdates,applyGrowthAction} from '../../server/growth.ts'
import {mainCompanionPolicy} from '../../server/companion-policy.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { createTurnEngine } from '../../server/agent.ts'
import { model } from '../../server/model.ts'
import { config } from '../../server/config.ts'
import { deriveTurnContract, slimActionCoachSchema, negativePersonalFactClauses,bindMaterialDeliverySchema } from '../../server/turn-contract.ts'
import { actionCoachTurnSchema, parseActionCoachTurn } from '../../server/action-coach-contracts.ts'
import { turnSystemPrompt } from '../../server/turn-prompt.ts'
import { configureProviderPayload } from '../../server/model-payload.ts'
import { importKnowledge, type KnowledgeCard } from '../../server/campus-knowledge.ts'
import { localEmbedding } from '../../server/local-embedding.ts'
import { Value } from 'typebox/value'
import {readFileSync,unlinkSync,existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {boundedOrdinaryReply,boundedPlanningReply,boundedRecallReply} from '../../server/bounded-reply.ts'
import {knowledgeIntent} from '../../server/evergreen-guide.ts'
import {estimateTokens} from '../../server/context.ts'

test('method citation selectors cannot name another or withdrawn card during generation',()=>{
 const allowed='6262d479-9403-4140-8910-48de23cd2600'
 const contract=deriveTurnContract({text:'那就用那个贡献核对方法吧。',knowledgeCount:1,knowledgeIds:[allowed],currentEventExists:true,planIntent:false,material:false})
 assert.equal(Value.Check(contract.schema as any,{reply:'先核对本人负责的一项。',citations:[{claimId:allowed}]}),true)
 assert.equal(Value.Check(contract.schema as any,{reply:'先核对一项。',citations:[{claimId:randomUUID()}]}),false)
 assert.equal(Value.Check(contract.schema as any,{reply:'先核对一项。',citations:[{claimId:'own-contribution'}]}),false)
 assert.equal(Value.Check(contract.schema as any,{reply:'这次只听你说。'}),true)
 const requested=deriveTurnContract({text:'请用这个已审核方法。',knowledgeCount:1,knowledgeIds:[allowed],requiredKnowledgeCitation:true,currentEventExists:true,planIntent:false,material:false})
 assert.equal(Value.Check(requested.schema as any,{reply:'用聊天建议代替。'}),false)
 assert.equal(Value.Check(requested.schema as any,{reply:'只核对本人负责的一项。',citations:[{claimId:allowed}]}),true)
 const without=deriveTurnContract({text:'先别给方法。',knowledgeCount:0,knowledgeIds:[],currentEventExists:true,planIntent:false,material:false})
 assert.equal(Value.Check(without.schema as any,{reply:'好。',citations:[{claimId:allowed}]}),false)
})
test('actual second-session blank-form request rejects an empty preamble before dispatch',()=>{
 const text='接着上次就业实习的小探索。我还没有开始查岗位，我卡在不知道选哪个岗位；上次只采纳计划，不代表已经完成。我这周现在只剩二十分钟。先帮我写一个可以直接复制填写的岗位职责和要求核对表，未知处留空，不要替我发送消息，也不要推断我适合创业。'
 const original=deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:true}),contract=bindMaterialDeliverySchema(original,text)
 assert.equal(Value.Check(contract.schema as any,{reply:'按你提供的内容，整理如下：'}),false)
 const event={target:{operation:'create',title:'岗位核对表',source:{messageId:randomUUID(),quote:'先帮我写一个可以直接复制填写的岗位职责和要求核对表'}},action:{operation:'create',draft:{content:'岗位名称：___\n公开来源：___\n职责原文：___\n要求原文：___\n尚未知：___'}}}
 assert.equal(Value.Check(contract.schema as any,{reply:'按你提供的内容，整理如下：',event}),true)
 assert.equal(Value.Check(contract.schema as any,{reply:'按你提供的内容，整理如下：',event:{...event,action:{operation:'close',actionId:randomUUID(),expectedRevision:1}}}),false)
 const incomplete=deriveTurnContract({text:'帮我写一封邮件，但还不知道发给谁。',knowledgeCount:0,currentEventExists:false,planIntent:false,material:true})
 assert.equal(Value.Check(bindMaterialDeliverySchema(incomplete,'帮我写一封邮件，但还不知道发给谁。').schema as any,{reply:'这封邮件准备发给谁？'}),true)
})

test('retained actual knowledge probe candidate is unrepresentable in the ordinary runtime contract',()=>{
  const retained=JSON.parse(readFileSync('evidence/coze-core-launch-20261011/MODEL_CAPABILITY_FIRST_FAIL.json','utf8'))
  assert.equal(retained.checks.freeOutput.passed,false)
  const output=retained.checks.freeOutput.output
  assert.ok(output.experienceCandidate,'actual first failure retained')
  const contract=deriveTurnContract({text:'请简短解释递归是什么，只回答知识，不需要个人记录或计划。',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
  assert.equal(contract.mode,'ordinary')
  assert.equal(Value.Check(contract.schema as any,output),false,'public explanation must not create a personal experience')
  assert.equal(Value.Check(contract.schema as any,{reply:output.reply}),true)
})

test('material subset retains event identity and current-source rules from the event lane',()=>{
  const contract=deriveTurnContract({text:'现在我只想问他还需要哪一部分，请直接起草一段可以发送的消息。',knowledgeCount:0,currentEventExists:true,planIntent:false,material:true})
  const prompt=turnSystemPrompt('default','qwen3.8-flash',contract)
  assert.equal(contract.mode,'ordinary')
  assert.match(prompt,/同一事情补充、复盘或材料用continue及授权eventId\/revision/)
  assert.match(prompt,/新事情create并用本轮原话source/)
  assert.match(prompt,/只用真实node\/action身份/)
})

test('ordinary turn contract keeps composable lanes and explicit controls narrow them',()=>{
  const derive=(text:string,extra:Partial<Parameters<typeof deriveTurnContract>[0]>={})=>deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false,...extra})
  for(const text of ['你记得我之前说过什么吗？','好的，先这样。','那我保研的把握，你现在怎么看？','我今天只想说说心情。'])assert.equal(derive(text).mode,'ordinary',text)
  const growth=derive('我是大三学生，专业是市场营销。')
  assert.equal(growth.mode,'ordinary');assert.equal(growth.capabilities.growth,true);assert.equal(growth.capabilities.candidate,false)
  assert.equal(growth.capabilities.plan,false);assert.equal(growth.capabilities.event,true)
  const plan=derive('我每周只有三小时，帮我安排一下这周。',{planIntent:true})
  assert.equal(plan.mode,'ordinary');assert.equal(plan.capabilities.plan,true);assert.equal(plan.capabilities.candidate,false)
  const knowledge=derive('我想试试校园二手书项目，帮我看看怎么开始。',{knowledgeCount:2})
  assert.equal(knowledge.mode,'ordinary');assert.equal(knowledge.capabilities.citations,true)
  assert.equal(derive('帮我看看怎么开始。',{knowledgeCount:0}).capabilities.citations,false,'no knowledge → no citations lane')
  const material=derive('请直接帮我写一句给同学的确认消息。',{material:true})
  assert.equal(material.mode,'ordinary');assert.equal(material.capabilities.material,true);assert.equal(material.capabilities.event,true)
  const readOnly=derive('当时他具体希望整理什么内容？',{currentEventExists:true,readOnly:true})
  assert.deepEqual(readOnly.capabilities,{growth:false,candidate:false,plan:false,citations:false,event:false,material:false})
  const supportOnly=derive('我今天只想说说心情。',{knowledgeCount:2,currentEventExists:true,planIntent:true,material:true})
  assert.equal(supportOnly.capabilities.event,false);assert.equal(supportOnly.capabilities.material,false);assert.equal(supportOnly.capabilities.citations,false)
})

test('slimmed schemas make closed lanes unrepresentable while kept lanes stay byte-identical',()=>{
  const lanes=(schema:Record<string,unknown>)=>Object.keys((schema as {properties:Record<string,unknown>}).properties).sort()
  // A read-only runtime schema keeps the structured preview and final reply.
  const replyOnly=slimActionCoachSchema({growth:false,candidate:false,plan:false,citations:false,event:false,material:false})
  assert.deepEqual(lanes(replyOnly),['lead','reply'])
  assert.deepEqual((replyOnly as {required:string[]}).required,['reply'])
  // reply_growth default: reply + growth + candidate + event-without-action.
  const growth=slimActionCoachSchema({growth:true,candidate:true,plan:false,citations:false,event:false,material:false})
  assert.deepEqual(lanes(growth),['experienceCandidate','growthUpdates','lead','reply'],'no event lane without an event signal')
  const eventNoMaterial=slimActionCoachSchema({growth:true,candidate:true,plan:false,citations:false,event:true,material:false})
  assert.deepEqual(lanes(eventNoMaterial),['event','experienceCandidate','growthUpdates','lead','reply'])
  assert.equal((eventNoMaterial.properties as Record<string,{properties:Record<string,unknown>}>).event.properties.action,undefined,'material branch removed')
  // planning adds weeklyPlan; knowledge adds citations; material restores action.
  const plan=slimActionCoachSchema({growth:true,candidate:false,plan:true,citations:false,event:false,material:false})
  assert.ok(lanes(plan).includes('weeklyPlan'))
  const knowledge=slimActionCoachSchema({growth:true,candidate:true,plan:false,citations:true,event:false,material:false})
  assert.ok(lanes(knowledge).includes('citations'))
  const material=slimActionCoachSchema({growth:true,candidate:true,plan:false,citations:false,event:true,material:true})
  assert.ok((material.properties as Record<string,{properties:Record<string,unknown>}>).event.properties.action,'material keeps the action branch')
  // background is never offered under the native protocol.
  for(const caps of [{growth:true,candidate:true,plan:true,citations:true,event:true,material:true},{growth:false,candidate:false,plan:false,citations:false,event:false,material:false}])
    assert.equal(lanes(slimActionCoachSchema(caps)).includes('background'),false)
  // Top-level kept lanes remain identical except event.action drafts, where
  // server-rendered evidence/readiness fields are unavailable to model output.
  const full=(actionCoachTurnSchema as unknown as {properties:Record<string,unknown>}).properties
  for(const lane of lanes(material).filter(lane=>lane!=='event'))assert.deepEqual((material.properties as Record<string,unknown>)[lane],full[lane],lane+' differs from the full contract')
  assert.ok(JSON.stringify(replyOnly).length<JSON.stringify(actionCoachTurnSchema).length/5,'read-only schema is materially smaller')
})
test('negative personal statements keep the fact lane without inventing a completed event',()=>{
 const derive=(text:string)=>deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false})
 for(const text of ['先聊课程，课件链接无法打开，我还没开始复习，怎么继续？','我没有作品，怎么继续？','我暂时不想接单，怎么办？']){
  const contract=derive(text);assert.equal(contract.capabilities.growth,true,text);assert.equal(contract.capabilities.event,true,text)
 }
 for(const text of ['如果我还没开始复习，该怎么办？','同学说他还没开始复习，这是什么意思？','“我还没开始复习”这句话是什么意思？','我还没开始复习吗？']){
   assert.equal(derive(text).mode,'ordinary',text);assert.deepEqual(negativePersonalFactClauses(text),[],text)
 }
})

test('slimmed payloads keep identity bindings and skip absent lanes',()=>{
  const current='00000000-0000-4000-8000-000000000011'
  const item={id:'00000000-0000-4000-8000-000000000021',revision:2}
  const growth=slimActionCoachSchema({growth:true,candidate:true,plan:false,citations:false,event:true,material:false})
  const payload=configureProviderPayload({},{provider:'bailian',id:'qwen3.8-flash'},'default',growth,undefined,8192,current,[],[item],0,false,undefined,false,['c0','c1']) as any
  const schema=payload.response_format.json_schema.schema
  assert.equal(schema.properties.event.properties.action,undefined)
  const updates=schema.properties.growthUpdates
  assert.ok(updates.items.anyOf.some((branch:any)=>branch.properties?.target?.anyOf?.some((entry:any)=>entry.properties?.operation?.const==='correct'&&entry.properties?.itemId?.enum?.[0]===item.id)),'correct branch still enum-bound to authorized items')
  assert.ok(updates.items.anyOf.every((branch:any)=>branch.properties?.source?.properties?.clauseId?.enum?.length===2),'clause handles stay enum-bound')
  assert.equal(schema.properties.experienceCandidate.properties.source.properties.clauseIds.items.enum.length,2)
  // Event lane absent: passing event targets must not throw and must not create an event lane.
  const noEvent=slimActionCoachSchema({growth:true,candidate:false,plan:false,citations:false,event:false,material:false})
  const payload2=configureProviderPayload({},{provider:'bailian',id:'qwen3.8-flash'},'default',noEvent,undefined,8192,current,[{id:'00000000-0000-4000-8000-000000000031',revision:1}],[],0,false,undefined,false,['c0']) as any
  assert.equal(payload2.response_format.json_schema.schema.properties.event,undefined)
  // Model outputs from a slimmed turn still parse against the full contract.
  const parsed=parseActionCoachTurn(JSON.stringify({reply:'先说说你的情况。'}))
  assert.equal(parsed.reply,'先说说你的情况。')
})

test('contract prompts omit closed lanes while the probe prompt stays byte-identical',()=>{
  const full=turnSystemPrompt('default','qwen3.8-flash')
  const contract=deriveTurnContract({text:'你记得我之前说过什么吗？',knowledgeCount:0,currentEventExists:false,planIntent:false,material:false,readOnly:true})
  const slim=turnSystemPrompt('default','qwen3.8-flash',contract)
  assert.notEqual(slim,full,'runtime prompt remains separate from the frozen capability probe')
  assert.equal(slim.includes('时间：每周N小时'),false,'growth rules absent in read-only turns')
  const planning=turnSystemPrompt('default','qwen3.8-flash',deriveTurnContract({text:'帮我安排一下这周。',knowledgeCount:0,currentEventExists:false,planIntent:true,material:false}))
  assert.ok(planning.includes('weeklyPlan'),'planning rules present in planning mode')
  assert.ok(planning.includes('event承接本人具体事项'),'ordinary planning can also carry event feedback')
})

test('engine applies the ordinary contract end-to-end and persists narrowed turn effects',async t=>{
  await localEmbedding.start()
  const outputs:unknown[]=[],requests:any[]=[]
  const engine=createTurnEngine({capabilityVerified:()=>true})
  const fake=createServer((req,res)=>{
    const chunks:Buffer[]=[];req.on('data',chunk=>chunks.push(Buffer.from(chunk)))
    req.on('end',()=>{
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      const output=outputs.shift() as {reply?:string}|undefined
      const supplied=JSON.parse(requests.at(-1).messages.find((m:any)=>m.role==='user').content)
      if(output&&['我在，你慢慢说。','我在听，你可以慢慢说。','我在听。'].includes(output.reply??'')&&supplied.boundedReply)output.reply=supplied.boundedReply.choices[0]
      if(output===undefined){res.writeHead(500);res.end();return}
      res.writeHead(200,{'Content-Type':'text/event-stream'})
      const base={id:'contract-'+requests.length,object:'chat.completion.chunk',created:1,model:model.id}
      if('__syntheticProviderError'in output){
        res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:'{"reply":"partial synthetic output'},finish_reason:null}]})+'\n\n')
        res.end('data: '+JSON.stringify({error:{code:'InvalidParameter',message:String(output.__syntheticProviderError)}})+'\n\n')
        return
      }
      if('__syntheticPartial'in output){
        res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:String(output.__syntheticPartial)},finish_reason:null}]})+'\n\n')
        setTimeout(()=>res.destroy(),25)
        return
      }
      const {__syntheticFinishReason='stop',__syntheticTailDelayMs=0,__syntheticRaw,...businessOutput}=output as Record<string,unknown>
      res.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{role:'assistant',content:typeof __syntheticRaw==='string'?__syntheticRaw:JSON.stringify(businessOutput)},finish_reason:null}]})+'\n\n')
      const finish=()=>{if(!res.destroyed)res.end('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:__syntheticFinishReason}],usage:{prompt_tokens:200,completion_tokens:80,total_tokens:280,prompt_tokens_details:{cached_tokens:20}}})+'\n\ndata: [DONE]\n\n')}
      if(Number(__syntheticTailDelayMs)>0)setTimeout(finish,Number(__syntheticTailDelayMs));else finish()
    })
  })
  await new Promise<void>(resolve=>fake.listen(0,'127.0.0.1',resolve))
  const previousURL=model.baseUrl,previousKey=config.apiKey
  model.baseUrl='http://127.0.0.1:'+(fake.address() as {port:number}).port
  config.apiKey='synthetic-turn-contract-key'
  const user='turn-contract-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC turn contract'})
  const prepare=async(text:string,conversationId=chat,owner=user)=>{
    await pool.query("UPDATE runs SET status='failed',error_code='SYNTHETIC_TEST_CLEANUP',finished_at=now() WHERE user_id=$1 AND status='running'",[owner])
    const run=(await store.startRun(owner,conversationId,randomUUID(),text)).run
    const staged:store.Staged={candidates:[],audit:[]}
    return {run,staged,input:{run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:(_event:any)=>{}}}
  }
  try{
    await t.test('local rejected-output diagnostics are opt-in, synthetic-account-only and secret-redacted',async()=>{
      const enabled=config.syntheticModelDiagnosticsEnabled
      const diagnosticUsers=(config as any).syntheticDiagnosticUserIds
      try{
        config.syntheticModelDiagnosticsEnabled=true
        ;(config as any).syntheticDiagnosticUserIds=[]
        const ordinary=await prepare('请简短解释递归。')
        outputs.push({reply:'这是格式失败测试。',unexpected:'sk-synthetic-credential-placeholder'})
        await assert.rejects(engine(ordinary.input),{code:'COACH_OUTPUT_INVALID'})
        assert.ok(!ordinary.staged.audit.some((row:any)=>row.phase==='rejected_synthetic_business_output_captured'))
        await store.terminateRun(user,ordinary.run.request_id,'failed','COACH_OUTPUT_INVALID')
        await pool.query('UPDATE "user" SET name=$2,email=$3 WHERE id=$1',[user,'SYNTHETIC GRILLING diagnostics',`six-diagnostics-${randomUUID()}@example.invalid`])
        const notAuthorized=await prepare('请简短解释递归。')
        outputs.push({reply:'这是格式失败测试。',unexpected:'sk-synthetic-credential-placeholder'})
        await assert.rejects(engine(notAuthorized.input),{code:'COACH_OUTPUT_INVALID'})
        const unauthorizedCapture=notAuthorized.staged.audit.some((row:any)=>row.phase==='rejected_synthetic_business_output_captured')
        const unauthorizedFile=fileURLToPath(new URL(`../../.local/synthetic-model-diagnostics/${notAuthorized.run.request_id}.txt`,import.meta.url))
        assert.equal(existsSync(unauthorizedFile),false,'markers alone must not create a diagnostic file')
        assert.equal(unauthorizedCapture,false,'markers alone are not permission to capture private output')
        await store.terminateRun(user,notAuthorized.run.request_id,'failed','COACH_OUTPUT_INVALID')
        ;(config as any).syntheticDiagnosticUserIds=[user]
        await pool.query('UPDATE "user" SET name=$2,email=$3 WHERE id=$1',[user,'Ordinary diagnostic identity',user+'@example.invalid'])
        const mismatchedIdentity=await prepare('请简短解释递归。')
        outputs.push({reply:'非 synthetic 身份不得留下诊断文本。',unexpected:'sk-synthetic-credential-placeholder'})
        await assert.rejects(engine(mismatchedIdentity.input),{code:'COACH_OUTPUT_INVALID'})
        const mismatchedCapture=mismatchedIdentity.staged.audit.some((row:any)=>row.phase==='rejected_synthetic_business_output_captured')
        const mismatchedFile=fileURLToPath(new URL(`../../.local/synthetic-model-diagnostics/${mismatchedIdentity.run.request_id}.txt`,import.meta.url))
        assert.equal(mismatchedCapture,false,'an allowlisted user ID still needs one of the synthetic account identity patterns')
        assert.equal(existsSync(mismatchedFile),false)
        await store.terminateRun(user,mismatchedIdentity.run.request_id,'failed','COACH_OUTPUT_INVALID')
        await pool.query('UPDATE "user" SET name=$2,email=$3 WHERE id=$1',[user,'SYNTHETIC GRILLING diagnostics',`six-diagnostics-${randomUUID()}@example.invalid`])
        const synthetic=await prepare('请简短解释递归。')
        outputs.push({reply:'这是格式失败测试。',unexpected:'sk-synthetic-credential-placeholder'})
        await assert.rejects(engine(synthetic.input),{code:'COACH_OUTPUT_INVALID'})
        const capture=synthetic.staged.audit.find((row:any)=>row.phase==='rejected_synthetic_business_output_captured') as any
        assert.ok(capture)
        const expected=fileURLToPath(new URL(`../../.local/synthetic-model-diagnostics/${synthetic.run.request_id}.txt`,import.meta.url))
        assert.equal(capture.file,expected)
        const body=readFileSync(expected,'utf8')
        assert.match(body,/<REDACTED>/)
        assert.doesNotMatch(body,/sk-synthetic/)
        unlinkSync(expected)
        await store.terminateRun(user,synthetic.run.request_id,'failed','COACH_OUTPUT_INVALID')
        await pool.query('UPDATE "user" SET name=$2,email=$3 WHERE id=$1',[user,'LifeOS synthetic adult diagnostics',`lifeos-diagnostics-${randomUUID()}@example.invalid`])
        const existingAcceptanceAccount=await prepare('请简短解释递归。')
        outputs.push({reply:'这是现有验收账号格式的诊断捕获测试。',unexpected:'sk-synthetic-credential-placeholder'})
        await assert.rejects(engine(existingAcceptanceAccount.input),{code:'COACH_OUTPUT_INVALID'})
        const existingAccountCapture=existingAcceptanceAccount.staged.audit.find((row:any)=>row.phase==='rejected_synthetic_business_output_captured') as any
        assert.ok(existingAccountCapture,'explicitly allowlisted LifeOS synthetic acceptance accounts must retain redacted failures too')
        const existingAccountFile=fileURLToPath(new URL(`../../.local/synthetic-model-diagnostics/${existingAcceptanceAccount.run.request_id}.txt`,import.meta.url))
        assert.equal(existingAccountCapture.file,existingAccountFile)
        assert.match(readFileSync(existingAccountFile,'utf8'),/<REDACTED>/)
        assert.doesNotMatch(readFileSync(existingAccountFile,'utf8'),/sk-synthetic/)
        unlinkSync(existingAccountFile)
        await store.terminateRun(user,existingAcceptanceAccount.run.request_id,'failed','COACH_OUTPUT_INVALID')
        const accepted=await prepare('请简短解释递归。')
        outputs.push({reply:'递归就是让同一个过程处理更小的同类问题，并在边界条件停止。'})
        await engine(accepted.input)
        const acceptedCapture=accepted.staged.audit.find((row:any)=>row.phase==='synthetic_business_output_captured') as any
        assert.ok(acceptedCapture,'the same explicit synthetic scope retains pre-repair business text for latency diagnosis')
        const acceptedFile=fileURLToPath(new URL(`../../.local/synthetic-model-diagnostics/${accepted.run.request_id}.txt`,import.meta.url))
        assert.equal(acceptedCapture.file,acceptedFile)
        assert.equal(JSON.parse(readFileSync(acceptedFile,'utf8')).reply,'递归就是让同一个过程处理更小的同类问题，并在边界条件停止。')
        const transportCapture=accepted.staged.audit.find((row:any)=>row.phase==='synthetic_transport_output_captured') as any
        assert.ok(transportCapture,'diagnostics retain the transport independently of the parser input')
        assert.equal(transportCapture.file,acceptedFile.replace(/\.txt$/,'.transport.txt'))
        assert.equal(JSON.parse(readFileSync(transportCapture.file,'utf8')).reply,'递归就是让同一个过程处理更小的同类问题，并在边界条件停止。')
        unlinkSync(transportCapture.file)
        unlinkSync(acceptedFile)
        await store.terminateRun(user,accepted.run.request_id,'failed','SYNTHETIC_DIAGNOSTIC_COMPLETE')
        const interrupted=await prepare('请简短解释递归。')
        const requestCount=requests.length
        const partialText='{"reply":"尚未完成 sk-synthetic-credential-placeholder'
        outputs.push({__syntheticPartial:partialText})
        await assert.rejects(engine(interrupted.input),{code:'MODEL_REQUEST_FAILED'})
        assert.equal(requests.length-requestCount,1,'stream interruption must not trigger a replacement generation')
        const failureAudit=interrupted.staged.audit.find((row:any)=>row.phase==='model_call_failed') as any
        assert.equal(failureAudit?.failureCategory,'NETWORK','the retained audit must distinguish a stream transport failure from schema or semantic rejection')
        const failureUsage=(interrupted.staged.modelUsage as any).calls[0]
        assert.equal(failureUsage.failureCategory,'NETWORK','durable usage must retain the same bounded category')
        for(const retained of [failureAudit,failureUsage]){
          assert.equal('providerErrorMessage' in retained,false,'provider text must not enter durable diagnostics')
          assert.equal(JSON.stringify(retained).includes(partialText),false)
          assert.doesNotMatch(JSON.stringify(retained),/尚未完成|sk-synthetic-credential-placeholder|synthetic-turn-contract-key|terminated|premature(?:ly)? closed|socket hang up/i)
        }
        const partialCapture=interrupted.staged.audit.find((row:any)=>row.phase==='partial_synthetic_business_output_captured') as any
        assert.ok(partialCapture?.partial)
        const partialFile=fileURLToPath(new URL(`../../.local/synthetic-model-diagnostics/${interrupted.run.request_id}.txt`,import.meta.url))
        assert.equal(partialCapture.file,partialFile)
        assert.match(readFileSync(partialFile,'utf8'),/<REDACTED>/)
        assert.doesNotMatch(readFileSync(partialFile,'utf8'),/sk-synthetic/)
        unlinkSync(partialFile)
        assert.equal(interrupted.staged.coach,undefined)
        await store.terminateRun(user,interrupted.run.request_id,'failed','MODEL_REQUEST_FAILED')
      }finally{
        config.syntheticModelDiagnosticsEnabled=enabled
        ;(config as any).syntheticDiagnosticUserIds=diagnosticUsers
        await pool.query('UPDATE "user" SET name=$1,email=$2 WHERE id=$1',[user,user+'@example.invalid'])
      }
    })
    await t.test('saved provider JSON generation abort fails once with bounded durable diagnostics',async()=>{
      const saved=JSON.parse(readFileSync(new URL('../fixtures/bailian-json-generation-abort.json',import.meta.url),'utf8'))
      const turn=await prepare('请简短解释递归。'),before=requests.length
      outputs.push({__syntheticProviderError:saved.errorMessage})
      await assert.rejects(engine(turn.input),{code:'MODEL_REQUEST_FAILED'})
      assert.equal(requests.length-before,1)
      for(const retained of [(turn.staged.modelUsage as any).calls[0],turn.staged.audit.find((row:any)=>row.phase==='model_call_failed') as any]){
        assert.equal(retained.failureCategory,'SCHEMA_OR_FORMAT')
        assert.equal(JSON.stringify(retained).includes(saved.errorMessage),false)
        assert.doesNotMatch(JSON.stringify(retained),/partial synthetic output|synthetic-turn-contract-key/)
      }
      const diagnosticFile=fileURLToPath(new URL(`../../.local/synthetic-model-diagnostics/${turn.run.request_id}.txt`,import.meta.url))
      assert.equal(existsSync(diagnosticFile),false,'provider abort must not persist a partial payload outside explicit synthetic diagnostics')
      assert.equal(turn.staged.coach,undefined)
      await store.terminateRun(user,turn.run.request_id,'failed','MODEL_REQUEST_FAILED')
    })
    await t.test('provider output truncation retains its known stop category without a replacement generation',async()=>{
      const turn=await prepare('请简短解释递归。'),before=requests.length
      outputs.push({reply:'递归处理更小的同类问题。',__syntheticFinishReason:'length'})
      await assert.rejects(engine(turn.input),{code:'MODEL_OUTPUT_TRUNCATED'})
      assert.equal(requests.length-before,1)
      assert.equal((turn.staged.modelUsage as any).calls[0].failureCategory,'PROVIDER_STOP_REASON')
      assert.equal((turn.staged.audit.find((row:any)=>row.phase==='model_call_failed') as any).failureCategory,'PROVIDER_STOP_REASON')
      assert.equal(turn.staged.coach,undefined)
      await store.terminateRun(user,turn.run.request_id,'failed','MODEL_OUTPUT_TRUNCATED')
    })
    await t.test('a complete JSON prefix never cuts off a delayed authoritative usage receipt',async()=>{
      const turn=await prepare('请简短解释递归。'),before=requests.length
      outputs.push({reply:'递归处理更小的同类问题，并在边界条件停止。',__syntheticTailDelayMs:2100})
      const result=await engine(turn.input)
      assert.equal(requests.length-before,1)
      assert.equal((result.usage as any).calls[0].usageCompleteness,'complete')
      assert.equal((result.usage as any).calls[0].outputTokens,80)
      assert.ok(!turn.staged.audit.some((a:any)=>a.phase==='host_structured_frame_terminated'))
      await store.terminateRun(user,turn.run.request_id,'cancelled','SYNTHETIC_COMPLETE')
    })
    await t.test('only the explicit final JSON after a delimited draft can drive the committed turn',async()=>{
      const turn=await prepare('请简短解释递归。'),before=requests.length,frames:any[]=[]
      turn.input.emit=event=>frames.push(event)
      outputs.push({__syntheticRaw:JSON.stringify({reply:'中间草稿不可保存。',event:{invented:true}})+'\n</thinking>\n'+JSON.stringify({reply:'递归处理更小的同类问题，并在边界条件停止。'}),__syntheticTailDelayMs:2100})
      const result=await engine(turn.input)
      assert.equal(requests.length-before,1)
      assert.equal(result.text,'递归处理更小的同类问题，并在边界条件停止。')
      assert.equal((result.usage as any).calls[0].usageCompleteness,'complete')
      assert.equal(turn.staged.coach,undefined)
      assert.ok(turn.staged.audit.some((a:any)=>a.phase==='coach_output_normalized'&&a.kind==='explicit_final_json_frame'))
      if(frames.some(f=>f.type==='draft'&&f.text==='中间草稿不可保存。'))assert.ok(frames.some(f=>f.type==='draft_discarded'))
      await store.terminateRun(user,turn.run.request_id,'cancelled','SYNTHETIC_COMPLETE')
    })
    await t.test('an explicit comparison cannot commit a question-only replacement for requested options',async()=>{
      const text='请比较两个低成本的自我观察办法，只比较，不安排任务。'
      const turn=await prepare(text)
      const before=requests.length
      outputs.push({reply:'你想探索什么具体方向？'})
      await assert.rejects(engine(turn.input),{code:'REPLY_COMPARISON_MISSING'})
      assert.equal(requests.length-before,1)
      const payload=requests.at(-1)
      assert.equal(payload.response_format.json_schema.schema.properties.reply.allOf.length,2)
      assert.equal(payload.response_format.json_schema.schema.properties.lead,undefined)
      assert.match(payload.messages.find((message:any)=>message.role==='system').content,/reply第一个字符直接从“方式一：”开始，不写前言，不给标签加Markdown粗体/)
      const prompt=JSON.parse(payload.messages.find((message:any)=>message.role==='user').content)
      const authorized=prompt.authorizedContext??prompt
      assert.equal(authorized.currentTask.responseScope.comparisonRequested,true)
      assert.equal(turn.staged.coach,undefined)
      const valid=await prepare(text)
      const comparison='方式一：若有现成学习记录，回看其中已做过的事情，不补猜能力。方式二：若之后愿意观察，只选一次已有日程中的活动，不增加安排。前者无需新行动，后者仅提供局部线索，均不证明职业适合。'
      outputs.push({reply:comparison})
      const result=await engine(valid.input)
      assert.equal(result.text,comparison)
      assert.equal(valid.staged.coach,undefined)
    })
    await t.test('requested understanding does not commit a repeated question followed by status acknowledgements',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC understanding delivery'})
      const text='我现在更在意专注时段。依据这条反馈更新自由的理解；现在不继续行动。'
      const turn=await prepare(text,conversation),before=requests.length
      outputs.push({reply:'地点自由但每天两次会，这和你在意的自主安排专注时间冲突吗？目前没有对照，创业不重开，现在不继续行动。'})
      await assert.rejects(engine(turn.input),{code:'REPLY_SUMMARY_MISSING'})
      assert.equal(requests.length-before,1,'no replacement generation')
      assert.equal(turn.staged.coach,undefined)
      const schema=requests.at(-1).response_format.json_schema.schema
      assert.equal(schema.properties.lead,undefined,'judgment updates generate their integrated reply without a duplicate lead')
      assert.ok(!schema.required.includes('lead'))
      assert.equal(schema.properties.reply.maxLength,100)
      assert.equal(schema.properties.reply.pattern,'^[^？?]*$')
      assert.equal(requests.at(-1).messages.find((message:any)=>message.role==='system').content.includes('本轮交付阶段理解：直接给有依据的暂定理解'),true,'the actual runtime instruction must match the no-question summary schema')
      assert.match(requests.at(-1).messages.find((message:any)=>message.role==='system').content,/reply任何位置都不能出现问号或疑问句；把未知写成“仍未知的是…”陈述句/,'the summary wire must override the generic exploration-question default with an executable declarative form')
      assert.match(requests.at(-1).messages.find((message:any)=>message.role==='system').content,/结论只限于实际查看或经历的这些对象，不能外推到整座城市、整类机会或整条路径/)
      assert.match(requests.at(-1).messages.find((message:any)=>message.role==='system').content,/本人明确尚不能区分两个因素时，暂定理解不得先归因于其中一个；本轮未请求行动，不安排区分动作/)
      assert.match(requests.at(-1).messages.find((message:any)=>message.role==='system').content,/任一已授权来源报告过的试用、收到、阅读、回复、采用或效果，只对该来源明确指向的同一人物、同一事项保留/)
      assert.ok(schema.properties.growthUpdates,'summary presentation does not close real fact updates')
      await store.terminateRun(user,turn.run.request_id,'failed','REPLY_SUMMARY_MISSING')
    })
    await t.test('a source-bound result survives both summary repair passes without legacy downgrade',async()=>{
      const text='接着整理资料的探索。最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。请根据新信息更新判断，不要重复问已经回答的内容。'
      const reply='最近一次我先定了三条分类规则。后来同学能直接找到两份材料，少问了我一次。这仍不能证明稳定效果。仍未知的是这三条规则的具体内容、同学是否实际阅读了材料、以及少问一次是否由规则直接导致。'
      const turn=await prepare(text)
      outputs.push({lead:'最近一次我先定了三条分类规则。',reply})
      const result=await engine(turn.input)
      assert.equal(result.text,reply,'the reported result must remain unchanged through both summary repair passes')
      assert.ok(!turn.staged.serverGoals?.some(goal=>goal.quote==='最近一次我先定了三条分类规则'),'deterministic capture cannot turn a past action into a goal')
      await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.ok(!(await growthContext(user,chat)).some(item=>item.kind==='goal'&&item.text==='最近一次我先定了三条分类规则'),'the committed memory keeps the event out of active goals')
    })
    await t.test('the actual final C6 causal assertion is bounded by the existing shared repair with no second generation',async()=>{
      const turn=await prepare('接着整理资料的探索。最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。请根据新信息更新判断，不要重复问已经回答的内容。'),before=requests.length
      const lead='这次你定三条分类规则后，同学直接找到两份材料并少问一次，说明提前给结构能减少沟通往返。'
      outputs.push({lead,reply:lead+'这些只记录本次经历，不推为稳定方法。'})
      const result=await engine(turn.input)
      assert.doesNotMatch(result.text,/说明提前给结构能减少沟通往返/)
      assert.match(result.text,/不能确认因果关系或普遍效果/)
      assert.match(result.text,/找到两份材料并少问一次/)
      assert.equal(requests.length-before,1)
    })
    await t.test('a faithful summary paraphrase is preserved without forcing source quotation',async()=>{
      const text='我整理过表格，后来同学直接找到了材料，少问了我一次。请根据新信息更新判断。'
      const reply='这次整理后同学找到了材料，也少问了一次。仍不能确认这是分类方法造成的，长期效果也未知。'
      const turn=await prepare(text),before=requests.length
      outputs.push({lead:'这次整理后同学找到了材料，也少问了一次。',reply})
      const result=await engine(turn.input)
      assert.equal(result.text,reply)
      assert.equal(requests.length-before,1,'preserving source meaning does not trigger a replacement generation')
    })
    await t.test('a partial-state summary retains authorized prior evidence without mandatory history replay',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC prior reported result'})
      for(let index=0;index<5;index++){
        const prior=await prepare(`最近一次我整理了第${index+1}份表格，后来同学直接找到了材料，少问了我一次。`,conversation)
        outputs.push({reply:'这是一次具体反馈，原因和长期效果仍未知。',...(index===0?{event:{target:{operation:'create',title:'整理表格',source:{messageId:prior.run.source_message_id,quote:'最近一次我整理了第1份表格'}},nodes:[{kind:'fact',source:{messageId:prior.run.source_message_id,quote:'少问了我一次'}}]}}:{})})
        const seeded=await engine(prior.input)
        await store.finishRun(prior.run,prior.staged,seeded.text,seeded.usage,new AbortController().signal)
      }
      const turn=await prepare('这周只剩二十分钟。请根据新信息更新判断。',conversation),before=requests.length
      const reply='表格已有实际查找反馈。这周只剩二十分钟；此前找到了材料且少问一次的结果保留，原因与长期效果仍未知。'
      outputs.push({lead:'表格已有实际查找反馈。',reply})
      const result=await engine(turn.input)
      assert.equal(result.text,reply)
      assert.equal(requests.length-before,1)
      assert.ok(JSON.stringify(requests.at(-1).messages).includes('少问了我一次'),'authorized historical evidence remains in the actual role-separated model context')
    })
    await t.test('an explicitly requested distinction action gets the one-factor evidence boundary on the actual wire',async()=>{
      const text='接着羽毛球那次体验。我想保留这种不被评价的陪伴，但不确定是运动本身还是这个室友带来的。请给暂定理解和一个很小的区分办法。'
      const turn=await prepare(text)
      outputs.push({lead:'目前还不能区分运动和室友各自的作用。',reply:'目前还不能区分运动和室友各自的作用。只做一次区分：仍和这位室友，把羽毛球换成一次散步，结束后记录是否仍有不用表现的感觉。'})
      const result=await engine(turn.input),wire=requests.at(-1)
      assert.match(wire.messages.find((message:any)=>message.role==='system').content,/若本人请求区分办法，一次只改变一个因素/)
      assert.match(result.text,/还不能区分/)
    })
    await t.test('equivalent unresolved two-factor wording gets the same one-factor boundary',async()=>{
      const text='我还不清楚究竟是运动本身还是室友带来的，请给一个很小的区分办法。'
      const turn=await prepare(text)
      outputs.push({lead:'目前还不能区分运动和室友各自的作用。',reply:'目前还不能区分运动和室友各自的作用。只做一次区分：保持同一位室友，把运动换成散步，只记录结果。'})
      await engine(turn.input)
      assert.match(requests.at(-1).messages.find((message:any)=>message.role==='system').content,/若本人请求区分办法，一次只改变一个因素/)
    })
    await t.test('comma before the two-factor conjunction keeps the bounded action lane valid',async()=>{
      const text='我还不清楚到底是运动本身，还是室友带来的，请给一个很小的区分办法。'
      const turn=await prepare(text)
      outputs.push({lead:'目前还不能区分。',reply:'先换一项再观察。'})
      const result=await engine(turn.input)
      assert.match(result.text,/只有“运动本身”不同的经历/)
    })
    await t.test('a distinction reply that changes both factors is replaced by the one-factor server contract',async()=>{
      const text='我还不清楚究竟是运动本身还是室友带来的，请给一个很小的区分办法。'
      const turn=await prepare(text),before=requests.length
      outputs.push({lead:'目前还不能区分运动和室友各自的作用。',reply:'目前还不能区分运动和室友各自的作用。下次换成散步、换一个室友，并记录结果。'})
      const result=await engine(turn.input)
      assert.equal(requests.length-before,1,'deterministic distinction repair must not retry')
      assert.match(result.text,/只有“运动本身”不同的经历/)
      assert.doesNotMatch(result.text,/换成散步|换一个室友|延长/)
    })
    await t.test('an ordinary action request does not receive the distinction-only prompt',async()=>{
      const text='请给我一个低成本的下一步行动。'
      const turn=await prepare(text)
      outputs.push({lead:'先用10分钟写下你当前要处理的问题。',reply:'先用10分钟写下你当前要处理的问题，写完就停。'})
      await assert.rejects(engine(turn.input),{code:'BOUNDED_REPLY_INVALID'})
      const system=requests.at(-1).messages.find((message:any)=>message.role==='system').content
      assert.doesNotMatch(system,/若本人请求区分办法/)
      assert.match(system,/少量样本不设置为整个方向的筛选阈值/)
    })
    await t.test('two requested distinction methods are not replaced by the single-action contract',async()=>{
      const text='我还不清楚究竟是运动本身还是室友带来的，请给两个很小的区分办法。'
      const turn=await prepare(text)
      const reply='可以先从已有经历寻找线索。办法一：若有同伴相同而活动不同的记录，只回看这组差异。办法二：若有活动相同而同伴不同的记录，只回看这组差异。找不到可比记录就停，差异也不能确认因果。'
      outputs.push({lead:'可以先从已有经历寻找线索。',reply})
      const result=await engine(turn.input)
      assert.equal(result.text,reply)
      assert.doesNotMatch(requests.at(-1).messages.find((message:any)=>message.role==='system').content,/若本人请求区分办法/)
    })
    await t.test('material plan comparison and one-sentence contracts exclude the distinction prompt',async()=>{
      for(const text of [
        '请给我一份只改变一个因素的实验记录模板。',
        '我这周有两小时，请安排只改变一个因素的实验计划。',
        '请比较两个只改变一个因素的区分办法。',
        '只用一句话给我一个只改变一个因素的区分办法。',
      ]){
        const turn=await prepare(text)
        outputs.push({reply:'这是故意无效的契约测试输出。',unexpected:true})
        await assert.rejects(engine(turn.input),{code:'COACH_OUTPUT_INVALID'})
        const system=requests.at(-1).messages.find((message:any)=>message.role==='system').content
        assert.doesNotMatch(system,/若本人请求区分办法/,text)
        await store.terminateRun(user,turn.run.request_id,'failed','COACH_OUTPUT_INVALID')
      }
    })
    await t.test('a summary keeps an attributed trial on its reported person and leaves the user state independent',async()=>{
      const text='室友说她试用过那个表格；我没有说自己试过。请更新当前理解。'
      const reply='室友报告她试用过那个表格；你本人是否试用仍未报告，这两个状态分开保留。'
      const turn=await prepare(text)
      outputs.push({lead:'室友报告她试用过那个表格；你本人是否试用仍未报告，这两个状态分开保留。',reply})
      const result=await engine(turn.input),wire=requests.at(-1)
      assert.match(wire.messages.find((message:any)=>message.role==='system').content,/只对该来源明确指向的同一人物、同一事项保留/)
      assert.match(wire.messages.find((message:any)=>message.role==='system').content,/引用、假设或他人状态不能变成本人状态/)
      assert.match(result.text,/室友报告她试用过/)
      assert.match(result.text,/你本人是否试用仍未报告/)
    })
    await t.test('saved real summary cannot promote a personal preference into a required path constraint',async()=>{
      const saved=JSON.parse(readFileSync(new URL('../fixtures/real-rx-summary-modality.json',import.meta.url),'utf8'))
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC preference modality'})
      const turn=await prepare(saved.userMessage,conversation),before=requests.length
      outputs.push(saved.response)
      await assert.rejects(engine(turn.input),{code:'REPLY_PREFERENCE_HARDENED'})
      assert.equal(requests.length-before,1,'unsupported modality must not cause a replacement generation')
      assert.equal(turn.staged.coach,undefined)
      await store.terminateRun(user,turn.run.request_id,'failed','REPLY_PREFERENCE_HARDENED')
    })
    await t.test('source-modality rejection also suppresses a model preview while an owned hard requirement remains usable',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC modality preview'})
      const turn=await prepare('我更在意留在目前城市，而且每周最多四小时探索。请更新理解，不要替我选。',conversation)
      const frames:any[]=[];turn.input.emit=(frame:any)=>{frames.push(frame)}
      const unsupported='你当前表达的城市偏好是一项必须满足的条件。'
      outputs.push({lead:unsupported,reply:unsupported+'时间仍以每周四小时为上限。'})
      await assert.rejects(engine(turn.input),{code:'REPLY_PREFERENCE_HARDENED'})
      assert.equal(frames.some(frame=>frame.type==='draft'&&frame.text?.includes('必须满足')),false,'rejected modality must not become provisional user-facing help')
      await store.terminateRun(user,turn.run.request_id,'failed','REPLY_PREFERENCE_HARDENED')
      const leadOnly=await prepare('我更在意留在目前城市，而且每周最多四小时探索。请更新理解，不要替我选。',conversation)
      outputs.push({lead:'留在目前城市是必须满足的硬条件。',reply:'留在目前城市是本轮报告的偏好；每周四小时仍是时间上限。'})
      await assert.rejects(engine(leadOnly.input),{code:'REPLY_PREFERENCE_HARDENED'})
      await store.terminateRun(user,leadOnly.run.request_id,'failed','REPLY_PREFERENCE_HARDENED')
      const owned=await prepare('我更在意留在目前城市。我必须留在目前城市。每周最多四小时探索。请更新理解，不要提问。',conversation)
      const reply='留在目前城市的偏好已由你明确设为硬要求。每周四小时仍是时间上限；具体选项是否兼容还需核实。'
      outputs.push({reply})
      assert.equal((await engine(owned.input)).text,reply)
      await store.terminateRun(user,owned.run.request_id,'failed','SYNTHETIC_MODALITY_COMPLETE')
    })
    await t.test('a reported reply cannot commit an unsupported read claim after legacy prose repair',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC unsupported reading'})
      const turn=await prepare('回来反馈：老师后来回复说这周忙，下周再看；同学表格仍是明确不适合他。请更新当前理解，保留各自未知。',conversation)
      const before=requests.length
      outputs.push({lead:'老师回复已读、同学反馈明确不适合，两条状态按你要求记录。',reply:'老师回复已读、同学反馈明确不适合，两条状态按你要求记录。当前无授权事件可写入，若需建事件追踪请提供对应事项名称；未回复原因保持未知，不列举猜测。'})
      await assert.rejects(engine(turn.input),{code:'REPLY_STATE_NOT_SUPPORTED'})
      assert.equal(requests.length-before,1,'reject once, never a paid correction retry')
      const prompt=JSON.parse(requests.at(-1).messages.find((message:any)=>message.role==='user').content)
      const teacher=(prompt.authorizedContext??prompt).currentTask.responseScope.reportedEvidence.participantReports.find((item:any)=>item.actor==='老师')
      assert.equal(teacher.states['回复'].status,'本人报告已回复')
      assert.equal(teacher.states['原材料阅读'],undefined,'absence is not a new unknown-state assertion')
      await store.terminateRun(user,turn.run.request_id,'failed','REPLY_STATE_NOT_SUPPORTED')
    })
    await t.test('finite comparison and one-action boundaries reject captured unsupported expansion without retry',async()=>{
      for(const item of [
        {text:'我还没有客户，每周最多两小时。请比较一个更低成本的探索方式。',reply:'能比较的方式只有两类。\n方式一：在既有安排中观察一次专注时段，结果未知。\n方式二：若有现成材料只回看一次，不安排两项任务。',code:'REPLY_COMPARISON_UNBOUNDED'},
        {text:'我想保留这种陪伴，但不确定是运动本身还是这个室友带来的。请给暂定理解和一个很小的区分办法。',reply:'先找一次不运动的相处机会；如果感受不同，再试一次运动。做完这两次对照就停。',code:'REPLY_ACTION_LIMIT'},
      ]){
        const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC expansion guard'})
        const turn=await prepare(item.text,conversation),before=requests.length;outputs.push({reply:item.reply})
        await assert.rejects(engine(turn.input),{code:item.code})
        assert.equal(requests.length-before,1)
        assert.equal(turn.staged.growth,undefined)
        await store.terminateRun(user,turn.run.request_id,'failed',item.code)
      }
    })
    await t.test('actual NS comparison disclaimer survives the full engine with its reported personal context',async()=>{
      const actual=JSON.parse(readFileSync(new URL('../fixtures/ns-negated-comparison-failure.json',import.meta.url),'utf8'))
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC NS negated exclusivity'})
      const turn=await prepare([...actual.historyUserTexts,actual.user].join('\n'),conversation),before=requests.length
      outputs.push(actual.raw)
      const result=await engine(turn.input)
      assert.equal(result.text,actual.raw.reply,'the helpful comparison is delivered intact rather than rewritten')
      assert.equal(requests.length-before,1,'no second semantic repair request')
      await store.terminateRun(user,turn.run.request_id,'failed','SYNTHETIC_GUARD_ONLY_REPLAY')
    })
    await t.test('a valid JSON string with a dangling internal-state reply is rejected before legacy punctuation repair',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC incomplete prose'})
      const turn=await prepare('回来反馈：老师后来回复说这周忙，下周再看。请更新当前理解。',conversation),before=requests.length
      outputs.push({reply:'老师：response 由 reported_no_response 更新为 reported_response（原话'})
      await assert.rejects(engine(turn.input),{code:'REPLY_INCOMPLETE_OR_INTERNAL'})
      assert.equal(requests.length-before,1)
      assert.equal(turn.staged.growth,undefined)
      await store.terminateRun(user,turn.run.request_id,'failed','REPLY_INCOMPLETE_OR_INTERNAL')
    })
    await t.test('source context survives sessions with objects intact but never bypasses Memory OFF or precise forgetting',async()=>{
      const owner='source-context-'+randomUUID(),chats=Array.from({length:5},()=>randomUUID())
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[owner,owner+'@example.invalid'])
      await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1)',[owner])
      for(const id of chats)await store.createConversation(owner,{id,title:'SYNTHETIC referent context'})
      const text='我是成年大学生，身边同学都在准备考研，我也跟着想报，但我还说不清自己要什么。'
      const fragment='我也跟着想报',clauseId=buildClauseCatalogue(text).find(clause=>clause.text===fragment)!.clauseId
      const execute=async(content:string,chat:ReturnType<typeof randomUUID>,output:any={reply:'只保留本人报告的具体线索，不把未知补成结论。'})=>{
        const turn=await prepare(content,chat,owner);outputs.push(output)
        const result=await engine(turn.input);await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      }
      await execute(text,chats[0]!,{reply:'先厘清你希望这条路径改变什么。',growthUpdates:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId}}]})
      const feeling='我是成年大学生，昨晚和室友打羽毛球后觉得轻松。'
      await execute(feeling,chats[1]!)
      const uncertainGoal='我想保留这种不被评价的陪伴，但不确定是运动本身还是这个室友带来的。'
      await execute(uncertainGoal,chats[1]!,{reply:'运动和这位室友同时出现，仍不能区分原因。'})
      const facts=(await pool.query('SELECT id,revision,text,kind FROM growth_items WHERE user_id=$1',[owner])).rows
      assert.ok(facts.some((item:any)=>item.kind==='context'&&item.text===text.slice(0,-1)))
      assert.ok(facts.some((item:any)=>item.kind==='context'&&item.text===feeling.slice(0,-1)))
      assert.ok(facts.some((item:any)=>item.kind==='context'&&item.text===uncertainGoal.slice(0,-1)),'server-captured goal anchors its adjacent unresolved question even when model omitted the goal lane')
      await execute('请保留仍相关的本人报告。',chats[2]!)
      assert.ok(JSON.stringify(requests.at(-1)).includes('身边同学都在准备考研'))
      assert.ok(JSON.stringify(requests.at(-1)).includes('昨晚和室友打羽毛球后觉得轻松'))
      assert.ok(JSON.stringify(requests.at(-1)).includes('但不确定是运动本身还是这个室友带来的'))
      await pool.query('UPDATE user_memory_settings SET enabled=false,revision=revision+1 WHERE user_id=$1',[owner])
      await execute('只用本轮报告。',chats[3]!)
      assert.ok(!JSON.stringify(requests.at(-1)).includes(fragment))
      assert.ok(!JSON.stringify(requests.at(-1)).includes('羽毛球'))
      await pool.query('UPDATE user_memory_settings SET enabled=true,revision=revision+1 WHERE user_id=$1',[owner])
      const target=facts.find((item:any)=>item.text===fragment)!,client=await pool.connect()
      try{await client.query('BEGIN');await applyGrowthAction(client,owner,target.id,{action:'forget',expectedRevision:target.revision,requestId:randomUUID()});await client.query('COMMIT')}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
      await execute('只沿用仍可使用的报告。',chats[4]!)
      assert.ok(!JSON.stringify(requests.at(-1)).includes(fragment),'overlapping wider context cannot resurrect the forgotten fragment')
      assert.ok(JSON.stringify(requests.at(-1)).includes('羽毛球'),'unrelated retained context remains available')
    })
    await t.test('captured real numbered comparison survives the normal engine unchanged (simulated replay, not a paid retry)',async()=>{
      const text='我是成年大学生。我还没有客户，也没有自由职业经历，每周最多两小时。我希望有能自主安排的专注时间，但不想找客户或收款。请比较一个更低成本的探索方式，不要推出我适合自由职业。'
      const replayUser='comparison-replay-'+randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[replayUser,replayUser+'@example.invalid'])
      const conversation=randomUUID();await store.createConversation(replayUser,{id:conversation,title:'SYNTHETIC captured comparison replay'})
      const turn=await prepare(text,conversation,replayUser)
      const raw=JSON.parse(readFileSync(new URL('../fixtures/real-comparison-cy.txt',import.meta.url),'utf8'))
      const before=requests.length
      outputs.push(raw)
      const result=await engine(turn.input)
      assert.equal(result.text,raw.reply,'do not relabel, prefix-parse or rewrite the real comparison into a different answer')
      assert.equal(requests.length-before,1)
      await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.equal((await store.runStatus(replayUser,turn.run.request_id)).status,'completed')
    })
    await t.test('a long optional preview cannot fail or truncate an otherwise valid ordinary reply',async()=>{
      const turn=await prepare('请简短解释为什么科学实验要控制其他条件，只回答知识。')
      const longLead='控制其他条件是为了把不同条件带来的影响分开辨认，避免同时改变多个条件后直接判断某个条件造成了全部结果。'
      assert.ok([...longLead].length>48)
      outputs.push({lead:longLead,reply:longLead})
      const before=requests.length
      const result=await engine(turn.input)
      assert.equal(result.text,longLead)
      assert.equal(requests.length-before,1,'presentation repair never regenerates')
      const schema=requests.at(-1).response_format.json_schema.schema
      assert.equal(schema.properties.lead.maxLength,240,'optional preview keeps its canonical contract rather than a conflicting wire hint')
      assert.equal(schema.properties.reply.maxLength,16000,'compact lead does not truncate the delivered reply')
      assert.equal(turn.staged.coach,undefined)
    })
    await t.test('a one-sentence readiness summary keeps personal facts but closes unrelated event mutation',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC retained C6 summary contract'})
      const text='我今天没精力继续验证，先暂停这个方向，不要再安排动作。只给一句阶段理解，等我以后主动回来再继续。'
      const turn=await prepare(text,conversation),quote='我今天没精力继续验证'
      outputs.push({reply:'目前只有一次检索线索，稳定效果与方向适配仍未知；现在暂停，等你主动回来。',growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:buildClauseCatalogue(text).find(c=>c.text===quote)!.clauseId}}]})
      const result=await engine(turn.input),properties=requests.at(-1).response_format.json_schema.schema.properties
      assert.ok(properties.growthUpdates,'a real current personal fact remains representable')
      assert.equal(properties.event,undefined,'a requested understanding is not an event mutation')
      assert.ok(turn.staged.audit.some((row:any)=>row.phase==='provider_native_contract'&&row.type==='json_schema'&&row.strict===true&&!row.properties.includes('event')))
      assert.ok(turn.staged.audit.some((row:any)=>row.phase==='provider_stream_assembly'&&row.streamMatchesResult===true))
      await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.ok((await growthContext(user,conversation)).some(item=>item.text===quote))
      const feedback=await prepare('我把奖学金材料按三条规则整理了一次，第二天大约20秒找到通知。只给一句阶段理解。',conversation)
      outputs.push({reply:'这次整理后约20秒找到通知仍只是单次结果，不证明职业适合或稳定效果。'})
      const updated=await engine(feedback.input)
      assert.ok(requests.at(-1).response_format.json_schema.schema.properties.event,'actual performed feedback retains event mutation')
      await store.finishRun(feedback.run,feedback.staged,updated.text,updated.usage,new AbortController().signal)
      await pool.query('DELETE FROM growth_items WHERE user_id=$1 AND conversation_id=$2',[user,conversation])
    })
    await t.test('ending after an unconfirmed label rejection commits only the actual boundary without a model call',async()=>{
      const owner='closing-control-'+randomUUID(),conversation=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[owner,owner+'@example.invalid'])
      const {setMemorySettings}=await import('../../server/memory.ts')
      await setMemorySettings(owner,{enabled:true,expectedRevision:0,requestId:randomUUID()})
      await store.createConversation(owner,{id:conversation,title:'SYNTHETIC closing control'})
      const text='忘掉“我喜欢销售”这个从未由我确认的错误标签；不要从这些经历重新推出来。现在结束，不安排下一步。'
      const turn=await prepare(text,conversation,owner),before=requests.length
      const result=await engine(turn.input)
      assert.equal(requests.length,before,'a pure control plus closing has no provider dispatch')
      assert.equal((result.usage as any).llmCallCount,0)
      assert.doesNotMatch(result.text,/告诉我|关键词|已遗忘|已删除/)
      assert.match(result.text,/未保存记录|已保存记录/)
      assert.match(result.text,/边界已保留/)
      await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      const memory=await growthContext(owner,conversation)
      assert.ok(memory.some(item=>item.inferenceBoundary?.active))
      assert.ok(!memory.some(item=>/现在结束|不安排下一步/.test(item.text)))
      await setMemorySettings(owner,{enabled:false,expectedRevision:1,requestId:randomUUID()})
      const off=await prepare(text,conversation,owner),offResult=await engine(off.input)
      assert.equal(requests.length,before)
      assert.doesNotMatch(offResult.text,/边界已保留/)
      assert.match(offResult.text,/未保存新的跨会话边界/)
      await store.finishRun(off.run,off.staged,offResult.text,offResult.usage,new AbortController().signal)
    })
    await t.test('current and persisted pauses gate aliases in drafts while a sourced unrelated question can stream',async()=>{
      for(const topic of ['保研','接单']){
        const owner='alias-preview-'+randomUUID(),conversation=randomUUID()
        await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[owner,owner+'@example.invalid'])
        await store.createConversation(owner,{id:conversation,title:'SYNTHETIC alias preview boundary'})
        for(const currentPause of [true,false]){
          const turn=await prepare(`我想要${topic}。我想要自由。${currentPause?'先暂停'+topic+'。':''}先问我一个问题。`,conversation,owner),frames:any[]=[]
          turn.input.emit=(frame:any)=>{frames.push(frame)}
          outputs.push({lead:`你说的“${topic}”具体指什么？`,reply:'你说的“自由”具体指什么？'})
          const result=await engine(turn.input)
          assert.ok(!frames.some(frame=>frame.type==='draft'&&frame.text.includes(topic)),topic+(currentPause?' current':' persisted'))
          assert.ok(frames.some(frame=>frame.type==='draft'&&frame.text==='你说的“自由”具体指什么？'))
          await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
        }
      }
    })
    await t.test('a real36 count observation cannot retain an unsupported cause in its judgment',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC count cause guard'})
      const turn=await prepare('接着整理资料的探索。最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。请根据新信息更新判断，不要重复问已经回答的内容。',conversation)
      const frames:any[]=[];turn.input.emit=(frame:any)=>{frames.push(frame)}
      outputs.push({reply:'新信息支持分类规则让同学少问一次，但这是单次观察。是否偶然仍未知；本人目的与偏好不变。'})
      const before=requests.length,result=await engine(turn.input)
      assert.equal(requests.length-before,1)
      assert.match(result.text,/少问了我一次/)
      assert.match(result.text,/原因仍未知/)
      assert.doesNotMatch(result.text,/支持分类规则让/)
      assert.ok(frames.some(frame=>frame.type==='draft'&&frame.verifiedFeedback&&/原因仍未知/.test(frame.text)))
      await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
    })
    await t.test('saved real36 repeated living experiences keep observed feelings in committed star-map records',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC daily repeated feeling'})
      const reports=[
        '我是成年大学生，昨晚和室友打羽毛球后觉得轻松。请从生活体验聊起，不要加付款、采用、效率评分或职业标签。先问一个值得问的问题。',
        '回来反馈：一周后我又和同一个室友打了一次，仍然放松，但当天身体累所以提前结束。不要用一次疲惫推翻之前的感受。',
      ]
      const messageIds:string[]=[]
      for(const [index,text] of reports.entries()){
        const turn=await prepare(text,conversation);messageIds.push(turn.run.source_message_id)
        const catalogue=buildClauseCatalogue(text),action=catalogue.find(c=>/打羽毛球|打了一次/.test(c.text))!,end=index===0?action:catalogue.find(c=>c.text.includes('提前结束'))!
        outputs.push({reply:index===0?'这次轻松，具体是什么感觉？':'这次仍然放松，同时身体累而提前结束；原因还不能据此确定。',experienceCandidate:{source:{clauseIds:catalogue.filter(c=>c.start>=action.start&&c.end<=end.end).map(c=>c.clauseId)},action:{clauseId:action.clauseId},...(index===1?{result:{clauseId:end.clauseId}}:{})}})
        const result=await engine(turn.input)
        await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      }
      const rows=(await pool.query('SELECT source_message_id,content FROM experiences WHERE user_id=$1 AND conversation_id=$2 ORDER BY created_at',[user,conversation])).rows
      assert.equal(rows.length,2,'an explicit later occurrence must not overwrite the first episode')
      assert.deepEqual(rows.map(r=>r.source_message_id),messageIds)
      assert.match(rows[0].content.result,/觉得轻松/)
      assert.match(rows[1].content.result,/仍然放松/)
      assert.match(rows[1].content.result,/身体累/)
      const view=await store.cognitionGraph(user)
      const nodes=view.nodes.filter((n:any)=>n.type==='experience'&&messageIds.includes(n.sourceMessageId)) as any[]
      assert.equal(nodes.length,2)
      for(const node of nodes){assert.doesNotMatch(node.experienceSummary.result,/尚未记录/);assert.ok(!node.outcomeKeys.includes('adoption'));assert.ok(!node.outcomeKeys.includes('payment'))}
    })
    await t.test('real36 definition answers close the asked unknown while adjacent outcome evidence cannot close a preference gap',async()=>{
      const owner='unknown-fields-'+randomUUID(),conversation=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[owner,owner+'@example.invalid'])
      await store.createConversation(owner,{id:conversation,title:'SYNTHETIC sourced freedom definition'})
      const first=await prepare('我是成年大学生，我想要更自由的生活，但明确不想创业。不要换词劝我创业，先问一个问题厘清我说的自由。',conversation,owner)
      outputs.push({reply:'你说的“自由”具体是指时间上的自主安排，还是经济上不被固定工作绑定？',event:{target:{operation:'create',title:'更自由的生活',source:{messageId:first.run.source_message_id,quote:'我想要更自由的生活'}},nodes:[{kind:'unknown',question:'你所说的“自由”具体指什么维度（如时间、地点、经济来源或决策权）？'}]}})
      const asked=await engine(first.input);await store.finishRun(first.run,first.staged,asked.text,asked.usage,new AbortController().signal)
      const {coachEventView}=await import('../../server/action-coach-events.ts')
      const event=(await coachEventView(owner,conversation))!,unknown=event.nodes.find(n=>n.kind==='unknown')!
      assert.equal(unknown.content,asked.text,'the saved question is the one actually shown, without invented alternatives')
      const next=await prepare('我主要在意能自己安排一天中专注工作的时间，不在意当老板，也不想承担找客户和收款。',conversation,owner)
      const reply='你更在意能自己安排一天中专注工作的时间，这澄清了你说的自由；是否适合某类工作仍未知。'
      // Two independent simulated outputs test the protocol boundary; this
      // never retries a production/paid request or changes the run's source.
      outputs.push({reply})
      await assert.rejects(engine({...next.input,staged:{candidates:[],audit:[]}}),{code:'COACH_UNKNOWN_DISPOSITION_MISSING'})
      assert.equal((await coachEventView(owner,conversation,event.id))!.nodes.find(n=>n.id===unknown.id)!.status,'active')
      outputs.push({reply,event:{target:{operation:'continue',eventId:event.id,expectedRevision:event.revision},resolveUnknowns:[unknown.id]}})
      const answered=await engine(next.input);await store.finishRun(next.run,next.staged,answered.text,answered.usage,new AbortController().signal)
      assert.ok(requests.at(-1).response_format.json_schema.schema.required.includes('event'))
      assert.equal((await coachEventView(owner,conversation,event.id))!.nodes.find(n=>n.id===unknown.id)!.status,'resolved')

      const other=randomUUID();await store.createConversation(owner,{id:other,title:'SYNTHETIC outcome does not answer preference'})
      const opening=await prepare('最近整理一门课的资料时，我发现自己愿意把零散内容分成几类。先问一个问题。',other,owner)
      const question='具体是哪一类内容或哪个环节让你感到愿意投入时间？'
      outputs.push({reply:question,event:{target:{operation:'create',title:'整理资料探索',source:{messageId:opening.run.source_message_id,quote:'我发现自己愿意把零散内容分成几类'}},nodes:[{kind:'unknown',question}]}})
      const opened=await engine(opening.input);await store.finishRun(opening.run,opening.staged,opened.text,opened.usage,new AbortController().signal)
      const workspace=(await coachEventView(owner,other))!,gap=workspace.nodes.find(n=>n.kind==='unknown')!
      const feedback=await prepare('接着整理资料的探索。最近一次我先定了三条分类规则，后来同学能直接找到两份材料，少问了我一次。请根据新信息更新判断，不要重复问已经回答的内容。',other,owner)
      outputs.push({reply:'这次出现了少问一次的结果，仍是一条观察，不能说明具体愿意投入的是哪类内容或环节。',event:{target:{operation:'continue',eventId:workspace.id,expectedRevision:workspace.revision},resolveUnknowns:[gap.id]}})
      const updated=await engine(feedback.input);await store.finishRun(feedback.run,feedback.staged,updated.text,updated.usage,new AbortController().signal)
      assert.equal((await coachEventView(owner,other,workspace.id))!.nodes.find(n=>n.id===gap.id)!.status,'active','an observed outcome does not answer the original preference field')
      const latest=(await coachEventView(owner,other,workspace.id))!
      const unrelated=await prepare('补充：我更在意留在目前城市。仍然只报告同学少问一次，没有说我愿意投入的具体内容或环节。',other,owner)
      outputs.push({reply:'留城是新增的偏好，愿意投入的具体内容或环节仍未知。',event:{target:{operation:'continue',eventId:latest.id,expectedRevision:latest.revision},resolveUnknowns:[gap.id]}})
      const retained=await engine(unrelated.input);await store.finishRun(unrelated.run,unrelated.staged,retained.text,retained.usage,new AbortController().signal)
      assert.equal((await coachEventView(owner,other,workspace.id))!.nodes.find(n=>n.id===gap.id)!.status,'active','an unrelated new preference is not an answer to this field')
      const current=(await coachEventView(owner,other,workspace.id))!
      const novel=await prepare('接着刚才的整理探索。另有一个无关偏好：我喜欢这本小说的内容。那不代表我愿意投入资料整理的哪个步骤。',other,owner)
      outputs.push({reply:'小说内容是另一项偏好，不能回答资料整理的投入环节。',event:{target:{operation:'continue',eventId:current.id,expectedRevision:current.revision},resolveUnknowns:[gap.id]}})
      const separate=await engine(novel.input);await store.finishRun(novel.run,novel.staged,separate.text,separate.usage,new AbortController().signal)
      assert.equal((await coachEventView(owner,other,workspace.id))!.nodes.find(n=>n.id===gap.id)!.status,'active','liking unrelated content never supplies the missing subject')
    })
    await t.test('compiled format overhead is checked before any provider reservation or dispatch',async()=>{
      const previous=model.contextWindow,conversation=randomUUID()
      await store.createConversation(user,{id:conversation,title:'SYNTHETIC schema context boundary'})
      const turn=await prepare('请解释一下递归。',conversation)
      try{
        outputs.push({reply:'递归是一个过程调用自身，并在达到终止条件时停止。'})
        await engine(turn.input)
        const system=requests.at(-1).messages.find((m:any)=>m.role==='system').content as string
        const added=estimateTokens(system.slice(system.indexOf('\n本轮输出格式定义')))
        const estimate=(turn.staged.audit.find((a:any)=>a.phase==='model_call_started') as any).contextTokenEstimate
        const oldEstimate=estimate-added,before=requests.length
        model.contextWindow=oldEstimate+8192+Math.floor(added/2)
        assert.ok(oldEstimate+8192<model.contextWindow)
        assert.ok(estimate+8192>model.contextWindow)
        const reservations=(await pool.query('SELECT count(*)::int AS count FROM lifeos_provider_spend WHERE request_id=$1',[turn.run.request_id])).rows[0].count
        await assert.rejects(engine(turn.input),{code:'MODEL_CONTEXT_LIMIT'})
        assert.equal(requests.length,before)
        assert.equal((await pool.query('SELECT count(*)::int AS count FROM lifeos_provider_spend WHERE request_id=$1',[turn.run.request_id])).rows[0].count,reservations)
      }finally{model.contextWindow=previous;await store.terminateRun(user,turn.run.request_id,'failed','SYNTHETIC_CONTEXT_LIMIT')}
    })
    await t.test('native schema cannot appear or disappear between generation projection and SDK dispatch',async()=>{
      const original=model.provider
      try{
        for(const [initial,next] of [[original,'synthetic-no-native'],['synthetic-no-native',original]]){
          model.provider=initial
          const turn=await prepare('请解释一下递归。'),before=requests.length
          const changed=createTurnEngine({capabilityVerified:()=>true,providerCallObserver:{before(){model.provider=next},after(){}}})
          await assert.rejects(changed(turn.input))
          assert.equal(requests.length,before,'mismatched schema must not reach even the fake HTTP server')
          const receipt=turn.staged.audit.find((a:any)=>a.phase==='provider_generation_contract_mismatch') as any
          assert.ok(receipt)
          assert.notEqual(receipt.generationHasSchema,receipt.outgoingHasSchema)
          model.provider=original
          await store.terminateRun(user,turn.run.request_id,'failed','SYNTHETIC_SCHEMA_CHANGED')
        }
      }finally{model.provider=original}
    })
    await t.test('context-only judgment updates retain memory without opening an unrelated process workspace',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC context-only judgment'})
      const text='接着升学和就业的取舍。家里希望我走稳定路线，但这是外部期待；我自己更在意留在目前城市，而且每周最多四小时探索。请更新判断，不要替我选。'
      const turn=await prepare(text,conversation)
      const fixture=JSON.parse(readFileSync('tests/fixtures/coach-spurious-judgment-event.json','utf8'))
      const {event:invalidEvent,...valid}=fixture
      assert.throws(()=>parseActionCoachTurn(JSON.stringify(fixture)),'saved fabricated nodes remain invalid')
      outputs.push({__syntheticRaw:readFileSync('tests/fixtures/coach-render-metadata-response.txt','utf8')})
      const result=await engine(turn.input)
      assert.ok(turn.staged.audit.some((a:any)=>a.phase==='coach_output_normalized'&&a.kind==='verified_render_metadata_ignored'))
      assert.equal(requests.at(-1).response_format.json_schema.schema.properties.event,undefined)
      assert.ok(requests.at(-1).response_format.json_schema.schema.properties.growthUpdates)
      const native=requests.at(-1).response_format.json_schema.schema
      assert.ok(requests.at(-1).messages.find((m:any)=>m.role==='system').content.includes(JSON.stringify(native)),'generation sees the exact same compiled contract as the native formatter, not an unbound legacy schema')
      assert.ok(turn.staged.audit.some((a:any)=>a.phase==='provider_native_contract'&&a.generationSchemaIncluded===true))
      const supplied=JSON.parse(requests.at(-1).messages.find((m:any)=>m.role==='user').content)
      const context=supplied.authorizedContext??supplied
      assert.ok(!context.currentUserMessage.clauses.some((c:any)=>c.text==='而且每周最多四小时探索'),'the existing program-owned recurring budget is not a duplicate model-write source')
      assert.equal(Value.Check(native.properties.growthUpdates,[{target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId:'c4'}}]),false)
      assert.equal(context.serverOwnedMemoryClauses,undefined,'staging metadata is not a selectable model source')
      assert.deepEqual(context.growthWriteScope.sourceClauseIds,context.currentUserMessage.clauses.map((c:any)=>c.id))
      assert.deepEqual(context.growthWriteScope.programOwnedClauseIds,['c4'])
      assert.match(requests.at(-1).messages.find((m:any)=>m.role==='system').content,/growthWriteScope\.sourceClauseIds/)
      for(const clauseId of [...context.growthWriteScope.sourceClauseIds,'c4','server_owned_memory_clauses']){
        const delta={target:{operation:'create'},assertion:'user_reported',kind:'context',source:{clauseId}}
        assert.equal(Value.Check(native.properties.growthUpdates,[delta]),context.growthWriteScope.sourceClauseIds.includes(clauseId),'prompt and native source authority agree for '+clauseId)
      }
      assert.equal(turn.staged.coach,undefined)
      await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.ok((await growthContext(user,conversation)).some(item=>item.text==='我自己更在意留在目前城市'))
      const budgets=(await growthContext(user,conversation)).filter(item=>item.text==='而且每周最多四小时探索')
      assert.equal(budgets.length,1)
      assert.equal(budgets[0]!.kind,'context')
      assert.equal(budgets[0]!.validUntil,null)
      const offUser='budget-memory-off-'+randomUUID(),offChat=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[offUser,offUser+'@example.invalid'])
      const {setMemorySettings}=await import('../../server/memory.ts')
      await setMemorySettings(offUser,{enabled:false,expectedRevision:0,requestId:randomUUID()})
      await store.createConversation(offUser,{id:offChat,title:'SYNTHETIC program-owned budget with memory off'})
      const off=await prepare(text,offChat,offUser)
      outputs.push(valid)
      const offResult=await engine(off.input)
      await store.finishRun(off.run,off.staged,offResult.text,offResult.usage,new AbortController().signal)
      const offBudget=(await growthContext(offUser,offChat)).filter(item=>item.text==='而且每周最多四小时探索')
      assert.equal(offBudget.length,1,'current-conversation working context remains usable')
      const isolatedChat=randomUUID();await store.createConversation(offUser,{id:isolatedChat,title:'SYNTHETIC Memory OFF new conversation'})
      assert.equal((await growthContext(offUser,isolatedChat)).length,0,'Memory OFF prevents cross-conversation reuse')
      const isolated=await prepare('新会话，先聊今天的课程。',isolatedChat,offUser)
      outputs.push({reply:'好的，先聊这次课程，具体问题还未知。'})
      await engine(isolated.input)
      const sent=JSON.stringify(requests.at(-1).messages)
      assert.ok(!sent.includes('而且每周最多四小时探索'))
      assert.ok(!sent.includes('我自己更在意留在目前城市'))
      await store.terminateRun(offUser,isolated.run.request_id,'cancelled','SYNTHETIC_COMPLETE')


      const injected=await prepare(text,conversation)
      outputs.push({...valid,event:{target:{operation:'create',title:'凭空过程',source:{messageId:injected.run.source_message_id,quote:'家里希望我走稳定路线'}}}})
      await assert.rejects(engine(injected.input),{code:'COACH_OUTPUT_INVALID'})
      await store.terminateRun(user,injected.run.request_id,'failed','COACH_OUTPUT_INVALID')
      const performed=await prepare('接着作品集的事：导师回复说手机打不开链接，但没有评价内容。请更新判断。',conversation)
      outputs.push({reply:'导师已回复手机打不开链接，内容评价仍未知，不能推断已阅读或不采用。'})
      await engine(performed.input)
      assert.ok(requests.at(-1).response_format.json_schema.schema.properties.event,'real participant feedback keeps process updates')
      await store.terminateRun(user,performed.run.request_id,'cancelled','SYNTHETIC_COMPLETE')
      const reviewed=await prepare('导师说作品集结构太散、案例证据不足。请更新判断，不要替我选。',conversation)
      const quote='导师说作品集结构太散、案例证据不足',source={messageId:reviewed.run.source_message_id,quote}
      const event={target:{operation:'create',title:'导师作品集评价',source},nodes:[{kind:'fact',source}]}
      assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:'保留具体评价。',event:{...event,nodes:[{kind:'fact',text:quote}]}})))
      outputs.push({reply:'导师指出结构太散、案例证据不足，这是一条具体评价，尚不能据此判断方向适配。',event})
      const evaluated=await engine(reviewed.input)
      assert.ok(requests.at(-1).response_format.json_schema.schema.properties.event,'ordinary substantive evaluation retains event mutation')
      await store.finishRun(reviewed.run,reviewed.staged,evaluated.text,evaluated.usage,new AbortController().signal)
      const {coachEventView}=await import('../../server/action-coach-events.ts')
      const persisted=await coachEventView(user,conversation)
      assert.ok(persisted?.nodes.some(node=>node.kind==='fact'&&node.source?.messageId===reviewed.run.source_message_id&&node.source.quote===quote))

      await pool.query('DELETE FROM growth_items WHERE user_id=$1 AND conversation_id=$2',[user,conversation])
    })
    await t.test('a repaired displayed question and its stored unknown stay identical',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC question repair identity'})
      const text='昨晚我和室友打球后很放松。先问一个问题。'
      const turn=await prepare(text,conversation)
      const question='我想问的具体情况是什么？'
      outputs.push({reply:question,event:{target:{operation:'create',title:'打球体验',source:{messageId:turn.run.source_message_id,quote:'昨晚我和室友打球后很放松'}},nodes:[{kind:'unknown',question}]}})
      const result=await engine(turn.input)
      assert.doesNotMatch(result.text,/我想问的具体情况是什么/)
      assert.ok(turn.staged.coach)
      const unknown=turn.staged.coach!.delta.nodes!.find((node:any)=>node.kind==='unknown') as any
      assert.ok(unknown)
      assert.equal(unknown.question,result.text)
      await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
    })
    await t.test('a category question streams and commits the same open question before its explanation',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC category preview identity'})
      const text='昨晚我把资料链接发给导师。导师回复说手机打不开链接。先处理访问条件。'
      const turn=await prepare(text,conversation),frames:any[]=[]
      turn.input.emit=event=>frames.push(event)
      const question='你发的是哪种链接（网盘、在线文档还是网页），对方有没有提到具体提示？'
      const opened='你发的是哪种链接，对方有没有提到具体提示？'
      outputs.push({lead:question,reply:question+'先辨认访问条件，不推断内容好坏。',event:{target:{operation:'create',title:'资料访问',source:{messageId:turn.run.source_message_id,quote:'昨晚我把资料链接发给导师'}},nodes:[{kind:'unknown',question}]}})
      const result=await engine(turn.input)
      assert.ok(frames.some(frame=>frame.type==='draft'&&frame.text===opened))
      assert.ok(result.text.includes(opened))
      assert.doesNotMatch(result.text,/网盘、在线文档还是网页/)
      assert.ok(!frames.some(frame=>frame.type==='draft_discarded'))
      const unknown=turn.staged.coach!.delta.nodes!.find((node:any)=>node.kind==='unknown') as any
      assert.equal(unknown.question,opened)
      await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
    })
    await t.test('uncertain read status stays unknown through bounded generation and a later pure readback',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC unknown read source'})
      const turn=await prepare('回来反馈：我发了PDF，不知道导师有没有读到，也没回复。请把已发、已读、已回复、是否采用、实际效果分开说。',conversation)
      outputs.push({reply:'我在听。'})
      const result=await engine(turn.input)
      assert.match(result.text,/已读：未知/)
      assert.doesNotMatch(result.text,/导师确认读到/)
      await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      const recall=await prepare('请把已发、已读、已回复、是否采用、实际效果分开说。',conversation)
      const before=requests.length,recalled=await engine(recall.input)
      assert.equal(requests.length,before)
      assert.match(recalled.text,/已读：未知/)
      await store.finishRun(recall.run,recall.staged,recalled.text,recalled.usage,new AbortController().signal)
    })
    await t.test('bounded listening reply remains in its authorized catalogue through final rendering',async()=>{
      const conversation=randomUUID()
      await store.createConversation(user,{id:conversation,title:'SYNTHETIC bounded listening regression'})
      const turn=await prepare('我是成年大学生，今天只想说说：老师没回复邮件让我有点失落。不要建议、不要追问，也不要把它和职业选择连起来。',conversation)
      outputs.push({reply:'我在听。'})
      const result=await engine(turn.input)
      const schema=requests.at(-1).response_format.json_schema.schema
      assert.ok(schema.properties.reply.enum.includes(result.text))
      await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.ok(!/[？?]/.test(result.text))
    })
    await t.test('real PDF feedback survives final bounded validation and commits verified states',async()=>{
      const conversation=randomUUID()
      await store.createConversation(user,{id:conversation,title:'SYNTHETIC PDF feedback regression'})
      const text='回来反馈：我发了PDF，导师确认已经读到，但还没有说是否采用其中建议，也没有给效果反馈。'
      const turn=await prepare(text,conversation)
      outputs.push({reply:'我在听。'})
      const result=await engine(turn.input)
      assert.match(result.text,/已发：PDF已发送/)
      assert.match(result.text,/已读：导师确认读到/)
      assert.match(result.text,/是否采用：未说明/)
      assert.match(result.text,/实际效果：未反馈/)
      const saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.ok(saved)
      assert.equal((await pool.query('SELECT status FROM runs WHERE user_id=$1 AND request_id=$2',[user,turn.run.request_id])).rows[0].status,'completed')
      const recall=await prepare('请把已发、已读、已回复、是否采用、实际效果分开说，只更新相关理解，不安排催促。',conversation)
      const before=requests.length
      const recalled=await engine(recall.input)
      assert.equal(requests.length,before,'an exact authorized readback has no provider dependency')
      assert.equal((recalled.usage as any).llmCallCount,0)
      assert.match(recalled.text,/已发：PDF已发送/)
      assert.match(recalled.text,/是否采用：未说明/)
      await store.finishRun(recall.run,recall.staged,recalled.text,recalled.usage,new AbortController().signal)
    })
    await t.test('saved real timeout case delivers and commits a blank worksheet with zero provider calls',async()=>{
      const text='刚才只有前缀，没有核对表。我仍未开始查岗位，这周只剩二十分钟。先帮我写一个可以直接复制填写的岗位职责和要求核对表，未知处留空；不要替我发送消息，不要把这个模板记为已经完成的行动。'
      const worksheetUser='worksheet-'+randomUUID(),worksheetChat=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[worksheetUser,worksheetUser+'@example.invalid'])
      await store.createConversation(worksheetUser,{id:worksheetChat,title:'SYNTHETIC blank worksheet'})
      const run=(await store.startRun(worksheetUser,worksheetChat,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]}
      const prepared={run,staged,input:{run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:(_event:any)=>{}}}
      const before=requests.length,result=await engine(prepared.input)
      if(requests.length!==before)throw new Error('UNEXPECTED_PROVIDER_REQUEST '+JSON.stringify({audit:prepared.staged.audit,request:requests.at(-1)?.messages?.at(-1)?.content}))
      assert.match(result.text,/岗位职责与要求核对表（待填写）/)
      assert.match(result.text,/一项职责.*________/)
      assert.match(result.text,/一项要求.*________/)
      assert.equal(prepared.staged.candidates.length,0)
      assert.ok(prepared.staged.audit.some((row:any)=>row.phase==='explicit_material_rendered_without_generation'&&row.basis==='explicit_blank_job_worksheet'))
      await store.finishRun(prepared.run,prepared.staged,result.text,result.usage,new AbortController().signal)
      assert.equal((await pool.query('select count(*)::int n from experiences where user_id=$1',[worksheetUser])).rows[0].n,0)
    })
    // reply_only: schema offers ONLY reply; the turn saves with zero growth writes.
    const meta=await prepare('你记得我之前说过什么吗？')
    outputs.push({reply:boundedRecallReply('你记得我之前说过什么吗？',[]).choices[0]})
    const metaResult=await engine(meta.input)
    const metaContract=(meta.staged.audit.find((a:any)=>a.phase==='turn_contract')) as any
    assert.equal(metaContract.mode,'ordinary')
    assert.ok(requests.at(-1).messages[0].content.includes(mainCompanionPolicy.instructions),'actual SDK wire consumes the main Skill business policy')
    assert.ok(!requests.at(-1).messages[0].content.includes('Ensure the local server is up'),'external host setup is not a model capability')
    const activation=meta.staged.audit.find((row:any)=>row.phase==='main_skill_payload') as Record<string,unknown>|undefined
    assert.equal(activation?.policyDigest,mainCompanionPolicy.policyDigest)
    assert.ok(meta.staged.audit.some((row:any)=>row.phase==='model_call_completed'&&row.callId===activation?.callId),'activation links to the completed call whose reply is saved')

    assert.deepEqual(Object.keys((requests.at(-1)!.response_format.json_schema.schema.properties)),['lead','reply'],'read-only schema offers preview plus final reply')
    const metaContext=JSON.parse(requests.at(-1)!.messages.find((m:any)=>m.role==='user').content)
    assert.equal(metaContext.methodSourceAvailability.status,'NOT_REQUESTED')
    assert.ok(metaContract.schemaChars<JSON.stringify(actionCoachTurnSchema).length/5)
    const metaSaved=await store.finishRun(meta.run,meta.staged,metaResult.text,metaResult.usage,new AbortController().signal)
    const committedAudit=(await pool.query('SELECT tool_audit FROM runs WHERE user_id=$1 AND request_id=$2',[user,meta.run.request_id])).rows[0].tool_audit as Record<string,unknown>[]
    assert.ok(committedAudit.some(row=>row.phase==='main_skill_payload'&&row.callId===activation?.callId&&row.policyDigest===mainCompanionPolicy.policyDigest),'Skill payload evidence survives the actual turn transaction')
    assert.deepEqual(metaSaved.growthIds,[])
    assert.equal((await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1',[user])).rows[0].n,0)
    await t.test('planning turn keeps weeklyPlan and persists the plan',async()=>{
      await pool.query('SELECT 1')
      const plan=await prepare('我每周有三小时，帮我安排一下下周。')
      const drafts:any[]=[];plan.input.emit=event=>drafts.push(event)
      outputs.push({reply:boundedPlanningReply({minutes:180,period:'next_week'}).choices[0],growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}],weeklyPlan:{target:{operation:'create'},availableMinutes:180,period:'next_week',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[{action:'整理作品',minutes:180,directionScopes:[]}]}})
      const planResult=await engine(plan.input)
      const planContract=(plan.staged.audit.find((a:any)=>a.phase==='turn_contract')) as any
      assert.equal(planContract.mode,'ordinary')
      const lanes=Object.keys((requests.at(-1)!.response_format.json_schema.schema.properties)).sort()
      assert.deepEqual(lanes,['event','growthUpdates','lead','reply','weeklyPlan'])
      assert.equal(drafts.filter(d=>d.type==='draft').length,1,'the budget acknowledgement does not occupy the substantive draft lane')
      assert.ok(drafts.some(d=>d.type==='draft'&&d.draftKind==='safe_sentence'&&d.text.includes('整理作品')&&d.text.includes('180分钟')),'the validated concrete allocation replaces the waiting hint as substantive content')
      assert.match(planResult.text,/下周建议安排.*180分钟/)
      assert.match(planResult.text,/整理作品（180分钟）/,'final content includes actual validated tasks, not just a budget acknowledgement')
      const saved=await store.finishRun(plan.run,plan.staged,planResult.text,planResult.usage,new AbortController().signal)
      assert.equal(saved.growthIds.length,1)
      assert.ok(saved.stateChange.plan,'plan persisted')
    })
    await t.test('negative current fact is saved and survives a new session only with memory enabled',async()=>{
      await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1) ON CONFLICT (user_id) DO UPDATE SET enabled=true',[user])
      const text='先聊课程，课件链接无法打开，我还没开始复习，怎么继续？',turn=await prepare(text)
      const choice=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]!
      outputs.push({reply:choice}) // Real NP_NEG_01 omitted the explicit not-started fact.
      const result=await engine(turn.input),saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.ok(requests.at(-1)!.response_format.json_schema.schema.properties.growthUpdates,'actual outgoing native schema permits the reported fact')
      const fact=(await pool.query('SELECT text,kind FROM growth_items WHERE user_id=$1 AND id=$2',[user,saved.growthIds[0]])).rows[0]
      assert.equal(fact.text,'我还没开始复习');assert.equal(fact.kind,'feedback');assert.deepEqual(saved.mergedExperienceIds,[],'not started cannot become completed experience')
      await pool.query('UPDATE user_memory_settings SET enabled=false WHERE user_id=$1',[user])
      const nextChat=randomUUID();await store.createConversation(user,{id:nextChat,title:'SYNTHETIC new course session'})
      const off=await prepare('继续复习这门课程。',nextChat);outputs.push({reply:'可以从你这次想处理的课程问题继续。'});await engine(off.input)
      assert.ok(!JSON.stringify(JSON.parse(requests.at(-1)!.messages.find((m:any)=>m.role==='user').content)).includes('我还没开始复习'))
      await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1) ON CONFLICT (user_id) DO UPDATE SET enabled=true',[user])
      const on=await prepare('继续复习这门课程。',nextChat);outputs.push({reply:'你报告还没有开始复习，可以从这次遇到的阻碍继续。'});await engine(on.input)
      assert.ok(JSON.stringify(JSON.parse(requests.at(-1)!.messages.find((m:any)=>m.role==='user').content)).includes('我还没开始复习'))
    })
    await t.test('listening preference does not create a personal goal or star-map change',async()=>{
      const turn=await prepare('我只想说说压力。')
      outputs.push({reply:'我在，你慢慢说。'})
      const result=await engine(turn.input),saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.deepEqual(saved.growthIds,[]);assert.deepEqual(saved.stateChange.growthDiff,[])
      assert.deepEqual(saved.themeChangedIds,[])
    })
    await t.test('RV2 support-only request overrides an existing event and cannot become a goal',async()=>{
      const text='还是那份材料，打不开的情况没有变。我现在只想说一下烦躁，先别给方法。',turn=await prepare(text)
      outputs.push({reply:'我在听，你可以慢慢说。'})
      const result=await engine(turn.input),context=JSON.parse(requests.at(-1)!.messages.find((m:any)=>m.role==='user').content)
      assert.ok(context.boundedReply.choices.every((x:string)=>!x.includes('方法')&&!x.includes('材料')),'a prior blocker cannot force another action suggestion')
      const saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.deepEqual(saved.growthCreatedIds,[]);assert.deepEqual(saved.stateChange.growthDiff,[])
      assert.equal((await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1 AND text=$2',[user,'我现在只想说一下烦躁'])).rows[0].n,0)
      const contract=deriveTurnContract({text,knowledgeCount:1,currentEventExists:true,planIntent:false,material:false})
      assert.equal(contract.capabilities.candidate,false);assert.equal(contract.capabilities.event,false);assert.equal(contract.capabilities.citations,false)
    })
    await t.test('malicious preference-as-goal is excluded while a separately reported blocker survives',async()=>{
      const text='我的课程资料打不开。我现在只想说一下烦躁，先别给方法。',turn=await prepare(text)
      outputs.push({reply:'我在听。',growthUpdates:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c1'}}]})
      const result=await engine(turn.input),saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      const rows=(await pool.query('SELECT text,kind FROM growth_items WHERE user_id=$1 AND id=ANY($2::uuid[])',[user,saved.growthCreatedIds])).rows
      assert.deepEqual(rows,[{text:'我的课程资料打不开',kind:'context'}])
      assert.deepEqual(saved.mergedExperienceIds,[]);assert.deepEqual(saved.candidateIds,[])
    })
    await t.test('a valid native not-started delta is not duplicated by the server supplement',async()=>{
      const text='我还没开始准备新项目，怎么继续？',turn=await prepare(text)
      const choice=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]!
      outputs.push({reply:choice,growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}]})
      const result=await engine(turn.input),saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.equal(saved.growthCreatedIds.length,1);assert.deepEqual(saved.mergedExperienceIds,[])
      assert.equal((await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1 AND text=$2',[user,'我还没开始准备新项目'])).rows[0].n,1)
    })
    await t.test('model-selected chat instructions cannot become personal goals',async()=>{
      const text='这次课程的资料网页无法打开，我尚未开始准备课堂汇报，先处理这个卡点。',turn=await prepare(text)
      const choice=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]!
      outputs.push({reply:choice,growthUpdates:[{target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{clauseId:'c2'}}]})
      const result=await engine(turn.input),saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.equal((await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1 AND text=$2',[user,'先处理这个卡点'])).rows[0].n,0)
      assert.equal((await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1 AND text=$2',[user,'我尚未开始准备课堂汇报'])).rows[0].n,1)
      assert.deepEqual(saved.mergedExperienceIds,[])
    })
    await t.test('server supplements cannot reintroduce a rejected assistant request',async()=>{
      const text='我是21岁的大三学生，先帮我想一个可以了解自己更喜欢哪种工作的起点。',turn=await prepare(text)
      outputs.push({reply:'可以先说说你想了解的部分。'})
      const result=await engine(turn.input)
      await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.equal((await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1 AND text=$2',[user,'先帮我想一个可以了解自己更喜欢哪种工作的起点'])).rows[0].n,0)
    })
    await t.test('an omitted explicit current-course resource blocker persists verbatim and is supplied in a new session',async()=>{
      const text='这门课的参考资料无法打开，我还没开始准备小组说明，先处理这个问题。',turn=await prepare(text)
      const choice=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]!
      outputs.push({reply:choice})
      const result=await engine(turn.input),saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      const blocker=(await pool.query('SELECT text,kind,assertion FROM growth_items WHERE user_id=$1 AND text=$2',[user,'这门课的参考资料无法打开'])).rows
      assert.equal(blocker.length,1);assert.equal(blocker[0].kind,'context');assert.equal(blocker[0].assertion,'user_reported')
      assert.deepEqual(saved.mergedExperienceIds,[])
      await pool.query('UPDATE user_memory_settings SET enabled=true WHERE user_id=$1',[user])
      const nextChat=randomUUID();await store.createConversation(user,{id:nextChat,title:'SYNTHETIC same course resource'})
      const nextText='继续昨天这门课程卡住的地方。',next=await prepare(nextText,nextChat)
      const nextChoice=boundedOrdinaryReply({text:nextText,intent:knowledgeIntent(nextText),contract:deriveTurnContract({text:nextText,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]!
      outputs.push({reply:nextChoice});await engine(next.input)
      const actualContext=JSON.stringify(JSON.parse(requests.at(-1)!.messages.find((m:any)=>m.role==='user').content))
      assert.ok(actualContext.includes('这门课的参考资料无法打开'));assert.ok(actualContext.includes('我还没开始准备小组说明'))
      await pool.query('UPDATE user_memory_settings SET enabled=false WHERE user_id=$1',[user])
      const offChat=randomUUID();await store.createConversation(user,{id:offChat,title:'SYNTHETIC memory off'})
      const off=await prepare(nextText,offChat);outputs.push({reply:nextChoice});await engine(off.input)
      const offContext=JSON.stringify(JSON.parse(requests.at(-1)!.messages.find((m:any)=>m.role==='user').content))
      assert.ok(!offContext.includes('这门课的参考资料无法打开'));assert.ok(!offContext.includes('我还没开始准备小组说明'))
    })
    await t.test('quoted, hypothetical, third-party and questioned resource blockers are not personal facts',async()=>{
      for(const text of ['如果这门课的参考资料无法打开，怎么办？','同学说：“我的课程课件无法打开”。','“这门课的参考资料无法打开”只是举例，怎么判断？','我的课程课件无法打开吗？']){
        const turn=await prepare(text),choice=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})?.choices[0]
        outputs.push({reply:choice??'先核对你本人正在处理的事情，原文、假设和问题不当成个人经历。'})
        const result=await engine(turn.input),saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
        assert.deepEqual(saved.growthCreatedIds,[],text);assert.deepEqual(saved.mergedExperienceIds,[],text)
      }
    })
    await t.test('native resource fact is not duplicated by the server supplement',async()=>{
      const text='我的课程课件无法打开，先处理这个问题。',turn=await prepare(text)
      const choice=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]!
      outputs.push({reply:choice,growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}]})
      const result=await engine(turn.input),saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.equal(saved.growthCreatedIds.length,1)
      assert.equal((await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1 AND text=$2',[user,'我的课程课件无法打开'])).rows[0].n,1)
    })
    await t.test('explicit zero-time plan saves the verified fact and empty plan with no provider call, including repeated reports',async()=>{
      for(const text of ['这周我可用零小时，请安排这周课程与备考。','这周我没有可用时间，是零小时。请排这周的课程和备考安排。','这周没有可用时间，只保存一个空安排。','这周我可用零小时，请安排这周课程与备考。']){
      const turn=await prepare(text)
      const before=requests.length,result=await engine(turn.input)
      assert.equal(requests.length,before,'no model request is needed to invent an empty plan')
      assert.match(result.text,/本周没有可用时间，先不安排任务/)
      const saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      const fact=(await pool.query('SELECT structured_plan FROM growth_items WHERE id=$1',[saved.stateChange.plan!.itemId])).rows[0]
      assert.equal(fact.structured_plan.availableMinutes,0);assert.deepEqual(fact.structured_plan.items,[])
      assert.equal((result.usage as any).llmCallCount,0)
      }
    })
    await t.test('natural next-week candidate request persists the exact limited budget and concrete proposal',async()=>{
      const turn=await prepare('下周仅有一小时，请给课程和备考安排下周的候选任务。')
      outputs.push({reply:boundedPlanningReply({minutes:60,period:'next_week'}).choices[0],growthUpdates:[{target:{operation:'create'},kind:'constraint',assertion:'user_reported',source:{clauseId:'c0'},timeEvidence:{kind:'calendar_week',which:'next',clauseId:'c0'}}],weeklyPlan:{target:{operation:'create'},availableMinutes:60,period:'next_week',budgetRef:{updateIndex:0},basis:[{updateIndex:0}],items:[{action:'核对课程资料',minutes:30,directionScopes:[]},{action:'核对备考资料',minutes:30,directionScopes:[]}]}})
      const result=await engine(turn.input)
      assert.match(result.text,/下周建议安排.*60分钟/);assert.match(result.text,/核对课程资料（30分钟）/)
      const saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      const plan=(await pool.query('SELECT structured_plan FROM growth_items WHERE id=$1',[saved.stateChange.plan!.itemId])).rows[0].structured_plan
      assert.equal(plan.availableMinutes,60);assert.equal(plan.period,'next_week');assert.equal(plan.items.length,2)
      assert.equal(saved.stateChange.plan!.status,'proposed')
      assert.ok(!saved.stateChange.growthDiff.some(delta=>delta.change==='withdrawn'),'a future budget was just created, not withdrawn')
    })
    await t.test('unverified two-hour amount stays a verbatim fact and the actual outgoing schema excludes an expiring constraint',async()=>{
      const text='我还有两小时准备明天的课堂汇报，先做哪一步？',turn=await prepare(text)
      const choice=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]!
      outputs.push({reply:choice,growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:'c0'}}]})
      const result=await engine(turn.input),schema=requests.at(-1)!.response_format.json_schema.schema
      assert.ok(schema.properties.reply.enum.includes(choice),'actual SDK carries the bounded reply enum')
      assert.equal(result.text,choice,'selected authorized editorial action is read back unchanged')
      assert.equal(schema.properties.growthUpdates.items.anyOf.some((branch:any)=>branch.properties?.kind?.const==='constraint'),false)
      const saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.equal(saved.growthIds.length,1)
      const fact=(await pool.query('SELECT kind,text,valid_until,time_basis FROM growth_items WHERE id=$1',[saved.growthIds[0]])).rows[0]
      assert.equal(fact.kind,'context');assert.equal(fact.text,'我还有两小时准备明天的课堂汇报')
      assert.equal(fact.valid_until,null);assert.equal(fact.time_basis,null)
      assert.deepEqual(saved.mergedExperienceIds,[],'an effort budget is not a completed experience')
      assert.equal((saved.stateChange.growth as any).status,'applied')
      assert.equal((result.usage as any).llmCallCount,1)
    })
    await t.test('method availability is explicit in the actual SDK request without opening citations',async()=>{
      const newChat=randomUUID()
      await store.createConversation(user,{id:newChat,title:'SYNTHETIC separate contact matter'})
      await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1) ON CONFLICT (user_id) DO UPDATE SET enabled=true',[user])
      const text='前天联系了学长，他没回，我下一步怎么办？',turn=await prepare(text,newChat)
      const choice=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]!
      outputs.push({reply:choice})
      const result=await engine(turn.input),request=requests.at(-1)!
      const context=JSON.parse(request.messages.find((m:any)=>m.role==='user').content)
      const supplied=context.methodSourceAvailability.suppliedMethodCount
      assert.equal(context.methodSourceAvailability.status,supplied?'MATCHED_PUBLIC_METHODS':'NO_MATCHING_PUBLIC_METHOD')
      assert.equal((context.methodContext??context.knowledge??[]).length,supplied)
      assert.ok(context.deferredGrowthRefs.some((ref:any)=>ref.reason==='UNSCOPED_TEMPORARY_TIME_FOR_OTHER_MATTER'))
      assert.ok(!JSON.stringify(context.growthBackground).includes('我还有两小时准备明天的课堂汇报'),'actual SDK context cannot use the other task budget')
      assert.equal((await pool.query("SELECT count(*)::int n FROM growth_items WHERE user_id=$1 AND text=$2",[user,'我还有两小时准备明天的课堂汇报'])).rows[0].n,1,'original saved fact remains available in storage')
      assert.equal(request.response_format.json_schema.schema.properties.citations,undefined)
      assert.ok(['NO_PUBLIC_METHOD','PUBLIC_METHOD_NOT_USED'].includes(context.boundedReply.sourceStatus),'bounded reply declares whether matched context was used')
      assert.ok(request.response_format.json_schema.schema.properties.reply.enum.includes(choice))
      assert.equal((result.usage as any).llmCallCount,1)
    })
    await t.test('contact goal and mailbox narration use the bounded native lane and show only an authorized provisional sentence',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC contact goal'})
      const text='准备通过学校邮箱请教学长丙，想问他的项目如何放进实习作品集。应该先怎么联系？',turn=await prepare(text,conversation),drafts:any[]=[]
      turn.input.emit=event=>drafts.push(event)
      const choice=boundedOrdinaryReply({text,intent:knowledgeIntent(text),contract:deriveTurnContract({text,knowledgeCount:0,currentEventExists:false,planIntent:false,material:false}),knowledgeCount:0,tier:'default'})!.choices[0]!
      outputs.push({reply:choice})
      const result=await engine(turn.input),request=requests.at(-1)!,schema=request.response_format.json_schema.schema
      assert.ok(schema.properties.reply.enum.includes(choice));assert.ok(!schema.properties.event||schema.properties.event.anyOf.every((branch:any)=>branch.properties.action===undefined))
      assert.equal(result.text,choice);assert.equal(drafts.filter(e=>e.type==='draft').length,1,JSON.stringify({drafts,audit:turn.staged.audit.filter((a:any)=>a.phase==='model_call_completed')}))
      const draft=drafts.find(e=>e.type==='draft');assert.ok(choice.startsWith(draft.text)||choice.endsWith(draft.text));assert.equal(draft.saved,false)
      assert.equal((await pool.query('SELECT count(*)::int n FROM coach_events WHERE user_id=$1 AND conversation_id=$2',[user,conversation])).rows[0].n,0,'provisional editorial content does not commit an event')
    })
    await t.test('out-of-catalogue model prose is rejected without retry or losing a saved fact',async()=>{
      const newChat=randomUUID();await store.createConversation(user,{id:newChat,title:'SYNTHETIC bounded rejection'})
      const before=(await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1',[user])).rows[0].n
      const turn=await prepare('我发给学长的问题还没有回复，今天还要催吗？',newChat),requestCount=requests.length
      outputs.push({reply:'明天再发，语气轻一点反而更容易得到回应。'})
      await assert.rejects(engine(turn.input),(error:any)=>error.code==='BOUNDED_REPLY_INVALID')
      assert.equal(requests.length-requestCount,1,'invalid prose is not a paid automatic repair')
      assert.equal((await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1',[user])).rows[0].n,before)
    })
    await t.test('saved real resume request delivers the verified contribution without another model call',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC resume regression'})
      const factTurn=await prepare('社团海报的文字排版是我做的，插画是队友做的。',conversation)
      const growth=await stageGrowthUpdates(factTurn.run,[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{messageId:factTurn.run.source_message_id,quote:'社团海报的文字排版是我做的'}}],await growthContext(user,conversation))
      await store.finishRun(factTurn.run,{candidates:[],audit:[],growth},'已记录。',null,new AbortController().signal)
      const correctionText='更正一下：我负责的是文字排版，标题文案是负责人给的。我现在只想聊聊，先别给方案。'
      const correction=await prepare(correctionText,conversation)
      outputs.push({reply:'我在听。',growthUpdates:[{target:{operation:'create'},kind:'context',assertion:'user_reported',source:{clauseId:buildClauseCatalogue(correctionText).find(c=>c.text==='标题文案是负责人给的')!.clauseId}}]})
      const corrected=await engine(correction.input)
      await store.finishRun(correction.run,correction.staged,corrected.text,corrected.usage,new AbortController().signal)
      const facts=await growthContext(user,conversation)
      assert.ok(facts.some(x=>x.text==='我负责的是文字排版'),'exact correction survives independently of title attribution')
      assert.ok(facts.some(x=>x.text==='标题文案是负责人给的'))
      const turn=await prepare('我决定现阶段就业优先，接单先不扩大。请沿用上次社团海报的真实经过，直接给我一句简历表达。不要写队友的插画，也别写采用和商业成绩。',conversation)
      const before=requests.length,result=await engine(turn.input)
      assert.equal(requests.length,before,'unique source-backed contribution uses the existing deterministic renderer')
      assert.match(result.text,/我负责的是文字排版/)
      assert.ok(!/待补|商业成绩|插画/.test(result.text))
      const saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.ok(saved.stateChange.material,'the deliverable is persisted, not just a preamble')
      assert.equal((await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1 AND text=$2',[user,'也别写采用和商业成绩'])).rows[0].n,0,'writing instructions do not become memories')
    })
    await t.test('an omitted explicit preference survives a new conversation only with Memory ON',async()=>{
      const preferenceUser='preference-'+randomUUID(),firstChat=randomUUID(),nextChat=randomUUID(),offChat=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[preferenceUser,preferenceUser+'@example.invalid'])
      await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1)',[preferenceUser])
      for(const id of [firstChat,nextChat,offChat])await store.createConversation(preferenceUser,{id,title:'SYNTHETIC explicit preference'})
      const execute=async(text:string,conversationId:string)=>{
        const run=(await store.startRun(preferenceUser,conversationId,randomUUID(),text)).run,staged:store.Staged={candidates:[],audit:[]}
        outputs.push({reply:'先围绕你报告的时间自主需求理解，不推断职业适配。'})
        const result=await engine({run,staged,context:await store.contextForRun(run),decision:null,signal:new AbortController().signal,emit:()=>{}})
        const saved=await store.finishRun(run,staged,result.text,result.usage,new AbortController().signal)
        return {saved,reply:result.text}
      }
      const quote='我主要在意能自己安排一天中专注工作的时间'
      const boundaries=['不在意当老板','也不想承担找客户和收款']
      await execute(quote+'，'+boundaries.join('，')+'。',firstChat)
      const facts=(await pool.query('SELECT id,text,kind FROM growth_items WHERE user_id=$1',[preferenceUser])).rows
      assert.deepEqual(facts.map(({text,kind}:any)=>({text,kind})).sort((a:any,b:any)=>a.text.localeCompare(b.text)),[quote,...boundaries].map(text=>({text,kind:'preference'})).sort((a,b)=>a.text.localeCompare(b.text)))
      await execute('接着时间自主这件事，只更新理解。',nextChat)
      assert.ok(requests.at(-1).messages.find((m:any)=>m.role==='user').content.includes(quote))
      for(const boundary of boundaries)assert.ok(requests.at(-1).messages.find((m:any)=>m.role==='user').content.includes(boundary),'negative boundary must cross conversations too')
      await pool.query('UPDATE user_memory_settings SET enabled=false,revision=revision+1 WHERE user_id=$1',[preferenceUser])
      const off=await execute('接着时间自主这件事，只更新理解。',offChat)
      const payload=requests.at(-1),allPayload=JSON.stringify(payload)
      assert.ok(!allPayload.includes(quote),'the unique personal quote cannot appear in any outgoing role')
      for(const fact of facts)assert.ok(!allPayload.includes(fact.id),'no personal source identity in any outgoing role')
      // Generic policy examples may contain a common phrase such as 不在意当老板.
      // Actual per-user envelopes and the final answer must not carry old facts.
      const envelopes=JSON.stringify(payload.messages.filter((message:any)=>message.role==='user'))
      for(const fact of [quote,...boundaries]){
        assert.ok(!envelopes.includes(fact),'all outgoing user messages respect Memory OFF')
        assert.ok(!off.reply.includes(fact),'the committed answer respects Memory OFF')
      }
    })
    await t.test('omitted participant feedback is retained as separate verbatim context and crosses sessions only with Memory ON',async()=>{
      const owner='participant-context-'+randomUUID(),first=randomUUID(),second=randomUUID(),third=randomUUID(),offChat=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[owner,owner+'@example.invalid'])
      await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1)',[owner])
      for(const id of [first,second,third,offChat])await store.createConversation(owner,{id,title:'SYNTHETIC separate participant reports'})
      const execute=async(text:string,conversation:ReturnType<typeof randomUUID>)=>{
        const turn=await prepare(text,conversation,owner)
        const before=requests.length,queued=outputs.length
        outputs.push({reply:'仅按本人报告保留不同事项，不推断未报告的阅读、采用或效果。'})
        const result=await engine(turn.input)
        if(requests.length===before)outputs.splice(queued,1)
        await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      }
      const initial='更正并区分两件事：老师那封邮件是未回复；另一位同学试过我做的表格后明确说不适合他。不要把两件事合并。'
      await execute(initial,first)
      const teacher='回来反馈：老师后来回复说这周忙，下周再看',classmate='同学表格仍是明确不适合他'
      await execute(teacher+'；'+classmate+'。请只更新各自相关状态。',second)
      const facts=(await pool.query('SELECT text FROM growth_items WHERE user_id=$1 AND kind=$2',[owner,'context'])).rows.map((row:any)=>row.text)
      assert.ok(facts.includes(teacher),'future viewing commitment stays attached to the teacher, not a student plan')
      assert.ok(facts.includes(classmate),'the other matter is an independent report')
      assert.ok(!facts.includes('下周再看'),'no detached future intent')
      await execute('接着老师邮件和同学表格，只更新各自相关状态。',third)
      assert.ok(JSON.stringify(requests.at(-1)).includes(teacher))
      assert.ok(JSON.stringify(requests.at(-1)).includes(classmate))
      const supplied=JSON.parse(requests.at(-1).messages.find((message:any)=>message.role==='user').content)
      const participants=(supplied.authorizedContext??supplied).currentTask.responseScope.reportedEvidence.participantReports
      assert.ok(participants.some((item:any)=>item.actor==='老师'&&item.quote===teacher&&item.states['原材料阅读']===undefined))
      assert.ok(participants.some((item:any)=>item.actor==='同学'&&item.quote===classmate))
      assert.ok(participants.some((item:any)=>item.actor==='另一位同学'&&item.states['试用'].status==='本人报告已试用'),'a later non-adoption status does not erase the prior reported trial')
      await pool.query('UPDATE user_memory_settings SET enabled=false,revision=revision+1 WHERE user_id=$1',[owner])
      await execute('只更新当前相关状态。',offChat)
      assert.ok(!JSON.stringify(requests.at(-1)).includes(teacher))
      assert.ok(!JSON.stringify(requests.at(-1)).includes(classmate))
    })
    await t.test('the current user message cannot disable the previous-reply guard',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC repeated reply'})
      const reply='目前只知道你在整理课程笔记，具体分类与使用情形还没有报告，不能推断整理已经提高效率，也不能由此给你的职业方向下结论。'
      const first=await prepare('我在整理课程笔记，暂时先理清这件事。',conversation)
      outputs.push({reply});const result=await engine(first.input)
      await store.finishRun(first.run,first.staged,result.text,result.usage,new AbortController().signal)
      const next=await prepare('请只更新这份笔记的局部理解，不生成任务。',conversation)
      const before=requests.length;outputs.push({reply})
      await assert.rejects(engine(next.input),(error:any)=>error.code==='REPLY_REPEATED_VERBATIM')
      assert.equal(requests.length,before+1,'no hidden paid retry')
    })
    await t.test('actual DE single-job stream retains the bounded first fragment through final validation and commit',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC bounded JD preview'})
      const text='我愿意只了解一个远程岗位的真实工作节奏，但不联系陌生人、不提供私人资料。给一个边界清楚的小行动。'
      const turn=await prepare(text,conversation),frames:any[]=[],before=requests.length
      turn.input.emit=event=>frames.push(event)
      const lead='选一个你感兴趣的远程岗位，在招聘平台读3份该岗位的JD，只记录其中关于工作时间、会议频率和响应要求的具体描述。'
      outputs.push({lead,reply:lead+'这个动作测的是公开信息里能看到的节奏线索，不联系任何人也不提供资料；投入上限30分钟，读完3份就停。'})
      const result=await engine(turn.input)
      assert.equal(requests.length,before+1,'one simulated provider dispatch, no repair call')
      const draft=frames.find(frame=>frame.type==='draft')
      assert.ok(draft?.text.includes('读这个岗位的JD'))
      assert.ok(!draft.text.includes('3份'))
      assert.ok(result.text.includes(draft.text),'same bounded content remains in final body')
      assert.ok(!frames.some(frame=>frame.type==='draft_discarded'))
      assert.ok(!turn.staged.audit.some((row:any)=>row.phase==='model_preview_not_retained'))
      assert.match(result.text,/读完这份就停/)
      const saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.ok(saved)
      assert.equal((await pool.query('SELECT status FROM runs WHERE request_id=$1',[turn.run.request_id])).rows[0].status,'completed')
    })
    await t.test('a preview changed by final generation is explicitly discarded before commit',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC preview replacement'})
      const turn=await prepare('我在比较两个课程选项，暂时只保留信息。',conversation),frames:any[]=[]
      turn.input.emit=event=>frames.push(event)
      outputs.push({lead:'你想比较哪个具体选项？',reply:'先保留这次报告的信息，不新增任务或推断选择。'})
      const result=await engine(turn.input)
      assert.ok(frames.some(frame=>frame.type==='draft'))
      assert.ok(frames.some(frame=>frame.type==='draft_discarded'))
      assert.ok(turn.staged.audit.some((event:any)=>event.phase==='model_preview_not_retained'))
      await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
    })
    await t.test('instruction-only understanding uses reply-only generation without dropping real control commits or new facts',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC instruction-only understanding'})
      const quote='我更在意留在目前城市',seed=await prepare(quote+'。',conversation)
      const growth=await stageGrowthUpdates(seed.run,[{target:{operation:'create'},kind:'preference',assertion:'user_reported',source:{messageId:seed.run.source_message_id,quote}}],await growthContext(user,conversation))
      await store.finishRun(seed.run,{candidates:[],audit:[],growth},'这条原话保留。',null,new AbortController().signal)
      const turn=await prepare('先暂停考研方向，不删除刚才查过的事实。说明当前暂定理解和仍未知的地方，这周不再安排任务。',conversation)
      outputs.push({reply:'你更在意留在目前城市，路径匹配仍未知。考研按你的要求暂停，已查事实保留，这周不再安排任务。'})
      const result=await engine(turn.input),wire=requests.at(-1)
      assert.deepEqual(Object.keys(wire.response_format.json_schema.schema.properties),['reply'],'withheld control preview is not generated')
      assert.ok(wire.messages.find((message:any)=>message.role==='user').content.includes(quote),'authorized understanding context is still present')
      const saved=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
      assert.equal((await pool.query("SELECT state FROM growth_direction_controls WHERE user_id=$1 AND scope='postgraduate_exam'",[user])).rows[0].state,'paused')
      assert.deepEqual(saved.growthIds,[],'instructions are not personal facts')
      assert.ok((await growthContext(user,conversation)).some(item=>item.text===quote))
      const mixed=await prepare('我主要在意能自主安排专注工作的时间。请更新当前理解。',conversation)
      outputs.push({reply:'这条专注时间偏好是你这次的新报告，其他路径条件仍未知。'})
      const mixedResult=await engine(mixed.input)
      assert.ok(requests.at(-1).response_format.json_schema.schema.properties.growthUpdates,'new personal reports retain the existing fact lane')
      const mixedSaved=await store.finishRun(mixed.run,mixed.staged,mixedResult.text,mixedResult.usage,new AbortController().signal)
      assert.ok(mixedSaved.growthIds.length)
    })
    await t.test('requested one-sentence summary binds the actual wire and survives final rendering',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC sentence quantity'})
      const turn=await prepare('我按三条规则整理过一次资料。只给一句当前总结。',conversation)
      const reply='你报告一次整理经历，其他结果仍未知。'
      outputs.push({reply})
      const result=await engine(turn.input),wire=requests.at(-1)
      const schema=wire.response_format.json_schema.schema
      assert.equal(schema.properties.reply.maxLength,240)
      assert.equal(Value.Check(schema.properties.reply,reply),true)
      assert.equal(Value.Check(schema.properties.reply,'一次经历。其他未知。'),false)
      const supplied=JSON.parse(wire.messages.find((message:any)=>message.role==='user').content)
      assert.equal(supplied.currentTask.responseScope.sentenceLimit,1)
      assert.equal(result.text,reply)
      await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
    })
    await t.test('a provider ignoring summary quantity fails once without committing a repeated paragraph',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC quantity refusal'})
      const turn=await prepare('只给一句当前判断。',conversation)
      outputs.push({reply:'目前只有一次经历。稳定效果仍未知。'})
      const before=requests.length
      await assert.rejects(engine(turn.input),{code:'REPLY_SENTENCE_LIMIT'})
      assert.equal(requests.length-before,1)
      assert.equal((await pool.query("SELECT count(*)::int n FROM messages WHERE user_id=$1 AND conversation_id=$2 AND role='assistant'",[user,conversation])).rows[0].n,0)
      await store.terminateRun(user,turn.run.request_id,'failed','REPLY_SENTENCE_LIMIT')
    })
    await t.test('a remaining-time correction does not collide with a recurring weekly limit',async()=>{
      const owner='turn-contract-budget-'+randomUUID(),conversation=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[owner,owner+'@example.invalid'])
      await store.createConversation(owner,{id:conversation,title:'SYNTHETIC distinct time budgets'})
      await pool.query('INSERT INTO user_memory_settings(user_id,enabled,revision) VALUES($1,true,1)',[owner])
      try{
        const correction='更正：我这周剩余时间是一小时，不是两小时。先暂停考研方向，不删除看过岗位的事实。今天没精力继续，不安排任务；只给一句阶段理解和仍未知之处，等我主动回来。'
        const turn=await prepare(correction,conversation,owner)
        const weekEnd=(await pool.query("SELECT (date_trunc('week',now() AT TIME ZONE 'Asia/Shanghai')+interval '1 week') AT TIME ZONE 'Asia/Shanghai' AS value")).rows[0].value
        await pool.query("INSERT INTO growth_items(id,user_id,conversation_id,kind,text,assertion,status,valid_until,time_basis) VALUES($1,$2,$3,'constraint',$4,'user_reported','active',$5,$6)",[randomUUID(),owner,conversation,'我每周最多两小时探索',weekEnd,JSON.stringify({kind:'calendar_week',which:'this',quote:'这周',anchor:'synthetic-test'})])
        outputs.push({reply:'已更正本周剩余时间为一小时并按你的要求今天不安排任务，同时你是否仍要探索还未知，等你主动回来再继续。'})
        const result=await engine(turn.input)
        assert.doesNotMatch(result.text,/(?:已更正|更正为|更正已记录|已更新|已修改)/)
        assert.match(result.text,/这周剩余时间是一小时/)
        assert.match(result.text,/每周最多两小时探索/)
        assert.match(result.text,/暂停/)
        assert.match(result.text,/今天不安排任务/)
        assert.match(result.text,/是否仍要探索还未知/)
        assert.equal(turn.staged.weeklyPlan,undefined,'a summary-only turn must not stage a plan')
        const final=await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
        assert.equal((await pool.query("SELECT state FROM growth_direction_controls WHERE user_id=$1 AND scope='postgraduate_exam'",[owner])).rows[0].state,'paused')
        const active=(await pool.query("SELECT kind,text,assertion,status,time_basis FROM growth_items WHERE user_id=$1 AND status='active' ORDER BY created_at",[owner])).rows
        assert.ok(active.some((item:any)=>item.kind==='constraint'&&item.assertion==='user_reported'&&item.text.includes('每周最多两小时探索')&&item.time_basis?.kind==='calendar_week'),JSON.stringify(active))
        assert.ok(active.some((item:any)=>item.kind==='constraint'&&item.assertion==='user_reported'&&item.text.includes('这周剩余时间是一小时')&&item.time_basis?.kind==='calendar_week'),'the current-week correction is committed as a distinct constraint')
        assert.equal((await pool.query('SELECT count(*)::int n FROM coach_events WHERE user_id=$1 AND conversation_id=$2',[owner,conversation])).rows[0].n,0,'no task event is committed for a no-task summary')
      }finally{
        await pool.query('DELETE FROM growth_items WHERE user_id=$1',[owner]).catch(()=>{})
        await pool.query('DELETE FROM runs WHERE user_id=$1',[owner]).catch(()=>{})
        await pool.query('DELETE FROM messages WHERE user_id=$1',[owner]).catch(()=>{})
        await pool.query('DELETE FROM conversations WHERE user_id=$1',[owner]).catch(()=>{})
        await pool.query('DELETE FROM user_memory_settings WHERE user_id=$1',[owner]).catch(()=>{})
        await pool.query('DELETE FROM growth_direction_controls WHERE user_id=$1',[owner]).catch(()=>{})
        await pool.query('DELETE FROM "user" WHERE id=$1',[owner]).catch(()=>{})
      }
    })
    await t.test('an explicit evaluation report stays source-aware instead of being replaced with unknown',async()=>{
      const conversation=randomUUID();await store.createConversation(user,{id:conversation,title:'SYNTHETIC evaluation source boundary'})
      const turn=await prepare('回来反馈：我发了PDF，导师确认已经读到，但明确没有评价内容，也没有说是否采用。',conversation)
      const reply='你报告导师已读到PDF，但明确没有评价内容；是否采用仍未知。'
      outputs.push({reply})
      const before=requests.length,result=await engine(turn.input)
      assert.equal(requests.length-before,1,'an unsupported canonical dimension retains ordinary generation')
      assert.equal((requests.at(-1).response_format.json_schema.schema.properties.reply as any).enum,undefined)
      assert.match(result.text,/没有评价内容/)
      assert.doesNotMatch(result.text,/是否评价内容未报告/)
      await store.finishRun(turn.run,turn.staged,result.text,result.usage,new AbortController().signal)
    })
  }finally{
    model.baseUrl=previousURL;config.apiKey=previousKey
    await new Promise<void>(resolve=>fake.close(()=>resolve()))
    try{await localEmbedding.close()}catch{}
    await pool.query('DELETE FROM growth_items WHERE user_id=$1',[user]).catch(()=>{})
    await pool.query('DELETE FROM runs WHERE user_id=$1',[user]).catch(()=>{})
    await pool.query('DELETE FROM messages WHERE user_id=$1',[user]).catch(()=>{})
    await pool.query('DELETE FROM conversations WHERE user_id=$1',[user]).catch(()=>{})
    await pool.query('DELETE FROM "user" WHERE id=$1',[user]).catch(()=>{})
    await pool.end()
  }
})
