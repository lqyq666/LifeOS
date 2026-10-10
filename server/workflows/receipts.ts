import {WorkflowError,type WorkflowRequest,type WorkflowReceipt,type WorkflowProposal} from './contracts.ts'
// No workflow owns a DB writer. Persisted receipts come only from the host transaction.
export function proposalReceipt(request:WorkflowRequest,proposal:WorkflowProposal,usage:Pick<WorkflowReceipt,'providerCalls'|'costCny'|'reservedCostCny'|'executionKind'|'skills'>):WorkflowReceipt{return {schemaVersion:2,traceId:request.traceId,status:'proposed',proposal,fallback:'none',...usage}}
export function acceptHostReceipt(receipt:WorkflowReceipt,host:{traceId:string;committed:boolean;requestId:string},request:WorkflowRequest):WorkflowReceipt{
 if(host.traceId!==request.traceId||host.requestId!==request.requestId||receipt.traceId!==request.traceId||!host.committed)throw new WorkflowError('stale_snapshot')
 return {...receipt,status:'persisted'}
}
