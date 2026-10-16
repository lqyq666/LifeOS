import test from 'node:test'
import assert from 'node:assert/strict'
import {materialRequest} from '../server/action-coach-events.ts'

test('an explicit draft verb precedes a non-pressuring qualifier in the actual mixed request',()=>{
 const text='再帮我拟一个暂不催促的后续沟通问题'
 assert.equal(materialRequest(text,'create'),'requested')
 for(const declined of ['不要帮我写消息','别重写','暂不联系对方'])assert.equal(materialRequest(declined,'create'),'declined',declined)
 assert.equal(materialRequest('我填过岗位核对表但卡住了，别重写。','create'),'declined')
})
