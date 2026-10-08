import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { formatDate, StatusBadge } from './StatusBadge'
import type { Manual } from '../types/manual'

/** Shared existing filter/table UI for All Manuals and a project's manuals. */
export function ManualsList({ manuals, loading = false, failed = false }: { manuals: Manual[]; loading?: boolean; failed?: boolean }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const search = params.get('manualSearch') || ''
  const category = params.get('category') || ''
  const status = params.get('manualStatus') || ''
  function setFilter(key: string, value: string) {
    setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); return next }, { replace: true })
  }
  const categories = useMemo(() => [...new Set(manuals.map(m => m.category).filter((c): c is string => Boolean(c)))].sort(), [manuals])
  const statuses = useMemo(() => [...new Set(['DRAFT', 'PUBLISHED', 'ARCHIVED', ...manuals.map(m => m.status)])], [manuals])
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return manuals.filter(manual =>
      `${manual.manual_code} ${manual.title}`.toLowerCase().includes(term) &&
      (!category || manual.category === category) && (!status || manual.status === status))
  }, [manuals, search, category, status])

  return (
    <section className="panel">
      <div className="manual-filters">
        <label className="field">Search<input type="search" placeholder="Search manual code or title" value={search} onChange={event => setFilter('manualSearch', event.target.value)} /></label>
        <label className="field">Category<select aria-label="Category filter" value={category} onChange={event => setFilter('category', event.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="field">Status<select aria-label="Status filter" value={status} onChange={event => setFilter('manualStatus', event.target.value)}><option value="">All statuses</option>{statuses.map(s => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <caption className="sr-only">Manuals with current published revision, category and status</caption>
          <thead className="bg-slate-50 text-xs text-slate-500"><tr>
            {['Manual Code', 'Title', 'Category', 'Current Revision', 'Status', 'Updated Date'].map(label => <th key={label} scope="col" className="px-5 py-3.5 font-medium">{label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {!loading && !failed && visible.map(manual => <tr key={manual.id} className="cursor-pointer hover:bg-slate-50" onClick={event => {
              if (!(event.target as HTMLElement).closest('a')) navigate(`/manuals/${manual.id}`)
            }}>
              <td className="whitespace-nowrap px-5 py-5 text-slate-500">{manual.manual_code}</td>
              <td className="px-5 py-5"><Link className="font-medium text-slate-900 hover:text-blue-800 hover:underline" to={`/manuals/${manual.id}`}>{manual.title}</Link></td>
              <td className="px-5 py-5 text-slate-600">{manual.category || '—'}</td>
              <td className="whitespace-nowrap px-5 py-5 font-medium text-slate-700">{manual.current_revision ? `REV ${manual.current_revision.revision_no}` : '—'}</td>
              <td className="px-5 py-5"><StatusBadge status={manual.status} /></td>
              <td className="whitespace-nowrap px-5 py-5 text-slate-500">{formatDate(manual.updated_at)}</td>
            </tr>)}
            {loading && <tr><td colSpan={6} className="p-12 text-center text-slate-500">Loading manuals…</td></tr>}
            {!loading && !failed && visible.length === 0 && <tr><td colSpan={6} className="p-12 text-center text-slate-500">
              {manuals.length ? 'No manuals match your filters.' : <><p className="font-medium text-slate-800">No manuals yet</p><p className="mt-2">Add a manual to start managing its revisions.</p></>}
            </td></tr>}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">{!loading && !failed ? `${visible.length} ${visible.length === 1 ? 'manual' : 'manuals'}` : 'Manual library'}</div>
    </section>
  )
}
