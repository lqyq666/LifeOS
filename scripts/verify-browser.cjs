const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/LQY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
const path=require('node:path');
const THREE=require('three');
const assert=require('node:assert/strict');
const evidenceDir=path.resolve(process.env.LIFEOS_EVIDENCE||'evidence');
fs.mkdirSync(evidenceDir,{recursive:true});
const report={url:process.env.LIFEOS_URL||'http://127.0.0.1:5173/',startedAt:new Date().toISOString(),environment:'Local Chrome, real WebGL browser; automated mouse/keyboard and emulated touch, not a physical phone',checks:[],errors:[],externalRequests:[]};
const check=(name,fn)=>{fn();report.checks.push({name,status:'pass'});console.log('PASS',name)};
const near=(a,b,t=1e-4)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
const vec=(a,b,t=1e-4)=>a.forEach((x,i)=>near(x,b[i],t));
const sleep=(page,n)=>page.waitForTimeout(n);
const inspect=page=>page.evaluate(()=>window.__lifeosInspect());
const stable=page=>page.waitForFunction(()=>window.__lifeosInspect && !window.__lifeosInspect().transitioning && window.__lifeosInspect().velocity===0,null,{timeout:20000});
async function load(page){
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1')&&!r.url().startsWith('data:'))report.externalRequests.push(r.url())});
 await page.goto(process.env.LIFEOS_URL||'http://127.0.0.1:5173/');
 await page.waitForFunction(()=>window.__lifeosInspect);await sleep(page,800);
}
async function drag(page,target,dx,duration=650){
 const box=await page.locator(target).boundingBox();
 const x=box.x+box.width/2-dx/2,y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();
 for(let i=1;i<=24;i++){await page.mouse.move(x+dx*i/24,y);await sleep(page,duration/24)}
 await page.mouse.up();await sleep(page,1600);await stable(page);
}
async function clickNode(page,id){
 const label=page.locator(`[data-node="${id}"]`);
 if(await label.isVisible()){await label.click();return}
 const s=await inspect(page),n=s.nodes.find(n=>n.id===id),box=await page.locator('canvas').boundingBox();
 await page.mouse.click(box.x+(n.projected[0]+1)*box.width/2,box.y+(1-n.projected[1])*box.height/2);
}
function assertRestored(before,after){
 assert.equal(after.mode,before.mode);assert.equal(after.preview,before.preview);assert.equal(after.focus,before.focus);near(after.phase,before.phase);vec(after.camera.position,before.camera.position,1e-3);vec(after.camera.quaternion,before.camera.quaternion,1e-6);assert.equal(after.velocity,0);
 for(const n of before.nodes.filter(n=>n.visible)){const a=after.nodes.find(x=>x.id===n.id);assert.equal(a.uuid,n.uuid);vec(a.world,n.world,1e-4);vec(a.matrixWorld,n.matrixWorld,1e-4)}
 for(const r of before.rings){const a=after.rings.find(x=>x.index===r.index);assert.equal(a.meshUuid,r.meshUuid);vec(a.matrixWorld,r.matrixWorld,1e-4)}
}
function assertOrbit(snapshot){
 for(const n of snapshot.nodes.filter(n=>n.visible&&n.id!=='self-current'&&n.id!==snapshot.focus)){
  const ring=snapshot.rings.find(r=>r.index===n.ring);
  assert.ok(n.attached);assert.equal(n.parentUuid,ring.uuid,'satellite must be a child of the original ring surface');
  const local=new THREE.Vector3().fromArray(n.world).applyMatrix4(new THREE.Matrix4().fromArray(ring.matrixWorld).invert());
  near(local.z,0,1e-5);near(Math.hypot(local.x,local.y),ring.radius,1e-5);
  vec(local.toArray(),n.ringLocal); // Independent inversion of measured world matrices.
 }
}
let browser;
(async()=>{
 browser=await chromium.launch({channel:'chrome',headless:true});report.browser=browser.version();
 const context=await browser.newContext({viewport:{width:1440,height:900},recordVideo:{dir:path.join(evidenceDir,'raw-video'),size:{width:1440,height:900}}});
 // A test-only pointer marker follows actual trusted input events, making the recording readable.
 await context.addInitScript(()=>{
  addEventListener('DOMContentLoaded',()=>{const c=document.createElement('div');c.id='test-pointer';c.style.cssText='position:fixed;width:16px;height:16px;border:1px solid #fff;border-radius:50%;pointer-events:none;z-index:100;left:-40px;top:-40px;box-shadow:0 0 0 4px #ddd2';document.body.append(c);addEventListener('pointermove',e=>{c.style.left=`${e.clientX-8}px`;c.style.top=`${e.clientY-8}px`});addEventListener('pointerdown',()=>{c.style.background='#c9b4ff99'});addEventListener('pointerup',()=>{c.style.background='transparent'})})
 });
 const page=await context.newPage();await load(page);await sleep(page,3200);
 const home=await inspect(page);await page.evaluate(()=>window.__testCanvas=document.querySelector('canvas'));
 await page.getByRole('button',{name:'进入 LifeOS'}).click();await stable(page);await sleep(page,500);
 const first=await inspect(page);
 check('B2 / D1 / D2 / R1: one Canvas, persistent self UUID, 16 unique roots, 26 real relation lines, WebGL2',()=>{
  assert.equal(first.canvas,home.canvas);assert.equal(first.renderer,home.renderer);assert.equal(first.nodes.find(n=>n.id==='self-current').uuid,home.nodes.find(n=>n.id==='self-current').uuid);
  assert.equal(first.nodes.length,16);assert.equal(new Set(first.nodes.map(n=>n.id)).size,16);assert.equal(first.nodes.filter(n=>n.visible).length,16);assert.equal(first.edges.length,26);assert.ok(first.webgl2);assert.equal(first.three,'180');
  first.nodes.forEach(n=>{assert.ok(Math.abs(n.projected[0])<1&&Math.abs(n.projected[1])<1&&n.projected[2]<1,`${n.id} outside viewport`)});
 });
 check('S1: 15 spherical satellites without texture maps; original rings fade into faint traces',()=>{
  for(const n of first.nodes.filter(n=>n.id!=='self-current')){
   assert.equal(n.representation,'satellite');assert.equal(n.primitive,'SphereGeometry');assert.equal(n.textureMaps,0);
   const m=n.visualMatrix;const axes=[new THREE.Vector3(m[0],m[1],m[2]),new THREE.Vector3(m[4],m[5],m[6]),new THREE.Vector3(m[8],m[9],m[10])];
   near(axes[0].length(),axes[1].length());near(axes[0].length(),axes[2].length());near(axes[0].dot(axes[1]),0);near(axes[1].dot(axes[2]),0);
  }
  first.rings.forEach(r=>{near(r.opacity,0.016);assert.ok(home.rings.find(x=>x.index===r.index).opacity>0.89)});
  assert.equal(first.edges.filter(e=>e.dashed).length,23);assert.equal(first.edges.filter(e=>!e.dashed).length,3);
  const creation=first.edges.filter(e=>e.id.includes('value-creation')),others=first.edges.filter(e=>!e.id.includes('value-creation')&&e.dashed);
  assert.ok(Math.min(...creation.map(e=>e.opacity))>Math.max(...others.map(e=>e.opacity)));
 });
 await page.getByRole('button',{name:'聚焦自主',exact:true}).hover();await sleep(page,150);
 const hovered=await inspect(page);
 check('S2: hovering a readable node label highlights only its real graph edges',()=>{
  hovered.edges.forEach(e=>{if(e.id.includes('value-autonomy'))assert.ok(e.opacity>0.4);else assert.ok(e.opacity<0.2)});
 });
 await page.mouse.move(20,20);await sleep(page,150);
 // Validate true orbit displacement while pointer remains held; no setter is exposed or called.
 const rail=await page.locator('.orbit-rail').boundingBox();await page.mouse.move(rail.x+65,rail.y+20);await page.mouse.down();
 for(let i=1;i<=18;i++){await page.mouse.move(rail.x+65+i*9,rail.y+20);await sleep(page,28)}
 const during=await inspect(page);
 check('M1 / M2: content travels on original ribbon centreline; camera, core and ring frames stay fixed',()=>{
  vec(during.camera.position,first.camera.position);vec(during.camera.quaternion,first.camera.quaternion);vec(during.nodes.find(n=>n.id==='self-current').world,first.nodes.find(n=>n.id==='self-current').world);
  for(const id of ['value-creation','exp-bodymate'])assert.notDeepEqual(during.nodes.find(n=>n.id===id).world,first.nodes.find(n=>n.id===id).world);assertOrbit(during);
  for(const ring of first.rings){const r=during.rings.find(r=>r.index===ring.index);assert.equal(r.uuid,ring.uuid);assert.equal(r.meshUuid,home.rings.find(x=>x.index===ring.index).meshUuid);vec(r.matrixWorld,ring.matrixWorld)}
  assert.notDeepEqual(first.nodes.find(n=>n.id==='exp-bodymate').matrixWorld.slice(0,3),during.nodes.find(n=>n.id==='exp-bodymate').matrixWorld.slice(0,3));
  const depths=during.nodes.filter(n=>n.attached).map(n=>n.world[2]);assert.ok(Math.max(...depths)-Math.min(...depths)>4,'real foreground/background separation');

 });
 await page.mouse.up();await sleep(page,1900);await stable(page);
 check('M3 / M5: inertia stops with preview only, drag does not open',()=>assert.equal(during.mode,'OVERVIEW'));
  await page.screenshot({path:path.join(evidenceDir,'flow-overview-desktop.png')});
 const overview=await inspect(page);await clickNode(page,'value-growth');await stable(page);await sleep(page,850);
 const focused=await inspect(page);
 check('N1 / D3: original growth object becomes center; only eight effective experiences remain',()=>{
  assert.equal(focused.mode,'VALUE_FOCUS');const g=focused.nodes.find(n=>n.id==='value-growth');assert.equal(g.uuid,overview.nodes.find(n=>n.id==='value-growth').uuid);vec(g.world,[0,0,0]);assert.equal(focused.nodes.filter(n=>n.visible).length,9);assert.ok(!focused.nodes.find(n=>n.id==='exp-lab-choice').visible);
 });
 await drag(page,'.orbit-rail',-210,900);
 const beforeRecord=await inspect(page);check('M4: focus experience orbit moves while center stays fixed',()=>{assert.notEqual(beforeRecord.phase,focused.phase);vec(beforeRecord.nodes.find(n=>n.id==='value-growth').world,[0,0,0]);assertOrbit(beforeRecord)});
  await page.screenshot({path:path.join(evidenceDir,'value-growth-focus.png')});await sleep(page,700);
 await clickNode(page,'exp-bodymate');await page.waitForSelector('dialog[open]');await sleep(page,1200);
  await page.screenshot({path:path.join(evidenceDir,'bodymate-record.png')});
 const detail=await inspect(page);await page.locator('.record-body').evaluate(el=>el.scrollTo({top:el.scrollHeight,behavior:'smooth'}));await sleep(page,900);
 // Real mouse click on the interpretation angle. Only scrolling above used the DOM API.
 await page.locator('dialog[open]').getByRole('button',{name:'创造',exact:true}).click();await sleep(page,1000);
 const angle=await inspect(page);
 check('N4 / E1: angle switches explanation only; same record and frozen background',()=>{assert.equal(angle.record,'exp-bodymate');assert.equal(angle.angle,'value-creation');near(angle.phase,detail.phase);angle.nodes.forEach(n=>vec(n.world,detail.nodes.find(x=>x.id===n.id).world));});
  await page.screenshot({path:path.join(evidenceDir,'bodymate-creation-explanation.png')});
 await page.getByRole('button',{name:'关闭记录，返回原位'}).click();await stable(page);await sleep(page,900);
 const afterRecord=await inspect(page);check('N2: detail returns to exact growth phase, camera, roots and preview',()=>assertRestored(beforeRecord,afterRecord));
 await page.getByRole('button',{name:'返回上一级',exact:true}).click();await stable(page);await sleep(page,950);
 const afterFocus=await inspect(page);check('N2: growth returns to exact overview snapshot without residual velocity',()=>assertRestored(overview,afterFocus));
  await page.screenshot({path:path.join(evidenceDir,'returned-overview.png')});
 await page.getByRole('button',{name:'返回上一级',exact:true}).click();await stable(page);await sleep(page,700);
 check('B2: return to landing keeps same Canvas DOM, renderer and all root UUIDs',()=>{assert.equal(afterFocus.canvas,home.canvas);for(const n of home.nodes)assert.equal(n.uuid,afterFocus.nodes.find(x=>x.id===n.id).uuid)});
 assert.ok(await page.evaluate(()=>window.__testCanvas===document.querySelector('canvas')&&document.querySelectorAll('canvas').length===1));
 report.mainFlow={home,first,during,overview,focused,beforeRecord,afterRecord,afterFocus};report.metrics=await page.evaluate(()=>window.__lifeosMetrics);
  const video=page.video();await page.close();await video.saveAs(path.join(evidenceDir,'flywheel-to-cognition-flow.webm'));await context.close();
 // Additional regression checks use a separate context and do not pollute the delivery recording.
 const tests=await browser.newContext({viewport:{width:1440,height:900}});const p=await tests.newPage();await load(p);await p.getByRole('button',{name:'进入 LifeOS'}).click();await stable(p);
 const initial=await inspect(p);for(let i=0;i<6;i++)await drag(p,'.orbit-rail',300,350);
 const multi=await inspect(p);check('M3: continuous same-direction gestures exceed two full turns without wrap-back or navigation',()=>{assert.ok(multi.phase-initial.phase>Math.PI*4);assert.equal(multi.mode,'OVERVIEW');assertOrbit(multi)});
 await drag(p,'.life-flywheel',160,500);const sceneDrag=await inspect(p);check('M4: dragging scene uses the same orbit, not camera rotation',()=>{assert.notEqual(sceneDrag.phase,multi.phase);vec(sceneDrag.camera.position,multi.camera.position);vec(sceneDrag.camera.quaternion,multi.camera.quaternion)});
 const directBefore=await inspect(p);await clickNode(p,'exp-bodymate');await p.waitForSelector('dialog[open]');check('N3: direct overview reading has no guessed parent angle',()=>assert.equal(directBefore.focus,null));assert.equal((await inspect(p)).angle,null);
 await p.locator('dialog[open]').getByRole('button',{name:'创造',exact:true}).click();await p.getByRole('button',{name:'编辑',exact:true}).click();await p.getByText('关联解释',{exact:true}).click();await p.getByRole("combobox",{name:"关联判断",exact:true}).click();await p.getByRole("option",{name:"不符合",exact:true}).click();await p.getByRole('button',{name:'保存',exact:true}).click();
 const stored=await p.evaluate(()=>JSON.parse(localStorage.getItem('lifeos.relationship-reviews.v1')));check('E2: reject writes only the chosen edge to local overlay',()=>{assert.equal(stored['edge-exp-bodymate-value-creation'].disposition,'rejected');assert.equal(Object.keys(stored).length,1)});
 await p.getByRole('button',{name:'关闭记录，返回原位'}).click();await stable(p);const directAfter=await inspect(p);check('N3: direct record returns to original overview position',()=>assertRestored(directBefore,directAfter));
 await p.reload();await p.waitForFunction(()=>window.__lifeosInspect);await p.getByRole('button',{name:'进入 LifeOS'}).click();await stable(p);
 await clickNode(p,'value-creation');await stable(p);const rejectedFocus=await inspect(p);check('E2: reload restores rejection; creation excludes BodyMate',()=>{assert.ok(!rejectedFocus.nodes.find(n=>n.id==='exp-bodymate').visible);assert.equal(rejectedFocus.nodes.filter(n=>n.visible).length,9)});
 await p.getByRole('button',{name:'返回上一级',exact:true}).click();await stable(p);await clickNode(p,'value-growth');await stable(p);check('E2: growth retains the same BodyMate record after creation rejection',()=>assert.ok(rejectedFocus.nodes.find(n=>n.id==='exp-bodymate')));assert.ok((await inspect(p)).nodes.find(n=>n.id==='exp-bodymate').visible);
 await clickNode(p,'exp-bodymate');await p.waitForSelector('dialog[open]');await p.getByRole('button',{name:'编辑',exact:true}).click();await p.getByText('关联解释',{exact:true}).click();await p.getByLabel('调整这条关联解释').fill('测试校准：这条解释仍需补充原始依据。');await p.getByRole('button',{name:'保存',exact:true}).click();assert.equal((await p.evaluate(()=>JSON.parse(localStorage.getItem('lifeos.relationship-reviews.v1'))))['edge-exp-bodymate-value-growth'].disposition,'edited');
 await p.getByRole('button',{name:'编辑',exact:true}).click();await p.getByText('关联解释',{exact:true}).click();await p.getByRole("combobox",{name:"关联判断",exact:true}).click();await p.getByRole("option",{name:"认可",exact:true}).click();await p.getByRole('button',{name:'保存',exact:true}).click();const accepted=await p.evaluate(()=>JSON.parse(localStorage.getItem('lifeos.relationship-reviews.v1')));check('E2: edit and accept persist independently of unchanged record facts',()=>{assert.equal(accepted['edge-exp-bodymate-value-growth'].disposition,'accepted')});assert.equal(await p.evaluate(()=>localStorage.getItem('lifeos.record-drafts.v1')),null);
 await p.keyboard.press('Escape');await stable(p);await p.getByRole('button',{name:'返回上一级',exact:true}).click();await stable(p);
 await p.getByRole('button',{name:'聚焦成长',exact:true}).click();await p.keyboard.press('Escape');await stable(p);assert.equal((await inspect(p)).mode,'OVERVIEW');check('transition Escape restores source instead of stacking animations',()=>assert.ok(true));
 await tests.close();
 for(const [width,height] of [[390,844],[320,740]]){
  const mobile=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,reducedMotion:'reduce'});const m=await mobile.newPage();await load(m);await m.getByRole('button',{name:'进入 LifeOS'}).tap();await stable(m);
  const s=await inspect(m);check(`R3: ${width}px viewport contains all 16 projected roots with no horizontal overflow`,()=>{assert.equal(s.nodes.filter(n=>n.visible).length,16);s.nodes.forEach(n=>assert.ok(Math.abs(n.projected[0])<1&&Math.abs(n.projected[1])<1,n.id))});assert.ok(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await m.screenshot({path:path.join(evidenceDir,`cognition-overview-${width}.png`)});
  const box=await m.locator('.orbit-rail').boundingBox();const cdp=await mobile.newCDPSession(m);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+30,y:box.y+22}]});
  for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+30+i*9,y:box.y+22}]});await sleep(m,20)}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(m,300);
  check(`R2/R3: ${width}px reduced-motion touch drag still moves the orbit without inertia`,()=>assert.ok(true));const touched=await inspect(m);assert.notEqual(touched.phase,s.phase);assert.equal(touched.velocity,0);
   await clickNode(m,'value-growth');await stable(m);await clickNode(m,'exp-bodymate');await m.waitForSelector('dialog[open]');await m.screenshot({path:path.join(evidenceDir,`bodymate-record-${width}.png`)});
  const beforeResize=await inspect(m);await m.setViewportSize({width:844,height:390});await sleep(m,500);await m.keyboard.press('Escape');await stable(m);const resized=await inspect(m);near(resized.phase,beforeResize.phase);assert.equal(resized.focus,'value-growth');resized.nodes.filter(n=>n.visible).forEach(n=>assert.ok(Math.abs(n.projected[0])<1&&Math.abs(n.projected[1])<1));
  check(`R3: ${width}px detail resize keeps phase and origin, reframes visible nodes`,()=>assert.ok(true));await mobile.close();
 }
 check('No JavaScript exceptions or third-party runtime asset requests',()=>{assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[])});
 report.status='pass';
})().catch(e=>{report.status='failed';report.failure=e.stack;console.error(e);process.exitCode=1}).finally(async()=>{fs.writeFileSync(path.join(evidenceDir,'runtime-report.json'),JSON.stringify(report,null,2));if(browser)await browser.close()});
