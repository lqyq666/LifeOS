import {createHash,randomUUID} from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool, HttpError, requireRow } from './db.ts'
import type { Run } from './store.ts'
import { scanUserClauses } from './user-command-spans.ts'
import {applyGrowthAction} from './growth.ts'

// P3: durable, cross-session direction controls. Pausing a direction is an
// account setting derived only from the user's own explicit words in the
// current message; it is never inferred from dissatisfaction, questions,
// quotations or what other people said. Existing paused/rejected growth items
// stay as they are — these controls add the user-level "不要再推某方向" layer.

export type DirectionScope =
  | 'employment'
  | 'research_exploration'
  | 'postgraduate_recommendation'
  | 'postgraduate_exam'
  | 'public_service'
  | 'entrepreneurship'
  | 'overseas_study'
  | 'undergraduate_upgrade'
  | 'freelance'
const scopeLabels: Record<DirectionScope,string>={
  research_exploration:'科研探索',
  employment:'就业',postgraduate_recommendation:'推免',postgraduate_exam:'考研',public_service:'考公考编',
  entrepreneurship:'创业',overseas_study:'留学出境升学',undergraduate_upgrade:'专升本',freelance:'自由职业',
}
const allScopes=Object.keys(scopeLabels) as DirectionScope[]
// 升学 as a server-side group expands to exactly these four; never employment
// or entrepreneurship.
const furtherStudyGroup:DirectionScope[]=['postgraduate_recommendation','postgraduate_exam','overseas_study','undergraduate_upgrade']

export type RawDirectionControl = {
  scopes: DirectionScope[]
  operation: 'pause'|'resume'
  quote: string
}
export type DirectionControlChange = Omit<RawDirectionControl,'quote'> & {
  source: { messageId:string; quote:string }
}
export type DirectionControl = {
  scope:DirectionScope; state:'paused'|'enabled'; revision:number
  sourceMessageId:string|null; sourceConversationId:string|null
  sourceQuote:string; sourceRedacted:boolean; updatedAt:string
}
export type PreparedDirectionControls = {
  expectedSnapshotKey:string
  changes:DirectionControlChange[]
}

const clauseSplit=/[，,；;。！？!?\n]/
const pauseVerbs=/(?:先别分析|不要再分析|先别推|别再给我推|不要再给我推|别给我推|别推|不要推|先不推|别再推|不要再推|停止推|暂停推|停止推荐|暂停|先别提|别提)/
const resumeVerbs=/(?:恢复|继续推|重新开始推|可以推|恢复推荐)/
// Direction wording → scopes. Longest phrases first so 专升本 wins over 本.
const directionPatterns:{pattern:RegExp;scopes:()=>DirectionScope[]}[]=[
  {pattern:/科研探索|科研体验|联系实验室/,scopes:()=>['research_exploration']},
  {pattern:/自由职业|接单/,scopes:()=>['freelance']},
  {pattern:/专升本|专接本|专插本/,scopes:()=>['undergraduate_upgrade']},
  {pattern:/推免|保研/,scopes:()=>['postgraduate_recommendation']},
  {pattern:/考研|研究生考试/,scopes:()=>['postgraduate_exam']},
  {pattern:/考公|公务员|考编|编制/,scopes:()=>['public_service']},
  {pattern:/留学|出境读|境外.*(读|升学)|出国读/,scopes:()=>['overseas_study']},
  {pattern:/创业/,scopes:()=>['entrepreneurship']},
  {pattern:/就业|找工作|求职/,scopes:()=>['employment']},
  {pattern:/升学/,scopes:()=>[...furtherStudyGroup]},
]
const quoted=(clause:string,index:number):boolean=>{
  for(const [open,close] of [['“','”'],['「','」'],['『','』'],['`','`']] as [string,string][])
    for(let at=clause.lastIndexOf(open,index);at>=0;at=clause.lastIndexOf(open,at-1)){
      const endQuote=clause.indexOf(close,at+open.length)
      if(endQuote>=index)return true
    }
  return false
}
// Restrict proposed plan labels to directions present in authorized personal
// text. This is not a pause/resume command or a new direction judgment.
export function mentionedDirectionScopes(text:string):DirectionScope[]{
  const scopes=new Set<DirectionScope>()
  for(const clause of scanUserClauses(text)){
    if(clause.quoted||clause.code||clause.conditional||clause.attributedToOther||clause.interrogative)continue
    for(const {pattern,scopes:resolve} of directionPatterns){
      const match=pattern.exec(clause.text)
      if(match&&!quoted(clause.text,match.index))for(const scope of resolve())scopes.add(scope)
    }
  }
  return [...scopes]
}
// An explicit command must be the user's own current instruction: no third
// party attribution, no negation of the command, no question form, no quotes.
const commandIsUsersOwn=(clause:string,verbIndex:number):boolean=>{
  if(clause.includes('？')||clause.includes('?'))return false
  if(quoted(clause,verbIndex))return false
  const before=clause.slice(0,verbIndex)
  if(/(?:朋友|同学|室友|父母|我妈|我爸|家人|老师|辅导员|学长|学姐)(?:说|劝|让|建议|提醒)/.test(before))return false
  if(/(?:不是|并非|没有|没)(?:让我?|叫我要?|要求我?|要)?(?:别|不要|停止|暂停|再)?$/.test(before.trim()))return false
  return true
}

