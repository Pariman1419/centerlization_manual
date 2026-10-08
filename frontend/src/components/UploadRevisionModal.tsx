import { useState, type FormEvent } from 'react'
import { errorMessage, manualsApi } from '../api/manuals'
import type { Manual, Revision } from '../types/manual'
import { Dialog } from './Dialog'
import { formatSize } from './StatusBadge'

const MAX_BYTES = 50 * 1024 * 1024
const MAX_OTHER_FILES = 10
const BLOCKED = ['.exe', '.bat', '.cmd', '.com', '.scr', '.msi', '.ps1', '.vbs', '.js', '.jar', '.dll', '.sh', '.html', '.htm', '.svg']

function extension(name: string) {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

type FileType = 'PDF' | 'WORD' | 'OTHER'
const TYPE_HELP: Record<FileType, string> = {
  PDF: 'PDF only · Maximum 50 MB',
  WORD: '.doc or .docx · Maximum 50 MB',
  OTHER: `Any type (Excel, images, ZIP…) · Up to ${MAX_OTHER_FILES} files · Maximum 50 MB combined`,
}

function FileRow({ file, onRemove }: { file: File; onRemove: () => void }) {
  return <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-slate-200 p-3 text-sm">
    <div className="min-w-0"><p className="break-all font-medium">{file.name}</p><p className="mt-1 text-slate-500">{formatSize(file.size)}</p></div>
    <button type="button" className="text-blue-800 underline" onClick={onRemove}>Remove</button>
  </div>
}

export function UploadRevisionModal({ manual, onUploaded, onClose }: {
  manual: Manual; onUploaded: (revision: Revision) => void; onClose: () => void
}) {
  const [type, setType] = useState<FileType>('PDF')
  const [files, setFiles] = useState<File[]>([])
  const [otherType, setOtherType] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  function changeType(next: FileType) { setType(next); setFiles([]); setError('') }
  function validate(file: File): string {
    if (file.size === 0) return `${file.name} is empty. Select another file.`
    if (file.size > MAX_BYTES) return `${file.name} must be at most 50 MB.`
    const ext = extension(file.name)
    if (type === 'PDF' && (ext !== '.pdf' || file.type !== 'application/pdf')) return 'Select a PDF file, or change the Type.'
    if (type === 'WORD' && !['.doc', '.docx'].includes(ext)) return 'Select a Word file (.doc or .docx), or change the Type.'
    if (type === 'OTHER' && BLOCKED.includes(ext)) return `Files of type ${ext} are not allowed.`
    return ''
  }
  function select(selected?: FileList | File[] | null) {
    setError('')
    const incoming = Array.from(selected ?? [])
    if (incoming.length === 0) return
    for (const file of incoming) {
      const problem = validate(file)
      if (problem) { setError(problem); return }
    }
    if (type !== 'OTHER') { setFiles(incoming.slice(0, 1)); return }
    if (files.length + incoming.length > MAX_OTHER_FILES) { setError(`At most ${MAX_OTHER_FILES} other files can be attached.`); return }
    if ([...files, ...incoming].reduce((total, file) => total + file.size, 0) > MAX_BYTES) {
      setError('The combined file size must be at most 50 MB. Remove a file or reduce its size.'); return
    }
    setFiles([...files, ...incoming])
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    if (files.length === 0) { setError('Select a file to upload.'); return }
    const form = new FormData(event.currentTarget)
    const data = new FormData()
    data.set('revision_no', String(form.get('revision_no') ?? ''))
    data.set('revision_detail', String(form.get('revision_detail') ?? ''))
    if (type === 'PDF') data.set('pdf_file', files[0])
    else if (type === 'WORD') data.set('word_file', files[0])
    else {
      if (!otherType.trim()) { setError('Describe what the Other file is.'); return }
      data.set('other_type', otherType.trim())
      files.forEach(file => data.append('other_files', file))
    }
    setBusy(true); setError('')
    try { onUploaded(await manualsApi.upload(manual.id, data)) }
    catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }
  return <Dialog title="Upload New Revision" onClose={onClose} busy={busy}>
    <form onSubmit={submit}>
      <fieldset disabled={busy} className="space-y-5 px-6 py-5">
        <div className="rounded-md bg-slate-50 p-3 text-sm">
          <p className="mb-2 text-slate-500">Project: {manual.project_name}</p>
          <p className="font-medium text-slate-800">{manual.title}</p>
          <p className="mt-1 text-slate-500">{manual.manual_code} · Current: {manual.current_revision ? `REV ${manual.current_revision.revision_no}` : 'No published revision'}</p>
        </div>
        <label className="field">Revision Number<input name="revision_no" required maxLength={50} placeholder="04" autoFocus pattern="[A-Za-z0-9][A-Za-z0-9_.-]*" /></label>
        <label className="field">Revision Detail<textarea name="revision_detail" rows={4} maxLength={20000} placeholder="Describe what changed in this revision." /></label>
        <label className="field">Type
          <select value={type} onChange={event => changeType(event.target.value as FileType)}>
            <option value="PDF">PDF</option>
            <option value="WORD">Word</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        {type === 'OTHER' && <label className="field">What is it?
          <input value={otherType} onChange={event => setOtherType(event.target.value)} required maxLength={100} placeholder="e.g. Excel, Drawing, Photo" />
        </label>}
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Upload File</p>
          <div data-testid="drop-zone" className={`drop-zone ${dragging ? 'border-blue-500 bg-blue-50' : ''}`}
            onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={event => { event.preventDefault(); setDragging(false); if (!busy) select(event.dataTransfer.files) }}>
            <p className="font-medium text-slate-700">Drag file here</p>
            <p className="my-1 text-sm text-slate-500">or</p>
            <label className="file-picker">Browse File<input type="file" multiple={type === 'OTHER'}
              accept={type === 'PDF' ? '.pdf,application/pdf' : type === 'WORD' ? '.doc,.docx' : undefined}
              onChange={event => { select(event.target.files); event.target.value = '' }} /></label>
            <p className="mt-3 text-xs text-slate-500">{TYPE_HELP[type]}</p>
          </div>
          {files.map((file, index) => <FileRow key={`${file.name}-${index}`} file={file} onRemove={() => setFiles(files.filter((_, i) => i !== index))} />)}
        </div>
        <p className="text-xs text-slate-500">Uploads are saved as drafts. Publish the revision when it is ready for use.</p>
        {error && <p role="alert" className="error">{error}</p>}
      </fieldset>
      <div className="modal-footer"><button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary" disabled={busy}>{busy ? 'Uploading…' : 'Upload Draft'}</button></div>
    </form>
  </Dialog>
}
