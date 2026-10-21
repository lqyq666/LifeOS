import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {migrationHash,migrationChecksumMatches} from '../server/migration-checksum.ts'
test('actual first auth migration retains historical checksum across Git LF transport but rejects changed SQL',()=>{
 const sql=readFileSync('server/migrations/000-better-auth-1.7.7.sql','utf8').replace(/\r\n/g,'\n')
 const old=migrationHash(sql.replace(/\n/g,'\r\n'))
 assert.ok(migrationChecksumMatches(sql,old))
 assert.ok(migrationChecksumMatches(sql.replace(/\n/g,'\r\n'),migrationHash(sql)))
 assert.equal(migrationChecksumMatches(sql.replace(/CREATE TABLE/i,'DROP TABLE'),old),false)
})

test('committed source archives preserve the applied identity migration bytes',()=>{
 for(const name of ['026-identity-layer.sql','027-identity-change-fields.sql']){
  const path=`server/migrations/${name}`
  const archived=execFileSync('git',['show',`HEAD:${path}`])
  assert.deepEqual(archived,readFileSync(path),path)
 }
})
