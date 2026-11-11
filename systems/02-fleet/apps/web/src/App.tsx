import { useCallback, useMemo, useState } from 'react'
import { AuthScreen } from './components/AuthScreen'
import { DeliveryPanel } from './components/DeliveryPanel'
import { DispatchHeader } from './components/DispatchHeader'
import { EscalationQueue } from './components/EscalationQueue'
import { FleetMap } from './components/FleetMap'
import { Icon } from './components/Icon'
import { InterventionDialog } from './components/InterventionDialog'
import { MetricStrip } from './components/MetricStrip'
import { useFleetFeed } from './hooks/useFleetFeed'
import { sendIntervention } from './lib/api'
import { deliveryById, sortEscalations, titleCase } from './lib/dispatch'
import type { Dashboard, InterventionAction } from './model'

const tokenKey = 'openwizard-fleet-token'

function readToken(): string | undefined {
  try {
    return window.sessionStorage.getItem(tokenKey) ?? undefined
  } catch {
    return undefined
  }
}

function writeToken(token: string | undefined): void {
  try {
    if (token) window.sessionStorage.setItem(tokenKey, token)
    else window.sessionStorage.removeItem(tokenKey)
  } catch {
    // Private browsing can disable session storage; in-memory auth still works.
  }
}

function defaultDeliveryId(dashboard: Dashboard): string | undefined {
  const firstEscalation = sortEscalations(dashboard.escalations).at(0)
  if (firstEscalation) return firstEscalation.deliveryId
  return (
    dashboard.deliveries.find((delivery) =>
      ['pending', 'in_transit', 'delayed'].includes(delivery.status),
    )?.id ?? dashboard.deliveries.at(0)?.id
  )
}

interface AuthenticatedAppProps {
  token: string
  onLogout: (message?: string) => void
}

interface Selection {
  delivery: ReturnType<typeof deliveryById>
  effectiveId: string | undefined
  escalation: Dashboard['escalations'][number] | undefined
  vehicle: Dashboard['vehicles'][number] | undefined
}

interface PendingIntervention {
  action: InterventionAction
  commandId: string
  expectedVersion: Dashboard['deliveries'][number]['version']
}

