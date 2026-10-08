import { request, setCsrfToken } from './manuals'
import type { AuthSession, SystemRole, User, UserInput } from '../types/user'

async function session(path: string, options?: RequestInit) {
  const result = await request<AuthSession>(path, options)
  setCsrfToken(result.csrf_token)
  return result
}

export const authApi = {
  me: () => session('/auth/me'),
  login: (username: string, password: string) => session('/auth/login', {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password}),
  }),
  changePassword: (current_password: string, new_password: string) => session('/auth/change-password', {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({current_password,new_password}),
  }),
  logout: async () => { await request('/auth/logout', {method:'POST'}); setCsrfToken('') },
}
export const usersApi = {
  resetPassword: (id: number, temporary_password: string) => request<{detail:string}>(`/users/${id}/reset-password`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({temporary_password}),
  }),
  list: () => request<User[]>('/users'),
  create: (input: UserInput) => request<User>('/users', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input)}),
  update: (id: number, payload: { display_name?: string; role?: SystemRole; is_active?: boolean }) => request<User>(`/users/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }),
}

export const adminApi = {
  getOverview: () => request<{
    total_users: number
    active_users: number
    total_projects: number
    active_projects: number
    total_manuals: number
    total_revisions: number
    active_sessions: number
    cache_status: string
  }>('/admin/overview'),
  flushCache: () => request<{ status: string; message: string; cache_flushed: boolean }>('/admin/cache/flush', { method: 'POST' }),
  cleanupStaleData: () => request<{ status: string; message: string; deleted_sessions: number }>('/admin/cleanup', { method: 'POST' }),
}
