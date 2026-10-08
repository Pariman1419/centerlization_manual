export type SystemRole = 'ADMIN' | 'BA' | 'DEV' | 'USER'

export interface User {
  id: number
  username: string
  display_name: string
  role: SystemRole
  is_active: boolean
  must_change_password?: boolean
  created_at: string
}
export interface AuthSession { user: User; csrf_token: string }
export interface UserInput { username: string; display_name: string; password: string; role: SystemRole }
