import { beforeEach, expect, it, vi } from 'vitest'
import { manualsApi, setCsrfToken } from '../api/manuals'
import { UploadNetwork } from './upload-network'

beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {})) })

it('sends multipart files with CSRF and reports actual upload bytes', async () => {
  UploadNetwork.automatic = false
  setCsrfToken('upload-csrf')
  const body = new FormData()
  body.set('pdf_file', new File(['%PDF'], 'manual.pdf', { type: 'application/pdf' }))
  const progress = vi.fn()
  const request = manualsApi.upload(7, body, { onProgress: progress })
  const network = UploadNetwork.instances[0]
  expect(network).toBeDefined()
  expect(network?.body?.get('pdf_file')).toBeInstanceOf(File)
  expect(network.headers.get('X-CSRF-Token')).toBe('upload-csrf')
  expect(network.headers.has('Content-Type')).toBe(false)
  network.progress(45)
  expect(progress).toHaveBeenLastCalledWith(45)
  network.finish(201, JSON.stringify({ id: 8, status: 'DRAFT' }))
  expect(await request).toMatchObject({ id: 8, status: 'DRAFT' })
})

it('aborts transmission and never accepts a later successful response', async () => {
  UploadNetwork.automatic = false
  const controller = new AbortController()
  const request = manualsApi.upload(7, new FormData(), { signal: controller.signal })
  expect(UploadNetwork.instances[0]).toBeDefined()
  const outcome = expect(request).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  UploadNetwork.instances[0]?.finish(201, '{"id":8}')
  await outcome
})

it('revokes the session on current-generation 401 and preserves server errors', async () => {
  UploadNetwork.automatic = false
  setCsrfToken('csrf')
  const expired = vi.fn()
  window.addEventListener('manual-auth-required', expired)
  try {
    const request = manualsApi.upload(7, new FormData(), { onProgress: () => {} })
    expect(UploadNetwork.instances[0]).toBeDefined()
    const outcome = expect(request).rejects.toThrow('Please log in')
    UploadNetwork.instances[0].finish(401, '{"detail":"Please log in"}')
    await outcome
    expect(expired).toHaveBeenCalledOnce()
  } finally { window.removeEventListener('manual-auth-required', expired) }
})

it('ignores a 401 from an older session and handles non-JSON failures', async () => {
  UploadNetwork.automatic = false
  setCsrfToken('old-session')
  const expired = vi.fn()
  window.addEventListener('manual-auth-required', expired)
  try {
    const request = manualsApi.upload(7, new FormData(), { onProgress: () => {} })
    expect(UploadNetwork.instances[0]).toBeDefined()
    const outcome = expect(request).rejects.toThrow('Unable to complete')
    setCsrfToken('new-session')
    UploadNetwork.instances[0].finish(401, '<html>gateway error</html>')
    await outcome
    expect(expired).not.toHaveBeenCalled()
  } finally { window.removeEventListener('manual-auth-required', expired) }
})

it('rejects network errors and refreshes the review queue when a mutation settles', async () => {
  UploadNetwork.automatic = false
  const changed = vi.fn()
  window.addEventListener('manual-data-changed', changed)
  try {
    const request = manualsApi.upload(7, new FormData(), { onProgress: () => {} })
    expect(UploadNetwork.instances[0]).toBeDefined()
    const outcome = expect(request).rejects.toThrow('Check your connection')
    UploadNetwork.instances[0].dispatchEvent(new Event('error'))
    await outcome
    expect(changed).toHaveBeenCalledOnce()
  } finally { window.removeEventListener('manual-data-changed', changed) }
})
