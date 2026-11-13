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

// Read-only matter comparison does not conduct the deeper interview. Keep the
// original delivery, refusal, evidence and privacy policy paragraphs verbatim.
const decisionEnd=extracted.instructions.indexOf('\nUse this only for a real direction choice')
if(decisionEnd<0)throw Error('DECISION_COMPANION_POLICY_UNAVAILABLE')
const decisionBoundaries=['When the person reports zero available time,','Use only contact channels, people and resources present in authorized state.'].map(start=>{
 const paragraph=extracted.grillingInstructions.split(/\r?\n\r?\n/).find(part=>part.startsWith(start))
 if(!paragraph)throw Error('DECISION_COMPANION_BOUNDARY_UNAVAILABLE')
 return paragraph
})
const decisionInstructions=[extracted.instructions.slice(0,decisionEnd).trim(),...decisionBoundaries].join('\n\n')
export const readOnlyDecisionPolicy=Object.freeze({
 name:mainCompanionPolicy.name,version:mainCompanionPolicy.version,
 sourceDigest:mainCompanionPolicy.sourceDigest,
 policyDigest:createHash('sha256').update(decisionInstructions).digest('hex'),
 scope:'read-only-matter-decision/1',instructions:decisionInstructions,
})

// Keep the approved delivery and privacy policy. The depth checklist is
// used by the full policy when the turn actually needs exploration.
const directDeliveryEnd=extracted.instructions.indexOf('\n## Personal understanding')
const directPrivacy=extracted.instructions.split(/\r?\n\r?\n/).find(part=>part.startsWith('沿用 growth、memory、experience'))
if(directDeliveryEnd<0||!directPrivacy)throw Error('DIRECT_COMPANION_POLICY_UNAVAILABLE')
const directDelivery=extracted.instructions.slice(0,directDeliveryEnd).trim()
 .replace(/mark what is truly\s+missing with【】placeholders or an explicit 待补 list/u,'state what remains unknown in complete prose')
const directOrdinaryInstructions=[directDelivery,directPrivacy,...decisionBoundaries].join('\n\n')
export const directOrdinaryPolicy=Object.freeze({
 name:mainCompanionPolicy.name,version:mainCompanionPolicy.version,
 sourceDigest:mainCompanionPolicy.sourceDigest,
 policyDigest:createHash('sha256').update(directOrdinaryInstructions).digest('hex'),
 scope:'direct-ordinary/2',instructions:directOrdinaryInstructions,
})