function AuthenticatedApp({ token, onLogout }: AuthenticatedAppProps) {
  const unauthorized = useCallback(
    () => onLogout('That dispatcher token is no longer valid.'),
    [onLogout],
  )
  const feed = useFleetFeed(token, unauthorized)
  const [selectedId, setSelectedId] = useState<string>()
  const [intervention, setIntervention] = useState<PendingIntervention>()
  const [mutationError, setMutationError] = useState<string>()
  const [mutating, setMutating] = useState(false)
  const [notice, setNotice] = useState<string>()

  const selection = useMemo<Selection>(() => {
    const dashboard = feed.dashboard
    if (!dashboard) {
      return {
        delivery: undefined,
        effectiveId: undefined,
        escalation: undefined,
        vehicle: undefined,
      }
    }
    const effectiveId = deliveryById(dashboard, selectedId)
      ? selectedId
      : defaultDeliveryId(dashboard)
    const delivery = deliveryById(dashboard, effectiveId)
    const escalation = sortEscalations(
      dashboard.escalations.filter((item) => item.deliveryId === effectiveId),
    ).at(0)
    const vehicle = dashboard.vehicles.find((item) => item.id === delivery?.vehicleId)
    return { delivery, effectiveId, escalation, vehicle }
  }, [feed.dashboard, selectedId])

  async function confirmIntervention(reason: string): Promise<void> {
    if (!intervention || !selection.delivery) return
    setMutating(true)
    setMutationError(undefined)
    try {
      const dashboard = await sendIntervention(
        token,
        selection.delivery.id,
        intervention.action,
        intervention.commandId,
        reason,
        intervention.expectedVersion,
      )
      feed.applyDashboard(dashboard)
      setNotice(`${titleCase(intervention.action)} accepted for ${selection.delivery.reference}.`)
      setIntervention(undefined)
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : 'The intervention was not accepted.',
      )
    } finally {
      setMutating(false)
    }
  }

  if (!feed.dashboard) {
    return (
      <main className="loading-page" aria-busy={feed.phase === 'loading'}>
        <div className="loading-card">
          <span className={`loading-mark ${feed.phase}`}>
            <Icon name="route" />
          </span>
          <p className="eyebrow">OpenWizard fleet control</p>
          <h1>{feed.phase === 'failed' ? 'Dispatch is unreachable' : 'Loading dispatch'}</h1>
          <p>{feed.error ?? 'Checking the seeded account and opening the live feed.'}</p>
          {feed.phase === 'failed' ? (
            <div className="loading-actions">
              <button className="primary-button" onClick={feed.retry} type="button">
                Try again
              </button>
              <button className="secondary-button" onClick={() => onLogout()} type="button">
                Change account
              </button>
            </div>
          ) : (
            <span className="loading-line" aria-hidden="true" />
          )}
        </div>
      </main>
    )
  }

  const dashboard = feed.dashboard
  return (
    <div className="dispatch-app">
      <DispatchHeader
        dashboard={dashboard}
        onLogout={() => onLogout()}
        phase={feed.phase}
        retryCount={feed.retryCount}
      />
      <main className="dispatch-main">
        {feed.phase === 'reconnecting' ? (
          <div className="reconnect-banner" role="status">
            <Icon name="wifi" />
            <span>Live updates paused. Showing the last confirmed projection.</span>
            <button onClick={feed.retry} type="button">
              Reconnect now
            </button>
          </div>
        ) : null}
        <MetricStrip dashboard={dashboard} />
        <div className="dispatch-grid">
          <FleetMap
            onSelectDelivery={setSelectedId}
            selectedDeliveryId={selection.effectiveId}
            vehicles={dashboard.vehicles}
          />
          <EscalationQueue
            escalations={dashboard.escalations}
            onSelect={setSelectedId}
            selectedDeliveryId={selection.effectiveId}
            timezone={dashboard.tenant.timezone}
          />
          <DeliveryPanel
            delivery={selection.delivery}
            escalation={selection.escalation}
            onIntervene={(nextAction) => {
              setMutationError(undefined)
              setIntervention({
                action: nextAction,
                commandId: crypto.randomUUID(),
                expectedVersion: selection.delivery?.version,
              })
            }}
            timezone={dashboard.tenant.timezone}
            vehicle={selection.vehicle}
          />
        </div>
      </main>
      <div className="toast-region" aria-live="polite" aria-atomic="true">
        {notice ? (
          <div className="success-toast">
            <Icon name="check" />
            {notice}
            <button aria-label="Dismiss message" onClick={() => setNotice(undefined)} type="button">
              <Icon name="close" />
            </button>
          </div>
        ) : null}
      </div>
      {intervention && selection.delivery ? (
        <InterventionDialog
          action={intervention.action}
          busy={mutating}
          delivery={selection.delivery}
          error={mutationError}
          onCancel={() => setIntervention(undefined)}
          onConfirm={(reason) => void confirmIntervention(reason)}
        />
      ) : null}
    </div>
  )
}

export default function App() {
  const [token, setToken] = useState(readToken)
  const [authMessage, setAuthMessage] = useState<string>()

  const logout = useCallback((message?: string) => {
    writeToken(undefined)
    setToken(undefined)
    setAuthMessage(message)
  }, [])

  if (!token) {
    return (
      <AuthScreen
        message={authMessage}
        onAuthenticate={(nextToken) => {
          writeToken(nextToken)
          setAuthMessage(undefined)
          setToken(nextToken)
        }}
      />
    )
  }

  return <AuthenticatedApp onLogout={logout} token={token} />
}
