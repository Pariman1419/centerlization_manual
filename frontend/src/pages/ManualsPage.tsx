import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { errorMessage, manualsApi } from '../api/manuals'
import { Dialog } from '../components/Dialog'
import { ManualForm } from '../components/ManualForm'
import { ManualsList } from '../components/ManualsList'
import type { Manual } from '../types/manual'

export function ManualsPage() {
  const navigate = useNavigate()
  const [manuals, setManuals] = useState<Manual[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    manualsApi.list().then(data => { if (active) setManuals(data) })
      .catch(err => { if (active) setError(errorMessage(err)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reload])

  return <>
    <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-3xl font-semibold tracking-tight text-slate-900">Manuals</h1><p className="mt-2 text-sm text-slate-500">Manage manuals and keep published revisions up to date.</p></div>
      <button className="btn-primary" onClick={() => setCreating(true)}><span aria-hidden="true" className="text-lg leading-none">+</span> Add Manual</button>
    </div>
    {error && <div role="alert" className="error mb-5 flex items-center justify-between gap-4"><p>{error}</p><button className="btn-secondary btn-small" onClick={() => setReload(value => value + 1)}>Retry</button></div>}
    <ManualsList manuals={manuals} loading={loading} failed={Boolean(error)} />
    {creating && <Dialog title="Add Manual" onClose={() => setCreating(false)}><ManualForm onCancel={() => setCreating(false)} onSaved={manual => navigate(`/manuals/${manual.id}`, { state: { message: 'Manual created successfully.' } })} /></Dialog>}
  </>
}
