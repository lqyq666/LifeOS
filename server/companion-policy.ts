import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'

// The product consumes the business policy, not the external agent's HTTP/
// server-start instructions. Capture once, just like the running Skill version.
const source=readFileSync(new URL('../skills/lifeos-personal-companion/SKILL.md',import.meta.url),'utf8')
export function extractCompanionPolicies(skillSource:string){
 const start=skillSource.indexOf('## When to follow up, deliver, or stop'),end=skillSource.indexOf('## Three kinds of unknown')
 const grillingStart=skillSource.indexOf('## LifeOS Grilling — evidence-led exploration')
 if(start<0||end<=start||grillingStart<start||grillingStart>=end)throw Error('MAIN_COMPANION_POLICY_UNAVAILABLE')
 const instructions=skillSource.slice(start,end).trim(),grillingInstructions=skillSource.slice(grillingStart,end).trim()
 const grillingVersion=/Policy version: `([^`]+)`/.exec(grillingInstructions)?.[1]
 if(!grillingVersion)throw Error('GRILLING_POLICY_VERSION_UNAVAILABLE')
 return {instructions,grillingInstructions,grillingVersion}
}
const extracted=extractCompanionPolicies(source)
export const mainCompanionPolicy=Object.freeze({
 name:'lifeos-personal-companion',version:'1.3.0-candidate',
 sourceDigest:createHash('sha256').update(source).digest('hex'),
 policyDigest:createHash('sha256').update(extracted.instructions).digest('hex'),
 scope:'follow-up-deliver-stop+grilling',instructions:extracted.instructions,
 grilling:Object.freeze({name:'lifeos-grilling',version:extracted.grillingVersion,policyDigest:createHash('sha256').update(extracted.grillingInstructions).digest('hex'),instructions:extracted.grillingInstructions}),
})
