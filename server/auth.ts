import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { pool } from './db.ts'
import { config } from './config.ts'
import { queuePasswordResetMail } from './password-reset-mail.ts'

async function retainCurrentPasswordResetToken(userId:string,token:string){
  const client=await pool.connect(),identifier='reset-password:'+token
  try{
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",['lifeos-password-reset',userId])
    const current=await client.query('SELECT 1 FROM "verification" WHERE value=$1 AND identifier=$2 AND "expiresAt">now()',[userId,identifier])
    if(current.rowCount!==1)throw new Error('PASSWORD_RESET_TOKEN_NOT_PERSISTED')
    await client.query('DELETE FROM "verification" WHERE value=$1 AND identifier LIKE $2 AND identifier<>$3',[userId,'reset-password:%',identifier])
    await client.query('COMMIT')
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}
  finally{client.release()}
}

async function clearPasswordResetTokens(userId:string){
  const sql='DELETE FROM "verification" WHERE value=$1 AND identifier LIKE $2',values=[userId,'reset-password:%']
  try{await pool.query(sql,values);return}
  catch{
    // Retry on a separately acquired connection. A transient pool.query error
    // must not leave a second, still-live reset token behind.
    let client:any
    try{
      client=await pool.connect()
      await client.query(sql,values)
      return
    }catch{
      console.error('[PASSWORD_RESET_TOKEN_CLEANUP_FAILED]')
      // This callback runs after the password update. Returning lets Better
      // Auth continue to its built-in session revocation instead of leaving
      // old sessions active by short-circuiting the route.
    }finally{client?.release()}
  }
}

export const authOptions = {
  database: pool, secret: config.authSecret, baseURL: config.origin, trustedOrigins: [config.origin],
  emailAndPassword: {
    enabled: true, minPasswordLength: 6, maxPasswordLength:128, disableSignUp: !config.signupEnabled,
    resetPasswordTokenExpiresIn:15*60,revokeSessionsOnPasswordReset:true,
    sendResetPassword:async({user,url,token})=>{
      try{await retainCurrentPasswordResetToken(user.id,token)}
      catch{console.error('[PASSWORD_RESET_SINGLE_TOKEN_ENFORCEMENT_FAILED]');return}
      await queuePasswordResetMail({user,url})
    },
    onPasswordReset:async({user})=>{await clearPasswordResetTokens(user.id)},
  },
  session: { expiresIn: 60 * 60 * 24 * 7 },
  rateLimit: { enabled: true, window: 60, max: 30, storage: 'database', customRules:{'/request-password-reset':{window:60,max:3},'/reset-password':{window:60,max:5}} },
  telemetry: { enabled: false },
  logger:{level:'error'},
  hooks:{before:createAuthMiddleware(async ctx=>{
    const redirect=ctx.path==='/request-password-reset'?ctx.body?.redirectTo:ctx.path.startsWith('/reset-password/')?ctx.query?.callbackURL:undefined
    if(redirect!==undefined&&redirect!==config.origin+'/#reset')throw new APIError('FORBIDDEN',{code:'RESET_REDIRECT_INVALID',message:'Invalid password recovery redirect'})
  })},
  advanced: { useSecureCookies: config.production, ipAddress: { ipAddressHeaders: ['x-lifeos-client-ip'] } },
} satisfies BetterAuthOptions
export const auth = betterAuth(authOptions)
