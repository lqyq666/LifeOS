import pg from 'pg'
import type { PoolClient } from 'pg'
import { config } from './config.ts'
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 8, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 })
pool.on('error', () => console.error('DATABASE_CONNECTION_ERROR'))
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result }
  catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}
export class HttpError extends Error { constructor(public status: number, public code: string, public retryAfter?: number, public details?: unknown) { super(code) } }
export const requireRow = <T>(row: T | undefined): T => { if (!row) throw new HttpError(404, 'NOT_FOUND'); return row }