// Limited explicit syntax, not a general semantic classifier: it recognizes a
// direct pause/resume command with a named direction in one clause. Everything
// else stays untouched or asks for one explicit confirmation.
export function deriveExplicitDirectionControls(currentText:string):
  {status:'none'} |
  {status:'explicit'; changes:RawDirectionControl[]} |
  {status:'needs_confirmation'; reason:string}{
  const clauses=scanUserClauses(currentText)
  const changes:RawDirectionControl[]=[]
  for(const clause of clauses){
    const body=clause.text.trim()
    if(!body)continue
    // N1.1: quoted/code spans, other people's speech, conditional clauses and
    // question clauses are never the user's own affirmative command.
    if(clause.quoted||clause.code||clause.attributedToOther||clause.conditional||clause.interrogative)continue
    const pause=pauseVerbs.exec(body)??/(?:不再把|不再将).{1,16}作为主线/.exec(body)
    const resume=resumeVerbs.exec(body)
    if(!pause&&!resume)continue
    const verbIndex=pause?pause.index:resume!.index
    // A command matched inside a protected span (backticks/quotes) is not the
    // user's instruction even when the surrounding clause looks affirmative.
    const absolute=clause.start+verbIndex
    if(clause.codeSpans.some(span=>absolute>=span.start&&absolute<span.end))continue
    if(clause.quoteSpans.some(span=>absolute>=span.start&&absolute<span.end))continue
    if(!commandIsUsersOwn(body,verbIndex))continue
    const scopes=new Set<DirectionScope>()
    for(const {pattern,scopes:resolve} of directionPatterns){
      if(pattern.test(body))for(const scope of resolve())scopes.add(scope)
    }
    if(!scopes.size){
      // A pause/resume command with no recognizable direction: broad
      // dissatisfaction needs one explicit confirmation, never a guess.
      return {status:'needs_confirmation',reason:'PAUSE_DIRECTION_SCOPE_UNKNOWN'}
    }
    if(pause&&resume&&pause.index!==resume.index){
      // Two opposing commands in one clause are ambiguous by construction.
      return {status:'needs_confirmation',reason:'PAUSE_RESUME_CONFLICT'}
    }
    changes.push({scopes:[...scopes].sort((a,b)=>a.localeCompare(b)),operation:pause?'pause':'resume',quote:body})
  }
  if(!changes.length)return {status:'none'}
  // An explicit command followed by a politeness question in the same sentence
  // is a confirmation request, not an executed setting.
  const politenessQuestion=clauses.some(clause=>clause.interrogative&&/(?:可以吗|好吗|行吗|可以么|行不行|对吗)/.test(clause.text))
  if(changes.length&&politenessQuestion)return {status:'needs_confirmation',reason:'PAUSE_CONFIRMATION_REQUESTED'}
  return {status:'explicit',changes}
}

export async function readDirectionControls(user:string,c:{query:PoolClient['query']}=pool):Promise<DirectionControl[]>{
  const rows=(await c.query('SELECT scope,state,revision,source_message_id,source_conversation_id,source_quote,source_redacted,updated_at FROM growth_direction_controls WHERE user_id=$1 ORDER BY scope',[user])).rows as {scope:DirectionScope;state:'paused'|'enabled';revision:number;source_message_id:string|null;source_conversation_id:string|null;source_quote:string;source_redacted:boolean;updated_at:Date}[]
  return rows.map(row=>({scope:row.scope,state:row.state,revision:row.revision,sourceMessageId:row.source_message_id,sourceConversationId:row.source_conversation_id,sourceQuote:row.source_quote,sourceRedacted:row.source_redacted,updatedAt:row.updated_at.toISOString()}))
}

