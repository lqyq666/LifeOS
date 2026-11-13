import {WorkspaceIcon} from './WorkspaceIcon'

export const processingStages={
 connecting:{icon:'folder',text:'正在恢复已保存的对话'},
 sending:{icon:'send',text:'正在连接会话'},
 queued:{icon:'orbit',text:'正在等待处理'},
 context:{icon:'search',text:'正在读取对话上下文'},
 background:{icon:'search',text:'正在结合允许使用的过往经历'},
 generating:{icon:'compose',text:'正在思考并组织回复'},
 streaming:{icon:'compose',text:'正在生成回复'},
 validating:{icon:'check',text:'正在核对回复与保存内容'},
 saving:{icon:'folder',text:'正在保存本轮对话'},
} as const
export type ProcessingStage=keyof typeof processingStages
export function ProcessingStatus({stage}:{stage:ProcessingStage}){
 const item=processingStages[stage]
 return <span className="qa-processing" role="status" aria-live="polite"><WorkspaceIcon name={item.icon} size={16}/><span className="qa-processing-label">{item.text}</span></span>
}
