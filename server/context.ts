export function estimateTokens(text:string){
  let estimate=0
  for(const character of text){
    const code=character.codePointAt(0)!
    if(code>=0x2e80)estimate+=1.5
    else if(/[A-Za-z0-9]/.test(character))estimate+=0.3
    else if(/\s/.test(character))estimate+=0.15
    else estimate+=0.7
  }
  return Math.ceil(estimate)
}
