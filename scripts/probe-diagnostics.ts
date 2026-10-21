import {classifyProviderFailure} from '../server/provider-errors.ts'

export function redactProbeText(value:unknown,secrets:string[]){
  let text=String(value??'')
  for(const secret of secrets.filter(Boolean).sort((a,b)=>b.length-a.length))text=text.replaceAll(secret,'[REDACTED]')
  return text.replace(/sk-[A-Za-z0-9_.-]{12,}/g,'[REDACTED]')
    .replace(/Bearer\s+[^\s,;"'}]+/gi,'Bearer [REDACTED]')
    .replace(/((?:authorization|api[-_]?key|access[-_]?token|secret)["']?\s*[:=]\s*)[^\r\n,}]+/gi,'$1[REDACTED]')
}
export function probeErrorCategory(message:string){
  return classifyProviderFailure(message)
}

// Redact individual values before serialization. Applying text substitutions to
// serialized JSON can replace an object opener and destroy the evidence format.
export function redactProbeValue(value:unknown,secrets:string[]):unknown{
  if(typeof value==='string')return redactProbeText(value,secrets)
  if(Array.isArray(value))return value.map(item=>redactProbeValue(item,secrets))
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[
    key,/^(?:authorization|api[-_]?key|access[-_]?token|secret)$/i.test(key)&&typeof item==='string'?'[REDACTED]':redactProbeValue(item,secrets),
  ]))
  return value
}
