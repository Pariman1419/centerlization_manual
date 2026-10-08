import { useState, type FormEvent } from 'react'
import { errorMessage } from '../api/manuals'
import { projectsApi } from '../api/projects'
import type { Project } from '../types/project'

export function ProjectForm({ onSaved, onCancel }: { onSaved: (project: Project) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const data = new FormData(event.currentTarget)
    setBusy(true); setError('')
    try {
      onSaved(await projectsApi.create({ project_code: String(data.get('project_code')).trim(),
        project_name: String(data.get('project_name')).trim(), description: String(data.get('description')).trim() }))
    } catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }
  return <form onSubmit={submit}>
    <fieldset disabled={busy} className="space-y-4 px-6 py-5">
      <p className="text-sm text-slate-500">Group the manuals for a machine or business project.</p>
      <label className="field">Project Code<input name="project_code" required maxLength={100} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" placeholder="PRJ-PLATING" autoFocus /></label>
      <p className="text-xs text-slate-500">Use English letters, numbers, underscores or hyphens; start with a letter or number, e.g. PRJ-001. Codes are case-sensitive and cannot change once manuals exist.</p>
      <label className="field">Project Name<input name="project_name" required maxLength={255} placeholder="Plating Machine" /></label>
      <label className="field">Description<textarea name="description" rows={3} maxLength={20000} placeholder="What manuals belong to this project?" /></label>
      {error && <p role="alert" className="error">{error}</p>}
    </fieldset>
    <div className="modal-footer"><button type="button" className="btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      <button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create Project'}</button></div>
  </form>
}
