// G4 mode-aware history selection: the DATABASE keeps every message and every
// memory; only the RAW DIALOGUE the model reads this turn is bounded. Long
// horizons stay available through the structured lanes (growth, currentEvent)
// which are always rendered — 越用越忘 is a regression, not an optimization.
import type { TurnContractMode } from './turn-contract.ts'

export type HistoryMessage={id:string;role:'user'|'assistant';content:string}

export type HistorySelection={
  selected:HistoryMessage[]
  totalMessages:number
  totalChars:number
  selectedChars:number
}

const carriesText=(text:string)=>/[\p{L}\p{N}]/u.test(text)

export function selectHistoryForMode(
  messages:readonly HistoryMessage[], // ordered oldest→newest, EXCLUDING the current message
  mode:TurnContractMode,
  currentText:string,
):HistorySelection{
  const totalMessages=messages.length
  const totalChars=messages.reduce((sum,m)=>sum+m.content.length,0)
  // Default keeps today's behaviour (16-message bounded window) when no rule
  // applies — selection can only shrink what the model reads.
  const takeRecent=(count:number):HistoryMessage[]=>{
    const picked=messages.slice(-count)
    // Never split a user→assistant pair head: if the first picked message is
    // an assistant reply, drop it so an orphaned answer doesn't masquerade
    // as context.
    if(picked.length&&picked[0]!.role==='assistant')picked.shift()
    return picked
  }
  let picked:HistoryMessage[]
  switch(mode){
    case 'reply_only':
      // Pure listening/meta/greeting: the current message plus the last
      // exchange is enough; personal understanding lives in growth.
      picked=takeRecent(2)
      break
    case 'planning':
      // Budgets, goals and constraints come from growth/obligations; keep a
      // few recent turns for tone and continuity.
      picked=takeRecent(4)
      break
    case 'knowledge':
      // The knowledge question stands on the current message plus its
      // immediate context; constraints ride in growth.
      picked=takeRecent(3)
      break
    case 'material':{
      // Facts come from the grounded catalogue/growth; keep the turns that
      // likely discuss the deliverable (recent window) without dragging in
      // unrelated old chat.
      picked=takeRecent(4)
      break
    }
    case 'ordinary':
    case 'event':{
      // Keep the recent window plus any older USER messages that mention the
      // current matter's keywords — the review needs the thread's own turns.
      const recent=takeRecent(4)
      const keywords=extractKeywords(currentText)
      // Compound keywords rarely appear verbatim in older turns; any shared
      // 2-char shingle is a topic signal (海报/社团…), false positives are
      // bounded by the 3-turn cap.
      const shingles=new Set(keywords.flatMap(k=>{const grams:string[]=[];for(let i=0;i+2<=k.length;i++)grams.push(k.slice(i,i+2));return grams}))
      const older=messages.slice(0,Math.max(0,messages.length-4)).filter(m=>m.role==='user'&&[...shingles].some(k=>m.content.includes(k))).slice(-3)
      picked=[...older,...recent.filter(m=>!older.includes(m))]
      break
    }
    default:
      picked=takeRecent(4)
  }
  const selectedChars=picked.reduce((sum,m)=>sum+m.content.length,0)
  return {selected:picked,totalMessages,totalChars,selectedChars}
}

// Topic keywords for the event lane: content words of the current message,
// excluding the generic filler set.
const genericWords=new Set([...'我你他她它们了的是一在和都也与及还就很不去要这那有没说会被把什么怎么如何为什么哪谁吗呢吧'.split(''),'现在','然后','因为','所以','但是','可能','觉得','知道','时候','可以','应该','需要','一下','一个'])
function extractKeywords(text:string):string[]{
  const keywords:string[]=[]
  for(const clause of text.split(/[，,。；;！？!?\s、]+/)){
    const trimmed=clause.trim()
    if(trimmed.length<2)continue
    let buffer=''
    for(const char of trimmed){
      if(genericWords.has(char)){
        if(buffer.length>=2)keywords.push(buffer)
        buffer=''
      }else buffer+=char
    }
    if(buffer.length>=2)keywords.push(buffer)
  }
  return [...new Set(keywords)]
}
