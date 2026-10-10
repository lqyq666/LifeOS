import type {WorkflowRequest,WorkflowMode} from './contracts.ts'
export type Route={route:'fast'|'candidate';mode?:WorkflowMode;reason:'control'|'listening'|'refusal'|'paused'|'disabled'|'review'|'deep'|'insufficient_context'|'unsupported'}
export const advancedWorkflowsEnabled=(env:NodeJS.ProcessEnv=process.env)=>env.LIFEOS_ADVANCED_WORKFLOWS==='true'
// These flags are server intent/permission results, never accepted from model output.
export function routeWorkflow(r:WorkflowRequest,enabled=advancedWorkflowsEnabled()):Route{
 if(r.controls.memoryControl)return {route:'fast',reason:'control'}
 if(r.controls.listeningOnly)return {route:'fast',reason:'listening'}
 if(r.controls.refuseAdvice)return {route:'fast',reason:'refusal'}
 if(r.controls.recommendationsPaused)return {route:'fast',reason:'paused'}
 if(!enabled)return {route:'fast',reason:'disabled'}
 if(r.mode==='action_review'&&r.consent.continueReview&&r.authorizedEvidenceRefs.some(x=>x.type==='event'))return {route:'candidate',mode:r.mode,reason:'review'}
 if(r.mode==='direction_decision'&&r.consent.deepAnalysis&&r.directions.length>=2&&r.budget&&r.authorizedEvidenceRefs.length)return {route:'candidate',mode:r.mode,reason:'deep'}
 return {route:'fast',reason:r.mode==='growth_diff'||r.mode==='kb_maintenance'?'unsupported':'insufficient_context'}
}
