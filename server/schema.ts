import { readFileSync, readdirSync } from 'node:fs'
import { migrationChecksumMatches } from './migration-checksum.ts'
import type { PoolClient } from 'pg'
export async function verifySchema(client:PoolClient){
  const applied=new Map<string,string>((await client.query('SELECT name,sha256 FROM lifeos_schema_migrations')).rows.map(row=>[row.name,row.sha256]))
  const names=readdirSync('server/migrations').filter(name=>name.endsWith('.sql')).sort()
  for(const name of names){
    const sql=readFileSync('server/migrations/'+name,'utf8')
    if(!migrationChecksumMatches(sql,applied.get(name)??''))throw new Error('SCHEMA_MIGRATION_MISSING_OR_CHANGED: '+name)
  }
  for(const name of applied.keys())if(!names.includes(name))throw new Error('SCHEMA_NEWER_THAN_RELEASE: '+name)
}
