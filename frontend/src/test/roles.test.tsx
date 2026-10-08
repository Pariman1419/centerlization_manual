import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManualDetailPage } from '../pages/ManualDetailPage'
import { ProjectDetailPage } from '../pages/ProjectDetailPage'

const base = { manual_id: 1, revision_detail: 'd', file_name: 'm.pdf', file_size: 1, mime_type: 'application/pdf', checksum: 'c',
  uploaded_by: 'BA02', uploaded_at: '2026-10-07T00:00:00Z', published_by: null, published_at: null }
const revisions = [
  { ...base, id: 1, revision_no: '01', status: 'DRAFT' },
  { ...base, id: 2, revision_no: '02', status: 'IN_REVIEW', submitted_by: 'BA02' },
  { ...base, id: 3, revision_no: '03', status: 'APPROVED' },
  { ...base, id: 4, revision_no: '04', status: 'REJECTED' },
]
const manual = { id: 1, project_id: 1, project_code: 'P', project_name: 'Project', manual_code: 'M-1', title: 'Manual', category: null,
  description: null, status: 'DRAFT', current_revision_id: null, current_revision: null, created_by: 'x',
  created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z' }
const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

function mockRole(role: string | null) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const url = String(input)
    if (url === '/api/projects/1') return reply({ id: 1, project_code: 'P', project_name: 'Project', description: null, status: 'ACTIVE',
      manual_count: 1, my_role: role, created_by: 'x', created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z' })
    if (url === '/api/projects/1/manuals') return reply([manual])
    if (url === '/api/projects/1/members') return reply([])
    if (url.endsWith('/reviews')) return reply([])
    if (url.endsWith('/revisions')) return reply(revisions)
    return reply(manual)
  })
}

async function manualActions(role: string | null) {
  mockRole(role)
  render(<MemoryRouter initialEntries={['/manuals/1']}><Routes><Route path="/manuals/:id" element={<ManualDetailPage />} /></Routes></MemoryRouter>)
  await screen.findByText('Revision History')
  await screen.findByRole('heading', { name: 'Manual' })
  await new Promise(resolve => setTimeout(resolve, 50))   // let the project role request settle
  const has = (name: RegExp | string) => screen.queryByRole('button', { name }) !== null
  return {
    upload: has(/Upload New Revision/), submit: has(/^Submit REV 01 for review$/) && has(/^Submit REV 04 for review$/),
    approve: has('Approve REV 02'), reject: has('Reject REV 02'), publish: has('Publish REV 03'),
  }
}

afterEach(() => vi.restoreAllMocks())

describe('role-based action visibility (backend remains authoritative)', () => {
  it('VIEWER sees no write, review or publish actions', async () => {
    expect(await manualActions('VIEWER')).toEqual({ upload: false, submit: false, approve: false, reject: false, publish: false })
  })
  it('CONTRIBUTOR can upload and submit but not review or publish', async () => {
    expect(await manualActions('CONTRIBUTOR')).toEqual({ upload: true, submit: true, approve: false, reject: false, publish: false })
  })
  it('legacy REVIEWER has the combined BA review and publish permissions', async () => {
    expect(await manualActions('REVIEWER')).toEqual({ upload: true, submit: true, approve: true, reject: true, publish: true })
  })
  it('OWNER can do everything including publish', async () => {
    expect(await manualActions('OWNER')).toEqual({ upload: true, submit: true, approve: true, reject: true, publish: true })
  })
  it('ADMIN can do everything', async () => {
    expect(await manualActions('ADMIN')).toEqual({ upload: true, submit: true, approve: true, reject: true, publish: true })
  })
  it('shows nothing privileged when the role is unknown', async () => {
    expect(await manualActions(null)).toEqual({ upload: false, submit: false, approve: false, reject: false, publish: false })
  })
})

describe('project page actions by role', () => {
  async function projectPage(role: string) {
    mockRole(role)
    render(<MemoryRouter initialEntries={['/projects/1']}><Routes><Route path="/projects/:projectId" element={<ProjectDetailPage />} /></Routes></MemoryRouter>)
    await screen.findByText(`Role: ${role}`)
    return { addManual: screen.queryByRole('button', { name: /Add Manual/ }) !== null }
  }
  it.each([['VIEWER', false], ['CONTRIBUTOR', true], ['REVIEWER', true], ['OWNER', true], ['ADMIN', true]])('%s add-manual=%s', async (role, expected) => {
    expect((await projectPage(role)).addManual).toBe(expected)
  })
})
