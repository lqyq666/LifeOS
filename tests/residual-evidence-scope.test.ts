import test from 'node:test'
import assert from 'node:assert/strict'
import {deriveExplicitDirectionControls} from '../server/growth-controls.ts'
import {extractSkillTags} from '../server/starmap-enrichment.ts'

test('R03 fearing a bad outcome is not withdrawing its direction',()=>{
 assert.equal(deriveExplicitDirectionControls('我不想考研失败。').status,'none')
 assert.equal(deriveExplicitDirectionControls('我不想就业后悔。').status,'none')
 assert.equal(deriveExplicitDirectionControls('我决定不再考研。').status,'explicit')
})

test('R03 an inference boundary does not swallow an independently named withdrawal',()=>{
 for(const boundary of ['不要推断稳定能力','别推导我的人格结论','不能推出我适合就业']){
  assert.deepEqual(deriveExplicitDirectionControls('我以前打算考研，现在我决定不再考研。'+boundary+'。'),{status:'explicit',changes:[{scopes:['postgraduate_exam'],operation:'pause',quote:'现在我决定不再考研'}]})
  assert.equal(deriveExplicitDirectionControls(boundary+'。').status,'none')
 }
 assert.equal(deriveExplicitDirectionControls('我决定不再考研。不要再推那个方向。').status,'needs_confirmation','a genuinely unnamed direction still needs confirmation')
})
test('R05 an explicit past-time prefix preserves owned work, without restoring denied or delegated work',()=>{
 assert.deepEqual(extractSkillTags('昨天我写了Python代码。','',''),['编程'])
 assert.deepEqual(extractSkillTags('前天我完成了迎新海报排版。','',''),['设计'])
 assert.deepEqual(extractSkillTags('我没有设计过海报。','',''),[])
 assert.deepEqual(extractSkillTags('我请室友设计了海报。','',''),[])
 assert.deepEqual(extractSkillTags('我交了海报，室友设计了布局，我只负责打印。','',''),[])
 assert.deepEqual(extractSkillTags('我完成了海报，但设计是室友做的，我只负责打印。','',''),[])
 assert.deepEqual(extractSkillTags('我设计了海报','','我交了海报，设计是室友做的，我只负责打印。'),[],'a historical inferred action cannot overrule the source')
})
