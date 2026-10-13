import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { setDefaultResultOrder } from 'node:dns'

setDefaultResultOrder('ipv4first')

const production = process.env.NODE_ENV === 'production'
const file = (() => { if(production)return {};try { return parseEnv(readFileSync('.env.server', 'utf8')) } catch { return {} } })()
// A deliberately configured local credential takes precedence over stale inherited placeholders.
const env = { ...process.env, ...file }
// Empty example-file credential entries must not hide a securely injected process credential.
for(const name of ['DASHSCOPE_API_KEY','LIFEOS_MODEL_DEFAULT_API_KEY','LIFEOS_MODEL_REASONING_API_KEY'])if(!file[name]?.trim()&&process.env[name])env[name]=process.env[name]
const configured=(primary:string,alias:string,fallback:string)=>process.env[alias]?.trim()||process.env[primary]?.trim()||file[alias]?.trim()||file[primary]?.trim()||fallback
const bailianBaseUrl='https://dashscope.aliyuncs.com/compatible-mode/v1'
const defaultProvider='bailian'
const defaultModelId=process.env.LIFEOS_MODEL_DEFAULT_ID?.trim()||file.LIFEOS_MODEL_DEFAULT_ID?.trim()||'qwen3.8-flash'
if(!['qwen3.8-flash','qwen3.8-max','qwen3.7-plus','deepseek-v4.1-flash'].includes(defaultModelId))throw new Error('Unsupported LIFEOS_MODEL_DEFAULT_ID; use a reviewed Bailian model')
const defaultApiKey=env.LIFEOS_MODEL_DEFAULT_API_KEY||env.LIFEOS_DEFAULT_API_KEY||env.DASHSCOPE_API_KEY||''
const thinkingBudgetRaw=process.env.LIFEOS_QWEN_THINKING_BUDGET??file.LIFEOS_QWEN_THINKING_BUDGET??'0'
if(!/^\d+$/.test(thinkingBudgetRaw)||Number(thinkingBudgetRaw)>4096)throw new Error('LIFEOS_QWEN_THINKING_BUDGET must be an integer from 0 to 4096')
const qwenThinkingBudget=Number(thinkingBudgetRaw)
if(qwenThinkingBudget&&!['qwen3.8-flash','qwen3.8-max','qwen3.7-plus'].includes(defaultModelId))throw new Error('Bounded Qwen thinking requires a reviewed Qwen model')
const reasoningProvider='bailian'
const reasoningId='deepseek-v4.1-flash'
const tierConfig=(tier:'REASONING'|'DEEP')=>{
  if(tier==='REASONING')return {
    provider:reasoningProvider,
    id:reasoningId,
    baseUrl:configured('LIFEOS_MODEL_REASONING_BASE_URL','LIFEOS_REASONING_BASE_URL',bailianBaseUrl),
    apiKey:env.LIFEOS_MODEL_REASONING_API_KEY||env.LIFEOS_REASONING_API_KEY||env.DASHSCOPE_API_KEY||'',
  }
  return {provider:'',id:'',baseUrl:'',apiKey:''}
}
export const config = {
  production,
  host: env.LIFEOS_HOST ?? (production?'0.0.0.0':'127.0.0.1'),
  port: Number(env.LIFEOS_PORT ?? 8787),
  origin: env.LIFEOS_ORIGIN ?? 'http://127.0.0.1:5173',
  databaseUrl: env.DATABASE_URL ?? '',
  authSecret: env.BETTER_AUTH_SECRET ?? '',
  apiKey: defaultApiKey,
  qwenThinkingBudget,
  modelTiers:{
    default:{provider:defaultProvider,id:defaultModelId,baseUrl:configured('LIFEOS_MODEL_DEFAULT_BASE_URL','LIFEOS_DEFAULT_BASE_URL',bailianBaseUrl),apiKey:defaultApiKey},
    reasoning:tierConfig('REASONING'),
    deep:tierConfig('DEEP'),
  },
  modelPricingJson:process.env.LIFEOS_MODEL_PRICING_JSON??env.LIFEOS_MODEL_PRICING_JSON??'{}',
  providerBudgetEnabled: env.LIFEOS_PROVIDER_BUDGET_ENABLED==='true'||(production&&env.LIFEOS_PROVIDER_BUDGET_ENABLED!=='false'),
  providerBudgetId: env.LIFEOS_PROVIDER_BUDGET_ID??'production',
  entitlementsEnabled: env.LIFEOS_ENTITLEMENTS_ENABLED==='true'||(production&&env.LIFEOS_ENTITLEMENTS_ENABLED!=='false'),
  signupEnabled: env.LIFEOS_SIGNUP_ENABLED === 'true' || (!production&&env.LIFEOS_SIGNUP_ENABLED!=='false'),
  mail: {
    enabled: env.LIFEOS_PASSWORD_RESET_ENABLED === 'true',
    host: env.LIFEOS_SMTP_HOST?.trim() ?? '',
    port: Number(env.LIFEOS_SMTP_PORT ?? 465),
    user: env.LIFEOS_SMTP_USER?.trim() ?? '',
    password: env.LIFEOS_SMTP_PASSWORD ?? '',
    from: env.LIFEOS_MAIL_FROM?.trim() ?? '',
  },
  trustedProxy: env.LIFEOS_TRUSTED_PROXY ?? '',
  messagesPerMinute: Number(env.LIFEOS_MESSAGES_PER_MINUTE ?? 3),
  messagesPerDay: Number(env.LIFEOS_MESSAGES_PER_DAY ?? 50),
  generationConcurrency: Number(env.LIFEOS_GENERATION_CONCURRENCY ?? 4),
  generationQueueLimit: Number(env.LIFEOS_GENERATION_QUEUE_LIMIT ?? 32),
  cozeSyntheticUserId: env.LIFEOS_COZE_SYNTHETIC_USER_ID?.trim() ?? '', // Better Auth default IDs are case-sensitive 32-character alphanumerics.
  // C1 controlled-integration diagnostics ONLY (default off, never set in
  // production): forces LOCAL knowledge candidates to miss so the remote Coze
  // fallback runs against the intact verified registry. Labeled in the audit;
  // this is not a natural user-traffic claim.
  diagLocalKnowledgeMiss: process.env.LIFEOS_DIAG_LOCAL_KNOWLEDGE_MISS === 'true',
}
export function validateConfig(){
  const origin=new URL(config.origin)
  if(origin.origin!==config.origin||origin.username||origin.password)throw new Error('LIFEOS_ORIGIN must be a canonical origin')
  if(config.production&&origin.protocol!=='https:')throw new Error('Production LIFEOS_ORIGIN requires HTTPS')
  if(!Number.isInteger(config.port)||config.port<1||config.port>65535)throw new Error('Invalid LIFEOS_PORT')
  if(!Number.isInteger(config.generationConcurrency)||config.generationConcurrency<1||config.generationConcurrency>32||!Number.isInteger(config.generationQueueLimit)||config.generationQueueLimit<0||config.generationQueueLimit>256)throw new Error('Invalid generation scheduler limits')
  if(!config.databaseUrl||config.authSecret.length<32||/^(.{1,8})\1+$/.test(config.authSecret))throw new Error('Database URL and a strong unique auth secret are required')
  for(const count of [config.messagesPerMinute,config.messagesPerDay])if(!Number.isInteger(count)||count<1||count>10000)throw new Error('Invalid message request limit')
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(config.providerBudgetId))throw new Error('Invalid provider budget ID')
  if(config.cozeSyntheticUserId&&!/^[A-Za-z0-9]{32}$/.test(config.cozeSyntheticUserId))throw new Error('LIFEOS_COZE_SYNTHETIC_USER_ID must be a 32-character Better Auth user ID')
  if(config.production&&!config.providerBudgetEnabled)throw new Error('Production requires provider spend reservations')
  if(config.production&&!config.entitlementsEnabled)throw new Error('Production requires account entitlements')
  if(config.production&&!credentialReady())throw new Error('Server model credential is required')
  if(config.mail.enabled&&!mailConfigured())throw new Error('Password recovery requires a complete SMTP configuration')
}
export function mailConfigured() {
  const m=config.mail
  return m.enabled&&!!m.host&&!!m.user&&!!m.password&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(m.from)&&![m.host,m.user,m.password,m.from].some(v=>/[\r\n]/.test(v))&&Number.isInteger(m.port)&&m.port>0&&m.port<=65535
}
export function credentialReady() { return /^[\x21-\x7e]{20,200}$/.test(config.apiKey) }
