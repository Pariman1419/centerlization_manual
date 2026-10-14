import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage, manualsApi } from '../api/manuals'
import type { Manual } from '../types/manual'
import { UserText } from './UserText'

export function GlobalSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Manual[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const resultsId = useId()

  useEffect(() => () => { generation.current++; controller.current?.abort() }, [])
  function clearResults() {
    generation.current++
    controller.current?.abort()
    setResults(null); setError(''); setBusy(false)
  }
  async function search(event: FormEvent) {
    event.preventDefault()
    clearResults()
    const term = query.trim()
    if (!term) return
    const run = generation.current
    const request = new AbortController()
    controller.current = request
    setBusy(true)
    try {
      const data = await manualsApi.search(term, request.signal)
      if (run === generation.current) setResults(data)
    } catch (failure) {
      if (run === generation.current && !request.signal.aborted) setError(errorMessage(failure))
    } finally {
      if (run === generation.current) setBusy(false)
    }
  }
  return <div className="global-search" onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); clearResults() }
  }}>
    <form role="search" onSubmit={search}>
      <input type="search" aria-label="Search all documents" placeholder="Search document code or title"
        maxLength={255} aria-controls={resultsId} value={query}
        onChange={event => { clearResults(); setQuery(event.target.value) }} />
      <button className="btn-secondary" aria-label="Search documents" disabled={busy || !query.trim()}>Search</button>
    </form>
    {(busy || error || results !== null) && <section id={resultsId} className="search-results panel" aria-label="Document search results" aria-busy={busy}>
      <div className="search-results-heading"><strong>Document search</strong><button className="btn-secondary btn-small" onClick={clearResults}>Close results</button></div>
      {busy && <p role="status">Searching documents…</p>}
      {error && <p role="alert" className="error">{error} Submit the search again to retry.</p>}
      {results?.length === 0 && <p>No matching documents in your projects.</p>}
      {results && results.length > 0 && <>
        <p className="text-sm text-slate-600">{results.length === 20 ? 'Showing the first 20 matches. Refine your search for more specific results.' : `${results.length} document${results.length === 1 ? '' : 's'} found.`}</p>
        <ul>{results.map(manual => <li key={manual.id}>
          <Link to={`/manuals/${manual.id}`} onClick={clearResults}>
            <UserText className="font-semibold">{manual.title}</UserText>
            <span className="text-sm text-slate-600">{manual.manual_code}</span>
            <UserText className="text-sm text-slate-600">{manual.project_name}</UserText>
          </Link>
        </li>)}</ul>
      </>}
    </section>}
  </div>
}
