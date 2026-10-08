import type { ProjectRole } from '../types/project'

export type EffectiveRole = ProjectRole | 'ADMIN' | null | undefined

const LEVEL: Record<string, number> = {
  VIEWER: 1,
  USER: 1,
  CONTRIBUTOR: 2,
  DEV: 2,
  REVIEWER: 3,
  OWNER: 4,
  BA: 4,
  ADMIN: 5,
}

// UI convenience only: the backend re-checks every action.
export function atLeast(role: EffectiveRole, minimum: ProjectRole): boolean {
  if (!role) return false
  return (LEVEL[role] ?? 0) >= (LEVEL[minimum] ?? 0)
}
