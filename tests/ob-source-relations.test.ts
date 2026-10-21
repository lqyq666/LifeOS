import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {groundUnsupportedOperationalResources,repairUnsupportedPreferenceClaim,softenSingleObservationCausality} from '../server/reply-draft.ts'
import {reportedEvidenceFromText,reportedCompletedContactClauses} from '../server/turn-contract.ts'
import {reconcileActionStages} from '../server/workflows/action-review.ts'
const saved=JSON.parse(readFileSync(new URL('./fixtures/ob-semantic-failures.json',import.meta.url),'utf8'))
const turn=(chain:string,index:number)=>saved.turns.find((x:any)=>x.chain===chain&&x.index===index)

test('actual OB delivery uses the existing source parser rather than a narrower stage verb list',()=>{
 const text=turn('action-review',0).user,before={sent:null,read:null,replied:null,used:null,effect:null}
 assert.ok(reportedCompletedContactClauses(text).length)
 assert.deepEqual(reconcileActionStages(before,text),{...before,sent:true,replied:false})
 for(const text of ['我打算把作品集链接发给导师了。','如果我把作品集链接发给导师了。','朋友说我把作品集链接发给导师了。','“我把作品集链接发给导师了”。','我不确定是否发给导师了。'])assert.equal(reconcileActionStages(before,text).sent,null,text)
 assert.equal(reconcileActionStages({...before,sent:true},'我不确定是否发给导师了。').sent,null)
 assert.equal(reconcileActionStages({...before,sent:true},'我不知道导师是否读了我发给他的PDF。').sent,true,'reading uncertainty does not retract a known sending')
 assert.equal(reconcileActionStages(before,'我把作品集链接发给导师了但是否读过仍未知。').sent,true)
})

test('actual OB public lookup loses only an unsupported prior-possession modifier, not the requested action',()=>{
 const x=turn('freedom-explore',3),fixed=groundUnsupportedOperationalResources(x.raw.reply,x.user)
 assert.ok(fixed?.includes('远程招聘帖'))
 assert.doesNotMatch(fixed!,/你已关注|已有哪一个可用来源|需要一个你确实/)
 assert.ok(fixed?.includes('最多30分钟')&&fixed.includes('只读')&&fixed.includes('不发私信'))
 assert.equal(fixed,x.raw.reply.replace('你已关注的',''),'only the unsupported modifier is deleted; no replacement access assertion')
 for(const reply of ['打开一个公开岗位描述，不发私信，但联系其中的招聘人。','去 LinkedIn 私信从业者。','从你收藏的社群里选一个招聘帖，只读公开文字。'])assert.notEqual(groundUnsupportedOperationalResources(reply,x.user),null,reply)
})

test('actual OB locality compatibility is removed without hardening a personal priority into exclusion',()=>{
 const user=turn('study-work-choice',3),basis=reportedEvidenceFromText(turn('study-work-choice',2).user).preferences
 const fixed=repairUnsupportedPreferenceClaim(user.raw.reply,user.user,basis)
 assert.ok(fixed)
 assert.doesNotMatch(fixed!,/其他城市或院校升学.*符合/)
 assert.ok(fixed!.includes('硬约束的判断解除')&&fixed!.includes('四小时内的小验证')&&fixed!.includes('真实招聘要求'))
 assert.equal(repairUnsupportedPreferenceClaim('其他城市的升学选项需要权衡你留城的偏好。',user.user,basis),null)
 assert.equal(repairUnsupportedPreferenceClaim('同城其他院校可能满足你的留城偏好。',user.user,basis),null)
 assert.equal(repairUnsupportedPreferenceClaim('你仍可在其他城市的院校远程升学，只要符合你对留城的偏好。',user.user,basis),null,'explicit remote qualification does not assert relocation')
})

test('unreported prospective time effects remain hypotheses while actual reported effects remain facts',()=>{
 const x=turn('freedom-explore',5),source=turn('freedom-explore',4).user
 const fixed=softenSingleObservationCausality(x.raw.reply,x.user,source)
 assert.ok(fixed?.includes('可能会打断专注'))
 assert.doesNotMatch(fixed!,/仍会打断专注/)
 const grounded='固定会议仍会打断专注。'
 assert.equal(softenSingleObservationCausality(grounded,x.user,'我确认固定会议会打断专注。'),null)
 for(const source of ['我担心固定会议会打断专注。','我不确定固定会议会打断专注。','我确认固定会议会打断室友的专注。'])assert.ok(softenSingleObservationCausality(grounded,x.user,source)?.includes('可能会打断专注'),source)
 assert.equal(softenSingleObservationCausality('固定会议打断了我的专注。',x.user,source),null,'reported past facts are not converted to hypothetical futures')
 assert.equal(softenSingleObservationCausality('固定会议可能会打断专注。',x.user,source),null)
 for(const text of ['固定会议不会打断专注。','这不是会打断专注的会议。','是否会打断专注仍未知。'])assert.equal(softenSingleObservationCausality(text,x.user,source),null,text)
 assert.equal(softenSingleObservationCausality('如果会议开在专注时段，会打断专注。',x.user,source),null,'an already conditional proposition is not an asserted actual effect')
})
