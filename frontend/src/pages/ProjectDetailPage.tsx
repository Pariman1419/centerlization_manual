import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { errorMessage } from '../api/manuals'
import { projectsApi } from '../api/projects'
import { Dialog } from '../components/Dialog'
import { ManualForm } from '../components/ManualForm'
import { ManualsList } from '../components/ManualsList'
import { StatusBadge } from '../components/StatusBadge'
import type { Manual } from '../types/manual'
import { atLeast } from '../lib/permissions'
import type { Project, ProjectMember, ProjectRole } from '../types/project'

const ROLE_OPTIONS: { value: ProjectRole; label: string }[] = [
  { value: 'OWNER', label: 'BA / Owner (Manage, Draft, Approve & Publish)' },
  { value: 'CONTRIBUTOR', label: 'Dev / Contributor (Create, Draft SOP, Submit)' },
  { value: 'REVIEWER', label: 'Reviewer (Review, Approve & Reject)' },
  { value: 'VIEWER', label: 'User / Viewer (Read & Download published manuals)' },
]

export function ProjectDetailPage() {
  const { projectId } = useParams()
  const id = Number(projectId)
  const navigate = useNavigate()
  const location = useLocation()
  const [project, setProject] = useState<Project | null>(null)
  const [manuals, setManuals] = useState<Manual[]>([])
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [params, setParams] = useSearchParams()
  const activeTab = params.get('tab') === 'members' ? 'members' : 'manuals'
  function setActiveTab(tab: 'manuals' | 'members') {
    setParams(previous => { const next = new URLSearchParams(previous); if (tab === 'members') next.set('tab', tab); else next.delete('tab'); return next }, { replace: true })
  }
  function onTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'manuals' : event.key === 'End' ? 'members' : activeTab === 'manuals' ? 'members' : 'manuals'
    setActiveTab(next)
    document.getElementById(`project-tab-${next}`)?.focus()
  }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [memberError, setMemberError] = useState('')
  const [creating, setCreating] = useState(false)
  const [reload, setReload] = useState(0)

  // Member management dialog state
  const [addingMember, setAddingMember] = useState(false)
  const [editingMember, setEditingMember] = useState<ProjectMember | null>(null)
  const [removingMember, setRemovingMember] = useState<ProjectMember | null>(null)
  const [busy, setBusy] = useState(false)
  const [memberFormError, setMemberFormError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setMemberError('')
    if (!Number.isSafeInteger(id) || id <= 0) {
      setError('Project not found')
      setLoading(false)
      return
    }
    Promise.all([
      projectsApi.get(id),
      projectsApi.manuals(id),
      projectsApi.members(id).catch(err => { if (active) setMemberError(errorMessage(err)); return [] as ProjectMember[] }),
    ])
      .then(([data, rows, memberRows]) => {
        if (active) {
          setProject(data)
          setManuals(rows)
          setMembers(memberRows)
        }
      })
      .catch(err => {
        if (active) setError(errorMessage(err))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [id, reload])

  const canManageMembers = atLeast(project?.my_role, 'OWNER')
  const canAddManual = atLeast(project?.my_role, 'CONTRIBUTOR')

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const data = new FormData(form)
    const username = String(data.get('username') || '').trim()
    const role = String(data.get('role') || 'VIEWER') as ProjectRole
    setBusy(true)
    setMemberFormError('')
    try {
      await projectsApi.addMember(id, { username, role })
      setAddingMember(false)
      setNotice(`Added ${username} to project members.`)
      setReload(r => r + 1)
    } catch (err) {
      setMemberFormError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleUpdateMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !editingMember) return
    const form = event.currentTarget
    const data = new FormData(form)
    const role = String(data.get('role') || '') as ProjectRole
    setBusy(true)
    setMemberFormError('')
    try {
      await projectsApi.updateMember(id, editingMember.user_id, role)
      setEditingMember(null)
      setNotice(`Updated role for ${editingMember.username} to ${role}.`)
      setReload(r => r + 1)
    } catch (err) {
      setMemberFormError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveMember() {
    if (busy || !removingMember) return
    setBusy(true)
    setMemberFormError('')
    try {
      await projectsApi.removeMember(id, removingMember.user_id)
      const removedName = removingMember.username
      setRemovingMember(null)
      setNotice(`Removed ${removedName} from project.`)
      setReload(r => r + 1)
    } catch (err) {
      setMemberFormError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return <>
    <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-2 text-sm text-slate-500">
      <Link to="/projects" className="hover:text-blue-800">Projects</Link>
      {project && <><span aria-hidden="true">/</span><span aria-current="page">{project.project_name}</span></>}
    </nav>
    {location.state?.message && (
      <p role="status" className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        {location.state.message}
      </p>
    )}
    {notice && (
      <p role="status" className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex items-center justify-between">
        <span>{notice}</span>
        <button type="button" aria-label="Dismiss notification" className="h-9 w-9 shrink-0 text-emerald-700 hover:text-emerald-900" onClick={() => setNotice('')}>&times;</button>
      </p>
    )}
    {error && (
      <div role="alert" className="error mb-5 flex items-center justify-between gap-4">
        <p>{error}</p>
        <button className="btn-secondary btn-small" onClick={() => setReload(value => value + 1)}>Retry</button>
      </div>
    )}
    {loading && <p className="py-10 text-center text-slate-500">Loading project…</p>}
    {!loading && !error && project && <>
      <div className="detail-heading panel mb-8 p-6">
        <h1 className="break-words text-3xl font-semibold tracking-tight text-slate-900">{project.project_name}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <p className="text-sm font-medium text-slate-500">{project.project_code}</p>
          <StatusBadge status={project.status} />
          {project.my_role && (
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 border border-slate-200">
              Role: {project.my_role}
            </span>
          )}
        </div>
        {project.description && (
          <p className="mt-4 max-w-3xl whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{project.description}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="project-tabs mb-6 flex border-b border-slate-200" role="tablist" aria-label="Project sections" onKeyDown={onTabKeyDown}>
        <button
          role="tab"
          id="project-tab-manuals"
          aria-controls="project-panel-manuals"
          tabIndex={activeTab === 'manuals' ? 0 : -1}
          aria-selected={activeTab === 'manuals'}
          className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'manuals'
              ? 'border-blue-600 text-blue-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
          }`}
          onClick={() => setActiveTab('manuals')}
        >
          Manuals ({manuals.length})
        </button>
        <button
          role="tab"
          id="project-tab-members"
          aria-controls="project-panel-members"
          tabIndex={activeTab === 'members' ? 0 : -1}
          aria-selected={activeTab === 'members'}
          className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'members'
              ? 'border-blue-600 text-blue-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
          }`}
          onClick={() => setActiveTab('members')}
        >
          Members ({memberError ? 'Unavailable' : members.length})
        </button>
      </div>

      {activeTab === 'manuals' && (
        <div id="project-panel-manuals" role="tabpanel" aria-labelledby="project-tab-manuals" tabIndex={0}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">Manuals</h2>
            {canAddManual && (
              <button className="btn-primary" onClick={() => setCreating(true)}>
                <span aria-hidden="true">+</span> Add Manual
              </button>
            )}
          </div>
          <ManualsList manuals={manuals} />
          {creating && (
            <Dialog title="Add Manual" onClose={() => setCreating(false)}>
              <ManualForm
                project={project}
                onCancel={() => setCreating(false)}
                onSaved={manual => {
                  setCreating(false)
                  navigate(`/manuals/${manual.id}`, { state: { message: 'Manual created successfully.' } })
                }}
              />
            </Dialog>
          )}
        </div>
      )}

      {activeTab === 'members' && (
        <div id="project-panel-members" role="tabpanel" aria-labelledby="project-tab-members" tabIndex={0}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Members</h2>
              <p className="mt-1 text-sm text-slate-500">Project members and their access permissions.</p>
            </div>
            {canManageMembers && (
              <button
                className="btn-primary"
                onClick={() => { setMemberFormError(''); setAddingMember(true) }}
              >
                <span aria-hidden="true">+</span> Add Member
              </button>
            )}
          </div>

          {memberError && <div role="alert" className="error mb-4 flex flex-wrap items-center justify-between gap-3"><p>Could not load project members. {memberError}</p><button className="btn-secondary btn-small" onClick={() => setReload(value => value + 1)}>Retry</button></div>}

          <div className="panel overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-5 py-4 font-medium">Username</th>
                  <th className="px-5 py-4 font-medium">Display Name</th>
                  <th className="px-5 py-4 font-medium">Role</th>
                  {canManageMembers && <th className="px-5 py-4 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={canManageMembers ? 4 : 3} className="p-8 text-center text-slate-500">
                      {memberError ? 'Member list is unavailable. Use Retry to load it again.' : 'No members assigned to this project.'}
                    </td>
                  </tr>
                ) : (
                  members.map(member => (
                    <tr key={member.id} className="border-b border-slate-100">
                      <td className="px-5 py-4 font-medium text-slate-900">{member.username}</td>
                      <td className="px-5 py-4 text-slate-600">{member.display_name}</td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-800 border border-slate-200">
                          {member.role === 'OWNER' ? 'BA / Owner' : member.role === 'CONTRIBUTOR' ? 'Dev / Contributor' : member.role}
                        </span>
                      </td>
                      {canManageMembers && (
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              className="btn-secondary btn-small"
                              onClick={() => {
                                setMemberFormError('')
                                setEditingMember(member)
                              }}
                            >
                              Change Role
                            </button>
                            <button
                              className="btn-secondary btn-small text-red-700 hover:text-red-800 hover:border-red-300 hover:bg-red-50"
                              onClick={() => {
                                setMemberFormError('')
                                setRemovingMember(member)
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Member Dialog */}
      {addingMember && (
        <Dialog title="Add Project Member" onClose={() => setAddingMember(false)} busy={busy}>
          <form onSubmit={handleAddMember}>
            <fieldset disabled={busy} className="space-y-4 px-6 py-5">
              <label className="field">
                Username
                <input
                  name="username"
                  required
                  maxLength={100}
                  placeholder="e.g. jdoe"
                  autoFocus
                />
              </label>
              <label className="field">
                Role (บทบาทในโปรเจกต์)
                <select name="role" defaultValue="VIEWER">
                  {ROLE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
              {memberFormError && <p role="alert" className="error">{memberFormError}</p>}
            </fieldset>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setAddingMember(false)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={busy}>
                {busy ? 'Adding…' : 'Add Member'}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {/* Edit Role Dialog */}
      {editingMember && (
        <Dialog
          title={`Change Role: ${editingMember.username}`}
          onClose={() => setEditingMember(null)}
          busy={busy}
        >
          <form onSubmit={handleUpdateMember}>
            <fieldset disabled={busy} className="space-y-4 px-6 py-5">
              <p className="text-sm text-slate-600">
                Change role for <strong>{editingMember.display_name}</strong> ({editingMember.username}).
              </p>
              <label className="field">
                Role (บทบาทในโปรเจกต์)
                <select name="role" defaultValue={editingMember.role}>
                  {ROLE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </label>
              {memberFormError && <p role="alert" className="error">{memberFormError}</p>}
            </fieldset>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setEditingMember(null)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save Role'}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {/* Remove Member Dialog */}
      {removingMember && (
        <Dialog
          title="Remove Member"
          onClose={() => setRemovingMember(null)}
          busy={busy}
        >
          <div className="space-y-4 px-6 py-5">
            <p className="text-sm text-slate-600">
              Are you sure you want to remove <strong>{removingMember.display_name}</strong> ({removingMember.username}) from this project?
            </p>
            {memberFormError && <p role="alert" className="error">{memberFormError}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setRemovingMember(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger"
              disabled={busy}
              onClick={handleRemoveMember}
            >
              {busy ? 'Removing…' : 'Remove Member'}
            </button>
          </div>
        </Dialog>
      )}
    </>}
  </>
}
