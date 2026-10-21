import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,existsSync} from 'node:fs'

const directory='evidence/v1.3-action-coach/provider/qwen-max-current-20261019'
test('candidate Max evidence is explicitly packaged without opening all provider diagnostics',()=>{
 const dockerfile=readFileSync('Dockerfile','utf8'),ignore=readFileSync('.dockerignore','utf8')
 assert.ok(dockerfile.includes(`COPY ${directory}/coach-capabilities-default.json ./${directory}/`))
 assert.ok(dockerfile.includes('FROM scratch AS capability-evidence'))
 assert.ok(dockerfile.includes('COPY --from=capability-evidence /app/evidence ./evidence'))
 assert.ok(ignore.split(/\r?\n/).includes('!'+directory+'/'))
 assert.ok(ignore.split(/\r?\n/).includes('!'+directory+'/coach-capabilities-default.json'))
 assert.ok(!ignore.split(/\r?\n/).includes('!'+directory+'/**'))
 const report=JSON.parse(readFileSync(directory+'/coach-capabilities-default.json','utf8'))
 assert.equal(report.model,'qwen3.8-max')
 assert.equal(report.evidence,'REAL_PROVIDER_API')
 assert.equal(report.status,'PASS')
})

test('candidate model config explicitly selects packaged evidence and pricing while retaining production guards',()=>{
 const compose=readFileSync('compose.yaml','utf8')
 const defaultLine=compose.split(/\r?\n/).find(line=>line.trim().startsWith('LIFEOS_MODEL_PRICING_JSON:'))!
 const defaultJson=/^\s*LIFEOS_MODEL_PRICING_JSON: '\$\{LIFEOS_MODEL_PRICING_JSON:-(.+)\}'$/.exec(defaultLine)![1]!
 assert.equal(JSON.parse(defaultJson)['bailian:qwen3.8-flash'].outputCnyPerMillion,2.7,'default JSON is not itself wrapped in literal single quotes')
 assert.ok(compose.includes('LIFEOS_EVIDENCE: ${LIFEOS_EVIDENCE:-/app/evidence/v1.3-action-coach/provider/qwen-current}'))
 assert.ok(compose.includes('LIFEOS_DEFAULT_MODEL: ${LIFEOS_MODEL_DEFAULT_ID:-qwen3.8-flash}'),'legacy display alias follows the authoritative ID, not a stale inherited alias')
 const path='deploy/max-candidate.env.example'
 assert.ok(existsSync(path))
 const profile=readFileSync(path,'utf8')
 assert.match(profile,/^LIFEOS_MODEL_DEFAULT_ID=qwen3\.8-max$/m)
 assert.ok(profile.includes('LIFEOS_EVIDENCE=/app/'+directory))
 const pricing=JSON.parse(/^LIFEOS_MODEL_PRICING_JSON='(.+)'$/m.exec(profile)![1]!)
 assert.deepEqual(pricing['bailian:qwen3.8-max'],{inputCnyPerMillion:12,outputCnyPerMillion:36,cachedInputCnyPerMillion:1.5})
 assert.ok(!/^(?:DATABASE_URL|DASHSCOPE_API_KEY|BETTER_AUTH_SECRET|LIFEOS_PROVIDER_BUDGET_ID)=/m.test(profile),'candidate template is not a secret store or new financial authority')
 assert.match(compose,/LIFEOS_PROVIDER_BUDGET_ENABLED: true/)
 assert.match(compose,/LIFEOS_ENTITLEMENTS_ENABLED: true/)
 assert.match(compose,/LIFEOS_SIGNUP_ENABLED: \$\{LIFEOS_SIGNUP_ENABLED:-false\}/)
 const builder=readFileSync('deploy/build-image.ps1','utf8')
 assert.ok(builder.includes('if (git status --porcelain)'))
 assert.ok(builder.includes('git -c core.autocrlf=false -c core.eol=lf archive'))
})
