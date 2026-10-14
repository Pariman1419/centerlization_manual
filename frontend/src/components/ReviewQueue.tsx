import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage, manualsApi } from '../api/manuals'
import type { ReviewQueueData } from '../types/manual'
import { Dialog } from './Dialog'
import { Icon } from './Icon'
import { UserText } from './UserText'

export function ReviewQueue({ onNavigate }: { onNavigate?: () => void }) {
  const [queue, setQueue] = useState<ReviewQueueData | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let active = true
    let generation = 0
    let controller: AbortController | null = null
    function load() {
      const run = ++generation
      controller?.abort()
      controller = new AbortController()
      manualsApi.reviewQueue(controller.signal).then(data => {
        if (active && run === generation) { setQueue(data); setError('') }
      }).catch(failure => {
        if (active && run === generation) { setQueue(null); setError(errorMessage(failure)) }
      })
    }
    function refreshWhenVisible() { if (document.visibilityState !== 'hidden') load() }
    load()
    window.addEventListener('manual-data-changed', load)
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    const timer = window.setInterval(refreshWhenVisible, 60000)
    return () => {
      active = false; controller?.abort(); window.clearInterval(timer)
      window.removeEventListener('manual-data-changed', load)
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [reload])
  if (!error && !queue?.can_review) return null
  return <>
    <button className="sidebar-link review-queue-button" aria-label={error ? 'Review queue unavailable' : `Waiting for review: ${queue?.count ?? 0}`}
      onClick={() => { setOpen(true); setReload(value => value + 1) }}>
      <Icon name="guide" /><span>Waiting for review</span>
      <strong role="status" className="review-count" aria-label={error ? 'Review queue unavailable' : `${queue?.count ?? 0} documents waiting for review`}>{error ? '!' : queue?.count}</strong>
    </button>
    {open && <Dialog title="Waiting for review" onClose={() => setOpen(false)} className="review-queue-dialog">
      <div className="p-6">
        {error && <div role="alert" className="error"><p>{error}</p><button className="btn-secondary mt-3" onClick={() => setReload(value => value + 1)}>Retry review queue</button></div>}
        {!error && queue?.count === 0 && <p>No documents are waiting for your review.</p>}
        {!error && queue && queue.count > 0 && <>
          <p className="mb-4 text-sm text-slate-600">{queue.count} revision{queue.count === 1 ? '' : 's'} waiting for review.{queue.count > queue.items.length ? ' Showing the oldest 20.' : ''}</p>
          <ul className="review-queue-list">{queue.items.map(item => <li key={item.revision_id}>
            <Link to={`/manuals/${item.manual_id}`} onClick={() => { setOpen(false); onNavigate?.() }}>
              <UserText className="font-semibold">{item.title}</UserText>
              <span>{item.manual_code} · <strong>REV {item.revision_no}</strong></span>
              <UserText className="text-sm text-slate-600">{item.project_name}</UserText>
            </Link>
          </li>)}</ul>
        </>}
      </div>
    </Dialog>}
  </>
}
