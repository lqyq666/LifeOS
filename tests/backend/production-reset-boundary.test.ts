import test from 'node:test'
import assert from 'node:assert/strict'
import {config} from '../../server/config.ts'
import {createApp} from '../../server/http.ts'
import {authOptions} from '../../server/auth.ts'
import {pool} from '../../server/db.ts'

test('public production HTTP never returns a generated password reset token to an unauthenticated requester',async()=>{
 const app=createApp(),previous=config.production,email='synthetic-reset-boundary@example.invalid',token='SYNTHETIC_ACCOUNT_TAKEOVER_TOKEN'
 await authOptions.emailAndPassword.sendResetPassword({user:{email},url:'http://127.0.0.1/reset-password/'+token})
 await new Promise<void>(r=>app.listen(0,'127.0.0.1',r))
 const url='http://127.0.0.1:'+(app.address() as any).port+'/api/auth/pending-reset?email='+encodeURIComponent(email)
 try{config.production=true;const denied=await fetch(url);assert.equal(denied.status,404);assert.ok(!(await denied.text()).includes(token));config.production=false;const local=await fetch(url);assert.equal(local.status,200);assert.equal((await local.json()).token,token)}
 finally{config.production=previous;app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));await pool.end()}
})
