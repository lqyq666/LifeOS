import {spawn,type ChildProcess} from 'node:child_process'
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'

// Operator driver for the real campus continuous experience. This script is the
// synthetic adult student: it reads each actual model reply and only then picks
// the next scripted answer. Hidden fixture facts are revealed only when the
// reply actually asks about that topic; unasked facts stay hidden. Fixture
// review criteria are never sent to the model.
//
// P0 invariants: every command names its trajectory actor (actorKey), each
// operator step has a stable logicalStepId, and a failed turn is preserved
// as-is — the same input is never resent automatically. A later explicit
// manual retry would be a new attempt under the same logicalStepId, which the
// unattended batch never triggers.

export type AnswerStep={kind:'answer',topics:{match:RegExp,answer:string,label:string}[],volunteer?:string,fallback?:string}
export type FixedStep={kind:'fixed',text:string,newConversation?:boolean,sampleClass?:'opening'|'ordinary_followup'|'long_material'}
export type ReadGrowthStep={kind:'readGrowth'}
export type EnableMemoryStep={kind:'enableMemory'}
export type ForgetStep={kind:'forget',match:RegExp,label:string}
export type Step=AnswerStep|FixedStep|ReadGrowthStep|EnableMemoryStep|ForgetStep
export type Scenario={id:string,steps:Step[]}