export const directionControlsSnapshotKey=(controls:DirectionControl[]):string=>createHash('sha256').update(JSON.stringify(controls.map(row=>[row.scope,row.state,row.revision]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))).digest('hex')

// Bind each derived clause to this turn's source message; the derive function
// itself never receives or fabricates message identities.
// N1.4: apply this turn's explicit commands to the pre-generation state so
// allowed/blocked scopes include the pending pause/resume immediately.
export function overlayDirectionChanges(controls:DirectionControl[],changes:readonly RawDirectionControl[]):DirectionControl[]{
  const map=new Map(controls.map(row=>[row.scope,{...row}]))
  for(const change of changes)for(const scope of change.scopes){
    const state=change.operation==='pause'?'paused':'enabled'
    const existing=map.get(scope)
    map.set(scope,existing?{...existing,state,revision:existing.revision+1}:{scope,state,revision:1,sourceMessageId:null,sourceConversationId:null,sourceQuote:'',sourceRedacted:true,updatedAt:new Date().toISOString()})
  }
  return [...map.values()].sort((a,b)=>a.scope.localeCompare(b.scope))
}

export async function stageDirectionControls(run:Run,changes:RawDirectionControl[],expectedSnapshotKey?:string):Promise<PreparedDirectionControls>{
  const message=requireRow((await pool.query("SELECT content FROM messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3 AND role='user'",[run.user_id,run.conversation_id,run.source_message_id])).rows[0]) as {content:string}
  const prepared:DirectionControlChange[]=[]
  for(const change of changes){
    if(!change.quote.trim()||!message.content.includes(change.quote))throw new HttpError(400,'DIRECTION_CONTROL_SOURCE_INVALID')
    if(change.scopes.some(scope=>!allScopes.includes(scope)))throw new HttpError(400,'DIRECTION_CONTROL_SCOPE_INVALID')
    prepared.push({scopes:change.scopes,operation:change.operation,source:{messageId:run.source_message_id,quote:change.quote}})
  }
  const currentKey=directionControlsSnapshotKey(await readDirectionControls(run.user_id))
  // The expected snapshot is the PRE-generation one supplied by the engine;
  // staging never re-reads a fresher state to overwrite it.
  if(expectedSnapshotKey!==undefined&&expectedSnapshotKey!==currentKey)throw new HttpError(409,'DIRECTION_CONTROL_CONFLICT')
  return {expectedSnapshotKey:expectedSnapshotKey??currentKey,changes:prepared}
}

export type ControlEffect={scope:DirectionScope;before:'paused'|'enabled';after:'paused'|'enabled';revision:number}

