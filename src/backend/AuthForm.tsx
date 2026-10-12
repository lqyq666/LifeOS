import { useEffect, useRef, useState, type FormEvent } from 'react'
import { api, ApiError, explainError } from './client'
import './auth.css'

export type AuthMode = 'welcome' | 'login' | 'signup' | 'forgot' | 'reset'

function authError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_EMAIL_OR_PASSWORD') return '邮箱或密码不正确，请检查后重试。'
    if (error.code.startsWith('USER_ALREADY_EXISTS')) return '这个邮箱已注册，可以直接登录。'
    if (error.code === 'INVALID_EMAIL') return '请输入有效的邮箱地址。'
    if (error.code === 'PASSWORD_TOO_SHORT') return '密码至少需要 12 个字符。'
    if (error.code === 'PASSWORD_TOO_LONG') return '密码最多支持 128 个字符。'
    if (error.code === 'INVALID_TOKEN') return '链接已过期或已使用，请重新申请重置邮件。'
    if (error.code === 'SIGN_UP_DISABLED') return '当前为小范围试运行，请使用已开通的账户登录。'
    if (error.code === 'PASSWORD_RESET_UNAVAILABLE') return '暂不支持邮件找回密码，请联系为你开通账户的管理员。'
    if (error.status === 429) return '尝试次数较多，请稍后再试。'
  }
  return explainError(error)
}

