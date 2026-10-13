import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { SMTPServer } from 'smtp-server'
import { config } from '../../server/config.ts'
import { createApp } from '../../server/http.ts'
import { pool } from '../../server/db.ts'
import { sendPasswordResetMail,passwordResetMailLimits,drainPasswordResetMail,queuePasswordResetMail } from '../../server/password-reset-mail.ts'

test('emailed link resets exactly once, expires, and revokes old sessions without exposing tokens',async()=>{
  const original={...config.mail},messages:string[]=[]
  let activeMessages=0,peakMessages=0
  const smtp=new SMTPServer({disabledCommands:['STARTTLS'],logger:false,
    onAuth(_auth,_session,cb){cb(null,{user:'synthetic'})},
    onData(stream,_session,cb){activeMessages++;peakMessages=Math.max(peakMessages,activeMessages);let data='';stream.on('data',chunk=>{data+=chunk.toString()});stream.on('end',()=>{setTimeout(()=>{messages.push(data);activeMessages--;cb()},30)})},
  })
  await new Promise<void>(r=>smtp.listen(0,'127.0.0.1',r))
  // SMTPServer's public underlying net.Server supplies the ephemeral port.
  Object.assign(config.mail,{enabled:true,host:'127.0.0.1',port:(smtp.server.address() as {port:number}).port,user:'synthetic',password:'Synthetic-not-a-secret',from:'reset@example.invalid'})
  const app=createApp()
  await new Promise<void>(r=>app.listen(0,'127.0.0.1',r))
  const origin='http://127.0.0.1:'+(app.address() as {port:number}).port
  const post=(path:string,data:unknown)=>fetch(origin+'/api/auth/'+path,{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json'},body:JSON.stringify(data)})
  const email='reset-'+randomUUID()+'@example.invalid',oldPassword='Synthetic-old-'+randomUUID(),newPassword='Synthetic-new-'+randomUUID()
  const clearRate=()=>pool.query('DELETE FROM "rateLimit"') // This file runs only in a disposable DB.
  try {
    const signup=await post('sign-up/email',{email,password:oldPassword,name:'Synthetic adult password recovery'})
    assert.equal(signup.status,200)
    const cookie=signup.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
    const user=(await signup.json()).user.id
    assert.equal((await fetch(origin+'/api/access-policy').then(r=>r.json())).passwordResetEnabled,true)
    const request=await post('request-password-reset',{email,redirectTo:config.origin+'/#reset'})
    assert.equal(request.status,200);const neutral=await request.json()
    await drainPasswordResetMail()
    assert.deepEqual(await (await post('request-password-reset',{email:'missing-'+randomUUID()+'@example.invalid',redirectTo:config.origin+'/#reset'})).json(),neutral)
    assert.equal(messages.length,1)
    const [headers,...body]=messages[0].split('\r\n\r\n'),encoded=body.join('\r\n\r\n')
    const text=/Content-Transfer-Encoding: base64/i.test(headers)?Buffer.from(encoded.replace(/\s/g,''),'base64').toString('utf8'):encoded.replace(/=\r?\n/g,'').replace(/=([0-9A-F]{2})/g,(_,hex:string)=>String.fromCharCode(parseInt(hex,16)))
    const emailedLink=new URL(text.match(/http:\/\/[^\s]+/)![0])
    assert.equal(emailedLink.origin,config.origin)
    assert.equal(emailedLink.pathname,'/')
    assert.equal(emailedLink.search,'','bearer token must not enter HTTP access logs')
    assert.ok(emailedLink.hash.startsWith('#reset?token='))
    const token=new URLSearchParams(emailedLink.hash.slice('#reset?'.length)).get('token')!
    assert.ok(token.length>=16);assert.ok(!JSON.stringify(neutral).includes(token))
    assert.equal((await fetch(origin+'/api/auth/pending-reset?email='+encodeURIComponent(email))).status,404)
    const stored=(await pool.query('SELECT "expiresAt" FROM "verification" WHERE identifier=$1',['reset-password:'+token])).rows[0]
    const expiresIn=new Date(stored.expiresAt).getTime()-Date.now();assert.ok(expiresIn>14*60*1000&&expiresIn<=15*60*1000)
    assert.equal((await post('reset-password',{token,newPassword:'short'})).status,400)
    const otherPassword='Synthetic-other-'+randomUUID()
    const simultaneous=await Promise.all([post('reset-password',{token,newPassword}),post('reset-password',{token,newPassword:otherPassword})])
    assert.deepEqual(simultaneous.map(r=>r.status).sort(),[200,400])
    assert.equal((await fetch(origin+'/api/session',{headers:{Cookie:cookie}})).status,401)
    assert.equal((await post('sign-in/email',{email,password:oldPassword})).status,401)
    // Determine which concurrent request won, without assuming scheduling order.
    const winning=simultaneous[0].status===200?newPassword:otherPassword
    assert.equal((await post('sign-in/email',{email,password:winning})).status,200)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM "verification" WHERE value=$1 AND identifier LIKE $2',[user,'reset-password:%'])).rows[0].n,0)
    await clearRate()
    await pool.query("UPDATE lifeos_password_reset_deliveries SET created_at=now()-interval '2 minutes'")
    await post('request-password-reset',{email,redirectTo:config.origin+'/#reset'})
    await drainPasswordResetMail()
    const expired=(await pool.query('SELECT identifier FROM "verification" WHERE value=$1',[user])).rows[0].identifier
    await pool.query('UPDATE "verification" SET "expiresAt"=now()-interval \'1 second\' WHERE identifier=$1',[expired])
    const denied=await post('reset-password',{token:expired.slice('reset-password:'.length),newPassword:'Synthetic-expired-'+randomUUID()})
    assert.equal(denied.status,400);assert.equal((await denied.json()).code,'INVALID_TOKEN')
    await clearRate()
    // A cleanup query failure must not skip Better Auth's subsequent session
    // revocation after the password has already been updated.
    const recoveryLogin=await post('sign-in/email',{email,password:winning})
    assert.equal(recoveryLogin.status,200)
    const recoveryCookie=recoveryLogin.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')
    await pool.query("UPDATE lifeos_password_reset_deliveries SET created_at=now()-interval '2 minutes'")
    const recoveryRequest=await post('request-password-reset',{email,redirectTo:config.origin+'/#reset'})
    assert.equal(recoveryRequest.status,200)
    await drainPasswordResetMail()
    const [failureHeaders,...failureBody]=messages.at(-1)!.split('\r\n\r\n')
    const failureEncoded=failureBody.join('\r\n\r\n')
    const failureText=/Content-Transfer-Encoding: base64/i.test(failureHeaders)?Buffer.from(failureEncoded.replace(/\s/g,''),'base64').toString('utf8'):failureEncoded.replace(/=\r?\n/g,'').replace(/=([0-9A-F]{2})/g,(_,hex:string)=>String.fromCharCode(parseInt(hex,16)))
    const failureURL=new URL(failureText.match(/http:\/\/[^\s]+/)![0])
    const failureToken=new URLSearchParams(failureURL.hash.slice('#reset?'.length)).get('token')!
    const originalQuery=pool.query
    let cleanupFailureInjected=false
    ;(pool as any).query=function(...args:any[]){
      if(typeof args[0]==='string'&&args[0].startsWith('DELETE FROM "verification"')&&!cleanupFailureInjected){cleanupFailureInjected=true;return Promise.reject(new Error('synthetic verification cleanup failure'))}
      return (originalQuery as any).apply(pool,args)
    }
    const failurePassword='Synthetic-after-cleanup-failure-'+randomUUID()
    let failedCleanupReset:Response
    try{failedCleanupReset=await post('reset-password',{token:failureToken,newPassword:failurePassword})}
    finally{(pool as any).query=originalQuery}
    assert.equal(cleanupFailureInjected,true)
    assert.equal(failedCleanupReset!.status,200)
    assert.equal((await fetch(origin+'/api/session',{headers:{Cookie:recoveryCookie}})).status,401)
    assert.equal((await post('sign-in/email',{email,password:winning})).status,401)
    assert.equal((await post('sign-in/email',{email,password:failurePassword})).status,200)
    await clearRate()
    const foreign=await post('request-password-reset',{email,redirectTo:'https://foreign.example.invalid/#reset'})
    assert.equal(foreign.status,403)
    await clearRate()
    const before=messages.length
    for(let i=0;i<4;i++){const r=await post('request-password-reset',{email:'unknown-'+i+'@example.invalid'});assert.equal(r.status,i===3?429:200)}
    assert.equal(messages.length,before)
    const dummyURL=config.origin+'/api/auth/reset-password/'+randomUUID().replaceAll('-','')+'?callbackURL='+encodeURIComponent('https://foreign.example.invalid/')
    const cappedEmail='cooldown-'+randomUUID()+'@example.invalid'
    await sendPasswordResetMail({user:{email:cappedEmail},url:dummyURL})
    await sendPasswordResetMail({user:{email:cappedEmail},url:dummyURL})
    assert.equal(messages.length,before+1)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM lifeos_password_reset_deliveries WHERE created_at>now()-interval \'60 seconds\'')).rows[0].n,2)
    const beforeQueue=messages.length
    await Promise.all(Array.from({length:8},(_,i)=>queuePasswordResetMail({user:{email:'queued-'+i+'@example.invalid'},url:dummyURL})))
    await drainPasswordResetMail()
    assert.equal(messages.length,beforeQueue+8)
    assert.ok(peakMessages<=2,'public recovery callback cannot open 80 concurrent SMTP sends')
    const {rows:[count]}=await pool.query('SELECT count(*)::int AS n FROM lifeos_password_reset_deliveries')
    await pool.query("INSERT INTO lifeos_password_reset_deliveries(id,recipient_hash,status) SELECT gen_random_uuid(),repeat('0',64),'unknown' FROM generate_series(1,$1)",[passwordResetMailLimits.daily-1-count.n])
    const beforeCap=messages.length
    await Promise.all(Array.from({length:8},(_,i)=>queuePasswordResetMail({user:{email:'concurrent-'+i+'@example.invalid'},url:dummyURL})))
    await drainPasswordResetMail()
    assert.equal(messages.length,beforeCap+1)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM lifeos_password_reset_deliveries')).rows[0].n,passwordResetMailLimits.daily)
    // Restart-equivalent retries still see the PG hold and dispatch nothing.
    await sendPasswordResetMail({user:{email:'after-restart@example.invalid'},url:dummyURL});assert.equal(messages.length,beforeCap+1)
    await pool.query("UPDATE lifeos_password_reset_deliveries SET created_at=now()-interval '2 days'")
    await pool.query("INSERT INTO lifeos_password_reset_deliveries(id,recipient_hash,status,created_at) SELECT gen_random_uuid(),repeat('1',64),'unknown',now()-interval '2 days' FROM generate_series(1,$1)",[passwordResetMailLimits.monthly-passwordResetMailLimits.daily])
    await sendPasswordResetMail({user:{email:'monthly-limit@example.invalid'},url:dummyURL});assert.equal(messages.length,beforeCap+1)
    await pool.query("UPDATE lifeos_password_reset_deliveries SET created_at=now()-interval '32 days'")
    const wasProduction=config.production
    try{config.production=true;await sendPasswordResetMail({user:{email:'tls-required@example.invalid'},url:dummyURL})}
    finally{config.production=wasProduction}
    assert.equal(messages.length,beforeCap+1,'production never falls back to plaintext SMTP')
    assert.equal((await pool.query("SELECT status FROM lifeos_password_reset_deliveries ORDER BY created_at DESC LIMIT 1")).rows[0].status,'unknown')
  } finally {
    await drainPasswordResetMail();Object.assign(config.mail,original);app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));await new Promise<void>(r=>smtp.close(r));await pool.end()
  }
})