export async function persistDirectionControls(c:PoolClient,run:Run,staged:PreparedDirectionControls):Promise<{controls:DirectionControl[];effects:ControlEffect[]}>{
  if(!staged.changes.length)return {controls:await readDirectionControls(run.user_id,c),effects:[]}
  // Shared growth lock keeps the ordering identical to growth writes; the
  // controls never take a contrary lock order.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['growth:'+run.user_id])
  const current=await readDirectionControls(run.user_id,c)
  if(directionControlsSnapshotKey(current)!==staged.expectedSnapshotKey)throw new HttpError(409,'DIRECTION_CONTROL_CONFLICT')
  const effects:ControlEffect[]=[]
  for(const change of staged.changes){
    const message=requireRow((await c.query("SELECT conversation_id FROM messages WHERE user_id=$1 AND id=$2 AND role='user'",[run.user_id,change.source.messageId])).rows[0]) as {conversation_id:string}
    if(!(await c.query('SELECT 1 FROM messages WHERE user_id=$1 AND conversation_id=$2 AND id=$3 AND strpos(content,$4)>0',[run.user_id,message.conversation_id,change.source.messageId,change.source.quote])).rowCount)throw new HttpError(400,'DIRECTION_CONTROL_SOURCE_INVALID')
    const targetState=change.operation==='pause'?'paused':'enabled'
    for(const scope of change.scopes){
      const existing=(await c.query('SELECT state,revision FROM growth_direction_controls WHERE user_id=$1 AND scope=$2 FOR UPDATE',[run.user_id,scope])).rows[0] as {state:'paused'|'enabled';revision:number}|undefined
      if(existing&&existing.state===targetState){
        // Setting the same state again is a true no-op for this turn's
        // effects; the row keeps its history and is not counted as changed.
        continue
      }
      // source_redacted is explicitly reset: a resumed direction gets the new
      // provenance and satisfies the 019 paired-id CHECK after a redaction.
      const updated=(await c.query(`INSERT INTO growth_direction_controls(user_id,scope,state,revision,source_conversation_id,source_message_id,source_quote,source_redacted,origin_request_id)
        VALUES($1,$2,$3,1,$4,$5,$6,false,$7)
        ON CONFLICT(user_id,scope) DO UPDATE SET state=EXCLUDED.state,revision=growth_direction_controls.revision+1,source_conversation_id=EXCLUDED.source_conversation_id,source_message_id=EXCLUDED.source_message_id,source_quote=EXCLUDED.source_quote,source_redacted=false,origin_request_id=EXCLUDED.origin_request_id,updated_at=now()
        RETURNING scope,state,revision,source_message_id,source_conversation_id,source_quote,source_redacted,updated_at`,
        [run.user_id,scope,targetState,message.conversation_id,change.source.messageId,change.source.quote,run.request_id])).rows[0] as {scope:DirectionScope;state:'paused'|'enabled';revision:number;source_message_id:string|null;source_conversation_id:string|null;source_quote:string;source_redacted:boolean;updated_at:Date}
      await c.query('INSERT INTO growth_direction_control_revisions(user_id,scope,revision,snapshot,origin_request_id) VALUES($1,$2,$3,$4,$5)',
        [run.user_id,scope,updated.revision,JSON.stringify({scope:updated.scope,state:updated.state,revision:updated.revision,sourceMessageId:updated.source_message_id,sourceConversationId:updated.source_conversation_id,sourceQuote:updated.source_quote,sourceRedacted:updated.source_redacted,updatedAt:updated.updated_at.toISOString()}),run.request_id])
      // A scope with no row implicitly starts enabled, so a first pause IS a change.
      effects.push({scope,before:existing?existing.state:'enabled',after:targetState,revision:updated.revision})
      if(change.operation==='pause'&&/(?:不再把|不再将).{1,16}作为主线/.test(change.source.quote)){
        const goals=(await c.query("SELECT id,revision,text FROM growth_items WHERE user_id=$1 AND kind IN ('goal','direction') AND assertion='user_reported' AND status='active' ORDER BY id FOR UPDATE",[run.user_id])).rows
        for(const goal of goals){
          const named=new Set(directionPatterns.filter(p=>p.pattern.test(goal.text)).flatMap(p=>p.scopes()))
          // A composite pursuit cannot be wholly paused by one named branch.
          if(named.size===1&&named.has(scope))await applyGrowthAction(c,run.user_id,goal.id,{requestId:randomUUID(),expectedRevision:goal.revision,action:'pause'})
        }
      }
    }
  }
  return {controls:await readDirectionControls(run.user_id,c),effects}
}

export async function redactDirectionControlsForMessages(c:PoolClient,user:string,messageIds:string[]):Promise<void>{
  if(!messageIds.length)return
  const rows=(await c.query('SELECT scope,revision FROM growth_direction_controls WHERE user_id=$1 AND source_message_id=ANY($2::uuid[]) AND NOT source_redacted',[user,messageIds])).rows as {scope:DirectionScope;revision:number}[]
  if(!rows.length)return
  await c.query("UPDATE growth_direction_controls SET source_redacted=true,source_message_id=NULL,source_conversation_id=NULL,source_quote='原话已遗忘',updated_at=now() WHERE user_id=$1 AND source_message_id=ANY($2::uuid[])",[user,messageIds])
  for(const row of rows){
    await c.query(`UPDATE growth_direction_control_revisions SET snapshot=jsonb_build_object('scope',scope,'revision',revision,'sourceMessageId',to_jsonb(NULL::uuid),'sourceConversationId',to_jsonb(NULL::uuid),'sourceQuote','原话已遗忘','sourceRedacted',true,'state',snapshot->'state','updatedAt',snapshot->'updatedAt') WHERE user_id=$1 AND scope=$2`,[user,row.scope])
  }
}

export const directionScopeLabel=(scope:DirectionScope):string=>scopeLabels[scope]
export {allScopes,furtherStudyGroup}
