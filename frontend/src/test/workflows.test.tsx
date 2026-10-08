import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ManualForm } from '../components/ManualForm'
import { UploadRevisionModal } from '../components/UploadRevisionModal'
import { ManualDetailPage } from '../pages/ManualDetailPage'
import { ManualsPage } from '../pages/ManualsPage'

const revision = { id: 1, manual_id: 1, revision_no: '01', revision_detail: 'Initial release',
  file_name: 'manual.pdf', file_size: 400, mime_type: 'application/pdf', checksum: 'abc',
  status: 'DRAFT', uploaded_by: 'BA01', uploaded_at: '2026-10-07T00:00:00Z', published_by: null, published_at: null }
const manual = { id: 1, project_id: 1, project_code: 'LEGACY', project_name: 'Legacy / Unassigned Manuals', manual_code: 'MAN-001', title: 'Plating Operation Manual', category: 'Operation',
  description: 'Machine instructions', status: 'DRAFT', current_revision_id: null, current_revision: null,
  created_by: 'BA01', created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z' }
let projectRole: string | null = 'OWNER'
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

describe('manual workflows', () => {
  it('rejects combined attachments over the upload limit and keeps the form', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    render(<UploadRevisionModal manual={manual} onUploaded={() => {}} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Revision Number'), { target: { value: '03' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'OTHER' } })
    const files = ['a.txt', 'b.txt'].map(name => {
      const file = new File(['drawing'], name, { type: 'text/plain' })
      Object.defineProperty(file, 'size', { value: 30 * 1024 * 1024 })
      return file
    })
    fireEvent.change(screen.getByLabelText('Browse File'), { target: { files } })
    expect(await screen.findByRole('alert')).toHaveTextContent('combined')
    expect(screen.getByLabelText('Revision Number')).toHaveValue('03')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByText('a.txt')).not.toBeInTheDocument()
  })

  it('creates a manual with metadata and no PDF', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(manual, 201))
    const saved = vi.fn()
    render(<ManualForm onSaved={saved} onCancel={() => {}} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), manual.title)
    await user.click(screen.getByRole('button', { name: 'Create Manual' }))
    await waitFor(() => expect(saved).toHaveBeenCalledWith(manual))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/manuals')
    const sent = JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    expect(sent.manual_code).toBeUndefined()
    expect(sent.category).toBe('THAI')
  })

  it('sends the typed value when category OTHER is chosen', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(manual, 201))
    render(<ManualForm onSaved={() => {}} onCancel={() => {}} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Title'), 'Safety')
    await user.selectOptions(screen.getByLabelText('Category'), 'OTHER')
    await user.type(screen.getByLabelText('Other category'), 'Maintenance')
    await user.click(screen.getByRole('button', { name: 'Create Manual' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).category).toBe('Maintenance')
  })

  it('shows a duplicate code error without closing the form', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ detail: 'Manual code MAN-001 already exists' }, 409))
    const saved = vi.fn()
    render(<ManualForm onSaved={saved} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Manual' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Manual' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(saved).not.toHaveBeenCalled()
  })

  it('uploads a PDF draft with revision detail', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(revision, 201))
    const saved = vi.fn()
    render(<UploadRevisionModal manual={manual} onUploaded={saved} onClose={() => {}} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Revision Number'), '01')
    await user.type(screen.getByLabelText('Revision Detail'), 'Initial release')
    await user.upload(screen.getByLabelText('Browse File'), new File(['%PDF-1.4'], 'manual.pdf', { type: 'application/pdf' }))
    await user.click(screen.getByRole('button', { name: 'Upload Draft' }))
    await waitFor(() => expect(saved).toHaveBeenCalledWith(revision))
    const body = fetchMock.mock.calls[0][1]!.body as FormData
    expect(body.get('revision_no')).toBe('01')
    expect(body.get('revision_detail')).toBe('Initial release')
    expect((body.get('pdf_file') as File).name).toBe('manual.pdf')
  })

  it('uploads a Word file when the Word type is selected', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(revision, 201))
    const saved = vi.fn()
    render(<UploadRevisionModal manual={manual} onUploaded={saved} onClose={() => {}} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Revision Number'), '02')
    await user.selectOptions(screen.getByLabelText('Type'), 'WORD')
    await user.upload(screen.getByLabelText('Browse File'), new File(['PK'], 'manual.docx'))
    await user.click(screen.getByRole('button', { name: 'Upload Draft' }))
    await waitFor(() => expect(saved).toHaveBeenCalledWith(revision))
    const body = fetchMock.mock.calls[0][1]!.body as FormData
    expect((body.get('word_file') as File).name).toBe('manual.docx')
    expect(body.get('pdf_file')).toBeNull()
  })

  it('uploads several files when the Other type is selected', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(revision, 201))
    render(<UploadRevisionModal manual={manual} onUploaded={() => {}} onClose={() => {}} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Revision Number'), '03')
    await user.selectOptions(screen.getByLabelText('Type'), 'OTHER')
    await user.type(screen.getByLabelText('What is it?'), 'Excel')
    await user.upload(screen.getByLabelText('Browse File'), [new File(['x'], 'data.xlsx'), new File(['y'], 'photo.png')])
    await user.click(screen.getByRole('button', { name: 'Upload Draft' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = fetchMock.mock.calls[0][1]!.body as FormData
    expect((body.getAll('other_files') as File[]).map(f => f.name)).toEqual(['data.xlsx', 'photo.png'])
    expect(body.get('other_type')).toBe('Excel')
  })

  it('requires a file and rejects files that do not match the selected type', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    render(<UploadRevisionModal manual={manual} onUploaded={() => {}} onClose={() => {}} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Revision Number'), '04')
    await user.click(screen.getByRole('button', { name: 'Upload Draft' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Select a file')
    await user.selectOptions(screen.getByLabelText('Type'), 'WORD')
    fireEvent.change(screen.getByLabelText('Browse File'), { target: { files: [new File(['x'], 'notes.txt')] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Word file')
    await user.selectOptions(screen.getByLabelText('Type'), 'OTHER')
    fireEvent.change(screen.getByLabelText('Browse File'), { target: { files: [new File(['x'], 'run.exe')] } })
    expect(screen.getByRole('alert')).toHaveTextContent('not allowed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires confirmation, supports cancel and refreshes after publishing', async () => {
    let published = false
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/projects/1') return response({ id: 1, my_role: projectRole })
      if (init?.method === 'POST') { published = true; return response({ ...revision, status: 'PUBLISHED' }) }
      if (url.endsWith('/revisions')) return response([{ ...revision, status: published ? 'PUBLISHED' : 'APPROVED' }])
      return response(published ? { ...manual, status: 'PUBLISHED', current_revision_id: 1, current_revision: { ...revision, status: 'PUBLISHED' } } : manual)
    })
    render(<MemoryRouter initialEntries={['/manuals/1']}><Routes><Route path="/manuals/:id" element={<ManualDetailPage />} /></Routes></MemoryRouter>)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Publish REV 01' }))
    const dialog = screen.getByRole('dialog', { name: 'Publish REV 01?' })
    expect(dialog).toHaveTextContent('previous published revision will be archived')
    expect(published).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(published).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Publish REV 01' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }))
    expect(await screen.findByRole('status')).toHaveTextContent('REV 01 published')
    expect(fetchMock.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
    expect(await screen.findByTestId('current-revision')).toHaveTextContent('REV 01')
  })

  it('filters the list by search, category and status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([manual, { ...manual, id: 2, manual_code: 'MAN-002', title: 'Safety Manual', category: 'Safety', status: 'PUBLISHED' }]))
    render(<MemoryRouter><ManualsPage /></MemoryRouter>)
    const user = userEvent.setup()
    expect(await screen.findByRole('link', { name: 'Safety Manual' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Search'), 'Plating')
    expect(screen.queryByRole('link', { name: 'Safety Manual' })).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Search'))
    await user.selectOptions(screen.getByLabelText('Category filter'), 'Safety')
    expect(screen.queryByRole('link', { name: manual.title })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Status filter'), 'DRAFT')
    expect(screen.getByText('No manuals match your filters.')).toBeInTheDocument()
  })

  it('submits a draft for review', async () => {
    let submitted = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/projects/1') return response({ id: 1, my_role: projectRole })
      if (url.endsWith('/submit-review') && init?.method === 'POST') {
        submitted = true
        return response({ ...revision, status: 'IN_REVIEW', submitted_by: 'BA01', submitted_at: '2026-10-07T00:00:00Z' })
      }
      if (url.endsWith('/reviews')) return response([])
      if (url.endsWith('/revisions')) return response([{ ...revision, status: submitted ? 'IN_REVIEW' : 'DRAFT' }])
      return response(manual)
    })
    render(<MemoryRouter initialEntries={['/manuals/1']}><Routes><Route path="/manuals/:id" element={<ManualDetailPage />} /></Routes></MemoryRouter>)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Submit REV 01 for review' }))
    const dialog = screen.getByRole('dialog', { name: 'Submit REV 01 for Review?' })
    await user.click(within(dialog).getByRole('button', { name: 'Submit for Review' }))
    expect(await screen.findByRole('status')).toHaveTextContent('REV 01 submitted for review')
  })

  it('rejects an in-review revision with a required comment and shows history', async () => {
    let rejected = false
    const reviews = [
      { id: 1, revision_id: 1, reviewer_id: 2, reviewer_username: 'reviewer1', reviewer_display_name: 'Reviewer One', decision: 'REJECTED' as const, comment: 'Needs update on section 2', created_at: '2026-10-07T01:00:00Z' },
    ]
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/projects/1') return response({ id: 1, my_role: projectRole })
      if (url.endsWith('/reject') && init?.method === 'POST') {
        rejected = true
        return response({ ...revision, status: 'REJECTED' })
      }
      if (url.endsWith('/reviews')) return response(rejected ? reviews : [])
      if (url.endsWith('/revisions')) return response([{ ...revision, status: rejected ? 'REJECTED' : 'IN_REVIEW' }])
      return response(manual)
    })
    render(<MemoryRouter initialEntries={['/manuals/1']}><Routes><Route path="/manuals/:id" element={<ManualDetailPage />} /></Routes></MemoryRouter>)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Reject REV 01' }))
    const dialog = screen.getByRole('dialog', { name: 'Reject REV 01?' })
    const rejectBtn = within(dialog).getByRole('button', { name: 'Reject' })
    await user.click(rejectBtn)
    expect(await screen.findByRole('alert')).toHaveTextContent('Comment is required')
    await user.type(within(dialog).getByLabelText(/Reason for Rejection/), 'Needs update on section 2')
    await user.click(rejectBtn)
    expect(await screen.findByRole('status')).toHaveTextContent('REV 01 rejected')
    expect(await screen.findByText('Needs update on section 2')).toBeInTheDocument()
  })

  it('approves an in-review revision and displays approval in review history', async () => {
    let approved = false
    const open = vi.spyOn(window, 'open')
    const reviews = [
      { id: 2, revision_id: 1, reviewer_id: 2, reviewer_username: 'reviewer1', reviewer_display_name: 'Reviewer One', decision: 'APPROVED' as const, comment: 'Looks great!', created_at: '2026-10-07T02:00:00Z' },
      { id: 1, revision_id: 1, reviewer_id: 2, reviewer_username: 'reviewer1', reviewer_display_name: 'Reviewer One', decision: 'REJECTED' as const, comment: 'Previous flaw', created_at: '2026-10-07T01:00:00Z' },
    ]
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url === '/api/projects/1') return response({ id: 1, my_role: projectRole })
      if (url === '/api/revisions/1/preview') return response({ url: 'https://files.example/revision-01.pdf', expires_in: 600 })
      if (url.endsWith('/approve') && init?.method === 'POST') {
        approved = true
        return response({ ...revision, status: 'APPROVED' })
      }
      if (url.endsWith('/reviews')) return response(approved ? reviews : [])
      if (url.endsWith('/revisions')) return response([{ ...revision, status: approved ? 'APPROVED' : 'IN_REVIEW' }])
      return response(manual)
    })
    render(<MemoryRouter initialEntries={['/manuals/1']}><Routes><Route path="/manuals/:id" element={<ManualDetailPage />} /></Routes></MemoryRouter>)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Approve REV 01' }))
    const dialog = screen.getByRole('dialog', { name: 'Approve REV 01?' })
    await user.click(within(dialog).getByRole('button', { name: /Preview/ }))
    expect(await screen.findByTitle('PDF preview')).toHaveAttribute('src', 'https://files.example/revision-01.pdf')
    expect(open).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Close PDF Preview' }))
    expect(approved).toBe(false)
    expect(within(dialog).getByRole('button', { name: 'Approve' })).toBeEnabled()
    await user.type(within(dialog).getByLabelText(/Approval Comments/), 'Looks great!')
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('status')).toHaveTextContent('REV 01 approved')
    expect(await screen.findByRole('button', { name: 'Publish REV 01' })).toBeInTheDocument()
    expect(await screen.findByText('Previous flaw')).toBeInTheDocument()
    expect(await screen.findByText('Looks great!')).toBeInTheDocument()
  })
})
