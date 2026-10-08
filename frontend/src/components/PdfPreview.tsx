import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { errorMessage, manualsApi } from '../api/manuals'
import { Dialog } from './Dialog'

function PreviewDialog({ revisionId, fileId, onClose }: { revisionId: number; fileId?: number; onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    manualsApi.fileAccess(revisionId, 'preview', fileId)
      .then(access => { if (active) setUrl(access.url) })
      .catch(err => { if (active) setError(errorMessage(err)) })
    return () => { active = false }
  }, [revisionId, fileId])
  // Mount outside the approval dialog so this modal has its own focus and close controls.
  return createPortal(<Dialog title="PDF Preview" onClose={onClose} className="pdf-preview-modal">
    <div className="pdf-preview-body">
      {!url && !error && <p role="status" className="p-6 text-center text-slate-500">Loading preview…</p>}
      {error && <p role="alert" className="error m-6">{error}</p>}
      {url && <iframe title="PDF preview" src={url} className="pdf-preview-frame" />}
    </div>
  </Dialog>, document.body)
}

/** Shared controls: preview in the page, download through the signed URL. */
export function PdfPreview({
  revisionId,
  fileId,
  fileName,
  previewable = true,
}: {
  revisionId: number
  fileId?: number
  fileName?: string
  previewable?: boolean
}) {
  const [previewing, setPreviewing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function download() {
    if (busy) return
    setError('')
    const tab = window.open('about:blank', '_blank')
    if (!tab) { setError('Allow pop-ups for Manual Management, then try again.'); return }
    tab.opener = null
    setBusy(true)
    try {
      const access = await manualsApi.fileAccess(revisionId, 'download', fileId)
      tab.location.replace(access.url)
    } catch (err) { tab.close(); setError(errorMessage(err)) }
    finally { setBusy(false) }
  }
  return <div>
    <div className="flex flex-wrap gap-2">
      {previewable && (
        <button
          className="btn-secondary btn-small"
          aria-label={fileName ? `Preview ${fileName}` : 'Preview'}
          disabled={busy}
          onClick={() => setPreviewing(true)}
        >
          Preview
        </button>
      )}
      <button
        className="btn-secondary btn-small"
        aria-label={fileName ? `Download ${fileName}` : 'Download'}
        disabled={busy}
        onClick={download}
      >
        {busy ? 'Opening…' : 'Download'}
      </button>
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {previewing && <PreviewDialog revisionId={revisionId} fileId={fileId} onClose={() => setPreviewing(false)} />}
  </div>
}
