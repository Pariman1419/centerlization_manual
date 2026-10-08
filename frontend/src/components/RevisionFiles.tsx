import type { Revision } from '../types/manual'
import { PdfPreview } from './PdfPreview'
import { formatSize } from './StatusBadge'

const KIND_LABEL = { WORD: 'Word', PDF: 'PDF', OTHER: 'Other' } as const

/** Every file of a revision with its own download (and, for PDFs, preview) controls. */
export function RevisionFiles({ revision }: { revision: Revision }) {
  const files = revision.files ?? []
  if (files.length === 0) return <PdfPreview revisionId={revision.id} fileName={revision.file_name} />
  return <ul className="space-y-2">
    {files.map(file => <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2">
      <div className="min-w-0">
        <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{file.kind === 'OTHER' && file.label ? `Other · ${file.label}` : KIND_LABEL[file.kind]}</span>
        <span className="break-all text-sm font-medium text-slate-800">{file.file_name}</span>
        <span className="ml-2 text-xs text-slate-500">{formatSize(file.file_size)}</span>
      </div>
      <PdfPreview revisionId={revision.id} fileId={file.id} fileName={file.file_name} previewable={file.kind === 'PDF'} />
    </li>)}
  </ul>
}
