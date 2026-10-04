import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { parseEnv } from 'node:util'

const container = 'lifeos-postgres-20261001'
const image = 'postgres@sha256:051f7b7b3abdd564d5d1bd1e8c4b9c1b6e77087d1dd22020ede611c096a272e0'
const local = '.env.server'
const env = existsSync(local) ? parseEnv(readFileSync(local, 'utf8')) : {}
function docker(args: string[]) { const result = spawnSync('docker', args, { encoding: 'utf8' }); if (result.status !== 0) throw new Error(result.stderr); return result.stdout.trim() }
if (docker(['ps', '-a', '--filter', `name=^/${container}$`, '--format', '{{.Names}}']) === container) {
  if (!env.DATABASE_URL) throw new Error('Existing LifeOS container found but local database configuration missing; restore the original configuration.')
  if (docker(['inspect', container, '--format', '{{.State.Running}}']) !== 'true') docker(['start', container])
  console.log('Reusing dedicated LifeOS PostgreSQL container.'); process.exit(0)
}
if (env.DATABASE_URL) throw new Error('DATABASE_URL is already configured; use that database and do not create a replacement.')
mkdirSync('.local', { recursive: true })
const password = randomBytes(32).toString('hex')
const authSecret = env.BETTER_AUTH_SECRET ?? ''
writeFileSync('.local/postgres.env', `POSTGRES_USER=lifeos\nPOSTGRES_DB=lifeos\nPOSTGRES_PASSWORD=${password}\n`, { mode: 0o600 })
docker(['run', '-d', '--name', container, '--restart', 'unless-stopped', '-p', '127.0.0.1:55432:5432',
  '--env-file', '.local/postgres.env', '-v', 'lifeos-postgres-data-20261001:/var/lib/postgresql/data',
  '--health-cmd', 'pg_isready -U lifeos -d lifeos', '--health-interval', '2s', '--health-retries', '15', image])
writeFileSync(local, (existsSync(local) ? readFileSync(local, 'utf8') : '') + `\nDATABASE_URL=postgresql://lifeos:${password}@127.0.0.1:55432/lifeos\nBETTER_AUTH_SECRET=${authSecret.length >= 32 ? authSecret : randomBytes(40).toString('hex')}\nLIFEOS_ORIGIN=http://127.0.0.1:5173\nLIFEOS_PORT=8787\n`, { mode: 0o600 })
console.log('Created dedicated LifeOS PostgreSQL 17.11 on 127.0.0.1:55432. Credentials saved only to ignored local files.')
