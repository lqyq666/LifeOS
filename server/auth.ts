import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { pool } from './db.ts'
import { config } from './config.ts'
export const authOptions = {
  database: pool, secret: config.authSecret, baseURL: config.origin, trustedOrigins: [config.origin],
  emailAndPassword: { enabled: true, minPasswordLength: 12, disableSignUp: !config.signupEnabled },
  session: { expiresIn: 60 * 60 * 24 * 7 },
  rateLimit: { enabled: true, window: 60, max: 30, storage: 'database' },
  telemetry: { enabled: false },
  advanced: { useSecureCookies: config.production, ipAddress: { ipAddressHeaders: ['x-lifeos-client-ip'] } },
} satisfies BetterAuthOptions
export const auth = betterAuth(authOptions)
