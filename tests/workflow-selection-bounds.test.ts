import test from 'node:test'
import assert from 'node:assert/strict'
import {Type} from 'typebox'
import {Value} from 'typebox/value'
import {bindWorkflowSelectionSchema} from '../server/workflows/provider-adapter.ts'

test('persisted VALUE04 empty selection: path schema requires actual evidence and one optional probe',()=>{
 const ids=Type.Array(Type.String(),{maxItems:12,uniqueItems:true})
 const schema=Type.Object({evidenceIds:ids,evidenceRelations:Type.Array(Type.Object({evidenceId:Type.String(),relation:Type.String()})),actionIds:ids,actionBasis:Type.Array(Type.Object({actionId:Type.String()}))})
 const bound=bindWorkflowSelectionSchema(schema,{path:{id:'employment'},facts:[{id:'e0'}],actions:[{id:'employment:requirements'},{id:'employment:portfolio'}]}) as any
 assert.equal(bound.properties.evidenceIds.minItems,1)
 assert.equal(bound.properties.evidenceIds.maxItems,1)
 assert.equal(bound.properties.actionIds.maxItems,1)
 assert.equal(bound.properties.actionBasis.maxItems,1)
 assert.equal(Value.Check(bound,{evidenceIds:[],evidenceRelations:[],actionIds:[],actionBasis:[]}),false)
 assert.equal(Value.Check(bound,{evidenceIds:['e0'],evidenceRelations:[{evidenceId:'e0',relation:'unknown'}],actionIds:[],actionBasis:[]}),true)
 assert.equal(schema.properties.actionIds.maxItems,12,'binding does not mutate the shared input IDs object')
})
