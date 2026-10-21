import { HttpError } from './db.ts'

export type ProviderFailureCategory='OVERLOADED'|'RATE_LIMIT'|'AUTHENTICATION'|'TIMEOUT'|'NETWORK'|'SCHEMA_OR_FORMAT'|'PAYLOAD'|'CONTENT_FILTER'|'PROVIDER_STOP_REASON'|'UNCLASSIFIED_ERROR'

// Durable diagnostics retain only a bounded category. Provider messages may
// contain payload fragments or credentials and never enter the audit.
export function classifyProviderFailure(message:string):ProviderFailureCategory{
  if(/\b1305\b|访问量过大/i.test(message))return 'OVERLOADED'
  if(/429|rate.?limit|too many requests|throttl|quota.*request|\b1302\b/i.test(message))return 'RATE_LIMIT'
  if(/401|403|invalid.*key|unauthorized|authentication/i.test(message))return 'AUTHENTICATION'
  if(/timeout|timed.?out|ETIMEDOUT/i.test(message))return 'TIMEOUT'
  if(/ECONN|ENOTFOUND|EAI_AGAIN|UND_ERR_|fetch failed|failed to fetch|connection (?:error|refused|reset|closed)|network|terminated|premature(?:ly)? closed|socket hang up/i.test(message))return 'NETWORK'
  if(/schema|response_format|json_schema/i.test(message))return 'SCHEMA_OR_FORMAT'
  if(/content_filter/i.test(message))return 'CONTENT_FILTER'
  if(/400|invalid.parameter|enable_thinking|reasoning_effort|max_tokens/i.test(message))return 'PAYLOAD'
  if(/provider finish_reason/i.test(message))return 'PROVIDER_STOP_REASON'
  return 'UNCLASSIFIED_ERROR'
}

// Pi 0.73.1 exposes an SDK error message, not the original error object.
// Inspect it only here; never return or log provider payloads or credentials.
export function providerError(message: string, receivedText = false): HttpError {
  if (/\b1305\b|访问量过大/.test(message)) return new HttpError(503,'MODEL_OVERLOADED',30)
  if (/\b1302\b|\b429\b|rate.?limit/i.test(message)) return new HttpError(429,'MODEL_RATE_LIMITED',60)
  if (/timed?\s*out|timeout/i.test(message)) return new HttpError(504,'MODEL_TIMEOUT',15)
  if (/\b40[13]\b/.test(message)) return new HttpError(503,'MODEL_CONFIGURATION_ERROR',300)
  // Bailian can abort structured generation before any delta reaches us.
  // Its explicit generation error is not a rejection of the static schema.
  if (/Model output became abnormal while generating a JSON response/i.test(message)) return new HttpError(502,'MODEL_REQUEST_FAILED',15)
  // Once text has streamed, a schema-labelled failure is not evidence that
  // the server rejected the request's static schema before generation.
  if (!receivedText&&/\b400\b/.test(message)&&/schema|uniqueItems|response_format/i.test(message)) return new HttpError(502,'MODEL_SCHEMA_UNSUPPORTED',0)
  return new HttpError(502,'MODEL_REQUEST_FAILED',15)
}
