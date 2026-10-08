import { useState, type FormEvent } from 'react'
import { authApi } from '../api/auth'
import { errorMessage } from '../api/manuals'
import type { User } from '../types/user'
import { FolderArtwork } from '../components/FolderArtwork'
import { Icon } from '../components/Icon'
import { ForgotPasswordDialog } from '../components/ForgotPasswordDialog'

export function LoginPage({onLoggedIn}:{onLoggedIn:(user:User)=>void}) {
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [forgot,setForgot] = useState(false)
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if(busy) return
    const form = event.currentTarget
    const data = new FormData(form)
    setBusy(true); setError('')
    try {
      const session = await authApi.login(String(data.get('username') ?? '').trim(), String(data.get('password') ?? ''))
      form.reset()
      onLoggedIn(session.user)
    } catch(err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }
  return <main className="login-shell">
    <section className="login-intro">
      <div className="brand"><Icon name="book" size={34} /><span>Manual<br />Management</span></div>
      <FolderArtwork />
      <h2>Controlled documents.<br />Clear workflows.</h2>
      <p>A shared workspace for project manuals, revision reviews and published documents.</p>
    </section>
    <div className="login-form-area"><div className="panel">
      <p className="text-sm font-semibold text-blue-900">Manual Management</p>
      <h1 className="mt-4 text-2xl font-semibold">Log in</h1>
      <p className="mt-2 text-sm text-slate-500">Sign in to manage your projects and manuals.</p>
      <form onSubmit={submit} className="mt-6"><fieldset disabled={busy} className="space-y-5">
        <label className="field">Username<input name="username" required maxLength={100} autoComplete="username" autoFocus /></label>
        <label className="field">Password<input name="password" type="password" required maxLength={128} autoComplete="current-password" /></label>
        {error && <p role="alert" className="error">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
      </fieldset></form>
      <button type="button" className="mt-4 text-sm text-blue-800 underline" onClick={() => setForgot(true)}>Forgot password?</button>
      <p className="mt-6 text-xs leading-5 text-slate-500">Contact your administrator if you need an account.</p>
    </div></div>
    {forgot && <ForgotPasswordDialog onClose={() => setForgot(false)} />}
  </main>
}
