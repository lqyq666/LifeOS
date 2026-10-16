import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {pool} from '../../server/db.ts'
import * as store from '../../server/store.ts'
import {stageGrowthUpdates} from '../../server/growth.ts'
import {CoachProviderBudget,comparisonAllowance} from '../../scripts/coach-provider-budget.ts'
import {campusComparisonArtifacts} from '../../scripts/campus-benchmark-summary.ts'

test('saved real diagnostic answers replay actual growth staging without provider calls or persisted acceptance',async()=>{
  const selected=process.env.LIFEOS_COMPARISON_REVIEW_DIR
  if(selected&&!/^[a-z0-9-]+$/.test(selected))throw new Error('REVIEW_DIRECTORY_INVALID')
  const directories=selected?[selected]:['complex-flash-20261005','complex-max-priced-20261005','complex-plus-20261005','complex-max-thinking-20261005']
  const reports=directories.map(directory=>{
    const root='.local/campus-growth/'+directory,files=readdirSync(root).filter(name=>name.startsWith('campus-comparison-')&&name.endsWith('.json'))
    assert.equal(files.length,1);return JSON.parse(readFileSync(root+'/'+files[0],'utf8'))
  })
  const budget=new CoachProviderBudget(),before=readFileSync(budget.path)
  const rows:any[]=[]
  try{
    for(const report of reports)for(const item of report.cases){
      const user='comparison-replay-'+randomUUID(),chat=randomUUID()
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
      try{
        await store.createConversation(user,{id:chat,title:'SYNTHETIC saved-output replay'})
        const run=(await store.startRun(user,chat,randomUUID(),item.input)).run
        // Synthetic DB transport rebinds only the fixed message ID. Text, quotes,
        // assertions, dependencies and time bounds remain exactly as produced.
        const output=item.output?JSON.parse(JSON.stringify(item.output).replaceAll('00000000-0000-4000-8000-000000000011',run.source_message_id)):null
        let result='NO_VALID_PARSED_OUTPUT',code:string|null=null
        if(output&&!campusComparisonArtifacts(output).growthStageEligible)result='NO_GROWTH_UPDATES_NOT_TESTED'
        else if(output){try{await stageGrowthUpdates(run,output.growthUpdates,[]);result='GROWTH_STAGED_NOT_COMMITTED'}catch(error:any){result='GROWTH_STAGE_REJECTED';code=error.code??'UNKNOWN'}}
        assert.equal((await pool.query('SELECT count(*)::int n FROM growth_items WHERE user_id=$1',[user])).rows[0].n,0)
        await store.terminateRun(user,run.request_id,'cancelled','SAVED_OUTPUT_DIAGNOSTIC_NO_COMMIT')
        rows.push({model:report.model,thinkingBudget:report.thinkingBudget,case:item.id,elapsedMs:item.elapsedMs,estimatedCostCny:item.estimatedCostCny,result,code,sourceViolations:(output?.growthUpdates??[]).filter((delta:any)=>!item.input.includes(delta.source.quote)||delta.assertion==='user_reported'&&delta.text!==undefined&&!delta.source.quote.includes(delta.text)).map((delta:any)=>({kind:delta.kind,text:delta.text,quote:delta.source.quote})),fullTransaction:'NOT_RUN',browser:'NOT_RUN',ordinarySpeedAcceptance:'NOT_RUN'})
      }finally{await pool.query('DELETE FROM "user" WHERE id=$1',[user])}
    }
    assert.equal(rows.length,directories.length*2)
    assert.deepEqual(readFileSync(budget.path),before,'offline replay never reserves or changes paid receipts')
    const snapshot=budget.snapshot(),historicalComparisonAllowance=comparisonAllowance(snapshot,JSON.parse(readFileSync('.local/campus-growth/comparison-restriction-20261005.json','utf8')))
    assert.equal(historicalComparisonAllowance.remainingCalls,0)
    const allowance=selected&&snapshot.continuation?{remainingCalls:null,remainingCny:snapshot.continuation.remainingCny,accountedCny:snapshot.continuation.accountedCny}:historicalComparisonAllowance
    writeFileSync('.local/campus-growth/'+(selected?selected+'-review.json':'comparison-review-20261005.json'),JSON.stringify({evidence:'REAL_ANSWERS_OFFLINE_ISOLATED_GROWTH_STAGING_ONLY',status:'WIP_NOT_READY',allowance,historicalComparisonAllowance,rows},null,2)+'\n')
    console.log(JSON.stringify({rows:rows.map(({model,thinkingBudget,case:caseId,result,code,elapsedMs,estimatedCostCny})=>({model,thinkingBudget,caseId,result,code,elapsedMs,estimatedCostCny})),allowance}))
  }finally{await pool.end()}
})
