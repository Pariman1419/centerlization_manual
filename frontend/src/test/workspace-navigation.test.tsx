import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { App } from '../App'

const user = { id: 1, username: 'reviewer', display_name: 'Reviewer', role: 'USER', is_active: true, created_at: '2026-10-07T00:00:00Z' }
const manual = { id: 7, project_id: 3, project_code: 'SAFE', project_name: 'Safety project', manual_code: 'SAFE-001', title: 'Safety manual', category: 'Operation', description: null, status: 'DRAFT', current_revision_id: null, current_revision: null, created_by: 'dev', created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z' }
const item = { revision_id: 8, manual_id: 7, manual_code: 'SAFE-001', title: 'Safety manual', project_id: 3, project_code: 'SAFE', project_name: 'Safety project', revision_no: '02', submitted_at: '2026-10-08T00:00:00Z' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function mockWorkspace(extra: (path: string) => Response | Promise<Response> | undefined = () => undefined) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    const custom = extra(path)
    if (custom) return custom
    if (path === '/api/auth/me') return json({ user, csrf_token: 'csrf' })
    if (path === '/api/manuals/review-queue') return json({ can_review: true, count: 1, items: [item] })
    if (path === '/api/manuals/7') return json(manual)
    if (path === '/api/manuals/7/revisions') return json([])
    if (path === '/api/projects/3') return json({ id: 3, project_code: 'SAFE', project_name: 'Safety project', my_role: 'BA' })
    return json([])
  })
  render(<MemoryRouter initialEntries={['/projects']}><App /></MemoryRouter>)
}

it('searches accessible document codes and titles and opens a result', async () => {
  mockWorkspace(path => path.startsWith('/api/manuals?') ? json([manual]) : undefined)
  const actions = userEvent.setup()
  await actions.type(await screen.findByRole('searchbox', { name: 'Search all documents' }), 'Safety')
  await actions.click(screen.getByRole('button', { name: 'Search documents' }))
  const results = await screen.findByRole('region', { name: 'Document search results' })
  expect(within(results).getByText('Safety project')).toBeInTheDocument()
  await actions.click(within(results).getByRole('link', { name: /Safety manual/ }))
  expect(await screen.findByRole('heading', { name: 'Safety manual' })).toBeInTheDocument()
})

it('opens the role-scoped queue and refreshes its count after mutations', async () => {
  let count = 1
  mockWorkspace(path => path === '/api/manuals/review-queue' ? json({ can_review: true, count, items: count ? [item] : [] }) : undefined)
  const actions = userEvent.setup()
  await actions.click(await screen.findByRole('button', { name: 'Waiting for review: 1' }))
  expect(within(screen.getByRole('dialog')).getByText('REV 02')).toBeInTheDocument()
  count = 0
  act(() => { window.dispatchEvent(new Event('manual-data-changed')) })
  expect(await screen.findByRole('button', { name: 'Waiting for review: 0' })).toBeInTheDocument()
  expect(screen.getByText('No documents are waiting for your review.')).toBeInTheDocument()
})

it('discards stale search results when the query changes', async () => {
  let finish: (response: Response) => void = () => {}
  mockWorkspace(path => path.startsWith('/api/manuals?') ? new Promise<Response>(resolve => { finish = resolve }) : undefined)
  const actions = userEvent.setup()
  const input = await screen.findByRole('searchbox', { name: 'Search all documents' })
  await actions.type(input, 'Safety')
  await actions.click(screen.getByRole('button', { name: 'Search documents' }))
  fireEvent.change(input, { target: { value: 'New query' } })
  await act(async () => { finish(json([manual])) })
  expect(screen.queryByRole('link', { name: /Safety manual/ })).not.toBeInTheDocument()
})

it('hides the queue from viewers without review permissions', async () => {
  mockWorkspace(path => path === '/api/manuals/review-queue' ? json({ can_review: false, count: 0, items: [] }) : undefined)
  await screen.findByRole('searchbox', { name: 'Search all documents' })
  expect(screen.queryByRole('button', { name: /Waiting for review/ })).not.toBeInTheDocument()
})