export function scenarios():Scenario[]{
  return [
    {id:'C01',steps:[
      {kind:'fixed',text:'我已经成年，读大学但还没确定毕业方向，经历也不多。我不想谈家庭收入。',sampleClass:'opening'},
      {kind:'answer',volunteer:'先说一下我的基本情况：我读统计学，大三，每周大概能拿出4小时，做过一份课程的数据分析作品。兴趣方向我还不确定。',topics:[
        {match:/专业|学什么|读什么|统计|什么系|年级/,answer:'我读统计学，现在大三。',label:'major'},
        {match:/时间|小时|精力|投入|每周能/,answer:'每周大概能拿出4小时。',label:'hours'},
        {match:/作品|经历|项目|做过|成果|作业|实践/,answer:'做过一份课程的数据分析作品，是课程作业，不算正式项目。',label:'evidence'},
        {match:/兴趣|喜欢|有意思|好奇|偏好|研究/,answer:'这个我还不知道，没有特别确定的兴趣。',label:'interest-unknown'},
        {match:/家庭|收入|经济|钱|家境/,answer:'这个我不想说。',label:'income-refused'},
        {match:/具体的选择|困惑|遇到什么|想处理什么|想聊什么/,answer:'没有什么具体的选择，就是想先把方向梳理清楚。',label:'generic-open'},
      ],fallback:'这个我说不好，先继续。'},
      {kind:'answer',topics:[
        {match:/专业|学什么|读什么|统计|年级/,answer:'统计学，大三。',label:'major'},
        {match:/时间|小时|精力/,answer:'每周大概4小时。',label:'hours'},
        {match:/作品|经历|项目|成果/,answer:'就是那份课程数据分析作品。',label:'evidence'},
        {match:/兴趣|喜欢|有意思|好奇|偏好/,answer:'还不知道。',label:'interest-unknown'},
        {match:/家庭|收入|经济|钱|家境/,answer:'这个我不想说。',label:'income-refused'},
      ],fallback:'嗯，你继续说。'},
      {kind:'answer',topics:[
        {match:/时间|小时/,answer:'每周4小时左右。',label:'hours'},
        {match:/作品|经历/,answer:'就是那份课程数据分析作品。',label:'evidence'},
        {match:/兴趣|喜欢|有意思/,answer:'还不知道。',label:'interest-unknown'},
        {match:/家庭|收入|经济|钱/,answer:'这个我不想说。',label:'income-refused'},
      ],fallback:'可以，先这样。'},
      {kind:'fixed',text:'帮我把现在的方向选择整理一下：我现在有什么基础、值得先探索什么、还缺什么？',sampleClass:'ordinary_followup'},
    ]},
    {id:'C02',steps:[
      {kind:'fixed',text:'我想准备专升本，但不知道现在从哪一步开始。',sampleClass:'opening'},
      {kind:'answer',volunteer:'我的情况：我在浙江读专科二年级，数字媒体专业，每周能拿出8小时，数学比较薄弱，相关的练习做过三次。',topics:[
        {match:/省|城市|学校在哪|哪里|在哪儿/,answer:'我在浙江。',label:'province'},
        {match:/专业|学什么/,answer:'数字媒体专业，专科二年级。',label:'major'},
        {match:/时间|小时/,answer:'每周能拿出8小时。',label:'hours'},
        {match:/基础|薄弱|数学|成绩|水平|练习/,answer:'数学比较薄弱，相关的练习做过三次。',label:'weakness'},
      ],fallback:'你先问我具体的情况吧。'},
      {kind:'answer',topics:[
        {match:/省|城市|哪里/,answer:'浙江。',label:'province'},
        {match:/数学|基础|练习|薄弱/,answer:'数学薄弱，只做过三次练习。',label:'weakness'},
        {match:/时间|小时/,answer:'每周8小时。',label:'hours'},
        {match:/条件|要求|资格|报名|政策|考什么/,answer:'这个我不清楚，需要你帮我核对官方的要求。',label:'policy-unknown'},
      ],fallback:'嗯。'},
      {kind:'fixed',text:'那专升本的报名条件这些，你能确认是官方哪一年的要求吗？别拿不确定的当结论。',sampleClass:'ordinary_followup'},
      {kind:'fixed',text:'好，那按我数学薄弱的情况，这个学期我具体先做哪几步？',sampleClass:'ordinary_followup'},
    ]},
    {id:'C03',steps:[
      {kind:'fixed',text:'考研和考公我都在考虑，怕两边都准备不好。',sampleClass:'opening'},
      {kind:'answer',volunteer:'我的情况：每周10小时，希望留在本地。研究兴趣我还没想清楚，考公的岗位资格也还没核实过。',topics:[
        {match:/时间|小时|精力/,answer:'每周10小时。',label:'hours'},
        {match:/城市|地域|地方|本地|留在哪|哪里/,answer:'我希望留在本地，不想去太远。',label:'location'},
        {match:/研究|兴趣|学术|读研想/,answer:'研究兴趣我还不知道，没想清楚。',label:'research-unknown'},
        {match:/岗位|资格|条件|要求|职位/,answer:'岗位资格我还没核实过。',label:'job-unknown'},
      ],fallback:'你具体想了解什么就问吧。'},
      {kind:'answer',topics:[
        {match:/时间|小时/,answer:'每周10小时，不能再多了。',label:'hours'},
        {match:/研究|兴趣|学术/,answer:'还不知道。',label:'research-unknown'},
        {match:/岗位|资格|职位/,answer:'没核实过。',label:'job-unknown'},
        {match:/城市|地域|本地|哪里/,answer:'留本地。',label:'location'},
      ],fallback:'嗯，你继续。'},
      {kind:'fixed',text:'现在这个学期我该优先哪个？帮我排一个两边都不超时的安排，冲突的地方直接说。',sampleClass:'ordinary_followup'},
    ]},
    {id:'C04A',steps:[
      {kind:'fixed',text:'有个无薪产品实习，每周15小时、持续8周，我要不要接？',sampleClass:'opening'},
      {kind:'fixed',text:'我每周有18小时可用，目前不用靠实习收入维持生活。',sampleClass:'ordinary_followup'},
      {kind:'fixed',text:'那你说我现在具体该怎么办？',sampleClass:'ordinary_followup'},
    ]},
    {id:'C04B',steps:[
      {kind:'fixed',text:'有个无薪产品实习，每周15小时、持续8周，我要不要接？',sampleClass:'opening'},
      {kind:'fixed',text:'我每周只有4小时能用，而且我需要有工资来维持基本开支。',sampleClass:'ordinary_followup'},
      {kind:'fixed',text:'那你说我现在具体该怎么办？',sampleClass:'ordinary_followup'},
    ]},
    {id:'C05A',steps:[
      {kind:'fixed',text:'你好，我叫小林。我想试校园二手书项目，帮我看看怎么开始。',sampleClass:'opening'},
      {kind:'fixed',text:'每周3小时，预算200元，还没有客户。',sampleClass:'ordinary_followup'},
      {kind:'fixed',text:'帮我看看第一步从哪里开始。',sampleClass:'ordinary_followup'},
    ]},
    {id:'C05B',steps:[
      {kind:'fixed',text:'我叫阿然，想搞个校园二手书项目，咋开始比较好？',sampleClass:'opening'},
      {kind:'fixed',text:'每周3小时，预算200元，还没有客户。',sampleClass:'ordinary_followup'},
      {kind:'fixed',text:'帮我看看第一步从哪里开始。',sampleClass:'ordinary_followup'},
    ]},
    {id:'C06',steps:[
      {kind:'fixed',text:'我22岁，现在想准备海外硕士，每周能拿出10小时，已经有一些作品。',sampleClass:'opening'},
      {kind:'answer',topics:[
        {match:/作品|项目/,answer:'三个数字媒体的小项目，都放在作品集里了。',label:'works'},
        {match:/时间|小时/,answer:'每周10小时。',label:'hours'},
        {match:/目标|国家|专业|学校/,answer:'方向还没完全定，先把作品和语言弄好。',label:'goal'},
      ],fallback:'嗯，你继续问。'},
      {kind:'fixed',text:'我改主意了，想在6周内先找工作，每周只有3小时。之前的作品还在。',sampleClass:'ordinary_followup'},
      {kind:'fixed',text:'那现在的重点应该怎么变？之前的安排还作数吗？',sampleClass:'ordinary_followup'},
    ]},
    {id:'C07A',steps:[
      {kind:'fixed',text:'上次说投五个岗位，但我还没投。',sampleClass:'opening'},
      {kind:'answer',topics:[
        {match:/为什么|原因|卡在|没投/,answer:'期末挤占时间，下周我每周只有1小时。',label:'reason'},
        {match:/时间|小时/,answer:'下周每周只有1小时。',label:'hours'},
      ],fallback:'期末太忙了。'},
    ]},
    {id:'C07B',steps:[
      {kind:'fixed',text:'我已经投了五个岗位，才过两天，还没有回复。',sampleClass:'opening'},
      {kind:'answer',topics:[
        {match:/投了什么|岗位|渠道/,answer:'就是上次列的那五个岗位。',label:'jobs'},
        {match:/多久|几天|时间/,answer:'才过两天。',label:'elapsed'},
      ],fallback:'对，还没回复。'},
    ]},
    {id:'C08',steps:[
      {kind:'fixed',text:'这次作业拖延了，我是不是根本不适合考研？',sampleClass:'opening'},
      {kind:'answer',topics:[
        {match:/平时|以前|过去|最近|其他作业/,answer:'过去四周的作业大多数是按时完成的。',label:'pattern'},
        {match:/那天|这次|当天|为什么这次/,answer:'那天是社团事务挤占了时间。',label:'that-day'},
      ],fallback:'嗯。'},
      {kind:'answer',topics:[
        {match:/平时|过去|四周/,answer:'过去四周多数按时完成。',label:'pattern'},
        {match:/那天|当天|这次/,answer:'社团事务挤占了时间。',label:'that-day'},
      ],fallback:'大概就是这样。'},
    ]},
    {id:'C09',steps:[
      {kind:'enableMemory'},
      {kind:'fixed',text:'我已经成年，想梳理我的成绩单和升学考虑。',sampleClass:'opening'},
      {kind:'fixed',text:'我对视觉设计比较有兴趣，每周能投入6小时。成绩单我这学期平均分81，高数70。',sampleClass:'ordinary_followup'},
      {kind:'readGrowth'},
      {kind:'forget',match:/成绩|81|高数|70/,label:'transcript'},
      {kind:'fixed',text:'我撤回刚才的成绩单信息，别再用它给我建议，也先别推升学相关的安排。',sampleClass:'ordinary_followup'},
      {kind:'fixed',text:'接着之前的：我现在的兴趣和时间投入，先做什么比较合适？',newConversation:true,sampleClass:'ordinary_followup'},
    ]},
    {id:'C10',steps:[
      {kind:'fixed',text:'我22岁读数字媒体，最近对毕业后的选择有点迷茫。',sampleClass:'opening'},
      {kind:'fixed',text:'我有三个数字媒体作品，每周能投入6小时，倾向就业但想看看真实反馈。',sampleClass:'ordinary_followup'},
      {kind:'fixed',text:'那就业和继续探索之间，帮我比较一下，我现在先确认哪个方向优先？',sampleClass:'ordinary_followup'},
      {kind:'fixed',text:'请直接起草一份我可以用的简历作品清单，今天就能发给一个招聘方。',sampleClass:'long_material'},
      {kind:'fixed',text:'我把清单发给两个招聘方了，还没有回复，感觉没什么效果。',sampleClass:'ordinary_followup'},
      {kind:'fixed',text:'最近课程变多了，每周只有3小时了，安排帮我改一下。',sampleClass:'ordinary_followup'},
      {kind:'fixed',text:'接着上次的，我下一步该做什么？',newConversation:true,sampleClass:'ordinary_followup'},
    ]},
  ]
}

