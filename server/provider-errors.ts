import { HttpError } from './db.ts'

// Pi 0.73.1 exposes an SDK error message, not the original error object.
// Inspect it only here; never return or log provider payloads or credentials.
export function providerError(message: string, receivedText = false): HttpError {
  if (/\b1305\b|访问量过大/.test(message)) return new HttpError(503,'MODEL_OVERLOADED',30)
  if (/\b1302\b|\b429\b|rate.?limit/i.test(message)) return new HttpError(429,'MODEL_RATE_LIMITED',60)
  if (/timed?\s*out|timeout/i.test(message)) return new HttpError(504,'MODEL_TIMEOUT',15)
  if (/\b40[13]\b/.test(message)) return new HttpError(503,'MODEL_CONFIGURATION_ERROR',300)
  // Once text has streamed, a schema-labelled failure is not evidence that
  // the server rejected the request's static schema before generation.
  if (!receivedText&&/\b400\b/.test(message)&&/schema|uniqueItems|response_format/i.test(message)) return new HttpError(502,'MODEL_SCHEMA_UNSUPPORTED',0)
  return new HttpError(502,'MODEL_REQUEST_FAILED',15)
}
