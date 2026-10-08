import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ManualDetailPage } from '../pages/ManualDetailPage'

const revision = {
  id: 1, manual_id: 1, revision_no: '01', revision_detail: 'Initial file', file_name: 'manual.pdf',
  file_size: 400, mime_type: 'application/pdf', checksum: 'abc', status: 'IN_REVIEW',
  uploaded_by: 'dev1', uploaded_at: '2026-10-07T00:00:00Z', published_by: null, published_at: null,
  content_version: 0, ba_updated_by: null as string | null, updated_at: null as string | null,
  dev_review_requested: false, dev_reviewed_by: null as string | null, dev_changes_requested: null as boolean | null,
  dev_review_comment: null as string | null,
}
const manual = { id: 1, project_id: 1, project_code: 'P', project_name: 'Project', manual_code: 'M-01',
  title: 'Safety Manual', category: 'Operation', description: '', status: 'DRAFT', current_revision_id: null,
  current_revision: null, created_by: 'dev1', created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z' }
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

function mount(initial = revision, role = 'BA') {
  let row = { ...initial }
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/api/projects/1') return response({ id: 1, my_role: role })
    if (url.endsWith('/update-files') && init?.method === 'POST') {
      const form = init.body as FormData
      row = { ...row, status: 'DRAFT', content_version: row.content_version + 1, ba_updated_by: 'ba1',
        file_name: (form.get('pdf_file') as File)?.name ?? row.file_name, revision_detail: String(form.get('revision_detail')) }
      return response(row)
    }
    if (url.endsWith('/request-dev-review') && init?.method === 'POST') {
      row = { ...row, dev_review_requested: true }
      return response(row)
    }
    if (url.endsWith('/dev-review') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body))
      row = { ...row, dev_reviewed_by: 'dev1', dev_changes_requested: body.changes_requested, dev_review_comment: body.comment }
      return response(row)
    }
    if (url.endsWith('/approve') && init?.method === 'POST') { row = { ...row, status: 'APPROVED' }; return response(row) }
    if (url.endsWith('/updates') || url.endsWith('/reviews')) return response([])
    if (url.endsWith('/revisions')) return response([row])
    return response(manual)
  })
  render(<MemoryRouter initialEntries={['/manuals/1']}><Routes>
    <Route path="/manuals/:id" element={<ManualDetailPage currentUsername={role === 'BA' ? 'ba1' : 'dev1'} />} />
  </Routes></MemoryRouter>)
  return fetch
}

describe('BA update and Dev feedback workflow', () => {
  it('BA replaces the file in the same REV and can approve the updated draft directly', async () => {
    const fetch = mount()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Update REV 01' }))
    const dialog = screen.getByRole('dialog', { name: 'Update REV 01' })
    fireEvent.change(within(dialog).getByLabelText('Revision Detail'), { target: { value: 'Safety corrected' } })
    await user.upload(within(dialog).getByLabelText('Browse File'), new File(['%PDF-1.4'], 'corrected.pdf', { type: 'application/pdf' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save Update' }))
    expect(await screen.findByRole('status')).toHaveTextContent('REV 01 updated')
    const call = fetch.mock.calls.find(call => String(call[0]).endsWith('/update-files'))!
    expect((call[1]?.body as FormData).get('expected_version')).toBe('0')
    expect((call[1]?.body as FormData).get('revision_no')).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Approve REV 01' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('button', { name: 'Publish REV 01' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview corrected.pdf' })).toBeInTheDocument()
  })

  it('BA requests Dev review and approval stays unavailable while waiting', async () => {
    mount({ ...revision, status: 'DRAFT', ba_updated_by: 'ba1', content_version: 1 })
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Request Dev review for REV 01' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Request Dev Review' }))
    expect(await screen.findByText('Waiting for Dev review')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve REV 01' })).not.toBeInTheDocument()
  })

  it('Dev can report no further changes and feedback is visible', async () => {
    const fetch = mount({ ...revision, status: 'DRAFT', ba_updated_by: 'ba1', content_version: 1, dev_review_requested: true }, 'CONTRIBUTOR')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Review BA update for REV 01' }))
    const dialog = screen.getByRole('dialog', { name: 'Review BA update — REV 01' })
    await user.type(within(dialog).getByLabelText('Feedback'), 'Looks correct')
    await user.click(within(dialog).getByRole('button', { name: 'No Further Changes' }))
    expect(await screen.findByText('Looks correct')).toBeInTheDocument()
    const call = fetch.mock.calls.find(call => String(call[0]).endsWith('/dev-review'))!
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({ expected_version: 1, changes_requested: false })
    expect(screen.queryByRole('button', { name: 'Approve REV 01' })).not.toBeInTheDocument()
  })

  it('Dev must explain requested changes and cannot update the BA file', async () => {
    mount({ ...revision, status: 'DRAFT', ba_updated_by: 'ba1', content_version: 1, dev_review_requested: true }, 'CONTRIBUTOR')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Review BA update for REV 01' }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Request Changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Feedback is required')
    await user.type(within(dialog).getByLabelText('Feedback'), 'Fix page 2')
    await user.click(within(dialog).getByRole('button', { name: 'Request Changes' }))
    expect(await screen.findByText('Fix page 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Update REV 01' })).not.toBeInTheDocument()
  })

  it('BA can approve after Dev confirms the updated file needs no changes', async () => {
    mount({ ...revision, status: 'DRAFT', ba_updated_by: 'ba1', content_version: 1,
      dev_review_requested: true, dev_reviewed_by: 'dev1', dev_changes_requested: false })
    expect(await screen.findByRole('button', { name: 'Approve REV 01' })).toBeInTheDocument()
  })

  it('Dev can open a new upload from a rejected REV', async () => {
    mount({ ...revision, status: 'REJECTED' }, 'CONTRIBUTOR')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Upload corrected revision for REV 01' }))
    expect(screen.queryByRole('button', { name: 'Submit REV 01 for review' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Upload New Revision' })).toBeInTheDocument()
    expect(screen.getByLabelText('Revision Number')).toBeEnabled()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Update REV 01' })).not.toBeInTheDocument())
  })
})
