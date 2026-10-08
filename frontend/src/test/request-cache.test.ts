import { afterEach, expect, it, vi } from 'vitest'
import { request, setCsrfToken } from '../api/manuals'

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
afterEach(() => setCsrfToken(''))

it('shares concurrent GETs but fetches fresh data after they finish', async () => {
  let finish!: (value: Response) => void
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const first = request('/projects')
  const second = request('/projects')
  expect(fetchMock).toHaveBeenCalledTimes(1)
  finish(response([{ id: 1 }]))
  expect(await first).toEqual([{ id: 1 }])
  expect(await second).toEqual([{ id: 1 }])
  fetchMock.mockResolvedValueOnce(response([{ id: 2 }]))
  expect(await request('/projects')).toEqual([{ id: 2 }])
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('does not reuse a GET from before a mutation or session change', async () => {
  let finish!: (value: Response) => void
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const old = request('/projects')
  fetchMock.mockResolvedValueOnce(response({ deleted: true }))
  await request('/projects/1', { method: 'DELETE' })
  fetchMock.mockResolvedValueOnce(response([]))
  expect(await request('/projects')).toEqual([])
  setCsrfToken('new-session')
  fetchMock.mockResolvedValueOnce(response([{ id: 2 }]))
  expect(await request('/projects')).toEqual([{ id: 2 }])
  finish(response([{ id: 1 }]))
  await old
  expect(fetchMock).toHaveBeenCalledTimes(4)
})

it('never retains failed GETs', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ detail: 'Storage unavailable' }, 503))
  await expect(request('/projects')).rejects.toThrow('Storage unavailable')
  fetchMock.mockResolvedValueOnce(response([]))
  expect(await request('/projects')).toEqual([])
  expect(fetchMock).toHaveBeenCalledTimes(2)
})

it('an old-session failure cannot clear the new read or log out the new session', async () => {
  let finishOld!: (value: Response) => void
  let finishNew!: (value: Response) => void
  const fetchMock = vi.spyOn(globalThis, 'fetch')
    .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve }))
  const expired = vi.fn()
  window.addEventListener('manual-auth-required', expired)
  try {
    setCsrfToken('old-session')
    const old = request('/projects')
    const failure = expect(old).rejects.toThrow('Session expired')
    setCsrfToken('new-session')
    const current = request('/projects')
    finishOld(response({ detail: 'Session expired' }, 401))
    await failure
    const shared = request('/projects')
    finishNew(response([{ id: 2 }]))
    expect(await current).toEqual([{ id: 2 }])
    expect(await shared).toEqual([{ id: 2 }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(expired).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('manual-auth-required', expired)
  }
})
