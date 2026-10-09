import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { pool } from './db.ts'
import { config } from './config.ts'

// 重置令牌暂存：邮件服务未接入前由 /api/auth/pending-reset 取回。
// 接入 Resend 等服务后改为发邮件并删除该表与 companion 端点。
const pendingResets = new Map<string, { token: string; url: string; at: number }>()
export function getPendingReset(email: string) {
  const entry = pendingResets.get(email.toLowerCase())
  if (!entry || Date.now() - entry.at > 10 * 60 * 1000) return null
  return entry
}

export const authOptions = {
  database: pool, secret: config.authSecret, baseURL: config.origin, trustedOrigins: [config.origin],
  emailAndPassword: {
    enabled: true, minPasswordLength: 12, disableSignUp: !config.signupEnabled,
    sendResetPassword: async ({ user, url }: { user: { email: string }, url: string }) => {
      const token = url.match(/\/reset-password\/([^?]+)/)?.[1] ?? ''
      pendingResets.set(user.email.toLowerCase(), { token, url, at: Date.now() })
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 7 },
  rateLimit: { enabled: true, window: 60, max: 30, storage: 'database' },
  telemetry: { enabled: false },
  advanced: { useSecureCookies: config.production, ipAddress: { ipAddressHeaders: ['x-lifeos-client-ip'] } },
} satisfies BetterAuthOptions
export const auth = betterAuth(authOptions)
