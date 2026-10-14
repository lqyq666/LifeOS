import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'

// The product consumes the business policy, not the external agent's HTTP/
// server-start instructions. Capture once, just like the running Skill version.
const source=readFileSync(new URL('../skills/lifeos-personal-companion/SKILL.md',import.meta.url),'utf8')
const start=source.indexOf('## When to follow up, deliver, or stop'),end=source.indexOf('## Three kinds of unknown')
if(start<0||end<=start)throw Error('MAIN_COMPANION_POLICY_UNAVAILABLE')
const instructions=source.slice(start,end).trim()
export const mainCompanionPolicy=Object.freeze({
 name:'lifeos-personal-companion',version:'1.2.2-candidate',
 sourceDigest:createHash('sha256').update(source).digest('hex'),
 policyDigest:createHash('sha256').update(instructions).digest('hex'),
 scope:'follow-up-deliver-stop',instructions,
})
