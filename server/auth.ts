import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { pool } from './db.ts'
import { config } from './config.ts'
import { queuePasswordResetMail } from './password-reset-mail.ts'

async function clearPasswordResetTokens(userId:string){
  try{await pool.query('DELETE FROM "verification" WHERE value=$1 AND identifier LIKE $2',[userId,'reset-password:%'])}
  catch{
    // Better Auth revokes sessions immediately after this callback; do not short-circuit that security step.
    console.error('[PASSWORD_RESET_TOKEN_CLEANUP_FAILED]')
  }
}

export const authOptions = {
  database: pool, secret: config.authSecret, baseURL: config.origin, trustedOrigins: [config.origin],
  emailAndPassword: {
    enabled: true, minPasswordLength: 12, maxPasswordLength:128, disableSignUp: !config.signupEnabled,
    resetPasswordTokenExpiresIn:15*60,revokeSessionsOnPasswordReset:true,
    sendResetPassword:queuePasswordResetMail,
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
