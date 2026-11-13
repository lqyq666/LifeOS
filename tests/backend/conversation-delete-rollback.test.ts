import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {pool} from '../../server/db.ts'
import {verifySchema} from '../../server/schema.ts'
test.after(async()=>{await pool.end()})
test('exact additive-registration rollback boots old schema verifier without losing deletion tombstones, and forward registration remains possible',async()=>{
 const cwd=process.cwd(),user='rollback-'+randomUUID(),chat=randomUUID();const temp=await mkdtemp(resolve('.local/rollback-schema-'))
 const prior=(await pool.query("SELECT sha256 FROM lifeos_schema_migrations WHERE name='040-conversation-deletion.sql'")).rows[0]
 try{
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$1,$2,false,now(),now())',[user,user+'@example.invalid'])
  await pool.query('INSERT INTO conversations(id,user_id,title) VALUES($1,$2,$3)',[chat,user,'SYNTHETIC rollback'])
  await pool.query('INSERT INTO deleted_conversations(user_id,conversation_id) VALUES($1,$2)',[user,chat])
  await mkdir(resolve(temp,'server/migrations'),{recursive:true})
  const names=execFileSync('git',['ls-tree','--name-only','3fbf420e2713d8247c12540e4e8e0362b664142f:server/migrations'],{encoding:'utf8'}).trim().split('\n')
  for(const name of names)await writeFile(resolve(temp,'server/migrations',name),execFileSync('git',['show','3fbf420e2713d8247c12540e4e8e0362b664142f:server/migrations/'+name]))
  process.chdir(temp)
  const c=await pool.connect();try{
   await assert.rejects(verifySchema(c),/SCHEMA_NEWER_THAN_RELEASE/)
   await c.query("DELETE FROM lifeos_schema_migrations WHERE name='040-conversation-deletion.sql' AND sha256=$1",[prior.sha256])
   await verifySchema(c)
   assert.equal((await c.query('SELECT count(*)::int AS n FROM deleted_conversations WHERE user_id=$1 AND conversation_id=$2',[user,chat])).rows[0].n,1)
   await c.query("INSERT INTO lifeos_schema_migrations(name,sha256) VALUES('040-conversation-deletion.sql',$1)",[prior.sha256])
   process.chdir(cwd);await verifySchema(c)
  }finally{c.release()}
 }finally{process.chdir(cwd);await pool.query("INSERT INTO lifeos_schema_migrations(name,sha256) VALUES('040-conversation-deletion.sql',$1) ON CONFLICT DO NOTHING",[prior.sha256]);await pool.query('DELETE FROM "user" WHERE id=$1',[user]);assert.ok(temp.startsWith(resolve('.local')+'/')||temp.startsWith(resolve('.local')+'\\'));await rm(temp,{recursive:true,force:true})}
})
