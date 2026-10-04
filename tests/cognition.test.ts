import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGraph, graph, parseReviews, type Reviews } from '../src/features/cognition/graph.ts'
import { CognitionController } from '../src/features/cognition/state.ts'
import { dampOrbit, shortestAngle, snapPhase, TAU } from '../src/features/cognition/orbit.ts'

test('seed has unique three-layer entities, 26 valid edges and correct many-to-many queries',()=>{
  assert.equal(graph.nodes.size,16);assert.equal(graph.data.edges.length,26)
  assert.deepEqual(graph.values.map(id=>graph.getExperiencesForValue(id).length),[9,6,8])
  assert.deepEqual(graph.getValueIdsForExperience('exp-bodymate'),['value-creation','value-growth'])
  assert.ok(!graph.getExperiencesForValue('value-growth').includes('exp-lab-choice'))
  assert.equal(graph.data.nodes.filter(n=>n.id==='exp-bodymate').length,1)
})
test('changing one legal edge changes both effective edges and focus query',()=>{
  const fixture=structuredClone(graph.data)
  const edge=fixture.edges.find(e=>e.sourceId==='exp-lab-choice')!
  edge.targetId='value-growth'
  const changed=createGraph(fixture)
  assert.ok(changed.getExperiencesForValue('value-growth').includes('exp-lab-choice'))
  assert.ok(changed.effectiveEdges().some(e=>e.sourceId==='exp-lab-choice'&&e.targetId==='value-growth'))
  assert.ok(!changed.getExperiencesForValue('value-autonomy').includes('exp-lab-choice'))
})
test('malformed IDs, endpoints, layers, duplicated edges and order are rejected',()=>{
  const mutate=[(d:typeof graph.data)=>d.nodes.push(d.nodes[0]),(d:typeof graph.data)=>{d.edges[3].targetId='missing'},(d:typeof graph.data)=>{d.edges[3].targetId='exp-lifeos'},(d:typeof graph.data)=>d.edges.push(d.edges[3]),(d:typeof graph.data)=>d.viewConfig.valueOrder.push('value-growth')]
  for(const fn of mutate){const d=structuredClone(graph.data);fn(d);assert.throws(()=>createGraph(d))}
})
test('rejecting one interpretation preserves the record and other interpretations; zero and one remain valid',()=>{
  const rejected={disposition:'rejected' as const,reviewedAt:new Date().toISOString()}
  const reviews:Reviews={'edge-exp-bodymate-value-creation':rejected}
  assert.deepEqual(graph.getValueIdsForExperience('exp-bodymate',reviews),['value-growth'])
  reviews['edge-exp-bodymate-value-growth']=rejected
  assert.equal(graph.getValueIdsForExperience('exp-bodymate',reviews).length,0)
  assert.equal(graph.getNode('exp-bodymate')?.title,'BodyMate')
  const all:Reviews=Object.fromEntries(graph.data.edges.filter(e=>e.targetId==='value-growth'&&e.type==='RELATES_TO_VALUE').map(e=>[e.id,rejected]))
  assert.equal(graph.getExperiencesForValue('value-growth',all).length,0)
  delete all['edge-exp-bodymate-value-growth'];assert.deepEqual(graph.getExperiencesForValue('value-growth',all),['exp-bodymate'])
})
test('snap crosses 2π without reverse long rotation and supports zero/one candidates',()=>{
  assert.ok(Math.abs(shortestAngle(TAU-0.01,0)-0.01)<1e-12)
  for(let phase=-TAU*4;phase<TAU*4;phase+=0.12)assert.ok(Math.abs(snapPhase(phase,8)-phase)<=Math.PI/8+1e-10)
  assert.equal(snapPhase(4,0),4);assert.equal(snapPhase(4,1),4)
})
test('exponential damping is frame-partition invariant, including damping=0',()=>{
  const one=dampOrbit(1,7,0.7),half=dampOrbit(1,7,0.3),two=dampOrbit(half.phase,half.velocity,0.4)
  assert.ok(Math.abs(one.phase-two.phase)<1e-12);assert.ok(Math.abs(one.velocity-two.velocity)<1e-12)
  assert.deepEqual(dampOrbit(1,7,0.5,0),{phase:4.5,velocity:7})
})
test('navigation restores phase, preview, camera, origin and ignores interpretation angle',()=>{
  const c=new CognitionController();c.reducedMotion=true;c.enter();c.phase=7.41;c.update({previewNodeId:'value-autonomy'})
  const camera={position:[0,0.4,18],quaternion:[0,0,0,1],fov:35,zoom:1,viewport:[1440,665],selfPosition:[0,0,0],selfRotation:[0,0,0]}
  c.capture=()=>camera
  c.open('value-growth');c.phase=-8.6;c.update({previewNodeId:'exp-path-adjustment'})
  c.open('exp-bodymate');c.changeAngle('value-creation');c.back()
  assert.equal(c.view.mode,'VALUE_FOCUS');assert.equal(c.view.focusValueId,'value-growth');assert.equal(c.phase,-8.6);assert.equal(c.view.previewNodeId,'exp-path-adjustment');assert.deepEqual(c.restoreRuntime,camera)
  c.back();assert.equal(c.phase,7.41);assert.equal(c.view.mode,'OVERVIEW');assert.equal(c.view.previewNodeId,'value-autonomy');assert.equal(c.velocity,0)
  c.open('exp-bodymate');assert.equal(c.view.interpretationValueId,null);c.back();assert.equal(c.view.mode,'OVERVIEW');assert.equal(c.phase,7.41)
})
test('transition lock blocks duplicate navigation; Escape can restore source',()=>{
  const c=new CognitionController();c.enter();c.enter();c.open('value-growth')
  assert.equal(c.navigationStack.length,1);assert.equal(c.view.mode,'OVERVIEW');c.back();assert.equal(c.view.mode,'LANDING');assert.equal(c.navigationStack.length,0)
})
test('drag, inertia and snap never navigate; cancellation and reduced motion stop velocity',()=>{
  const c=new CognitionController();c.reducedMotion=true;c.enter();c.reducedMotion=false
  c.startDrag();for(let i=0;i<30;i++)c.drag(60,0.02);assert.ok(c.phase>TAU*2);c.release()
  for(let i=0;i<200;i++)c.tick(1/60)
  assert.equal(c.view.mode,'OVERVIEW');assert.equal(c.velocity,0);assert.equal(c.snapTarget,null)
  c.startDrag();c.drag(70,0.02);c.cancelDrag();const p=c.phase;c.tick(1);assert.equal(c.phase,p)
  c.reducedMotion=true;c.startDrag();c.drag(30,0.02);c.release();assert.equal(c.velocity,0)
})
test('review persistence failure is visible and does not mutate seed or committed overlay',()=>{
  const c=new CognitionController(),before=JSON.stringify(graph.data)
  const review={disposition:'accepted' as const,reviewedAt:new Date().toISOString()}
  assert.equal(c.review('edge-exp-bodymate-value-growth',review,()=>{throw new Error('QuotaExceeded')}),false)
  assert.ok(c.view.storageError);assert.deepEqual(c.view.reviews,{})
  let stored='';assert.ok(c.review('edge-exp-bodymate-value-growth',review,r=>{stored=JSON.stringify(r)}))
  assert.deepEqual(parseReviews(stored),c.view.reviews);assert.equal(JSON.stringify(graph.data),before)
  c.review('edge-exp-bodymate-value-growth',{...review,disposition:'edited',editedReason:'由本人调整的解释'},r=>{stored=JSON.stringify(r)})
  c.review('edge-exp-bodymate-value-growth',review,r=>{stored=JSON.stringify(r)})
  assert.equal(parseReviews(stored)['edge-exp-bodymate-value-growth'].editedReason,'由本人调整的解释')
  assert.ok(graph.getDecisionContext(['exp-bodymate'],c.view.reviews).edges.every(e=>!e.verifiedFact))
})
test('invalid persisted reviews are not treated as trusted saved state',()=>{
  assert.throws(()=>parseReviews('[]'));assert.throws(()=>parseReviews('{broken'))
  assert.throws(()=>parseReviews(JSON.stringify({'edge-exp-bodymate-value-growth':{disposition:'edited',reviewedAt:'invalid'}})))
})
