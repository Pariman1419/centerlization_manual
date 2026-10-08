export type ProjectRole = 'ADMIN' | 'OWNER' | 'REVIEWER' | 'CONTRIBUTOR' | 'VIEWER' | 'BA' | 'DEV' | 'USER'

export interface ProjectMember {
  id: number
  project_id: number
  user_id: number
  username: string
  display_name: string
  role: ProjectRole
  added_by: number | null
  created_at: string
  updated_at: string
}

export interface Project {
  id: number
  project_code: string
  project_name: string
  owner_user_id: number | null
  description: string | null
  status: 'ACTIVE' | 'ARCHIVED'
  manual_count: number
  my_role?: ProjectRole | 'ADMIN' | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface ProjectInput {
  project_code: string
  project_name: string
  description: string
}
