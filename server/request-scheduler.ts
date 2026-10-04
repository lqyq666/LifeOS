import { HttpError } from './db.ts'

type Waiter = { user: string; signal: AbortSignal; resolve: (release: () => void) => void; reject: (reason: unknown) => void; cancel: () => void }

// Serial execution per account also protects writes shared across conversations.
// The database remains authoritative for request idempotency and conversation locks.
export class RequestScheduler {
  private readonly users = new Set<string>()
  private readonly waiting: Waiter[] = []
  constructor(private readonly concurrency: number, private readonly queueLimit: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32 || !Number.isInteger(queueLimit) || queueLimit < 0 || queueLimit > 256) throw new Error('Invalid generation scheduler limits')
  }
  acquire(user: string, signal: AbortSignal, onWait: () => void = () => {}): Promise<() => void> {
    signal.throwIfAborted()
    if (this.users.size < this.concurrency && !this.users.has(user) && !this.waiting.length) return Promise.resolve(this.grant(user))
    if (this.waiting.length >= this.queueLimit) return Promise.reject(new HttpError(503, 'MODEL_QUEUE_FULL', 5))
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { user, signal, resolve, reject, cancel: () => {
        const index = this.waiting.indexOf(waiter)
        if (index < 0) return
        this.waiting.splice(index, 1)
        signal.removeEventListener('abort', waiter.cancel)
        reject(signal.reason)
        this.pump()
      } }
      this.waiting.push(waiter)
      signal.addEventListener('abort', waiter.cancel, { once: true })
      try { onWait() } catch (error) {
        const index = this.waiting.indexOf(waiter)
        if (index >= 0) this.waiting.splice(index, 1)
        signal.removeEventListener('abort', waiter.cancel)
        reject(error)
      }
      this.pump()
    })
  }
  private grant(user: string): () => void {
    this.users.add(user)
    let released = false
    return () => {
      if (released) return
      released = true
      this.users.delete(user)
      this.pump()
    }
  }
  private pump() {
    while (this.users.size < this.concurrency) {
      const index = this.waiting.findIndex(waiter => !this.users.has(waiter.user))
      if (index < 0) return
      const [waiter] = this.waiting.splice(index, 1)
      waiter!.signal.removeEventListener('abort', waiter!.cancel)
      if (waiter!.signal.aborted) { waiter!.reject(waiter!.signal.reason); continue }
      waiter!.resolve(this.grant(waiter!.user))
    }
  }
}
