import test from 'node:test'
import assert from 'node:assert/strict'
import {config} from '../../server/config.ts'
import {createApp} from '../../server/http.ts'
import {pool} from '../../server/db.ts'

test('public production HTTP never returns a generated password reset token to an unauthenticated requester',async()=>{
 const app=createApp(),previous=config.production,email='synthetic-reset-boundary@example.invalid'
 await new Promise<void>(r=>app.listen(0,'127.0.0.1',r))
 const url='http://127.0.0.1:'+(app.address() as any).port+'/api/auth/pending-reset?email='+encodeURIComponent(email)
 try{config.production=true;const denied=await fetch(url);assert.equal(denied.status,404);
 const origin='http://127.0.0.1:'+(app.address() as any).port;
 const policy=await fetch(origin+'/api/access-policy');assert.equal((await policy.json()).passwordResetEnabled,false);
 const reset=await fetch(origin+'/api/auth/request-password-reset',{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json'},body:JSON.stringify({email})});assert.equal(reset.status,503);assert.equal((await reset.json()).error,'PASSWORD_RESET_UNAVAILABLE');
 config.production=false;const local=await fetch(url);assert.equal(local.status,404);assert.equal((await (await fetch(origin+'/api/access-policy')).json()).passwordResetEnabled,false)}
 finally{config.production=previous;app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));await pool.end()}
})
