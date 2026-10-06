import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { pool } from '../../server/db.ts'
import * as store from '../../server/store.ts'
import { growthContext, growthView, stageGrowthUpdates, actOnGrowthItem } from '../../server/growth.ts'
import { buildMaterialFactCatalogue, resolveSelectedMaterialFacts } from '../../server/grounded-material.ts'

// P4 material regressions (isolated PG, no provider): the catalogue contains
// only the user's own verified words; corrections and withdrawals retire stale
// references; rendering is deterministic and identical to what is stored.
test('material catalogue and renderer keep resume facts evidence-bound (MAT-01..04)',async t=>{
  const user='grounded-material-'+randomUUID(),chat=randomUUID()
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await store.createConversation(user,{id:chat,title:'SYNTHETIC material conversation'})
  const prepare=async(text:string)=>(await store.startRun(user,chat,randomUUID(),text)).run
  const saveFacts=async(run:store.Run,changes:any[])=>{
    const growth=await growthContext(user,chat)
    const staged=await stageGrowthUpdates(run,changes,growth)
    return store.finishRun(run,{candidates:[],audit:[],growth:staged},'已记录。',null,new AbortController().signal)
  }
  try{
    let threeWorksId=''
    await t.test('MAT-01 three works prove existence only — no tools, roles or proficiency appear',async()=>{
      const run=await prepare('我有三个数字媒体作品，倾向就业但想看看真实反馈。')
      await saveFacts(run,[
        {target:{operation:'create'},kind:'ability',assertion:'user_reported',source:{messageId:run.source_message_id,quote:'我有三个数字媒体作品'}},
        {target:{operation:'create'},kind:'goal',assertion:'user_reported',source:{messageId:run.source_message_id,quote:'倾向就业但想看看真实反馈'}},
      ])
      const catalogue=buildMaterialFactCatalogue(await growthContext(user,chat))
      assert.equal(catalogue.length,2)
      const works=catalogue.find(fact=>fact.field==='project')!
      threeWorksId=works.catalogueId
      assert.equal(works.text,'我有三个数字媒体作品','facts render verbatim from the user words')
      assert.equal(works.completeForField,false,'existence of works is not a complete project entry')
      const result=resolveSelectedMaterialFacts(catalogue.map(fact=>fact.catalogueId),catalogue,user,user)
      assert.equal(result.readiness,'template')
      assert.ok(!/PS|Figma|Premiere|Excel|独立负责|设计师/.test(result.content),'no invented tools, proficiency or roles')
      assert.ok(result.content.includes('【待补：联系方式】')&&result.content.includes('【待补：个人基本信息】'),'missing fields stay visible')
    })
    await t.test('MAT-04 a corrected fact retires the old catalogue id; withdrawal removes the entry',async()=>{
      const run=await prepare('我会Figma但还不熟练，作品改成四个了。')
      await saveFacts(run,[
        {target:{operation:'create'},kind:'preference',assertion:'user_reported',source:{messageId:run.source_message_id,quote:'我会Figma但还不熟练'}},
        {target:{operation:'amend',itemId:(await growthContext(user,chat)).find(row=>row.text==='我有三个数字媒体作品')!.id,expectedRevision:1,beforeQuote:'我有三个数字媒体作品'},kind:'ability',assertion:'user_reported',source:{messageId:run.source_message_id,quote:'作品改成四个了'}},
      ])
      const after=buildMaterialFactCatalogue(await growthContext(user,chat))
      assert.ok(!after.some(fact=>fact.catalogueId===threeWorksId),'the corrected revision has a new catalogue id')
      const works=after.filter(fact=>fact.field==='project').map(fact=>fact.text)
      assert.ok(works.some(text=>text==='作品改成四个了'),'the corrected count is the current fact')
      assert.ok(!works.includes('我有三个数字媒体作品'),'the stale count is gone')
      const figma=after.find(fact=>fact.text==='我会Figma但还不熟练')!
      const draft=resolveSelectedMaterialFacts([figma.catalogueId],after,user,user)
      assert.ok(draft.content.includes('我会Figma但还不熟练'),'degree qualifiers survive verbatim (MAT-02)')
      // Cross-account and stale references are refused outright.
      assert.throws(()=>resolveSelectedMaterialFacts([threeWorksId],after,user,user),/MATERIAL_REFERENCE_INVALID/,'stale id after correction')
      assert.throws(()=>resolveSelectedMaterialFacts(after.map(fact=>fact.catalogueId),after,user,'other-user'),/MATERIAL_REFERENCE_INVALID/,'cross-account catalogue')
      // Forgetting the Figma source removes it from the catalogue entirely.
      const figmaItem=(await growthView(user,chat)).items.find(row=>row.text==='我会Figma但还不熟练')!
      await actOnGrowthItem(user,figmaItem.id,{requestId:randomUUID(),expectedRevision:figmaItem.revision,action:'forget'})
      const forgotten=buildMaterialFactCatalogue(await growthContext(user,chat))
      assert.ok(!forgotten.some(fact=>fact.catalogueId===figma.catalogueId),'withdrawn capabilities cannot be reused (MAT-04)')
    })
    await t.test('MAT-03 deterministic rendering: same ids produce the identical stored content',async()=>{
      const catalogue=buildMaterialFactCatalogue(await growthContext(user,chat))
      const ids=catalogue.map(fact=>fact.catalogueId)
      const first=resolveSelectedMaterialFacts(ids,catalogue,user,user)
      const second=resolveSelectedMaterialFacts(ids,catalogue,user,user)
      assert.equal(first.content,second.content,'rewrite/copy/refresh read one server-rendered content')
      assert.deepEqual(first.usedCatalogueIds,ids)
    })
  }finally{
    await pool.query('DELETE FROM growth_source_suppressions WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_item_lineage WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_items WHERE user_id=$1',[user])
    await pool.query('DELETE FROM growth_revisions WHERE user_id=$1',[user])
    await pool.query('DELETE FROM runs WHERE user_id=$1',[user])
    await pool.query('DELETE FROM messages WHERE user_id=$1',[user])
    await pool.query('DELETE FROM conversations WHERE user_id=$1',[user])
    await pool.query('DELETE FROM "user" WHERE id=$1',[user])
  }
})

test.after(async()=>{await pool.end()})
