const styles: Record<string, string> = {
  PUBLISHED: 'bg-emerald-100 text-emerald-900 border-emerald-300 font-semibold',
  APPROVED: 'bg-sky-50 text-sky-900 border-sky-300',
  IN_REVIEW: 'bg-purple-50 text-purple-900 border-purple-200',
  REJECTED: 'bg-red-50 text-red-900 border-red-200',
  DRAFT: 'bg-amber-50 text-amber-900 border-amber-200',
  ARCHIVED: 'bg-slate-100 text-slate-700 border-slate-300',
  ACTIVE: 'bg-blue-50 text-blue-900 border-blue-200',
  INACTIVE: 'bg-slate-100 text-slate-700 border-slate-300',
}

function formatStatusLabel(status: string) {
  return status
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium ${styles[status] || styles.ARCHIVED}`}>
      {formatStatusLabel(status)}
    </span>
  )
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatSize(bytes: number | null) {
  if (bytes === null) return 'PDF'
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
