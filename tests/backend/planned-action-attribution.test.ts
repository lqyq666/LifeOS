import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {parseActionCoachTurn} from '../../server/action-coach-contracts.ts'
import {buildClauseCatalogue,processFactInputIndices,reportedContribution} from '../../server/clause-catalogue.ts'

test('a planned omitted-subject action cannot invalidate the reply or become performed experience evidence',()=>{
 const text='我在考研和就业之间拿不定主意，这周只能拿出一小时。我先选就业，今天用十分钟看一个岗位。'
 const catalogue=buildClauseCatalogue(text)
 const action=catalogue.find(clause=>clause.text==='今天用十分钟看一个岗位')!
 assert.ok(action)
 const output={
  reply:'你已经把当前选择收窄到就业。今天先看一个岗位，十分钟到点就停；这只是准备执行的下一步，不算已经完成。',
  growthUpdates:[{
   target:{operation:'create'},
   assertion:'user_reported',
   kind:'feedback',
   progressState:'completed',
   source:{clauseId:action.clauseId},
   contribution:{actor:'self',actionQuote:'看一个岗位'}
  }]
 }
 const parsed=parseActionCoachTurn(JSON.stringify(output),{
  sourceCatalogue:{messageId:randomUUID(),catalogue,text,canonicalFacts:true}
 })
 const fact=parsed.growthUpdates![0]!
 assert.ok('progressState'in fact)
 assert.equal(fact.progressState,'unknown')
 assert.deepEqual(reportedContribution(fact),{
  actor:'unknown',
  actionQuote:'',
  skillTags:[],
  sourceQuote:'今天用十分钟看一个岗位',
  sourceMessageId:reportedContribution(fact)!.sourceMessageId,
  sourceClauseId:action.clauseId,
  factQuote:'今天用十分钟看一个岗位'
 })
})

test('an invalid optional event fact reference cannot erase a valid blocked-attempt reply',()=>{
 const text='我看了一个岗位四分钟，只核对了三列标题，没有完成，也没帮我判断方向。今天没时间了。'
 const catalogue=buildClauseCatalogue(text)
 const parsed=parseActionCoachTurn(JSON.stringify({
  reply:'你实际看了四分钟，只核对到三列标题；这次没有完成，也没有帮助判断方向。今天不再加动作，下次再按新的重点继续。',
  growthUpdates:[{
   target:{operation:'create'},
   assertion:'user_reported',
   kind:'feedback',
   progressState:'attempted',
   source:{clauseId:'c0'},
   contribution:{actor:'self',actionQuote:'我看了一个岗位四分钟'}
  }],
  event:{
   target:{operation:'create',title:'就业岗位初次浏览反馈',source:{clauseId:'c0'}},
   factRefs:[0,7]
  }
 }),{sourceCatalogue:{messageId:randomUUID(),catalogue,text,canonicalFacts:true}})
 assert.equal(parsed.reply.startsWith('你实际看了四分钟'),true)
 assert.equal(parsed.event!.nodes!.length,1)
 assert.deepEqual(processFactInputIndices(parsed.event!.nodes![0]!),[0])
})
