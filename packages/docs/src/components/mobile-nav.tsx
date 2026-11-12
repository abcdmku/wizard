import { X } from 'lucide-react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { site } from '../lib/site'
import { DocsNav } from './docs-nav'
import { ThemeToggle } from './theme-toggle'

/**
 * The navigation drawer for narrow screens. It renders into `document.body`, because the header
 * blurs its backdrop and a fixed element inside it would be sized to the header, not the screen.
 */
export function MobileNav({
  currentSlug,
  onClose,
}: {
  readonly currentSlug: string
  readonly onClose: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return createPortal(
    <div className="docs-mobile-nav-layer">
      <button
        type="button"
        className="docs-mobile-nav-backdrop"
        aria-label="Close navigation"
        onClick={onClose}
      />
      <aside className="docs-mobile-nav-panel" data-nav-scroller>
        <div className="docs-mobile-nav-header">
          <span>Documentation</span>
          <button type="button" onClick={onClose} aria-label="Close navigation">
            <X aria-hidden="true" />
          </button>
        </div>
        <DocsNav currentSlug={currentSlug} onNavigate={onClose} />
        <div className="docs-mobile-nav-footer">
          <a href={site.repositoryUrl} className="docs-mobile-nav-repo">
            GitHub repository
          </a>
          <ThemeToggle />
        </div>
      </aside>
    </div>,
    document.body,
  )
}
