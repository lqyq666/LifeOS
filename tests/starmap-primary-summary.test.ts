import test from 'node:test'
import assert from 'node:assert/strict'
import { rankPrimaryThemes } from '../server/user-themes.ts'
import { applicableExperienceOutcomes, summarizeExperience } from '../server/experience-insight.ts'

const theme = (title:string, over:Record<string,unknown>={}) => ({
  id:title, title, status:'active', pinned:false,
  source_refs:[{growthItemId:'g-'+title,quote:`我想探索${title}`}],
  linkedExperienceCount:0, confirmedExperienceCount:0,
  updated_at:'2026-10-01T00:00:00.000Z', ...over,
})

test('three primary star-map keywords reflect user priority and evidence instead of recency alone',()=>{
  const ranked=rankPrimaryThemes([
    theme('新近空主题',{updated_at:'2026-10-17T00:00:00.000Z'}),
    theme('作品实践',{linkedExperienceCount:3,confirmedExperienceCount:2,updated_at:'2026-09-01T00:00:00.000Z'}),
    theme('就业',{source_refs:[{growthItemId:'g-job',quote:'我决定本阶段就业优先'}]}),
    theme('课程学习',{linkedExperienceCount:2,confirmedExperienceCount:1}),
    theme('保研',{pinned:true}),
  ])
  assert.deepEqual(ranked.map(item=>item.title),['保研','就业','作品实践'])
  assert.deepEqual(ranked.map(item=>item.primaryReason),['本人置顶','本人明确优先','2 段已确认经历支持'])
})

test('experience summary keeps action, reported result and unknowns separate',()=>{
  assert.deepEqual(summarizeExperience({
    summary:'上周我完成了招新海报，部长说整体效果还不错。',
    action:'上周我完成了招新海报', result:'部长说整体效果还不错', reflection:'',
  }),{
    action:'上周我完成了招新海报',
    result:'部长说整体效果还不错',
    reflection:'尚未记录本人复盘',
    unknowns:'是否读过、是否回应、是否采用、实际效果仍未知',
  })
  assert.deepEqual(summarizeExperience({summary:'我整理了访谈记录。',action:'我整理了访谈记录',result:'',reflection:'下次先区分原话和判断'}),{
    action:'我整理了访谈记录',result:'尚未记录结果',reflection:'下次先区分原话和判断',unknowns:'结果仍未知',
  })
})

test('experience outcomes are applicable to the experience instead of a universal delivery funnel',()=>{
  const everyday={summary:'和室友打羽毛球后觉得轻松',action:'我和室友打了羽毛球',result:'我觉得轻松',sourceQuote:'昨天我和室友打羽毛球后觉得轻松'}
  assert.deepEqual(applicableExperienceOutcomes(everyday),[])
  assert.equal(summarizeExperience(everyday).unknowns,'')
  assert.deepEqual(applicableExperienceOutcomes({action:'我把海报发给了部长',result:'还没回复'}),['read','response','adoption','effect'])
  assert.deepEqual(applicableExperienceOutcomes({action:'我给客户交付了海报',result:'客户还没付款'}),['read','response','adoption','payment','effect'])
})
