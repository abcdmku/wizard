import { CircleCheck, X } from 'lucide-react'
import { useState } from 'react'
import { type AppRole, AppShell } from './components/AppShell'
import { CustomerView } from './components/customer/CustomerView'
import { OperatorView } from './components/operator/OperatorView'
import { ErrorBanner, PageSkeleton } from './components/shared/StateViews'
import { useFulfillment } from './use-fulfillment'

export function App() {
  const [role, setRole] = useState<AppRole>(() =>
    window.location.pathname.startsWith('/ops') ? 'operator' : 'customer',
  )
  const state = useFulfillment()

  const changeRole = (next: AppRole) => {
    setRole(next)
    window.history.replaceState({}, '', next === 'operator' ? '/ops/orders' : '/orders')
  }

  return (
    <AppShell
      role={role}
      onRoleChange={changeRole}
      isDemo={state.isDemo}
      refreshing={state.refreshing}
      onRefresh={() => void state.refresh()}
    >
      {state.error && (
        <div className="global-banner-wrap">
          <ErrorBanner message={state.error} retry={() => void state.refresh()} />
        </div>
      )}
      {state.initialLoading ? (
        <PageSkeleton operator={role === 'operator'} />
      ) : role === 'customer' ? (
        <CustomerView state={state} />
      ) : (
        <OperatorView state={state} />
      )}
      {state.notice && (
        <div className="toast" role="status" aria-live="polite">
          <CircleCheck size={18} aria-hidden="true" />
          <span>{state.notice}</span>
          <button type="button" aria-label="Dismiss message" onClick={state.clearNotice}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </AppShell>
  )
}
