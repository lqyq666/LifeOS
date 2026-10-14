import {openSync,closeSync,readFileSync,writeSync,fsyncSync,unlinkSync} from 'node:fs'
import {resolve} from 'node:path'

const projects=new Set(['7693388932939300905','7693465311558795327','7693892523869290496'])
type Row=Record<string,unknown>
type Reservation={requestId:string;projectId:string;purpose:'development'|'business';reservedCredits:number;payloadDigest:string;sourceDigest:string}
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0
const digest=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)

// Coze account credits are a different funding pool from the product-model
// CNY ledger. An unresolved first attempt continues to hold its full reserve.
export class CozeCreditBudget{
 readonly path:string
 constructor(path:string){this.path=resolve(path)}
 static initialize(path:string,existingCredits:number,authorizationDigest:string){
  if(!positive(existingCredits)||!digest(authorizationDigest))throw Error('COZE_EXISTING_FUNDING_INVALID')
  const fd=openSync(resolve(path),'wx',0o600)
  try{writeSync(fd,JSON.stringify({type:'existing_credit_balance',budgetUnit:'coze_credits',existingCredits,authorizationDigest,newBudget:0})+'\n');fsyncSync(fd)}finally{closeSync(fd)}
  return new CozeCreditBudget(path)
 }
 private rows():Row[]{return readFileSync(this.path,'utf8').trim().split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line))}
 private view(rows:Row[]){
  const opening=rows[0],initial=opening?.type==='existing_credit_balance'?opening.existingCredits:opening?.type==='development_reserved'?opening.observedAccountBalance:null
  if(!positive(initial)||opening.budgetUnit!=='coze_credits'||opening.newBudget!==0)throw Error('COZE_LEDGER_FUNDING_INVALID')
  const reserved=new Map<string,Row>(),settled=new Set<string>(),charges=new Map<string,number>();let charged=0,held=0
  let allowance:Row|null=null,priorReservations=new Set<string>()
  let acceptanceWindow:Row|null=null,windowPrior=new Set<string>()
  for(const row of rows){
   if(row.type==='development_reserved'||row.type==='credits_reserved'){
    if(typeof row.requestId!=='string'||reserved.has(row.requestId)||!positive(row.reservedCredits)||row.budgetUnit!=='coze_credits')throw Error('COZE_LEDGER_RESERVATION_INVALID')
    reserved.set(row.requestId,row)
   }else if(row.type==='development_finished'||row.type==='credits_reconciled'){
    const requestId=String(row.requestId),reservation=reserved.get(requestId)
    if(!reservation||settled.has(requestId)||!positive(row.accountedCredits)||Number(row.accountedCredits)>Number(reservation.reservedCredits))throw Error('COZE_LEDGER_RECONCILIATION_INVALID')
    settled.add(requestId);charged+=Number(row.accountedCredits);charges.set(requestId,Number(row.accountedCredits))
   }else if(row.type==='account_allowance_bound'){
    if(allowance||row.percentage!==0.2||!positive(row.observedRemainingCredits)||row.maximumAdditionalCredits!==Math.floor(Number(row.observedRemainingCredits)*0.2)||!positive(row.maximumAdditionalCredits)||!digest(row.approvalDigest)||!digest(row.balanceEvidenceDigest)||typeof row.observedAt!=='string'||!Number.isFinite(Date.parse(row.observedAt))||row.newBudget!==0)throw Error('COZE_ACCOUNT_ALLOWANCE_INVALID')
    allowance=row;priorReservations=new Set(reserved.keys())
   }else if(row.type==='owner_acceptance_window'){
    if(acceptanceWindow||!allowance||row.newBudget!==0||row.oldUnknownReservations!=='retained_excluded_from_this_window'||!positive(row.observedRemainingCredits)||!positive(row.maximumCredits)||Number(row.maximumCredits)>Math.floor(Number(row.observedRemainingCredits)*0.2)||!digest(row.approvalDigest)||!digest(row.balanceEvidenceDigest)||typeof row.observedAt!=='string'||!Number.isFinite(Date.parse(row.observedAt)))throw Error('COZE_ACCEPTANCE_WINDOW_INVALID')
    acceptanceWindow=row;windowPrior=new Set(reserved.keys())
   }else if(row.type==='owner_acceptance_window_increased'){
    if(!acceptanceWindow||row.newBudget!==0||row.previousApprovalDigest!==acceptanceWindow.approvalDigest||!positive(row.maximumCredits)||Number(row.maximumCredits)<=Number(acceptanceWindow.maximumCredits)||Number(row.maximumCredits)>Number(acceptanceWindow.observedRemainingCredits)||!digest(row.approvalDigest))throw Error('COZE_ACCEPTANCE_WINDOW_INVALID')
    acceptanceWindow=Object.assign({},acceptanceWindow,{maximumCredits:row.maximumCredits,approvalDigest:row.approvalDigest})
   }else if(row.type!=='existing_credit_balance'&&row.type!=='credits_attempt_finished')throw Error('COZE_LEDGER_ROW_INVALID')
  }
  for(const [id,row] of reserved)if(!settled.has(id))held+=Number(row.reservedCredits)
  const legacyAccounted=acceptanceWindow?[...windowPrior].reduce((sum,id)=>sum+(settled.has(id)?charges.get(id)!:Number(reserved.get(id)!.reservedCredits)),0):charged+held
  if(legacyAccounted>initial)throw Error('COZE_LEDGER_OVERCOMMITTED')
  let allowanceAccounted=0,newCharged=0
  if(allowance)for(const [id,row] of reserved)if(!priorReservations.has(id)){allowanceAccounted+=settled.has(id)?charges.get(id)!:Number(row.reservedCredits);newCharged+=charges.get(id)??0}
  if(allowance&&!acceptanceWindow&&allowanceAccounted>Number(allowance.maximumAdditionalCredits))throw Error('COZE_ALLOWANCE_OVERCOMMITTED')
  const allowanceRemaining=allowance?Number(allowance.maximumAdditionalCredits)-allowanceAccounted:null
  const windowAccounted=acceptanceWindow?[...reserved].filter(([id])=>!windowPrior.has(id)).reduce((sum,[id,row])=>sum+(settled.has(id)?charges.get(id)!:Number(row.reservedCredits)),0):0
  if(acceptanceWindow&&windowAccounted>Number(acceptanceWindow.maximumCredits))throw Error('COZE_ACCEPTANCE_WINDOW_OVERCOMMITTED')
  // A fresh account snapshot already includes past known charges. Old opaque
  // holds remain conservative; resolving them requires their observed bills.
  const accountAvailable=allowance?Math.max(0,Number(allowance.observedRemainingCredits)-held-newCharged):null
  const available=acceptanceWindow?Math.min(Number(acceptanceWindow.maximumCredits)-windowAccounted,Number(acceptanceWindow.observedRemainingCredits)-windowAccounted):Math.min(initial-charged-held,allowanceRemaining??Infinity,accountAvailable??Infinity)
  return {initialCredits:initial,chargedCredits:charged,heldCredits:held,availableCredits:available,...(acceptanceWindow?{acceptanceWindowMaximumCredits:Number(acceptanceWindow.maximumCredits),acceptanceWindowAccountedCredits:windowAccounted}:{}),...(allowance?{observedAccountRemainingCredits:Number(allowance.observedRemainingCredits),maximumAdditionalCredits:Number(allowance.maximumAdditionalCredits),allowanceAccountedCredits:allowanceAccounted,allowanceRemainingCredits:allowanceRemaining!}:{}),reservations:reserved,settled}
 }
 balance(){const {reservations,settled,...balance}=this.view(this.rows());return balance}
 private append(make:(rows:Row[])=>Row){
  const lock=this.path+'.lock';let fd:number
  try{fd=openSync(lock,'wx',0o600)}catch{throw Error('COZE_LEDGER_BUSY_NO_RETRY')}
  try{
   const row=make(this.rows()),out=openSync(this.path,'a',0o600)
   try{writeSync(out,JSON.stringify({...row,recordedAt:new Date().toISOString()})+'\n');fsyncSync(out)}finally{closeSync(out)}
  }finally{closeSync(fd);unlinkSync(lock)}
 }
 reserve(input:Reservation){
  if(!input.requestId||!projects.has(input.projectId)||!['development','business'].includes(input.purpose)||!positive(input.reservedCredits)||!digest(input.payloadDigest)||!digest(input.sourceDigest))throw Error('COZE_RESERVATION_INVALID')
  this.append(rows=>{
   const view=this.view(rows),old=view.reservations.get(input.requestId)
   if(rows.some(row=>row.type==='account_allowance_bound')&&!['7693388932939300905','7693465311558795327'].includes(input.projectId))throw Error('COZE_RESERVATION_INVALID')
   if(old)throw Error(old.payloadDigest!==input.payloadDigest?'COZE_REQUEST_CONFLICT':'COZE_FIRST_ATTEMPT_ALREADY_RESERVED')
   if(input.reservedCredits>view.availableCredits)throw Error('COZE_EXISTING_CREDITS_UNAVAILABLE')
   return {type:'credits_reserved',budgetUnit:'coze_credits',newBudget:0,...input}
  })
 }
 bindAccountAllowance(input:{observedRemainingCredits:number;observedAt:string;approvalDigest:string;balanceEvidenceDigest:string}){
  if(!positive(input.observedRemainingCredits)||Math.floor(input.observedRemainingCredits*0.2)<1||!Number.isFinite(Date.parse(input.observedAt))||!digest(input.approvalDigest)||!digest(input.balanceEvidenceDigest))throw Error('COZE_ACCOUNT_ALLOWANCE_INVALID')
  this.append(rows=>{
   this.view(rows)
   if(rows.some(row=>row.type==='account_allowance_bound'))throw Error('COZE_ACCOUNT_ALLOWANCE_ALREADY_BOUND')
   return {type:'account_allowance_bound',budgetUnit:'coze_credits',newBudget:0,percentage:0.2,maximumAdditionalCredits:Math.floor(input.observedRemainingCredits*0.2),...input}
  })
 }
 finishUnknown(requestId:string,outcome:'completed'|'failed'|'cancelled',providerCalls:number|null,receiptId:string|null){
  if(!['completed','failed','cancelled'].includes(outcome)||!(providerCalls===null||Number.isSafeInteger(providerCalls)&&providerCalls>=0&&providerCalls<=5))throw Error('COZE_ATTEMPT_RESULT_INVALID')
  this.append(rows=>{
   const view=this.view(rows)
   if(!view.reservations.has(requestId)||rows.some(row=>row.type==='credits_attempt_finished'&&row.requestId===requestId))throw Error('COZE_ATTEMPT_NOT_RESERVED_OR_ALREADY_FINISHED')
   return {type:'credits_attempt_finished',requestId,outcome,providerCalls,receiptId,costCredits:'unknown',costCny:'unknown_not_converted',reservationRetained:true}
  })
 }
 authorizeAcceptanceWindow(input:{observedRemainingCredits:number;maximumCredits:number;observedAt:string;approvalDigest:string;balanceEvidenceDigest:string}){
  this.append(rows=>{
   const before=this.view(rows)
   if(rows.some(row=>row.type==='owner_acceptance_window'))throw Error('COZE_ACCEPTANCE_WINDOW_ALREADY_BOUND')
   if(!positive(input.maximumCredits)||input.maximumCredits>(before.allowanceRemainingCredits??0))throw Error('COZE_ACCEPTANCE_WINDOW_INVALID')
   const row={type:'owner_acceptance_window',budgetUnit:'coze_credits',newBudget:0,oldUnknownReservations:'retained_excluded_from_this_window',...input}
   this.view([...rows,row])
   return row
  })
 }
 increaseAcceptanceWindow(input:{maximumCredits:number;previousApprovalDigest:string;approvalDigest:string}){
  this.append(rows=>{
   this.view(rows)
   const row={type:'owner_acceptance_window_increased',newBudget:0,budgetUnit:'coze_credits',...input}
   this.view([...rows,row]);return row
  })
 }
 // Only an independently observed account bill can release a reservation.
 // A workflow's self-reported boolean/zero cost cannot settle this ledger.
 reconcile(requestId:string,observedCredits:number,billEvidenceDigest:string){
  if(!Number.isFinite(observedCredits)||observedCredits<=0||!digest(billEvidenceDigest))throw Error('COZE_BILL_EVIDENCE_REQUIRED')
  this.append(rows=>{
   const view=this.view(rows),reservation=view.reservations.get(requestId),accountedCredits=Math.ceil(observedCredits)
   if(!reservation||view.settled.has(requestId)||accountedCredits>Number(reservation.reservedCredits))throw Error('COZE_BILL_RESERVATION_CONFLICT')
   return {type:'credits_reconciled',requestId,observedCredits,accountedCredits,billEvidenceDigest,budgetUnit:'coze_credits',costCny:'unknown_not_converted'}
  })
 }
}
