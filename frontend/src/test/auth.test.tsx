import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { App } from '../App'

const user = { id: 1, username: 'ba01', display_name: 'BA One', role: 'USER', is_active: true, created_at: '2026-10-07T00:00:00Z' }
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json'}})

it('requires login and removes All Manuals from navigation', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({detail:'Please log in'},401))
  render(<MemoryRouter initialEntries={['/projects']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', {name:'Log in'})).toBeInTheDocument()
  expect(screen.queryByRole('link', {name:'All Manuals'})).not.toBeInTheDocument()
  expect(screen.queryByRole('link', {name:'Users'})).not.toBeInTheDocument()
})

it('logs in, shows identity, uses CSRF and logs out', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input)
    if(path === '/api/auth/me') return response({detail:'Please log in'},401)
    if(path === '/api/auth/login') return response({user,csrf_token:'test-csrf'})
    if(path === '/api/auth/logout') return response({detail:'Logged out'})
    return response([])
  })
  render(<MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>)
  const actions = userEvent.setup()
  await actions.type(await screen.findByLabelText('Username'), 'ba01')
  await actions.type(screen.getByLabelText('Password'), 'Test-password-123!')
  await actions.click(screen.getByRole('button', {name:'Log in'}))
  expect(await within(screen.getByRole('complementary')).findByText('BA One')).toBeInTheDocument()
  expect(screen.queryByRole('link', {name:'Users'})).not.toBeInTheDocument()
  await actions.click(screen.getByRole('button', {name:'Log out'}))
  expect(await screen.findByRole('heading', {name:'Log in'})).toBeInTheDocument()
  const logout = fetchMock.mock.calls.find(call => String(call[0]) === '/api/auth/logout')!
  expect(new Headers(logout[1]?.headers).get('X-CSRF-Token')).toBe('test-csrf')
})

it('allows admin to create a user and does not expose password hashes', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async(input, init) => {
    if(String(input) === '/api/auth/me') return response({user:{...user,role:'ADMIN'},csrf_token:'admin-csrf'})
    if(String(input) === '/api/users' && init?.method === 'POST') return response({...user,id:2,username:'ba02',display_name:'BA Two'},201)
    if(String(input) === '/api/users') return response([user])
    return response([])
  })
  render(<MemoryRouter initialEntries={['/users']}><App /></MemoryRouter>)
  const actions = userEvent.setup()
  await actions.click(await screen.findByRole('button', {name:'Add User'}))
  const dialog = screen.getByRole('dialog', {name:'Add User'})
  await actions.type(within(dialog).getByLabelText('Username'), 'ba02')
  await actions.type(within(dialog).getByLabelText('Display Name'), 'BA Two')
  await actions.type(within(dialog).getByLabelText('Password'), 'Test-password-123!')
  await actions.click(within(dialog).getByRole('button', {name:'Create User'}))
  expect(await screen.findByRole('status')).toHaveTextContent('User created successfully')
  const create = fetchMock.mock.calls.find(call => String(call[0]) === '/api/users' && call[1]?.method === 'POST')!
  expect(JSON.parse(create[1]!.body as string).role).toBe('USER')
  expect(new Headers(create[1]?.headers).get('X-CSRF-Token')).toBe('admin-csrf')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('returns to Login when a protected API session expires', async () => {
  vi.spyOn(globalThis,'fetch').mockImplementation(async(input) => String(input) === '/api/auth/me'
    ? response({user,csrf_token:'csrf'}) : response({detail:'Please log in'},401))
  render(<MemoryRouter initialEntries={['/projects']}><App /></MemoryRouter>)
  expect(await screen.findByRole('heading', {name:'Log in'})).toBeInTheDocument()
})


