import type {ActionCoachTurn} from './action-coach-contracts.ts'

// Material is generated once, in the authoritative action draft. Rendering
// it into the natural reply is deterministic and makes no additional model call.
// Provenance, versions, URLs and atomic commit are checked on this final text.
export function renderCoachReply(turn:ActionCoachTurn):string{
  const action=turn.event?.action
  if(!action||!('draft' in action))return turn.reply
  // Resume-portfolio selections are already rendered server-side before this
  // point; anything without content here is a protocol violation.
  if(!('content' in action.draft))throw new Error('ACTION_COACH_EMPTY_MATERIAL')
  const material=action.draft.content
  if(!material.trim())throw new Error('ACTION_COACH_EMPTY_MATERIAL')
  if(turn.reply.includes(material))return turn.reply
  // A complete plain-text draft may already appear with simple bold markup.
  // Only accept an exact match after removing those wrappers; preserve code,
  // escapes and literal operators, and never rewrite the authoritative draft.
  if(!/[`\\]/.test(turn.reply)&&!/[`\\*]/.test(material)){
    const plain=turn.reply.replace(/(?<![\\\w*])\*\*(\S(?:[^\n]*?\S)?)\*\*(?![\w*])/g,'$1')
    if(plain.includes(material))return plain
  }
  return turn.reply.trim()?turn.reply+'\n\n'+material:material
}
