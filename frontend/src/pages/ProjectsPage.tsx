import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { FolderArtwork } from '../components/FolderArtwork'
import { errorMessage } from '../api/manuals'
import { projectsApi } from '../api/projects'
import { Dialog } from '../components/Dialog'
import { ProjectForm } from '../components/ProjectForm'
import { formatDate, StatusBadge } from '../components/StatusBadge'
import type { Project } from '../types/project'
import { atLeast } from '../lib/permissions'

import { CardSkeleton } from '../components/Skeleton'

export function ProjectsPage() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Project | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [notice, setNotice] = useState('')
  const [params, setParams] = useSearchParams()
  const search = params.get('search') || ''
  const status = params.get('status') || ''
  function setFilter(key: string, value: string) {
    setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); return next }, { replace: true })
  }
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    projectsApi.list().then(data => { if (active) setProjects(data) })
      .catch(err => { if (active) setError(errorMessage(err)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reload])
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return projects.filter(project => `${project.project_code} ${project.project_name}`.toLowerCase().includes(term) && (!status || project.status === status))
  }, [projects, search, status])
  async function handleDelete() {
    if (!deleting || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await projectsApi.delete(deleting.id)
      setProjects(rows => rows.filter(row => row.id !== deleting.id))
      setNotice(`Project ${deleting.project_code} deleted.`)
      setDeleting(null)
    } catch (err) {
      setDeleteError(errorMessage(err))
    } finally {
      setDeleteBusy(false)
    }
  }
  return <>
    <div className="page-heading">
      <div><h1>Projects</h1><p>Manage project manuals and revision workflows.</p></div>
      <button className="btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={18} />New Project</button>
    </div>
    {notice && <p role="status" className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
    <section className="document-banner" aria-label="Document workspace">
      <div><h2>Controlled documents.<br />Clear workflows.</h2><p>Organize your manuals, reviews and published revisions.</p></div>
      <FolderArtwork className="banner-folder" />
    </section>
    <div className="panel project-filters">
      <label className="field">Search<input type="search" placeholder="Search project code or name" value={search} onChange={event => setFilter('search', event.target.value)} /></label>
      <label className="field">Status<select aria-label="Project status filter" value={status} onChange={event => setFilter('status', event.target.value)}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option></select></label>
    </div>
    {error && <div role="alert" className="error mb-5 flex items-center justify-between gap-4"><p>{error}</p><button className="btn-secondary btn-small" onClick={() => setReload(value => value + 1)}>Retry</button></div>}
    {loading && (
      <div className="project-grid" aria-busy="true" aria-label="Loading projects">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    )}
    {!loading && !error && (visible.length ? <div className="project-grid">{visible.map(project => <article className="project-card" key={project.id}>
      <div className="project-card-top">
        <div className="project-card-title"><h2>{project.project_name}</h2><p className="project-code">{project.project_code}</p></div>
        <FolderArtwork className="card-folder" />
      </div>
      <div className="project-tags"><StatusBadge status={project.status} />{project.my_role && <span className="role-badge"><Icon name="users" size={14} />{project.my_role}</span>}</div>
      <p className="project-description">{project.description || 'No project description provided.'}</p>
      <div className="project-card-footer"><div className="project-metadata"><p><Icon name="file" size={17} />{project.manual_count} {project.manual_count === 1 ? 'Manual' : 'Manuals'}</p><p><Icon name="calendar" size={17} />Updated: {formatDate(project.updated_at)}</p></div>
        <div className="project-card-actions">
          {atLeast(project.my_role, 'OWNER') && <button className="btn-secondary btn-small text-red-700 hover:text-red-800 hover:bg-red-50 hover:border-red-300" aria-label={`Delete Project ${project.project_name}`} onClick={() => { setDeleteError(''); setDeleting(project) }}>Delete</button>}
          <Link className="btn-primary project-open" to={`/projects/${project.id}`} aria-label={`Open Project ${project.project_name}`}><span>Open Project</span><Icon name="arrow" size={18} /></Link>
        </div></div>
    </article>)}</div> : <div className="panel empty-state"><FolderArtwork /><h2>{projects.length ? 'No matching projects' : 'Your workspace starts here'}</h2><p>{projects.length ? 'Try a different search or reset the status filter.' : 'Create a project to organize your manuals and revisions.'}</p>{projects.length ? <button className="btn-secondary" onClick={() => setParams({}, { replace: true })}>Clear filters</button> : <button className="btn-primary" onClick={() => setCreating(true)}><Icon name="plus" size={18} />Create Project</button>}</div>)}
    {!loading && !error && <p className="project-count">{visible.length} {visible.length === 1 ? 'project' : 'projects'}</p>}
    {creating && <Dialog title="Create Project" onClose={() => setCreating(false)}><ProjectForm onCancel={() => setCreating(false)} onSaved={project => {
      setCreating(false); navigate(`/projects/${project.id}`, { state: { message: 'Project created successfully.' } })
    }} /></Dialog>}
    {deleting && <Dialog title="Delete Project" busy={deleteBusy} onClose={() => setDeleting(null)}>
      <div className="space-y-4 p-6">
        <p>Delete <strong>{deleting.project_name}</strong> ({deleting.project_code})?</p>
        <p>This permanently deletes the project and all of its manuals, revisions (including published revisions) and files. This cannot be undone.</p>
        {deleteError && <p role="alert" className="error">{deleteError}</p>}
      </div>
      <div className="modal-footer">
        <button className="btn-secondary" disabled={deleteBusy} onClick={() => setDeleting(null)}>Cancel</button>
        <button className="btn-danger" disabled={deleteBusy} onClick={handleDelete}>{deleteBusy ? 'Deleting…' : 'Delete Project'}</button>
      </div>
    </Dialog>}
  </>
}
