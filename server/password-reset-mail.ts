import nodemailer from 'nodemailer'
import { createHmac, randomUUID } from 'node:crypto'
import { config, mailConfigured } from './config.ts'
import { pool } from './db.ts'
import {RequestScheduler} from './request-scheduler.ts'

export const passwordResetMailLimits={daily:80,monthly:900,perRecipientHourly:3,cooldownSeconds:60} as const
const pendingDeliveries=new Set<Promise<void>>()
const deliveryScheduler=new RequestScheduler(2,80)
const stopping=new AbortController()
export function queuePasswordResetMail(input:{user:{email:string};url:string}):Promise<void>{
  const delivery=(async()=>{
    const recipient=createHmac('sha256',config.authSecret).update(input.user.email.trim().toLowerCase()).digest('hex')
    const release=await deliveryScheduler.acquire(recipient,stopping.signal)
    try{await sendPasswordResetMail(input)}finally{release()}
  })().catch(()=>{console.warn('PASSWORD_RESET_MAIL_DELIVERY_UNCONFIRMED')})
  pendingDeliveries.add(delivery)
  void delivery.then(()=>pendingDeliveries.delete(delivery))
  // Existing and absent accounts receive the same response without waiting for
  // SMTP. The durable reservation still gates every actual network dispatch.
  return Promise.resolve()
}
export async function drainPasswordResetMail(){await Promise.allSettled([...pendingDeliveries])}
export async function stopPasswordResetMail(){stopping.abort('PASSWORD_RESET_MAIL_STOPPING');await drainPasswordResetMail()}

async function reserve(email:string) {
  const recipientHash=createHmac('sha256',config.authSecret).update(email.trim().toLowerCase()).digest('hex')
  const client=await pool.connect()
  try {
    await client.query('BEGIN')
    // Rolling limits stay below provider calendar quotas across time zones.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('lifeos-password-reset-mail'))")
    const {rows:[counts]}=await client.query(`SELECT
      count(*) FILTER(WHERE created_at>now()-interval '24 hours')::int AS daily,
      count(*) FILTER(WHERE created_at>now()-interval '31 days')::int AS monthly,
      count(*) FILTER(WHERE recipient_hash=$1 AND created_at>now()-interval '1 hour')::int AS recipient,
      count(*) FILTER(WHERE recipient_hash=$1 AND created_at>now()-interval '60 seconds')::int AS cooldown
      FROM lifeos_password_reset_deliveries WHERE created_at>now()-interval '31 days'`,[recipientHash])
    const l=passwordResetMailLimits
    if(counts.daily>=l.daily||counts.monthly>=l.monthly||counts.recipient>=l.perRecipientHourly||counts.cooldown){await client.query('ROLLBACK');return null}
    const id=randomUUID()
    await client.query("INSERT INTO lifeos_password_reset_deliveries(id,recipient_hash,status) VALUES($1,$2,'reserved')",[id,recipientHash])
    await client.query('COMMIT');return id
  } catch(error) { await client.query('ROLLBACK');throw error }
  finally {client.release()}
}

export async function sendPasswordResetMail({user,url}:{user:{email:string};url:string}) {
  if(!mailConfigured())throw new Error('PASSWORD_RESET_UNAVAILABLE')
  const link=new URL(url)
  if(link.origin!==config.origin||!/^\/api\/auth\/reset-password\/[a-zA-Z0-9_-]{16,200}$/.test(link.pathname))throw new Error('PASSWORD_RESET_LINK_INVALID')
  // Never let a requester select where the bearer token is redirected.
  const emailLink=config.origin+'/#reset?token='+encodeURIComponent(link.pathname.split('/').at(-1)!)
  let id:string|null=null
  try {
    id=await reserve(user.email)
    if(!id)return
    const m=config.mail
    const transporter=nodemailer.createTransport({host:m.host,port:m.port,secure:m.port===465,
      requireTLS:m.port!==465&&(config.production||!['localhost','127.0.0.1','::1'].includes(m.host)),
      auth:{user:m.user,pass:m.password},
      connectionTimeout:10000,greetingTimeout:10000,socketTimeout:10000,dnsTimeout:5000,
      logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true,maxRecipients:1,
    })
    try {
      const result=await transporter.sendMail({from:{name:'LifeOS',address:m.from},to:user.email,
        subject:'重置你的 LifeOS 密码',
        headers:{'Resend-Idempotency-Key':'lifeos-password-reset/'+id},
        text:`你好，\n\n请打开以下链接，为你的 LifeOS 账户设置新密码：\n\n${emailLink}\n\n链接在申请后 15 分钟内有效，只能使用一次。重置后，原有登录会话会失效。\n\n如果不是你申请的，请忽略这封邮件，你的密码不会改变。\n\nLifeOS`,
      })
      if(!result.accepted?.length)throw new Error('PASSWORD_RESET_MAIL_NOT_ACCEPTED')
      await pool.query("UPDATE lifeos_password_reset_deliveries SET status='sent',settled_at=now() WHERE id=$1",[id])
    } finally {transporter.close()}
  } catch {
    // Preserve the reservation even if the SMTP result or DB settlement is lost.
    // Do not expose whether this mailbox exists, tokens, or SMTP error/credentials.
    if(id)await pool.query("UPDATE lifeos_password_reset_deliveries SET status='unknown',settled_at=now() WHERE id=$1",[id]).catch(()=>{})
    console.warn('PASSWORD_RESET_MAIL_DELIVERY_UNCONFIRMED')
  }
}