// Pure decision state machine, separated from the spawned child process so the
// operator's actor mapping and no-auto-retry contract are testable offline.
export function createOperatorDriver(options:{scenarios:Scenario[];log:(entry:Record<string,unknown>)=>void;send:(line:Record<string,unknown>)=>void}){
  const queue=options.scenarios
  let scenarioIndex=0,stepIndex=0
  let lastGrowth:unknown=null
  let pendingMemoryActor:string|null=null
  let forgetQueue:{itemId:string,expectedRevision:number,actorKey:string}[]=[]
  const dispatch=(command:Record<string,unknown>|null)=>{
    if(!command){options.log({event:'operator-done-sending'});options.send({operation:'exit'});return}
    options.send(command)
  }
  function nextCommand(replyText:string|null):Record<string,unknown>|null{
    while(scenarioIndex<queue.length){
      const scenario=queue[scenarioIndex]!,step=scenario.steps[stepIndex]
      if(!step){scenarioIndex++;stepIndex=0;continue}
      const logicalStepId=scenario.id+':'+stepIndex
      const advance=()=>{stepIndex++}
      if(step.kind==='readGrowth'){advance();return{operation:'readGrowth',actorKey:scenario.id,logicalStepId}}
      if(step.kind==='enableMemory'){advance();pendingMemoryActor=scenario.id;return{operation:'readMemory',actorKey:scenario.id,logicalStepId}}
      if(step.kind==='forget'){
        const growth=lastGrowth as {items?:{id:string,text?:string,revision?:number,status?:string}[]}|null
        const items=growth?.items??[]
        const targets=items.filter(item=>item.status!=='forgotten'&&step.match.test(String(item.text||'')))
        options.log({event:'forget-step',scenario:scenario.id,label:step.label,found:targets.map(t=>t.id),items:items.map(i=>({id:i.id,status:i.status,text:String(i.text||'').slice(0,60)}))})
        if(!targets.length){advance();return nextCommand(replyText)}
        advance()
        forgetQueue=targets.map(t=>({itemId:t.id,expectedRevision:t.revision??1,actorKey:scenario.id}))
        const first=forgetQueue.shift()!
        return{operation:'growthAction',actorKey:scenario.id,logicalStepId,itemId:first.itemId,value:{requestId:randomUUID(),expectedRevision:first.expectedRevision,action:'forget'}}
      }
      if(step.kind==='fixed'){const text=step.text;advance();return{trajectory:scenario.id,actorKey:scenario.id,logicalStepId,text,sampleClass:step.sampleClass??'ordinary_followup',...(step.newConversation?{newConversation:true}:{})}}
      // answer step: reveal facts only when the reply actually asks about them
      // (match interrogative sentences only, so the model's own framing like
      // "经历少" or its boundary acknowledgment never counts as a question); a
      // student who is never asked may volunteer the core situation once instead
      const questionText=replyText?replyText.split(/(?<=[。！？!?；;])|\n/).filter(part=>part.includes('？')||part.includes('?')).join(''):''
      const revealed:string[]=[],answers:string[]=[]
      for(const topic of step.topics)if(questionText&&topic.match.test(questionText)){revealed.push(topic.label);answers.push(topic.answer)}
      let text:string
      if(revealed.length)text=answers.join('')
      else if(step.volunteer)text=step.volunteer
      else text=step.fallback??'这个我说不好，先继续。'
      options.log({event:'answer-step',scenario:scenario.id,replyAsked:revealed,volunteated:!revealed.length&&Boolean(step.volunteer),hidden:(step.topics.map(t=>t.label).filter(l=>!revealed.includes(l)))})
      advance()
      return{trajectory:scenario.id,actorKey:scenario.id,logicalStepId,text,sampleClass:'ordinary_followup'}
    }
    return null
  }
  function handleChildMessage(message:any){
    if(message.ready){options.log({event:'ready',runId:message.runId});dispatch(nextCommand(null));return}
    if(message.operation==='readMemory'){
      if(pendingMemoryActor){
        const actorKey=pendingMemoryActor
        pendingMemoryActor=null
        const settings=message.value?.settings
        if(settings&&!settings.enabled){options.log({event:'memory-enable',actor:actorKey,revision:settings.revision});options.send({operation:'memorySettings',actorKey,value:{requestId:randomUUID(),enabled:true,expectedRevision:settings.revision}});return}
        options.log({event:'memory-already-enabled',actor:actorKey})
        dispatch(nextCommand(null));return
      }
      options.log({event:'readMemory',items:(message.value?.items??[]).length});dispatch(nextCommand(null));return
    }
    if(message.operation==='memorySettings'){options.log({event:'memorySettings-result',value:message.value});dispatch(nextCommand(null));return}
    if(message.operation==='readGrowth'){lastGrowth=message.value;options.log({event:'readGrowth',items:(message.value?.items??[]).map((i:any)=>({id:i.id,status:i.status,kind:i.kind,assertion:String(i.assertion??i.text??'').slice(0,80),revision:i.revision}))});dispatch(nextCommand(null));return}
    if(message.operation==='growthAction'){
      options.log({event:'growthAction-result',value:message.value})
      if(forgetQueue.length){const next=forgetQueue.shift()!;options.send({operation:'growthAction',actorKey:next.actorKey,itemId:next.itemId,value:{requestId:randomUUID(),expectedRevision:next.expectedRevision,action:'forget'}});return}
      dispatch(nextCommand(null));return
    }
    if(message.trajectory&&('turn' in message)){
      const failed=Boolean(message.error)
      const delta=(message.events??[]).find((e:any)=>e?.value?.type==='delta'&&e?.value?.saved===true)
      const replyText=typeof delta?.value?.text==='string'?delta.value.text:null
      options.log({event:'turn-result',scenario:message.trajectory,actor:message.actorKey??message.trajectory,turn:message.turn,failed,error:message.error??null,reply:replyText})
      // A failed turn consumed a real call and stays failed: the failure is
      // preserved as-is and the script advances. The same input is never
      // resent automatically; an explicit manual retry would be a new attempt
      // under the same logicalStepId, accounted separately, never inflating
      // the logical success count.
      dispatch(nextCommand(replyText));return
    }
    if(message.closed){options.log({event:'closed',runId:message.runId,status:message.status});return}
    options.log({event:'child-stdout',message})
  }
  return {nextCommand,handleChildMessage}
}

