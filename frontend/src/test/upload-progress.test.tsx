import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { UploadRevisionModal } from '../components/UploadRevisionModal'
import { UploadNetwork } from './upload-network'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ManualDetailPage } from '../pages/ManualDetailPage'

const manual = { id: 7, project_id: 3, project_code: 'SAFE', project_name: 'Safety project', manual_code: 'SAFE-001', title: 'Safety manual', category: 'Operation', description: null, status: 'DRAFT', current_revision_id: null, current_revision: null, created_by: 'dev', created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z' }

async function prepareUpload() {
  const actions = userEvent.setup()
  await actions.type(screen.getByLabelText('Revision Number'), '03')
  await actions.type(screen.getByLabelText('Revision Detail'), 'Safety changes')
  await actions.upload(screen.getByLabelText('Browse File'), new File(['%PDF'], 'safety.pdf', { type: 'application/pdf' }))
  return actions
}

it('shows byte progress, processing after transmission, and preserves inputs when cancelled', async () => {
  UploadNetwork.automatic = false
  const saved = vi.fn(), cancelled = vi.fn()
  render(<UploadRevisionModal manual={manual} onUploaded={saved} onClose={() => {}} onCancelled={cancelled} />)
  const actions = await prepareUpload()
  await actions.click(screen.getByRole('button', { name: 'Upload Draft' }))
  await waitFor(() => expect(UploadNetwork.instances).toHaveLength(1))
  act(() => { UploadNetwork.instances[0].progress(35) })
  expect(screen.getByRole('progressbar', { name: 'File upload' })).toHaveAttribute('value', '35')
  act(() => { UploadNetwork.instances[0].progress(100) })
  expect(screen.getByText(/Files sent.*waiting for the server/i)).toBeInTheDocument()
  await actions.click(screen.getByRole('button', { name: 'Cancel upload' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/Refresh revision history before retrying/i)
  expect(screen.getByLabelText('Revision Number')).toHaveValue('03')
  expect(screen.getByLabelText('Revision Detail')).toHaveValue('Safety changes')
  expect(screen.getByText('safety.pdf')).toBeInTheDocument()
  expect(saved).not.toHaveBeenCalled()
  expect(cancelled).toHaveBeenCalledOnce()
})

it('confirms before discarding edits and selected files on close or Escape', async () => {
  const close = vi.fn()
  render(<UploadRevisionModal manual={manual} onUploaded={() => {}} onClose={close} />)
  const actions = await prepareUpload()
  await actions.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument()
  await actions.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect(close).not.toHaveBeenCalled()
  fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: false, cancelable: true }))
  expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument()
  await actions.click(screen.getByRole('button', { name: 'Discard changes' }))
  expect(close).toHaveBeenCalledOnce()
})

it('keeps selected files until a file-type change is explicitly confirmed', async () => {
  render(<UploadRevisionModal manual={manual} onUploaded={() => {}} onClose={() => {}} />)
  const actions = await prepareUpload()
  await actions.selectOptions(screen.getByLabelText('Type'), 'WORD')
  expect(screen.getByText('safety.pdf')).toBeInTheDocument()
  expect(screen.getByLabelText('Type')).toHaveValue('PDF')
  await actions.click(screen.getByRole('button', { name: 'Keep files' }))
  expect(screen.getByText('safety.pdf')).toBeInTheDocument()
  await actions.selectOptions(screen.getByLabelText('Type'), 'WORD')
  await actions.click(screen.getByRole('button', { name: 'Change type and clear files' }))
  expect(screen.getByLabelText('Type')).toHaveValue('WORD')
  expect(screen.queryByText('safety.pdf')).not.toBeInTheDocument()
})

it('keeps the upload form mounted while the parent refreshes history after cancellation', async () => {
  UploadNetwork.automatic = false
  let manualReads = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
    const path = String(input)
    if (path === '/api/manuals/7' && ++manualReads > 1) return new Promise<Response>(() => {})
    const data = path === '/api/manuals/7' ? manual : path === '/api/projects/3'
      ? { id: 3, my_role: 'OWNER', project_name: 'Safety project' } : []
    return new Response(JSON.stringify(data), { status: 200 })
  })
  render(<MemoryRouter initialEntries={['/manuals/7']}><Routes><Route path="/manuals/:id" element={<ManualDetailPage />} /></Routes></MemoryRouter>)
  const actions = userEvent.setup()
  await actions.click(await screen.findByRole('button', { name: /Upload New Revision/i }))
  await prepareUpload()
  await actions.click(screen.getByRole('button', { name: 'Upload Draft' }))
  await actions.click(screen.getByRole('button', { name: 'Cancel upload' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/Refresh revision history/i)
  expect(screen.getByLabelText('Revision Number')).toHaveValue('03')
  expect(screen.getByText('safety.pdf')).toBeInTheDocument()
})
