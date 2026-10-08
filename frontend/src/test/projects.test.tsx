import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { App } from '../App'
import { UploadRevisionModal } from '../components/UploadRevisionModal'

const project = { id: 2, project_code: 'PRJ-PLATING', project_name: 'Plating Machine', description: 'Plating machine manuals', status: 'ACTIVE', manual_count: 1, my_role: 'OWNER', created_by: 'BA01', created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z' }
const manual = { id: 3, project_id: 2, project_code: 'PRJ-PLATING', project_name: 'Plating Machine', manual_code: 'MAN-PLATING-001', title: 'Operation Manual', category: 'Operation', description: 'Operating instructions', status: 'DRAFT', current_revision_id: null, current_revision: null, created_by: 'BA01', created_at: '2026-10-07T00:00:00Z', updated_at: '2026-10-07T00:00:00Z' }
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

function mockApi() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input)
    if (path === '/api/auth/me') return response({user:{id:1,username:'ba01',display_name:'BA01',role:'USER',is_active:true,created_at:'2026-10-07T00:00:00Z'},csrf_token:'project-test-csrf'})
    if (path === '/api/projects' && init?.method === 'POST') return response(project, 201)
    if (path === '/api/projects/2' && init?.method === 'DELETE') return response({ deleted: true })
    if (path === '/api/projects/2/manuals' && init?.method === 'POST') return response(manual, 201)
    if (path === '/api/projects') return response([project])
    if (path === '/api/projects/2') return response(project)
    if (path === '/api/projects/2/manuals') return response([manual])
    if (path === '/api/manuals/3') return response(manual)
    if (path === '/api/manuals/3/revisions') return response([])
    if (path === '/api/manuals') return response([manual])
    return response({ detail: 'Not found' }, 404)
  })
}

