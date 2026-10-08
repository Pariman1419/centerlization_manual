import { useState } from 'react'
import { errorMessage, manualsApi } from '../api/manuals'
import type { Revision } from '../types/manual'
import { Dialog } from './Dialog'
import { RevisionFiles } from './RevisionFiles'

export function DevReviewDialog({ revision, mode, onClose, onCompleted }: {
  revision: Revision; mode: 'request' | 'feedback'; onClose: () => void; onCompleted: () => void
}) {
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(changesRequested = false) {
    if (busy) return
    if (mode === 'feedback' && changesRequested && !comment.trim()) {
      setError('Feedback is required when requesting changes.'); return
    }
    setBusy(true); setError('')
    try {
      if (mode === 'request') await manualsApi.requestDevReview(revision.id, revision.content_version ?? 0)
      else await manualsApi.devReview(revision.id, revision.content_version ?? 0, changesRequested, comment.trim())
      onCompleted()
    } catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }
  return <Dialog title={mode === 'request' ? `Request Dev review — REV ${revision.revision_no}` : `Review BA update — REV ${revision.revision_no}`}
    busy={busy} onClose={onClose}>
    <div className="space-y-4 px-6 py-5 text-sm text-slate-600">
      <p>{mode === 'request' ? 'Ask Dev to check the updated files. BA can approve after Dev confirms no further changes.'
        : 'Check the files updated by BA. Request changes with feedback, or confirm no further changes so BA can approve.'}</p>
      <fieldset disabled={busy}>
        <legend className="mb-2 font-medium">Updated revision files</legend>
        <RevisionFiles revision={revision} />
      </fieldset>
      {mode === 'feedback' && <label className="field">Feedback
        <textarea rows={4} maxLength={20000} value={comment} disabled={busy} onChange={event => setComment(event.target.value)} />
      </label>}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
    <div className="modal-footer">
      <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      {mode === 'request' ? <button className="btn-primary" onClick={() => submit()} disabled={busy}>
        {busy ? 'Sending…' : 'Request Dev Review'}</button> : <>
        <button className="btn-secondary" onClick={() => submit(true)} disabled={busy}>Request Changes</button>
        <button className="btn-success" onClick={() => submit(false)} disabled={busy}>{busy ? 'Saving…' : 'No Further Changes'}</button>
      </>}
    </div>
  </Dialog>
}
