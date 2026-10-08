import { useState } from 'react'
import { errorMessage, manualsApi } from '../api/manuals'
import type { RevisionUpdateEvent } from '../types/manual'
import { formatDateTime } from './StatusBadge'

export function RevisionUpdateLog({ revisionId }: { revisionId: number }) {
  const [events, setEvents] = useState<RevisionUpdateEvent[] | null>(null)
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function toggle() {
    if (busy) return
    if (visible) { setVisible(false); return }
    setVisible(true); setBusy(true); setError('')
    try { setEvents(await manualsApi.updates(revisionId)) }
    catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }
  const labels = { REVISION_UPDATED: 'BA updated draft', DEV_REVIEW_REQUESTED: 'Dev review requested',
    DEV_REVIEW_COMPLETED: 'Dev review completed' }
  return <div className="mt-4">
    <button className="btn-secondary btn-small" disabled={busy} aria-expanded={visible}
      onClick={toggle}>{visible ? 'Hide update history' : 'View update history'}</button>
    {visible && <div className="mt-3 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
      {busy && <p role="status">Loading update history…</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {!busy && !error && events?.length === 0 && <p>No updates recorded.</p>}
      {events?.map(event => <div key={event.id} className="border-b border-slate-200 pb-3 last:border-0">
        <p className="font-medium">{labels[event.action]} · {event.actor_username || 'Former user'}</p>
        <p className="text-xs text-slate-500">{formatDateTime(event.created_at)}</p>
        {event.details?.content_version !== undefined && <p className="text-xs text-slate-500">Update {event.details.content_version}</p>}
        {event.details?.previous_files && <p className="mt-2 break-all">Previous files: {event.details.previous_files.map(f => f.file_name).join(', ')}</p>}
        {event.details?.files && <p className="break-all">Updated files: {event.details.files.map(f => f.file_name).join(', ')}</p>}
        {event.details?.revision_detail && <p className="mt-1 whitespace-pre-wrap">{event.details.revision_detail}</p>}
        {event.details?.changes_requested !== undefined && <p>{event.details.changes_requested ? 'Further changes requested' : 'No further changes'}</p>}
        {event.details?.comment && <p className="whitespace-pre-wrap">{event.details.comment}</p>}
      </div>)}
    </div>}
  </div>
}
