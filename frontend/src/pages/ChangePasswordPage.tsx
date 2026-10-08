import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth'
import { errorMessage } from '../api/manuals'
import type { User } from '../types/user'

export function ChangePasswordPage({forced = false, onChanged, onLogout}:{forced?:boolean; onChanged:(user:User)=>void; onLogout?:()=>void}) {
  const navigate = useNavigate()
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [show,setShow] = useState(false)
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if(busy) return
    const form = event.currentTarget
    const data = new FormData(form)
    const next = String(data.get('new_password') ?? '')
    if(next !== String(data.get('confirm_password') ?? '')) {setError('New passwords do not match.'); return}
    setBusy(true); setError('')
    try {
      const session = await authApi.changePassword(String(data.get('current_password') ?? ''), next)
      form.reset()
      onChanged(session.user)
      navigate('/projects', {replace:true})
    } catch(err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }
  const type = show ? 'text' : 'password'
  return <div className="flex items-center justify-center px-5 py-12">
    <div className="panel w-full max-w-md p-8">
      <h1 className="text-2xl font-semibold">Change Password</h1>
      {forced && <p className="mt-2 text-sm text-slate-500">You must set a new password before continuing.</p>}
      <form onSubmit={submit} className="mt-6"><fieldset disabled={busy} className="space-y-5">
        <label className="field">Current Password<input name="current_password" type={type} required maxLength={128} autoComplete="current-password" autoFocus /></label>
        <label className="field">New Password<input name="new_password" type={type} required minLength={12} maxLength={128} autoComplete="new-password" /></label>
        <label className="field">Confirm New Password<input name="confirm_password" type={type} required minLength={12} maxLength={128} autoComplete="new-password" /></label>
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={show} onChange={event => setShow(event.target.checked)} />Show passwords</label>
        <p className="text-xs text-slate-500">Use at least 12 characters.</p>
        {error && <p role="alert" className="error">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Change Password'}</button>
        {onLogout && <button type="button" className="btn-secondary w-full" onClick={onLogout}>Log out</button>}
      </fieldset></form>
    </div>
  </div>
}