export function AuthForm({ mode, onModeChange, onDone, onCancel }: {
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
  onDone: () => Promise<void>
  onCancel: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const emailInput = useRef<HTMLInputElement>(null)
  const newPasswordInput = useRef<HTMLInputElement>(null)
  const authenticated = useRef(false)
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [name, setName] = useState('')
  const [newPassword, setNewPassword] = useState(''), [confirmPassword, setConfirmPassword] = useState('')
  const [resetToken, setResetToken] = useState(() => mode==='reset' ? new URLSearchParams(window.location.hash.split('?')[1]??'').get('token')??'' : '')
  const [resetComplete,setResetComplete]=useState(false)
  const [notice, setNotice] = useState(() => mode==='reset'&&!new URLSearchParams(window.location.hash.split('?')[1]??'').get('token') ? '链接已过期或无效，请重新申请重置邮件。' : ''), [busy, setBusy] = useState(false), [showPassword, setShowPassword] = useState(false)
  const [signupEnabled, setSignupEnabled] = useState<boolean | null>(null)
  const [passwordResetEnabled, setPasswordResetEnabled] = useState(false)
  const signup = mode === 'signup'
  const forgot = mode === 'forgot'
  const reset = mode === 'reset'
  useEffect(() => { let current = true; api<{ signupEnabled: boolean; passwordResetEnabled: boolean }>('/api/access-policy').then(value => { if (current) { setSignupEnabled(value.signupEnabled); setPasswordResetEnabled(value.passwordResetEnabled === true) } }).catch(() => {}); return () => { current = false } }, [])
  useEffect(() => { if (signupEnabled === false && mode === 'signup') onModeChange('login') }, [signupEnabled, mode, onModeChange])

  useEffect(() => {
    dialog.current?.showModal()
    // Read the emailed token once, then remove it from the visible URL/history.
    const url=new URL(window.location.href)
    if(url.hash.split('?')[0]==='#reset'){url.searchParams.delete('token');url.searchParams.delete('error');window.history.replaceState(null,'',url.pathname+url.search+'#reset')}
    return () => dialog.current?.close()
  }, [])
  useEffect(() => {
    if (mode === 'welcome') heading.current?.focus()
    else if(mode==='reset')(newPasswordInput.current??heading.current)?.focus()
    else emailInput.current?.focus()
  }, [mode])
  function switchMode(next: AuthMode) {
    setNotice(''); setPassword(''); setNewPassword(''); setConfirmPassword(''); setShowPassword(false);setResetToken('');setResetComplete(false); onModeChange(next)
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setNotice('')
    try {
      if (forgot) {
        if (!passwordResetEnabled) { setNotice('暂不支持邮件找回密码，请联系为你开通账户的管理员。'); return }
        await api('/api/auth/request-password-reset', { email: email.trim(), redirectTo: window.location.origin+'/#reset' })
        setNotice('如果该邮箱已注册，我们会发送重置链接。请查看收件箱和垃圾邮件；链接在 15 分钟内有效。')
        return
      }
      if (reset) {
        if (!resetToken) { setNotice('链接已过期或无效，请重新申请重置邮件。');return }
        if (newPassword.length < 12) { setNotice('密码至少需要 12 个字符。'); return }
        if (newPassword !== confirmPassword) { setNotice('两次输入的密码不一致。'); return }
        await api('/api/auth/reset-password', { newPassword, token: resetToken })
        setNotice('密码已重置，原有登录会话已退出。请用新密码登录。');setResetComplete(true)
        setResetToken(''); setNewPassword(''); setConfirmPassword('')
        return
      }
      if (!authenticated.current) {
        await api('/api/auth/' + (signup ? 'sign-up/email' : 'sign-in/email'), {
          email: email.trim(), password, ...(signup ? { name: name.trim() || email.trim().split('@')[0] } : {}),
        })
        authenticated.current = true
      }
      await onDone()
      setPassword('')
    } catch (error) {
      setNotice(authenticated.current ? '账户已登录，内容暂时未能加载。请重试。' : authError(error))
    } finally { setBusy(false) }
  }

  const title = forgot ? '重置密码' : reset ? '设置新密码' : mode === 'welcome' ? '欢迎来到 LifeOS' : signup ? '创建你的账户' : '欢迎回来'
  const description = forgot ? (passwordResetEnabled ? '输入注册邮箱，我们会把重置链接发送给你。' : '请联系为你开通账户的管理员协助处理。') : reset ? '输入新密码，至少 12 个字符。' : mode === 'welcome' ? '让对话和经历，陪你继续成长。' : signup ? '从一次对话，开始记录你的成长。' : '继续你的对话与成长记录。'

  return <dialog ref={dialog} className="lifeos-auth" aria-labelledby="auth-title" aria-describedby="auth-description"
    onCancel={event => { event.preventDefault(); if (!busy) onCancel() }}>
    <div className="auth-layout">
      <button className="auth-close" type="button" onClick={onCancel} disabled={busy} aria-label="关闭登录">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
      <section className="auth-content">
        <svg className="auth-symbol" viewBox="0 0 42 42" fill="none" aria-hidden="true"><ellipse cx="21" cy="21" rx="19" ry="7.8" transform="rotate(-28 21 21)" /><ellipse cx="21" cy="21" rx="8" ry="19" transform="rotate(-28 21 21)" /><circle cx="21" cy="21" r="3.2" /></svg>
        <h1 ref={heading} tabIndex={-1} id="auth-title">{title}</h1>
        <p id="auth-description">{description}</p>
        {mode === 'welcome' ? <div className="auth-options">
          <button type="button" className="auth-button is-primary" onClick={() => switchMode('login')}>登录<svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          {signupEnabled === true && <button type="button" className="auth-button is-secondary" onClick={() => switchMode('signup')}>创建账户</button>}
          {signupEnabled === false && <p className="auth-hint">当前通过邀请开通，请使用已开通的账户登录。</p>}
        </div> : <>
          {reset && !resetToken ? <div className="auth-options"><p className="auth-notice" role="status">{notice}</p><button type="button" className="auth-button is-primary" onClick={()=>switchMode(resetComplete?'login':'forgot')}>{resetComplete?'前往登录':'重新申请重置邮件'}</button></div> : forgot && !passwordResetEnabled ? <p className="auth-notice" role="status">暂不支持邮件找回密码，请联系为你开通账户的管理员。</p> : <form className="auth-form qa-auth-form" onSubmit={submit} aria-label={forgot ? '重置密码' : reset ? '设置新密码' : signup ? '创建账户' : '邮箱登录'} aria-busy={busy}>
            {signup && <label htmlFor="auth-name">称呼<span className="auth-optional">可选</span><input id="auth-name" aria-label="称呼" value={name} onChange={event => setName(event.target.value)} autoComplete="nickname" maxLength={80} disabled={busy || authenticated.current} /></label>}
            {!reset && <label htmlFor="auth-email">邮箱<input ref={emailInput} id="auth-email" type="email" required value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="name@example.com" maxLength={254} disabled={busy || authenticated.current} aria-describedby={notice ? 'auth-notice' : undefined} /></label>}
            {reset && <label htmlFor="auth-new-password">新密码<span className="auth-password-field"><input ref={newPasswordInput} id="auth-new-password" type="password" required minLength={12} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" disabled={busy} /></span></label>}
            {reset && <label htmlFor="auth-confirm-password">确认密码<span className="auth-password-field"><input id="auth-confirm-password" type="password" required minLength={12} maxLength={128} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} autoComplete="new-password" disabled={busy} /></span></label>}
            {!forgot && !reset && <label htmlFor="auth-password">密码<span className="auth-password-field"><input id="auth-password" aria-label="密码" type={showPassword ? 'text' : 'password'} required minLength={signup ? 12 : undefined} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} disabled={busy || authenticated.current} aria-describedby={signup ? 'auth-password-hint' : undefined} /><button className="auth-password-toggle" type="button" disabled={busy || authenticated.current} onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword} aria-controls="auth-password"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z" stroke="currentColor" strokeWidth="1.4" /><circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.4" />{showPassword && <path d="m4 4 16 16" stroke="currentColor" strokeWidth="1.4" />}</svg></button></span></label>}
            {(signup || reset) && <p className="auth-hint" id="auth-password-hint">至少 12 个字符</p>}
            {notice && <p className="auth-notice" role="alert" id="auth-notice">{notice}</p>}
            <button type="submit" className="auth-button is-primary" disabled={busy}>{busy ? (forgot ? '正在申请…' : reset ? '正在重置…' : '正在连接…') : authenticated.current ? '重试加载' : forgot ? '发送重置邮件' : reset ? '重置密码' : signup ? '创建账户' : '登录'}</button>
          </form>}
          {!authenticated.current && !forgot && !reset && signupEnabled === true && <p className="auth-switch">{signup ? '已有账户？' : '还没有账户？'}<button type="button" onClick={() => switchMode(signup ? 'login' : 'signup')} disabled={busy}>{signup ? '登录' : '创建账户'}</button></p>}
          {!authenticated.current && mode === 'login' && <p className="auth-switch"><button type="button" onClick={() => switchMode('forgot')} disabled={busy}>忘记密码？</button></p>}
        </>}
        <button className="auth-back" type="button" onClick={mode === 'welcome' ? onCancel : () => switchMode('welcome')} disabled={busy}>返回{mode === 'welcome' ? '首页' : '上一页'}</button>
      </section>
      <footer className="auth-footer">LifeOS Campus</footer>
    </div>
  </dialog>
}
