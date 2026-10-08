import { useState, type FormEvent } from 'react'
import { Dialog } from './Dialog'

export function ForgotPasswordDialog({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState('')
  const [confirmed, setConfirmed] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = username.trim()
    if (!trimmed) return
    setConfirmed(trimmed)
  }

  if (confirmed) {
    return <Dialog title="Forgot Password" onClose={onClose}>
      <div className="space-y-4 px-6 py-5">
        <p className="text-sm text-slate-700">Tell your administrator this account needs a password reset:</p>
        <p className="rounded-md bg-slate-50 p-3 text-center text-lg font-semibold text-slate-900">{confirmed}</p>
        <p className="text-xs text-slate-500">Only an administrator can reset a password.</p>
      </div>
      <div className="modal-footer"><button type="button" className="btn-primary" onClick={onClose}>Close</button></div>
    </Dialog>
  }

  return <Dialog title="Forgot Password" onClose={onClose}>
    <form onSubmit={submit}>
      <fieldset className="space-y-5 px-6 py-5">
        <p className="text-sm text-slate-600">Enter your username to confirm which account needs a password reset, then share it with your administrator.</p>
        <label className="field">Username
          <input value={username} onChange={event => setUsername(event.target.value)} required maxLength={100} autoFocus placeholder="Your username" />
        </label>
      </fieldset>
      <div className="modal-footer"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary">Confirm</button></div>
    </form>
  </Dialog>
}