function main(){
  const paid=process.argv.includes('--paid')
  if(!paid&&!process.argv.includes('--preflight'))throw new Error('--paid or --preflight required')
  const arg=(name:string)=>{const i=process.argv.indexOf(name);return process.argv[i+1] as string}
  const freezePath=resolve(arg('--freeze'))
  const fixturePath='tests/fixtures/campus-growth-trajectories.json'
  const stamp=Date.now(),directory=resolve('.local/campus-growth/continuous-'+stamp)
  mkdirSync(directory,{recursive:true})
  const logPath=resolve(directory,'operator-log.jsonl')
  const operatorDigest=createHash('sha256').update(JSON.stringify(scenarios().map(s=>({id:s.id,steps:s.steps.map(t=>({...t,topics:t.kind==='answer'?t.topics.map(x=>({label:x.label,answer:x.answer})):undefined}))})))).digest('hex')
  const log=(entry:Record<string,unknown>)=>appendFileSync(logPath,JSON.stringify({...entry,at:new Date().toISOString()})+'\n')
  writeFileSync(resolve(directory,'operator-manifest.json'),JSON.stringify({startedAt:new Date().toISOString(),paid,freezePath,fixturePath,operatorDigest,automaticRetry:false,scenarios:scenarios().map(s=>({id:s.id,turns:s.steps.length}))},null,2))
  log({event:'operator-start',paid,directory,automaticRetry:false})

  const queue=(()=>{const all=scenarios();const i=process.argv.indexOf('--only');if(i<0)return all;const wanted=process.argv[i+1]!.split(',');const filtered=all.filter(s=>wanted.includes(s.id));if(!filtered.length)throw new Error('NO_SCENARIO_SELECTED');return filtered})()
  const child:ChildProcess=spawn(process.execPath,['--import','tsx','scripts/run-action-coach.ts',paid?'--paid':'--preflight','--freeze',freezePath,'--fixture',fixturePath],{stdio:['pipe','pipe','pipe']})
  const send=(line:object)=>{(child.stdin as NonNullable<ChildProcess['stdin']>).write(JSON.stringify(line)+'\n');log({event:'operator-sent',...line})}
  const driver=createOperatorDriver({scenarios:queue,log,send})

  let buffer='',runId=''
  ;(child.stdout as NonNullable<ChildProcess['stdout']>).on('data',(chunk:Buffer)=>{
    buffer+=chunk.toString()
    let boundary:number
    while((boundary=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,boundary).trim();buffer=buffer.slice(boundary+1)
      if(!line)continue
      let message:any
      try{message=JSON.parse(line)}catch{log({event:'child-stdout-unparsed',line:line.slice(0,200)});continue}
      if(message.ready)runId=message.runId
      driver.handleChildMessage(message)
    }
  })
  ;(child.stderr as NonNullable<ChildProcess['stderr']>).on('data',(chunk:Buffer)=>{const text=chunk.toString().trim();if(text)log({event:'child-stderr',text:text.slice(0,400)})})
  child.on('exit',(code,signal)=>{log({event:'child-exit',code,signal});console.log(JSON.stringify({operatorFinished:true,code,signal,logPath,runId}))})
}

const entryScript=process.argv[1]?pathToFileURL(resolve(process.argv[1])).href:null
if(entryScript&&import.meta.url===entryScript)main()
