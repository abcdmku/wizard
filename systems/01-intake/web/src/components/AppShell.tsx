import type { ReactNode } from 'react'

export interface AppShellProps {
  children: ReactNode
  audience?: 'applicant' | 'reviewer'
  applicantName?: string
  headerActions?: ReactNode
}

export function AppShell({
  children,
  audience = 'applicant',
  applicantName,
  headerActions,
}: AppShellProps) {
  const workspaceLabel = audience === 'reviewer' ? 'Reviewer workspace' : 'Grant application portal'

  return (
    <div className="app-shell" data-audience={audience}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="topbar">
        <div className="topbar__inner">
          <a className="brand" href="/" aria-label="OpenWizard home">
            <span className="brand__mark" aria-hidden="true">
              OW
            </span>
            <span className="brand__name">OpenWizard</span>
          </a>
          <div className="topbar__context">
            <span className="topbar__workspace">{workspaceLabel}</span>
            {applicantName ? <span className="topbar__identity">{applicantName}</span> : null}
            {headerActions ? <div className="topbar__actions">{headerActions}</div> : null}
          </div>
        </div>
      </header>
      <main className="app-main" id="main-content" tabIndex={-1}>
        {children}
      </main>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <span>OpenWizard grant intake</span>
          <span>Save your work before leaving this page.</span>
        </div>
      </footer>
    </div>
  )
}
