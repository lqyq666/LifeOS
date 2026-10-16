export function redactProbeText(value:unknown,secrets:string[]){
  let text=String(value??'')
  for(const secret of secrets.filter(Boolean).sort((a,b)=>b.length-a.length))text=text.replaceAll(secret,'[REDACTED]')
  return text.replace(/sk-[A-Za-z0-9_-]{12,}/g,'[REDACTED]')
    .replace(/Bearer\s+[^\s,;"'}]+/gi,'Bearer [REDACTED]')
    .replace(/((?:authorization|api[-_]?key|access[-_]?token|secret)["']?\s*[:=]\s*)[^\r\n,}]+/gi,'$1[REDACTED]')
}
export function probeErrorCategory(message:string){
  if(/429|rate.?limit|too many requests|throttl|quota.*request/i.test(message))return 'RATE_LIMIT'
  if(/401|403|invalid.*key|unauthorized|authentication/i.test(message))return 'AUTHENTICATION'
  if(/timeout|timed.?out|ETIMEDOUT/i.test(message))return 'TIMEOUT'
  if(/ECONN|ENOTFOUND|fetch failed|network/i.test(message))return 'NETWORK'
  if(/schema|response_format|json_schema/i.test(message))return 'SCHEMA_OR_FORMAT'
  if(/400|invalid.parameter|enable_thinking|reasoning_effort|max_tokens/i.test(message))return 'PAYLOAD'
  return 'UNCLASSIFIED_ERROR'
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