it('confirms project deletion, allows cancellation and removes the card after success', async () => {
  const fetchMock = mockApi()
  render(<MemoryRouter initialEntries={['/projects']}><App /></MemoryRouter>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Delete Project Plating Machine' }))
  let dialog = screen.getByRole('dialog', { name: 'Delete Project' })
  expect(within(dialog).getByText(/all.*manuals.*revisions.*files/i)).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(fetchMock.mock.calls.some(call => call[1]?.method === 'DELETE')).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Delete Project Plating Machine' }))
  dialog = screen.getByRole('dialog', { name: 'Delete Project' })
  await user.click(within(dialog).getByRole('button', { name: 'Delete Project' }))
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Open Project Plating Machine' })).not.toBeInTheDocument())
  expect(fetchMock.mock.calls.some(call => call[0] === '/api/projects/2' && call[1]?.method === 'DELETE')).toBe(true)
  expect(screen.getByText(/Project PRJ-PLATING deleted/)).toBeInTheDocument()
})

it('keeps the project and confirmation dialog when deletion fails', async () => {
  const fetchMock = mockApi()
  const implementation = fetchMock.getMockImplementation()!
  fetchMock.mockImplementation((input, init) => init?.method === 'DELETE' ? Promise.resolve(response({ detail: 'Delete failed' }, 500)) : implementation(input, init))
  render(<MemoryRouter initialEntries={['/projects']}><App /></MemoryRouter>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Delete Project Plating Machine' }))
  const dialog = screen.getByRole('dialog', { name: 'Delete Project' })
  await user.click(within(dialog).getByRole('button', { name: 'Delete Project' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Delete failed')
  expect(screen.getByRole('link', { name: 'Open Project Plating Machine' })).toBeInTheDocument()
})

it('opens Projects by default and navigates into its manuals', async () => {
  mockApi()
  render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument()
  expect(await screen.findByText('1 Manual')).toBeInTheDocument()
  await userEvent.setup().click(screen.getByRole('link', { name: 'Open Project Plating Machine' }))
  expect(await screen.findByRole('heading', { name: 'Plating Machine' })).toBeInTheDocument()
  expect(await screen.findByRole('link', { name: 'Operation Manual' })).toBeInTheDocument()
  expect(screen.getByText('MAN-PLATING-001')).toBeInTheDocument()
})

it('creates a project using the existing dialog and opens it with success feedback', async () => {
  const fetchMock = mockApi()
  render(<MemoryRouter initialEntries={['/projects']}><App /></MemoryRouter>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'New Project' }))
  const dialog = screen.getByRole('dialog', { name: 'Create Project' })
  await user.type(within(dialog).getByLabelText('Project Code'), 'PRJ-PLATING')
  await user.type(within(dialog).getByLabelText('Project Name'), 'Plating Machine')
  await user.type(within(dialog).getByLabelText('Description'), 'Plating machine manuals')
  await user.click(within(dialog).getByRole('button', { name: 'Create Project' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Project created successfully')
  expect(await screen.findByRole('heading', { name: 'Plating Machine' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const call = fetchMock.mock.calls.find(call => call[1]?.method === 'POST')!
  expect(call[0]).toBe('/api/projects')
  expect(JSON.parse(call[1]!.body as string).project_code).toBe('PRJ-PLATING')
})

it('adds a manual within a project without another project selector', async () => {
  const fetchMock = mockApi()
  render(<MemoryRouter initialEntries={['/projects/2']}><App /></MemoryRouter>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Add Manual' }))
  const dialog = screen.getByRole('dialog', { name: 'Add Manual' })
  expect(within(dialog).getByText('Plating Machine')).toBeInTheDocument()
  await user.type(within(dialog).getByLabelText('Title'), 'Operation Manual')
  await user.click(within(dialog).getByRole('button', { name: 'Create Manual' }))
  expect(await screen.findByRole('heading', { name: 'Operation Manual' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Plating Machine' })).toHaveAttribute('href', '/projects/2')
  const call = fetchMock.mock.calls.find(call => call[1]?.method === 'POST')!
  expect(call[0]).toBe('/api/projects/2/manuals')
  expect(JSON.parse(call[1]!.body as string)).not.toHaveProperty('project_id')
})

it('shows the project breadcrumb on manual detail and returns to project detail', async () => {
  mockApi()
  render(<MemoryRouter initialEntries={['/manuals/3']}><App /></MemoryRouter>)
  const user = userEvent.setup()
  const breadcrumb = await screen.findByRole('navigation', { name: 'Breadcrumb' })
  expect(within(breadcrumb).getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/projects')
  expect(within(breadcrumb).getByRole('link', { name: 'Plating Machine' })).toHaveAttribute('href', '/projects/2')
  expect(screen.getByText('PRJ-PLATING')).toBeInTheDocument()
  await user.click(within(breadcrumb).getByRole('link', { name: 'Plating Machine' }))
  expect(await screen.findByRole('heading', { name: 'Plating Machine' })).toBeInTheDocument()
})

it('shows project context on the existing upload dialog and preserves upload fields', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ id: 9, revision_no: '01' }, 201))
  const uploaded = vi.fn()
  render(<UploadRevisionModal manual={manual} onUploaded={uploaded} onClose={() => {}} />)
  expect(screen.getByText('Project: Plating Machine')).toBeInTheDocument()
  expect(screen.getByText('Operation Manual')).toBeInTheDocument()
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Revision Number'), '01')
  await user.upload(screen.getByLabelText('Browse File'), new File(['%PDF-1.4'], 'operation.pdf', { type: 'application/pdf' }))
  await user.click(screen.getByRole('button', { name: 'Upload Draft' }))
  await waitFor(() => expect(uploaded).toHaveBeenCalled())
  expect(fetchMock.mock.calls[0][0]).toBe('/api/manuals/3/revisions')
})

it('keeps project creation open on duplicate errors', async () => {
  mockApi().mockImplementation(async (input, init) => {
    if (String(input) === '/api/auth/me') return response({user:{id:1,username:'ba01',display_name:'BA01',role:'USER',is_active:true,created_at:'2026-10-07T00:00:00Z'},csrf_token:'project-test-csrf'})
    return init?.method === 'POST' ? response({ detail: 'Project code PRJ-PLATING already exists' }, 409) : response([])
  })
  render(<MemoryRouter initialEntries={['/projects']}><App /></MemoryRouter>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'New Project' }))
  fireEvent.change(screen.getByLabelText('Project Code'), { target: { value: 'PRJ-PLATING' } })
  fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Plating Machine' } })
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Create Project' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('displays my_role badge on project cards for regular users', async () => {
  const projectWithRole = { ...project, my_role: 'CONTRIBUTOR' }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input)
    if (path === '/api/auth/me') return response({ user: { id: 1, username: 'ba01', display_name: 'BA01', role: 'USER' }, csrf_token: 'csrf' })
    if (path === '/api/projects') return response([projectWithRole])
    return response({ detail: 'Not found' }, 404)
  })
  render(<MemoryRouter initialEntries={['/projects']}><App /></MemoryRouter>)
  expect(await screen.findByText('CONTRIBUTOR')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Delete Project/ })).not.toBeInTheDocument()
})

it('switches between Manuals and Members tabs and lists project members', async () => {
  const member = {
    id: 1,
    project_id: 2,
    user_id: 1,
    username: 'ba01',
    display_name: 'BA01',
    role: 'OWNER',
    added_by: null,
    created_at: '2026-10-07T00:00:00Z',
    updated_at: '2026-10-07T00:00:00Z',
  }
  const projectWithOwnerRole = { ...project, my_role: 'OWNER' }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input)
    if (path === '/api/auth/me') return response({ user: { id: 1, username: 'ba01', display_name: 'BA01', role: 'USER' }, csrf_token: 'csrf' })
    if (path === '/api/projects/2') return response(projectWithOwnerRole)
    if (path === '/api/projects/2/manuals') return response([manual])
    if (path === '/api/projects/2/members') return response([member])
    return response({ detail: 'Not found' }, 404)
  })
  render(<MemoryRouter initialEntries={['/projects/2']}><App /></MemoryRouter>)
  const user = userEvent.setup()
  expect(await screen.findByRole('tab', { name: 'Manuals (1)' })).toBeInTheDocument()
  const membersTab = screen.getByRole('tab', { name: 'Members (1)' })
  await user.click(membersTab)
  expect(await screen.findByRole('heading', { name: 'Members' })).toBeInTheDocument()
  expect(screen.getByText('ba01')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add Member' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Change Role' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
})
