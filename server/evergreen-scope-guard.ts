// Narrow, auditable hard boundaries, not a semantic entailment classifier.
export function unsupportedMethodAssertion(reply:string){
 const guarantees=/(?:保证|一定|必然|必定|稳拿|稳过|百分之百|100%).{0,16}(?:成功|盈利|收入|上岸|录取|通过|治好|有效|复购)|(?:证明|意味着|带来|实现|获得|就是).{0,6}稳定收入/g
 for(const match of reply.matchAll(guarantees)){
  const before=reply.slice(Math.max(0,match.index!-8),match.index)
  if(/(?:不能|不|未|无法|不会|否认|不等于)[^，。；;！？]*$/.test(before))continue
  const sentence=reply.slice(match.index,reply.indexOf('。',match.index)<0?undefined:reply.indexOf('。',match.index))
  if(/[？?]/.test(sentence))continue
  return match[0]
 }
 return null
}
