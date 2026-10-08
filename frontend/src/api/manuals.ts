import type { Manual, ManualInput, Revision, RevisionReview, RevisionUpdateEvent } from '../types/manual'

let csrfToken = ''
let requestGeneration = 0
const pendingReads = new Map<string, Promise<unknown>>()
function clearReadCache() { requestGeneration++; pendingReads.clear() }
export function setCsrfToken(value: string) { csrfToken = value; clearReadCache() }

export function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes((options.method ?? 'GET').toUpperCase())
  if (mutation) {
    clearReadCache()
    return fetchRequest<T>(path, options).finally(clearReadCache)
  }
  // ponytail: share in-flight metadata reads only; add TTL only with cross-user invalidation.
  const cacheable = Object.keys(options).length === 0 && /^\/(projects|manuals)(\/\d+)?(\/manuals|\/revisions)?$/.test(path)
  if (!cacheable) return fetchRequest<T>(path, options)
  const cached = pendingReads.get(path)
  if (cached) return cached as Promise<T>
  if (pendingReads.size >= 128) return fetchRequest<T>(path, options)
  const pending = fetchRequest<T>(path, options).finally(() => {
    if (pendingReads.get(path) === pending) pendingReads.delete(path)
  })
  pendingReads.set(path, pending)
  return pending
}

async function fetchRequest<T>(path: string, options: RequestInit): Promise<T> {
  const generation = requestGeneration
  let response: Response
  const headers = new Headers(options.headers)
  if (csrfToken && options.method && !['GET', 'HEAD', 'OPTIONS'].includes(options.method.toUpperCase())) {
    headers.set('X-CSRF-Token', csrfToken)
  }
  try {
    response = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin' })
  } catch {
    throw new Error('Unable to reach Manual Management. Check your connection and try again.')
  }
  const body = await response.json().catch(() => null)
  if (response.status === 401 && path !== '/auth/login' && generation === requestGeneration) {
    setCsrfToken('')
    window.dispatchEvent(new Event('manual-auth-required'))
  }
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'Unable to complete the request. Please try again.')
  if (body === null) throw new Error('The server returned an unexpected response. Please try again.')
  return body as T
}

export const manualsApi = {
  list: () => request<Manual[]>('/manuals'),
  get: (id: number) => request<Manual>(`/manuals/${id}`),
  create: (input: ManualInput, projectId?: number) => request<Manual>(projectId === undefined ? '/manuals' : `/projects/${projectId}/manuals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }),
  revisions: (id: number) => request<Revision[]>(`/manuals/${id}/revisions`),
  upload: (id: number, body: FormData) => request<Revision>(`/manuals/${id}/revisions`, { method: 'POST', body }),
  publish: (id: number) => request<Revision>(`/revisions/${id}/publish`, { method: 'POST' }),
  submitReview: (id: number) => request<Revision>(`/revisions/${id}/submit-review`, { method: 'POST' }),
  approve: (id: number, comment?: string, expected_version = 0) => request<Revision>(`/revisions/${id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment, expected_version }),
  }),
  reject: (id: number, comment: string) => request<Revision>(`/revisions/${id}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment }),
  }),
  update: (id: number, input: ManualInput) => request<Manual>(`/manuals/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }),
  updateRevision: (id: number, revision_detail: string) => request<Revision>(`/revisions/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision_detail }),
  }),
  replaceFiles: (id: number, body: FormData) => request<Revision>(`/revisions/${id}/update-files`, { method: 'POST', body }),
  requestDevReview: (id: number, expected_version: number) => request<Revision>(`/revisions/${id}/request-dev-review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_version }),
  }),
  devReview: (id: number, expected_version: number, changes_requested: boolean, comment: string) => request<Revision>(`/revisions/${id}/dev-review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected_version, changes_requested, comment }),
  }),
  updates: (id: number) => request<RevisionUpdateEvent[]>(`/revisions/${id}/updates`),
  withdraw: (id: number) => request<Revision>(`/revisions/${id}/withdraw`, { method: 'POST' }),
  deleteRevision: (id: number) => request<{ deleted: boolean }>(`/revisions/${id}`, { method: 'DELETE' }),
  deleteManual: (id: number) => request<{ deleted: boolean }>(`/manuals/${id}`, { method: 'DELETE' }),
  reviews: (id: number) => request<RevisionReview[]>(`/revisions/${id}/reviews`),
  fileAccess: (id: number, action: 'preview' | 'download', fileId?: number) => request<{ url: string; expires_in: number }>(
    `/revisions/${id}/${action}${fileId === undefined ? '' : `?file_id=${fileId}`}`),
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to complete the request. Please try again.'
}
