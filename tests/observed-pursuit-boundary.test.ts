import test from 'node:test'
import assert from 'node:assert/strict'
import {deriveThemeCandidates,themeHasPursuitSource,themeNextStep} from '../server/user-themes.ts'
const fact=(id:string,text:string,kind='goal')=>({id,text,kind,status:'active',assertion:'user_reported'})
const step='我想先找一件能核实实际条件的小事'
const theme=(title:string,quote:string)=>({title,status:'active',pinned:false,source_refs:[{growthItemId:title,quote}]})

test('the observed immediate step is kept out of pursuits and old visible projections',()=>{
 assert.deepEqual(deriveThemeCandidates([fact('step',step)]),[])
 assert.equal(themeHasPursuitSource(theme('找一件能核实实际条件的小事',step)),false)
 assert.ok(deriveThemeCandidates([fact('job','我想找一份实习')]).length===1,'a concrete development goal remains legal')
 assert.ok(deriveThemeCandidates([fact('habit','我想长期练习写作')]).length===1,'non-career pursuits remain legal')
 assert.equal(deriveThemeCandidates([fact('explore','我想先探索创业')])[0]?.kind,'exploration','a current exploration is not promoted to a decided pursuit')
})

test('explicit priority survives the model labelling it context without relying on recency',()=>{
 const themes=[theme('找一件能核实实际条件的小事',step),theme('就业','我想比较就业')]
 const facts=[fact('p','当前更重视就业','context')]
 assert.equal(themeNextStep(themes,new Set(),facts),'当前重点：就业（本人表达）')
 assert.equal(themeNextStep(themes,new Set(),[fact('p','当前不知道是否该优先就业','context')]),'正在探索：就业；优先顺序尚未确认。')
 assert.equal(themeNextStep(themes,new Set(['就业']),facts),'')
 assert.equal(deriveThemeCandidates(facts)[0]?.title,'就业')
 assert.equal(deriveThemeCandidates(facts)[0]?.status,'active')
})
