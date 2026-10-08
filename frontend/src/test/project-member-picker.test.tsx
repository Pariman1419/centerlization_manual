import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { ProjectDetailPage } from '../pages/ProjectDetailPage'

const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
})

function mockApi(candidateStatus = 200, candidates = [{ id: 8, username: 'jane', display_name: 'Jane Doe', role: 'USER' }]) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/member-candidates')) return reply(candidateStatus === 200 ? candidates : { detail: 'Unable to load users' }, candidateStatus)
    if (url.endsWith('/members') && init?.method === 'POST') return reply({ id: 2, user_id: 8, username: 'jane', display_name: 'Jane Doe', role: JSON.parse(init.body as string).role }, 201)
    if (url.endsWith('/members') || url.endsWith('/manuals')) return reply([])
    return reply({ id: 1, project_name: 'Project', project_code: 'P', my_role: 'OWNER', status: 'ACTIVE' })
  })
}

async function openPicker() {
  render(<MemoryRouter initialEntries={['/projects/1?tab=members']}><Routes>
    <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
  </Routes></MemoryRouter>)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Add Member' }))
  return { user, dialog: screen.getByRole('dialog', { name: 'Add Project Member' }) }
}

afterEach(() => vi.restoreAllMocks())

it.each([['BA', 'OWNER'], ['DEV', 'CONTRIBUTOR'], ['USER', 'VIEWER'], ['ADMIN', 'ADMIN']])(
  'defaults %s users to %s and allows overriding before adding', async (systemRole, projectRole) => {
    const fetchMock = mockApi(200, [{ id: 8, username: 'jane', display_name: 'Jane Doe', role: systemRole }])
    const { user, dialog } = await openPicker()
    const picker = within(dialog).getByRole('combobox', { name: 'User' })
    await within(picker).findByRole('option', { name: 'Jane Doe (jane)' })
    await user.selectOptions(picker, '8')
    const rolePicker = within(dialog).getByRole('combobox', { name: /Role/ })
    expect(rolePicker).toHaveValue(projectRole)
    expect(within(rolePicker).queryByRole('option', { name: /^Reviewer/ })).not.toBeInTheDocument()
    expect(within(rolePicker).getByRole('option', { name: /BA.*Reject/ })).toBeInTheDocument()
    await user.selectOptions(rolePicker, 'ADMIN')
    await user.click(within(dialog).getByRole('button', { name: 'Add Member' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Added jane')
    const call = fetchMock.mock.calls.find(call => call[1]?.method === 'POST')!
    expect(JSON.parse(call[1]!.body as string).role).toBe('ADMIN')
  },
)

it('resets the suggested role when switching users after a manual override', async () => {
  mockApi(200, [
    { id: 8, username: 'jane', display_name: 'Jane Doe', role: 'BA' },
    { id: 9, username: 'dev', display_name: 'Developer', role: 'DEV' },
  ])
  const { user, dialog } = await openPicker()
  const picker = within(dialog).getByRole('combobox', { name: 'User' })
  await within(picker).findByRole('option', { name: 'Jane Doe (jane)' })
  await user.selectOptions(picker, '8')
  const rolePicker = within(dialog).getByRole('combobox', { name: /Role/ })
  await user.selectOptions(rolePicker, 'ADMIN')
  await user.selectOptions(picker, '9')
  expect(rolePicker).toHaveValue('CONTRIBUTOR')
})

it('selects an existing user and submits its ID with the chosen role', async () => {
  const fetchMock = mockApi()
  const { user, dialog } = await openPicker()
  const picker = await within(dialog).findByRole('combobox', { name: 'User' })
  expect(await within(picker).findByRole('option', { name: 'Jane Doe (jane)' })).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Add Member' })).toBeDisabled()
  await user.selectOptions(picker, '8')
  await user.selectOptions(within(dialog).getByRole('combobox', { name: /Role/ }), 'ADMIN')
  await user.click(within(dialog).getByRole('button', { name: 'Add Member' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Added jane')
  const call = fetchMock.mock.calls.find(call => call[1]?.method === 'POST')!
  expect(JSON.parse(call[1]!.body as string)).toEqual({ user_id: 8, role: 'ADMIN' })
})

it('shows a retry action when users cannot be loaded and prevents submission', async () => {
  mockApi(503)
  const { dialog } = await openPicker()
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Unable to load users')
  expect(within(dialog).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Add Member' })).toBeDisabled()
})

it('explains when no active users remain to add', async () => {
  mockApi(200, [])
  const { dialog } = await openPicker()
  expect(await within(dialog).findByText('No active users available to add.')).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Add Member' })).toBeDisabled()
})
