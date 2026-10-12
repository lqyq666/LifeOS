import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {pool} from '../../server/db.ts'

test.after(()=>pool.end())
test('migration 034 preserves existing ordinary spend and old-binary inserts, and rolls back transactionally',async()=>{
 const client=await pool.connect()
 try{
  assert.match((await client.query('SELECT current_database() AS name')).rows[0].name,/^lifeos_dialogue_test_/)
  await client.query('BEGIN')
  await client.query('ALTER TABLE lifeos_provider_spend DROP COLUMN workflow_request_id; ALTER TABLE lifeos_provider_spend ADD CONSTRAINT lifeos_provider_spend_call_index_check CHECK (call_index IN (1,2))')
  const budget='migration-budget-'+randomUUID(),user='migration-owner-'+randomUUID()
  await client.query('INSERT INTO lifeos_provider_budgets(id,limit_cny) VALUES($1,10)',[budget])
  const ids=[randomUUID(),randomUUID()]
  for(const [index,id] of ids.entries())await client.query("INSERT INTO lifeos_provider_spend(id,budget_id,user_id,request_id,call_index,provider,model,reserved_cny,settled_cny,status) VALUES($1,$2,$3,$4,$5,'synthetic','synthetic',0.1,$6,$7)",[id,budget,user,randomUUID(),index+1,index===0?0.01:null,index===0?'known':'unknown'])
  const before=(await client.query('SELECT * FROM lifeos_provider_spend WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows
  await client.query('SAVEPOINT before_034')
  const sql=readFileSync('server/migrations/034-workflow-provider-spend.sql','utf8')
  await client.query(sql)
  const after=(await client.query('SELECT * FROM lifeos_provider_spend WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows
  assert.deepEqual(after.map(({workflow_request_id,...row})=>row),before)
  assert.ok(after.every(row=>row.workflow_request_id===null))
  // The previous binary omits the new nullable column entirely.
  await client.query("INSERT INTO lifeos_provider_spend(id,budget_id,user_id,request_id,call_index,provider,model,reserved_cny,status) VALUES($1,$2,$3,$4,2,'synthetic-old-binary','synthetic',0.1,'reserved')",[randomUUID(),budget,user,randomUUID()])
  await client.query('SAVEPOINT invalid_ordinary_third')
  await assert.rejects(()=>client.query("INSERT INTO lifeos_provider_spend(id,budget_id,user_id,request_id,call_index,provider,model,reserved_cny,status) VALUES($1,$2,$3,$4,3,'synthetic','synthetic',0.1,'reserved')",[randomUUID(),budget,user,randomUUID()]),/check constraint/)
  await client.query('ROLLBACK TO SAVEPOINT invalid_ordinary_third')
  await client.query('ROLLBACK TO SAVEPOINT before_034')
  assert.equal((await client.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='lifeos_provider_spend' AND column_name='workflow_request_id'")).rows[0].n,0,'an interrupted transaction leaves schema 033 intact')
  assert.deepEqual((await client.query('SELECT * FROM lifeos_provider_spend WHERE id=ANY($1::uuid[]) ORDER BY id',[ids])).rows,before)
  await client.query(sql)
  assert.equal((await client.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='lifeos_provider_spend' AND column_name='workflow_request_id'")).rows[0].n,1,'the same migration succeeds after transactional rollback')
 }finally{await client.query('ROLLBACK');client.release()}
})

test('migration 036 preserves legacy ambiguity and old-binary inserts through transactional rollback',async()=>{
 const client=await pool.connect()
 try{
  assert.match((await client.query('SELECT current_database() AS name')).rows[0].name,/^lifeos_dialogue_test_/)
  await client.query('BEGIN')
  await client.query('ALTER TABLE lifeos_provider_spend DROP COLUMN workflow_dispatch_state')
  const budget='dispatch-migration-'+randomUUID(),user='dispatch-migration-'+randomUUID(),id=randomUUID()
  await client.query('INSERT INTO lifeos_provider_budgets(id,limit_cny) VALUES($1,10)',[budget])
  await client.query("INSERT INTO lifeos_provider_spend(id,budget_id,user_id,request_id,call_index,provider,model,reserved_cny,status) VALUES($1,$2,$3,$4,1,'old-binary','synthetic',0.1,'unknown')",[id,budget,user,randomUUID()])
  const before=(await client.query('SELECT * FROM lifeos_provider_spend WHERE id=$1',[id])).rows[0]
  await client.query('SAVEPOINT before_036')
  const sql=readFileSync('server/migrations/036-workflow-dispatch-boundary.sql','utf8')
  await client.query(sql)
  const after=(await client.query('SELECT * FROM lifeos_provider_spend WHERE id=$1',[id])).rows[0]
  const {workflow_dispatch_state,...existing}=after;assert.equal(workflow_dispatch_state,null);assert.deepEqual(existing,before)
  await client.query("INSERT INTO lifeos_provider_spend(id,budget_id,user_id,request_id,call_index,provider,model,reserved_cny,status) VALUES($1,$2,$3,$4,2,'old-binary','synthetic',0.1,'reserved')",[randomUUID(),budget,user,randomUUID()])
  await client.query('ROLLBACK TO SAVEPOINT before_036')
  assert.deepEqual((await client.query('SELECT * FROM lifeos_provider_spend WHERE id=$1',[id])).rows[0],before)
  await client.query(sql)
  assert.equal((await client.query('SELECT workflow_dispatch_state FROM lifeos_provider_spend WHERE id=$1',[id])).rows[0].workflow_dispatch_state,null)
 }finally{await client.query('ROLLBACK');client.release()}
})
