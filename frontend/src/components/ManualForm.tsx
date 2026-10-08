import { useState, type FormEvent } from 'react'
import { errorMessage, manualsApi } from '../api/manuals'
import type { Manual } from '../types/manual'
import type { Project } from '../types/project'

export function ManualForm({ onSaved, onCancel, project, manual: editing }: { onSaved: (manual: Manual) => void; onCancel: () => void; manual?: Manual; project?: Pick<Project, 'id' | 'project_name' | 'project_code'> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const existing = editing?.category ?? ''
  const [categoryChoice, setCategoryChoice] = useState(!editing || existing === 'THAI' || existing === 'EN' ? existing || 'THAI' : 'OTHER')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const data = new FormData(event.currentTarget)
    const category = categoryChoice === 'OTHER' ? String(data.get('category_other')).trim() : categoryChoice
    setBusy(true); setError('')
    try {
      const input = { title: String(data.get('title')).trim(), category, description: String(data.get('description')).trim() }
      const manual = editing ? await manualsApi.update(editing.id, input) : await manualsApi.create(input, project?.id)
      onSaved(manual)
    } catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }
  return <form onSubmit={submit}>
    <fieldset disabled={busy} className="space-y-4 px-6 py-5">
      {!editing && <p className="text-sm text-slate-500">Create the manual first. Add a PDF revision when it is ready.</p>}
      {project && <div className="rounded-md bg-slate-50 p-3 text-sm"><p className="text-slate-500">Project</p><p className="mt-1 font-medium text-slate-800">{project.project_name}</p><p className="mt-1 text-slate-500">{project.project_code}</p></div>}
      <label className="field">Title<input name="title" required maxLength={255} placeholder="Plating Operation Manual" defaultValue={editing?.title} autoFocus /></label>
      <label className="field">Category<select name="category_choice" value={categoryChoice} onChange={event => setCategoryChoice(event.target.value)}>
        <option value="THAI">THAI</option><option value="EN">EN</option><option value="OTHER">OTHER</option>
      </select></label>
      {categoryChoice === 'OTHER' && <label className="field">Other category<input name="category_other" required maxLength={100} placeholder="Specify category" defaultValue={editing && categoryChoice === 'OTHER' ? existing : ''} /></label>}
      <label className="field">Description<textarea name="description" rows={3} maxLength={20000} placeholder="What does this manual cover?" defaultValue={editing?.description ?? ''} /></label>
      {error && <p role="alert" className="error">{error}</p>}
    </fieldset>
    <div className="modal-footer">
      <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      <button className="btn-primary" disabled={busy}>{editing ? (busy ? 'Saving…' : 'Save Changes') : busy ? 'Creating…' : 'Create Manual'}</button>
    </div>
  </form>
}
