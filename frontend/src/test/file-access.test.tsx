import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { PdfPreview } from '../components/PdfPreview'

it('requests backend access for Download and opens the temporary URL', async () => {
  const replace = vi.fn()
  const popup = { opener: {}, location: { replace }, close: vi.fn() }
  const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ url: 'https://files.example/temporary', expires_in: 600 })))
  render(<PdfPreview revisionId={7} />)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Download' }))
  await waitFor(() => expect(replace).toHaveBeenCalledWith('https://files.example/temporary'))
  expect(open).toHaveBeenCalledWith('about:blank', '_blank')
  expect(popup.opener).toBeNull()
  expect(fetchMock.mock.calls[0][0]).toBe('/api/revisions/7/download')
})

it('previews the selected PDF in a dialog on the page and closes it', async () => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ url: 'https://files.example/temporary', expires_in: 600 })))
  render(<PdfPreview revisionId={7} fileId={12} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(await screen.findByTitle('PDF preview')).toHaveAttribute('src', 'https://files.example/temporary')
  expect(screen.getByRole('dialog', { name: 'PDF Preview' })).toBeInTheDocument()
  expect(open).not.toHaveBeenCalled()
  expect(fetchMock.mock.calls[0][0]).toBe('/api/revisions/7/preview?file_id=12')
  await user.click(screen.getByRole('button', { name: 'Close PDF Preview' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('keeps the preview dialog open with a backend file-access error', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ detail: 'File access is temporarily unavailable' }), { status: 502 }))
  render(<PdfPreview revisionId={7} />)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Preview' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable')
  expect(screen.getByRole('dialog', { name: 'PDF Preview' })).toBeInTheDocument()
  expect(screen.queryByTitle('PDF preview')).not.toBeInTheDocument()
})

it('applies descriptive aria-label with filename when fileName prop is provided', () => {
  render(<PdfPreview revisionId={7} fileId={12} fileName="operation-manual.pdf" />)
  expect(screen.getByRole('button', { name: 'Preview operation-manual.pdf' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Download operation-manual.pdf' })).toBeInTheDocument()
})

