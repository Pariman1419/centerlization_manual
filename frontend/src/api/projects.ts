import { request } from './manuals'
import type { Project, ProjectInput, ProjectMember, ProjectRole } from '../types/project'
import type { Manual } from '../types/manual'

export const projectsApi = {
  list: () => request<Project[]>('/projects'),
  get: (id: number) => request<Project>(`/projects/${id}`),
  delete: (id: number) => request<{ deleted: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
  create: (input: ProjectInput) => request<Project>('/projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }),
  update: (id: number, input: Partial<ProjectInput> & { status?: 'ACTIVE' | 'ARCHIVED' }) => request<Project>(`/projects/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }),
  manuals: (id: number) => request<Manual[]>(`/projects/${id}/manuals`),
  members: (id: number) => request<ProjectMember[]>(`/projects/${id}/members`),
  addMember: (id: number, input: { user_id?: number; username?: string; role: ProjectRole }) => request<ProjectMember>(`/projects/${id}/members`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }),
  updateMember: (id: number, userId: number, role: ProjectRole) => request<ProjectMember>(`/projects/${id}/members/${userId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }),
  }),
  removeMember: (id: number, userId: number) => request<{ detail: string }>(`/projects/${id}/members/${userId}`, {
    method: 'DELETE',
  }),
}
