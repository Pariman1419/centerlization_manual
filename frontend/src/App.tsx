import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Icon } from './components/Icon'
import { Breadcrumb } from './components/DetailNavigation'
import { ProjectsPage } from './pages/ProjectsPage'
import { LoginPage } from './pages/LoginPage'
import { ManualDetailPage } from './pages/ManualDetailPage'
import { ProjectDetailPage } from './pages/ProjectDetailPage'
import { TemplatesPage } from './pages/TemplatesPage'
import { WorkflowGuidePage } from './pages/WorkflowGuidePage'
import { authApi } from './api/auth'
import { errorMessage } from './api/manuals'
import type { User } from './types/user'

const UsersPage = lazy(() => import('./pages/UsersPage').then(m => ({ default: m.UsersPage })))
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage').then(m => ({ default: m.ChangePasswordPage })))

export function App() {
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [user, setUser] = useState<User|null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  useEffect(() => { setMenuOpen(false) }, [location.pathname])
  useEffect(() => {
    let active = true
    const expired = () => { if (active) setUser(null) }
    window.addEventListener('manual-auth-required', expired)
    authApi.me().then(session => { if (active) setUser(session.user) }).catch(() => { if (active) setUser(null) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; window.removeEventListener('manual-auth-required', expired) }
  }, [])
  async function logout() {
    if (loggingOut) return
    setLoggingOut(true); setAuthError('')
    try { await authApi.logout(); setUser(null) } catch (err) { setAuthError(errorMessage(err)) }
    finally { setLoggingOut(false) }
  }
  if (loading) return <main className="min-h-screen bg-slate-50 p-12 text-center text-slate-500" aria-busy="true">Loading Manual Management…</main>
  if (!user) return <Routes><Route path="/login" element={<LoginPage onLoggedIn={setUser} />} /><Route path="*" element={<Navigate to="/login" replace />} /></Routes>
  if (user.must_change_password) return <main className="min-h-screen bg-slate-50">
    <Suspense fallback={<div className="panel p-12 text-center text-slate-500" aria-busy="true">Loading…</div>}>
      <Routes>
        <Route path="/change-password" element={<ChangePasswordPage forced onChanged={setUser} onLogout={logout} />} />
        <Route path="*" element={<Navigate to="/change-password" replace />} />
      </Routes>
    </Suspense>
  </main>
  const currentPage = location.pathname.startsWith('/users')
    ? 'Users'
    : location.pathname.startsWith('/templates')
    ? 'Templates'
    : location.pathname.startsWith('/guidelines')
    ? 'Guidelines & Workflow'
    : location.pathname.startsWith('/change-password')
    ? 'Change password'
    : location.pathname.startsWith('/manuals/')
    ? 'Manual details'
    : /^\/projects\/\d+/.test(location.pathname)
    ? 'Project details'
    : 'Projects'

  return <div className="app-shell">
    <a href="#main-content" className="skip-link">Skip to main content</a>
    <aside className="sidebar">
      <Link to="/projects" className="brand" aria-label="Manual Management home"><Icon name="book" size={34} /><span>Manual<br />Management</span></Link>
      <nav aria-label="Main navigation" className="sidebar-nav">
        <NavLink to="/projects" className={({ isActive }) => `sidebar-link ${isActive || location.pathname.startsWith('/manuals/') ? 'is-active' : ''}`}>
          <Icon name="folder" />
          <span>Projects</span>
        </NavLink>
        <NavLink to="/templates" className={({ isActive }) => `sidebar-link ${isActive ? 'is-active' : ''}`}>
          <Icon name="template" />
          <span>Templates</span>
        </NavLink>
        <NavLink to="/guidelines" className={({ isActive }) => `sidebar-link ${isActive ? 'is-active' : ''}`}>
          <Icon name="guide" />
          <span>Guidelines</span>
        </NavLink>
        {user.role === 'ADMIN' && (
          <NavLink to="/users" className={({ isActive }) => `sidebar-link ${isActive ? 'is-active' : ''}`}>
            <Icon name="users" />
            <span>Users</span>
          </NavLink>
        )}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-account"><span className="avatar">{user.display_name.slice(0, 2).toUpperCase()}</span><div className="min-w-0"><p className="font-semibold break-words">{user.display_name}</p><p className="sidebar-caption">{user.role === 'ADMIN' ? 'Administrator' : 'Workspace member'}</p></div></div>
        <Link to="/change-password" className="sidebar-link"><Icon name="lock" /><span>Change password</span></Link>
        <button className="sidebar-link w-full" disabled={loggingOut} onClick={logout}><Icon name="logout" /><span>{loggingOut ? 'Logging out…' : 'Log out'}</span></button>
      </div>
    </aside>
    <div className="workspace">
      <header className="workspace-header">
        <div className="mobile-brand"><Icon name="book" size={25} /><span>Manual Management</span></div>
        <Breadcrumb label="Workspace breadcrumb" className="workspace-breadcrumb" items={[{ label: 'Workspace', to: '/projects' }, { label: currentPage }]} />
        <div className="header-account"><span className="avatar avatar-light">{user.display_name.slice(0, 2).toUpperCase()}</span><span>{user.display_name}</span></div>
        <button type="button" className="mobile-menu-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(!menuOpen)}><Icon name={menuOpen ? 'close' : 'menu'} /></button>
      </header>
      {menuOpen && <nav id="mobile-navigation" className="mobile-navigation" aria-label="Mobile navigation">
        <NavLink to="/projects"><Icon name="folder" />Projects</NavLink>
        <NavLink to="/templates"><Icon name="template" />Templates</NavLink>
        <NavLink to="/guidelines"><Icon name="guide" />Guidelines</NavLink>
        {user.role === 'ADMIN' && <NavLink to="/users"><Icon name="users" />Users</NavLink>}
        <Link to="/change-password"><Icon name="lock" />Change password</Link>
        <button disabled={loggingOut} onClick={logout}><Icon name="logout" />{loggingOut ? 'Logging out…' : 'Log out'}</button>
      </nav>}
    <main id="main-content" tabIndex={-1} className="workspace-content">
      {authError && <p role="alert" className="error mb-5">{authError}</p>}
      <Suspense fallback={<div className="panel p-12 text-center text-slate-500 animate-pulse" aria-busy="true">Loading content…</div>}>
        <Routes>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/guidelines" element={<WorkflowGuidePage />} />
          <Route path="/change-password" element={<ChangePasswordPage onChanged={setUser} />} />
          <Route path="/login" element={<Navigate to="/projects" replace />} />
          <Route path="/manuals" element={<Navigate to="/projects" replace />} />
          <Route path="/users" element={user.role === 'ADMIN' ? <UsersPage /> : <Navigate to="/projects" replace />} />
          <Route path="/manuals/:id" element={<ManualDetailPage currentUsername={user.username} />} />
          <Route path="*" element={<div className="panel p-8"><h1 className="text-xl font-semibold">Page not found</h1><Link to="/projects" className="mt-4 inline-block text-blue-800 underline">Back to Projects</Link></div>} />
        </Routes>
      </Suspense>
    </main>
    </div>
  </div>
}
