import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { TemplatesPage } from '../pages/TemplatesPage'
import { WorkflowGuidePage } from '../pages/WorkflowGuidePage'

describe('New Sidebar Pages: Templates & Guidelines', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders TemplatesPage with empty state and supports uploading a new template', async () => {
    render(
      <MemoryRouter>
        <TemplatesPage />
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Manual Templates' })).toBeInTheDocument()
    expect(screen.getByText(/No Templates Yet/i)).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Upload First Template/i }))
    const dialog = screen.getByRole('dialog', { name: 'Upload Manual Template' })
    expect(dialog).toBeInTheDocument()

    const titleInput = within(dialog).getByPlaceholderText(/Standard Operating Procedure Template/i)
    await user.type(titleInput, 'Welding SOP Template')
    const file = new File(['mock template content'], 'Welding_SOP.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const fileInput = within(dialog).getByLabelText(/Select Template File/)
    await user.upload(fileInput, file)

    const form = dialog.querySelector('form')!
    fireEvent.submit(form)

    expect(await screen.findByRole('status')).toHaveTextContent(/Welding SOP Template.*uploaded/i)
    expect(screen.getByRole('heading', { name: 'Welding SOP Template' })).toBeInTheDocument()
  })

  it('allows adding and editing topics in Table of Contents in WorkflowGuidePage (English default & Thai toggle)', async () => {
    render(
      <MemoryRouter>
        <WorkflowGuidePage />
      </MemoryRouter>
    )
    expect(screen.getByRole('heading', { level: 1, name: /Manual Creation Workflow/i })).toBeInTheDocument()
    expect(screen.getByText(/Standard Manual Structure/i)).toBeInTheDocument()

    const user = userEvent.setup()
    // Click Add New Topic
    await user.click(screen.getByRole('button', { name: /Add Topic/i }))
    const dialog = screen.getByRole('dialog', { name: /Add New Table of Contents Topic/i })
    expect(dialog).toBeInTheDocument()

    await user.type(within(dialog).getByPlaceholderText(/1. Document Header & Control/), '7. Chemical Safety Measures')
    await user.type(within(dialog).getByPlaceholderText(/Type items required/), 'Store in fireproof cabinet\nWear nitrile gloves')

    const form = dialog.querySelector('form')!
    fireEvent.submit(form)

    expect(await screen.findByRole('status')).toHaveTextContent(/New topic.*7. Chemical Safety Measures.*added/i)
    expect(screen.getByRole('heading', { name: '7. Chemical Safety Measures' })).toBeInTheDocument()
    expect(screen.getByText(/Store in fireproof cabinet/i)).toBeInTheDocument()

    // Test Language Switch to Thai
    await user.click(screen.getByRole('button', { name: /ไทย/i }))
    expect(screen.getByText(/คู่มือขั้นตอนการจัดทำและโครงสร้างเนื้อหา/i)).toBeInTheDocument()
    expect(screen.getByText(/สารบัญโครงสร้างเนื้อหาในคู่มือมาตรฐาน/i)).toBeInTheDocument()
  })

  it('renders interactive checklist and tracks progress in WorkflowGuidePage', async () => {
    render(
      <MemoryRouter>
        <WorkflowGuidePage />
      </MemoryRouter>
    )
    const user = userEvent.setup()
    // Switch to Checklist tab
    await user.click(screen.getByRole('button', { name: /4. Pre-flight Checklist/i }))
    expect(screen.getByText(/Pre-flight Quality Checklist/i)).toBeInTheDocument()

    // Toggle checklist checkbox
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThan(0)
    await user.click(checkboxes[0])
    expect(checkboxes[0]).toBeChecked()
    expect(screen.getByText(/1 \/ 6 Passed/i)).toBeInTheDocument()
  })
})
