import { useEffect, useState, type FormEvent } from 'react'
import { adminApi, usersApi } from '../api/auth'
import { errorMessage } from '../api/manuals'
import { Dialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { TableRowSkeleton } from '../components/Skeleton'
import type { SystemRole, User, UserInput } from '../types/user'

interface SystemOverview {
  total_users: number
  active_users: number
  total_projects: number
  active_projects: number
  total_manuals: number
  total_revisions: number
  active_sessions: number
  cache_status: string
}

export function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [overview, setOverview] = useState<SystemOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [busy, setBusy] = useState(false)
  const [adminActionBusy, setAdminActionBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [message, setMessage] = useState('')
  const [reload, setReload] = useState(0)
  const [resetTarget, setResetTarget] = useState<User | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')

    Promise.allSettled([
      usersApi.list(),
      adminApi.getOverview(),
    ]).then(([usersRes, overviewRes]) => {
      if (!active) return
      if (usersRes.status === 'fulfilled') {
        setUsers(usersRes.value)
      } else {
        setError(errorMessage(usersRes.reason))
      }
      if (overviewRes.status === 'fulfilled') {
        setOverview(overviewRes.value)
      }
    }).finally(() => {
      if (active) setLoading(false)
    })

    return () => {
      active = false
    }
  }, [reload])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const data = new FormData(form)
    const input: UserInput = {
      username: String(data.get('username') ?? '').trim(),
      display_name: String(data.get('display_name') ?? '').trim(),
      password: String(data.get('password') ?? ''),
      role: (data.get('role') as SystemRole) || 'USER',
    }
    setBusy(true)
    setFormError('')
    try {
      await usersApi.create(input)
      form.reset()
      setCreating(false)
      setMessage('User created successfully.')
      setReload(value => value + 1)
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function submitEditUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !editingUser) return
    const form = event.currentTarget
    const data = new FormData(form)
    const displayName = String(data.get('display_name') ?? '').trim()
    const role = (data.get('role') as SystemRole) || 'USER'
    const isActive = data.get('is_active') === 'true'

    setBusy(true)
    setFormError('')
    try {
      await usersApi.update(editingUser.id, {
        display_name: displayName,
        role,
        is_active: isActive,
      })
      setMessage(`Updated user "${editingUser.username}" to Role: ${role} (${isActive ? 'Active' : 'Inactive'}).`)
      setEditingUser(null)
      setReload(v => v + 1)
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function closeReset() {
    setResetTarget(null)
    setShowPassword(false)
    setFormError('')
  }

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !resetTarget) return
    const form = event.currentTarget
    const data = new FormData(form)
    const password = String(data.get('temporary_password') ?? '')
    if (password !== String(data.get('confirm_password') ?? '')) {
      setFormError('Temporary passwords do not match.')
      return
    }
    setBusy(true)
    setFormError('')
    try {
      await usersApi.resetPassword(resetTarget.id, password)
      form.reset()
      setMessage(`Password reset for ${resetTarget.username}. They must change it at next login.`)
      closeReset()
    } catch (err) {
      setFormError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleFlushCache() {
    setAdminActionBusy(true)
    try {
      const res = await adminApi.flushCache()
      setMessage(res.message || 'System cache invalidated.')
      setReload(v => v + 1)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setAdminActionBusy(false)
    }
  }

  async function handleCleanup() {
    if (!window.confirm('Run database cleanup to clear expired sessions and sync caches?')) return
    setAdminActionBusy(true)
    try {
      const res = await adminApi.cleanupStaleData()
      setMessage(res.message || 'Cleanup completed.')
      setReload(v => v + 1)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setAdminActionBusy(false)
    }
  }

  function getRoleBadge(role: SystemRole | string) {
    switch (role) {
      case 'ADMIN':
        return <span className="inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold bg-purple-100 text-purple-900 border border-purple-200">Admin (Superuser)</span>
      case 'BA':
        return <span className="inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold bg-blue-100 text-blue-900 border border-blue-200">BA (Business Analyst)</span>
      case 'DEV':
        return <span className="inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-900 border border-emerald-200">Dev (Developer)</span>
      case 'USER':
      default:
        return <span className="inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">User (Viewer)</span>
    }
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Users & Role Management</h1>
          <p className="mt-2 text-sm text-slate-500">
            Manage user accounts, assign team roles (BA, Dev, Admin, User), and maintain database/cache state.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="btn-secondary"
            disabled={adminActionBusy}
            onClick={handleFlushCache}
            title="Purge Redis and query cache generation"
          >
            <Icon name="refresh" size={16} />
            Flush Cache
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={adminActionBusy}
            onClick={handleCleanup}
            title="Clean expired sessions and stale data"
          >
            <Icon name="trash" size={16} />
            Clean Stale Data
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              setFormError('')
              setCreating(true)
            }}
          >
            <Icon name="plus" size={16} />
            Add User
          </button>
        </div>
      </div>

      {/* System Stats Bar */}
      {overview && (
        <div className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="panel p-4">
            <span className="text-xs font-medium text-slate-500 uppercase">Users</span>
            <p className="text-2xl font-bold text-slate-900 mt-1">
              {overview.active_users} <span className="text-xs font-normal text-slate-400">/ {overview.total_users} total</span>
            </p>
          </div>
          <div className="panel p-4">
            <span className="text-xs font-medium text-slate-500 uppercase">Projects</span>
            <p className="text-2xl font-bold text-slate-900 mt-1">
              {overview.active_projects} <span className="text-xs font-normal text-slate-400">active</span>
            </p>
          </div>
          <div className="panel p-4">
            <span className="text-xs font-medium text-slate-500 uppercase">Manuals</span>
            <p className="text-2xl font-bold text-slate-900 mt-1">
              {overview.total_manuals} <span className="text-xs font-normal text-slate-400">({overview.total_revisions} revs)</span>
            </p>
          </div>
          <div className="panel p-4">
            <span className="text-xs font-medium text-slate-500 uppercase">Cache Layer</span>
            <p className="text-lg font-bold text-emerald-700 mt-1 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              {overview.cache_status === 'connected' ? 'Redis Active' : 'DB / In-Memory'}
            </p>
          </div>
        </div>
      )}

      {message && (
        <p role="status" className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </p>
      )}

      {error && (
        <div role="alert" className="error mb-5">
          <p>{error}</p>
          <button className="btn-secondary btn-small mt-3" onClick={() => setReload(value => value + 1)}>
            Retry
          </button>
        </div>
      )}

      <div className="panel overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
            <tr>
              {['Username', 'Display Name', 'Assigned Role', 'Status', 'Actions'].map(label => (
                <th key={label} className="px-5 py-4 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>
                <TableRowSkeleton cols={5} />
                <TableRowSkeleton cols={5} />
                <TableRowSkeleton cols={5} />
              </>
            ) : (
              users.map(user => (
                <tr key={user.id} className="border-b border-slate-100">
                  <td className="px-5 py-4 font-semibold text-slate-900">{user.username}</td>
                  <td className="px-5 py-4 text-slate-700">{user.display_name}</td>
                  <td className="px-5 py-4">
                    {getRoleBadge(user.role)}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        user.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        className="btn-secondary btn-small"
                        aria-label={`Change Role for ${user.username}`}
                        onClick={() => {
                          setFormError('')
                          setMessage('')
                          setEditingUser(user)
                        }}
                      >
                        Change Role
                      </button>
                      <button
                        className="btn-secondary btn-small text-slate-600"
                        aria-label={`Reset Password for ${user.username}`}
                        onClick={() => {
                          setFormError('')
                          setMessage('')
                          setResetTarget(user)
                        }}
                      >
                        Reset Password
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add User Modal */}
      {creating && (
        <Dialog title="Add User" onClose={() => setCreating(false)} busy={busy}>
          <form onSubmit={submit}>
            <fieldset disabled={busy} className="space-y-5 px-6 py-5">
              <label className="field">
                Username
                <input name="username" required maxLength={100} autoComplete="off" autoFocus placeholder="e.g. ba_somchai or dev_anand" />
              </label>
              <label className="field">
                Display Name
                <input name="display_name" required maxLength={255} placeholder="e.g. Somchai (BA Team Lead)" />
              </label>
              <label className="field">
                Password
                <input
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <p className="text-xs text-slate-500">Use at least 12 characters.</p>
              <label className="field">
                Role (บทบาทการทำงาน)
                <select name="role" defaultValue="USER">
                  <option value="USER">User (End User / Viewer — ค้นหา ดู Preview และดาวน์โหลดคู่มือฉบับประกาศใช้)</option>
                  <option value="BA">BA (Business Analyst — จัดการ Template, ยกร่าง, Edit ฉบับสมบูรณ์, ตรวจสอบ, อนุมัติ & Publish)</option>
                  <option value="DEV">Dev (Developer — โหลด Template, สร้าง Manual, ยกร่างเบื้องต้น, ส่งตรวจ Submit Review)</option>
                  <option value="ADMIN">Admin (Superuser — ผู้ดูแลระบบสูงสุด เข้าถึงได้ทุกโปรเจกต์และฐานข้อมูล)</option>
                </select>
              </label>
              {formError && <p role="alert" className="error">{formError}</p>}
            </fieldset>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setCreating(false)} disabled={busy}>
                Cancel
              </button>
              <button className="btn-primary" disabled={busy}>
                {busy ? 'Creating…' : 'Create User'}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {/* Change Role / Edit User Modal */}
      {editingUser && (
        <Dialog title={`Change Role: ${editingUser.username}`} onClose={() => setEditingUser(null)} busy={busy}>
          <form onSubmit={submitEditUser}>
            <fieldset disabled={busy} className="space-y-5 px-6 py-5">
              <label className="field">
                Display Name
                <input
                  name="display_name"
                  defaultValue={editingUser.display_name}
                  required
                  maxLength={255}
                  autoFocus
                />
              </label>
              <label className="field">
                Role (บทบาทการทำงาน)
                <select name="role" defaultValue={editingUser.role}>
                  <option value="BA">BA (Business Analyst — จัดการ Template, ยกร่าง, Edit ฉบับสมบูรณ์, ตรวจสอบ, อนุมัติ & Publish)</option>
                  <option value="DEV">Dev (Developer — โหลด Template, สร้าง Manual, ยกร่างเบื้องต้น, ส่งตรวจ Submit Review)</option>
                  <option value="ADMIN">Admin (Superuser — ผู้ดูแลระบบสูงสุด เข้าถึงได้ทุกโปรเจกต์และฐานข้อมูล)</option>
                  <option value="USER">User (End User / Viewer — ค้นหา ดู Preview และดาวน์โหลดคู่มือฉบับประกาศใช้)</option>
                </select>
              </label>
              <label className="field">
                Account Status
                <select name="is_active" defaultValue={editingUser.is_active ? 'true' : 'false'}>
                  <option value="true">Active (Can log in)</option>
                  <option value="false">Inactive (Suspended)</option>
                </select>
              </label>
              {formError && <p role="alert" className="error">{formError}</p>}
            </fieldset>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setEditingUser(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <Dialog title="Reset Password" onClose={closeReset} busy={busy}>
          <form onSubmit={submitReset}>
            <fieldset disabled={busy} className="space-y-5 px-6 py-5">
              <p className="text-sm text-slate-600">
                Set a temporary password for <strong>{resetTarget.username}</strong>. All their sessions will be signed
                out and they must change it at next login.
              </p>
              <label className="field">
                Temporary Password
                <input
                  name="temporary_password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  autoFocus
                />
              </label>
              <label className="field">
                Confirm Temporary Password
                <input
                  name="confirm_password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={event => setShowPassword(event.target.checked)}
                />
                Show passwords
              </label>
              <p className="text-xs text-slate-500">Use at least 12 characters.</p>
              {formError && <p role="alert" className="error">{formError}</p>}
            </fieldset>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={closeReset} disabled={busy}>
                Cancel
              </button>
              <button className="btn-primary" disabled={busy}>
                {busy ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  )
}