it('confirms which account needs a reset for Forgot password without calling the API', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({detail:'Please log in'},401))
  render(<MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>)
  const actions = userEvent.setup()
  await actions.click(await screen.findByRole('button', {name:'Forgot password?'}))
  const dialog = screen.getByRole('dialog', {name:'Forgot Password'})
  await actions.type(within(dialog).getByLabelText('Username'), 'ba01')
  await actions.click(within(dialog).getByRole('button', {name:'Confirm'}))
  expect(within(dialog).getByText('ba01')).toBeInTheDocument()
  expect(within(dialog).getByText('Only an administrator can reset a password.')).toBeInTheDocument()
  expect(fetchMock.mock.calls.every(call => String(call[0]) === '/api/auth/me')).toBe(true)
})

it('forces users with a temporary password to change it before reaching projects', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input)
    if(path === '/api/auth/me') return response({user:{...user,must_change_password:true},csrf_token:'c1'})
    if(path === '/api/auth/change-password') return response({user,csrf_token:'c2'})
    return response([])
  })
  render(<MemoryRouter initialEntries={['/projects']}><App /></MemoryRouter>)
  const actions = userEvent.setup()
  expect(await screen.findByRole('heading', {name:'Change Password'})).toBeInTheDocument()
  expect(screen.queryByRole('link', {name:'Projects'})).not.toBeInTheDocument()
  await actions.type(screen.getByLabelText('Current Password'), 'Temporary-pass-456!')
  await actions.type(screen.getByLabelText('New Password'), 'Brand-new-pass-789!')
  await actions.type(screen.getByLabelText('Confirm New Password'), 'Different-pass-000!')
  await actions.click(screen.getByRole('button', {name:'Change Password'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('do not match')
  await actions.clear(screen.getByLabelText('Confirm New Password'))
  await actions.type(screen.getByLabelText('Confirm New Password'), 'Brand-new-pass-789!')
  await actions.click(screen.getByRole('button', {name:'Change Password'}))
  expect(await screen.findByRole('heading', {name:'Projects'})).toBeInTheDocument()
  const change = fetchMock.mock.calls.find(call => String(call[0]) === '/api/auth/change-password')!
  expect(JSON.parse(change[1]!.body as string)).toEqual({current_password:'Temporary-pass-456!', new_password:'Brand-new-pass-789!'})
  expect(new Headers(change[1]?.headers).get('X-CSRF-Token')).toBe('c1')
})

it('lets admin reset a password with confirmation and does not keep it afterwards', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = String(input)
    if(path === '/api/auth/me') return response({user:{...user,role:'ADMIN'},csrf_token:'admin-csrf'})
    if(path === '/api/users/7/reset-password') return response({detail:'ok'})
    if(path === '/api/users') return response([{...user,id:7,username:'ba07'}])
    return response([])
  })
  render(<MemoryRouter initialEntries={['/users']}><App /></MemoryRouter>)
  const actions = userEvent.setup()
  await actions.click(await screen.findByRole('button', {name:'Reset Password for ba07'}))
  const dialog = screen.getByRole('dialog', {name:'Reset Password'})
  await actions.type(within(dialog).getByLabelText('Temporary Password'), 'Temporary-pass-456!')
  await actions.type(within(dialog).getByLabelText('Confirm Temporary Password'), 'Mismatch-pass-000!')
  await actions.click(within(dialog).getByRole('button', {name:'Reset Password'}))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('do not match')
  await actions.clear(within(dialog).getByLabelText('Confirm Temporary Password'))
  await actions.type(within(dialog).getByLabelText('Confirm Temporary Password'), 'Temporary-pass-456!')
  await actions.click(within(dialog).getByRole('button', {name:'Reset Password'}))
  expect(await screen.findByRole('status')).toHaveTextContent('Password reset for ba07')
  const call = fetchMock.mock.calls.find(c => String(c[0]) === '/api/users/7/reset-password')!
  expect(JSON.parse(call[1]!.body as string)).toEqual({temporary_password:'Temporary-pass-456!'})
  expect(new Headers(call[1]?.headers).get('X-CSRF-Token')).toBe('admin-csrf')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.queryByText(/Temporary-pass-456!/)).not.toBeInTheDocument()
})
