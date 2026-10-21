import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseActionCoachTurn} from '../server/action-coach-contracts.ts'

const fixture=JSON.parse(readFileSync(new URL('./fixtures/nr-output-envelope-failure.json',import.meta.url),'utf8'))
test('the actual NR explicit create envelope uses the sole canonical parser without trusting model text',()=>{
 const output=fixture.turns[2].raw,normalizations:string[]=[]
 const parsed=parseActionCoachTurn(JSON.stringify(output),{onNormalization:kind=>normalizations.push(kind)})
 assert.equal(parsed.reply,output.reply)
 assert.deepEqual(parsed.growthUpdates,[{assertion:'user_reported',kind:'context',source:{clauseId:'c1'},target:{operation:'create'}}])
 assert.deepEqual(normalizations,['explicit_reported_create_envelope'])
 const poisoned=structuredClone(output);poisoned.growthUpdates.create[0].text='模型编造：你已经决定就业'
 assert.deepEqual(parseActionCoachTurn(JSON.stringify(poisoned)).growthUpdates,parsed.growthUpdates,'model prose never supplies the stored fact')
 assert.deepEqual(output.growthUpdates.create[0].text,fixture.turns[2].raw.growthUpdates.create[0].text,'original failure fixture is not mutated')
})
test('ambiguous edits, extra fields, inferred assertions and invalid sources remain invalid',()=>{
 const row={assertion:'user_reported',kind:'context',source:{clauseId:'c1'}}
 for(const growthUpdates of [{create:[row],correct:[]},{create:[{...row,target:{operation:'correct',itemId:'invented'}}]},{create:[{...row,assertion:'ai_observation'}]},{create:[{...row,unknownProperty:true}]},{create:[{...row,source:{clauseId:'not-a-clause'}}]},{create:Array(9).fill(row)}]){
  assert.throws(()=>parseActionCoachTurn(JSON.stringify({reply:'保留原始信息。',growthUpdates})))
 }
 const canonical={reply:'只保留来源。',growthUpdates:[{...row,target:{operation:'create'}}]},notices:string[]=[]
 assert.deepEqual(parseActionCoachTurn(JSON.stringify(canonical),{onNormalization:kind=>notices.push(kind)}),canonical)
 assert.equal(notices.length,0)
})
