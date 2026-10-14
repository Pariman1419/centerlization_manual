import type { Manual, ManualInput, ReviewQueueData, Revision, RevisionReview, RevisionUpdateEvent } from '../types/manual'

let csrfToken = ''
let requestGeneration = 0
const pendingReads = new Map<string, Promise<unknown>>()
function clearReadCache() { requestGeneration++; pendingReads.clear() }
function finishMutation() { clearReadCache(); window.dispatchEvent(new Event('manual-data-changed')) }
export function setCsrfToken(value: string) { csrfToken = value; clearReadCache() }

export function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes((options.method ?? 'GET').toUpperCase())
  if (mutation) {
    clearReadCache()
    return fetchRequest<T>(path, options).finally(finishMutation)
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
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
    throw new Error('Unable to reach Manual Management. Check your connection and try again.')
  }
  const body = await response.json().catch(() => null)
  return responseBody<T>(path, response.status, body, generation)
}

function responseBody<T>(path: string, status: number, body: unknown, generation: number): T {
  if (status === 401 && path !== '/auth/login' && generation === requestGeneration) {
    setCsrfToken('')
    window.dispatchEvent(new Event('manual-auth-required'))
  }
  if (status < 200 || status >= 300) {
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : null
    throw new Error(typeof detail === 'string' ? detail : 'Unable to complete the request. Please try again.')
  }
  if (body === null) throw new Error('The server returned an unexpected response. Please try again.')
  return body as T
}

export interface UploadOptions {
  signal?: AbortSignal
  onProgress?: (percent: number | null) => void
}

function uploadRequest<T>(path: string, body: FormData, options: UploadOptions): Promise<T> {
  clearReadCache()
  const generation = requestGeneration
  const pending = new Promise<T>((resolve, reject) => {
    if (options.signal?.aborted) { reject(new DOMException('Upload cancelled', 'AbortError')); return }
    const xhr = new XMLHttpRequest()
    let settled = false
    function cleanup() {
      options.signal?.removeEventListener('abort', cancel)
      xhr.upload.removeEventListener('progress', progress)
      xhr.removeEventListener('load', load)
      xhr.removeEventListener('error', error)
      xhr.removeEventListener('abort', aborted)
      xhr.removeEventListener('timeout', timeout)
    }
    function fail(failure: unknown) {
      if (settled) return
      settled = true; cleanup(); reject(failure)
    }
    function progress(event: ProgressEvent) {
      options.onProgress?.(event.lengthComputable && event.total > 0 ? Math.min(100, Math.round(event.loaded / event.total * 100)) : null)
    }
    function cancel() { xhr.abort() }
    function aborted() { fail(new DOMException('Upload cancelled', 'AbortError')) }
    function error() { fail(new Error('Unable to reach Manual Management. Check your connection and try again. Refresh revision history before retrying an upload.')) }
    function timeout() { fail(new Error('Upload timed out. Refresh revision history before retrying.')) }
    function load() {
      if (settled) return
      let payload: unknown = null
      try { payload = JSON.parse(xhr.responseText) } catch { /* Gateways may return HTML. */ }
      try {
        const result = responseBody<T>(path, xhr.status, payload, generation)
        settled = true; cleanup(); resolve(result)
      } catch (failure) { fail(failure) }
    }
    xhr.open('POST', `/api${path}`)
    xhr.withCredentials = true
    if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken)
    xhr.upload.addEventListener('progress', progress)
    xhr.addEventListener('load', load)
    xhr.addEventListener('error', error)
    xhr.addEventListener('abort', aborted)
    xhr.addEventListener('timeout', timeout)
    options.signal?.addEventListener('abort', cancel, { once: true })
    try { xhr.send(body) } catch (failure) { fail(failure) }
  })
  return pending.finally(finishMutation)
}

export const manualsApi = {
  list: () => request<Manual[]>('/manuals'),
  search: (search: string, signal?: AbortSignal) => request<Manual[]>(`/manuals?${new URLSearchParams({ search, limit: '20' })}`, { signal }),
  reviewQueue: (signal?: AbortSignal) => request<ReviewQueueData>('/manuals/review-queue', { signal }),
  get: (id: number) => request<Manual>(`/manuals/${id}`),
  create: (input: ManualInput, projectId?: number) => request<Manual>(projectId === undefined ? '/manuals' : `/projects/${projectId}/manuals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }),
  revisions: (id: number) => request<Revision[]>(`/manuals/${id}/revisions`),
  upload: (id: number, body: FormData, options?: UploadOptions) => options
    ? uploadRequest<Revision>(`/manuals/${id}/revisions`, body, options)
    : request<Revision>(`/manuals/${id}/revisions`, { method: 'POST', body }),
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
  replaceFiles: (id: number, body: FormData, options?: UploadOptions) => options
    ? uploadRequest<Revision>(`/revisions/${id}/update-files`, body, options)
    : request<Revision>(`/revisions/${id}/update-files`, { method: 'POST', body }),
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
