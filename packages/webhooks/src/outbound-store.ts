import type {
  WebhookDelivery,
  WebhookDeliveryClaim,
  WebhookDeliveryQuery,
  WebhookDeliverySettlement,
  WebhookEnqueueResult,
  WebhookStore,
  WebhookSubscription,
  WebhookSubscriptionPatch,
  WebhookSubscriptionQuery,
} from './outbound-types'

/** In-memory subscription store and delivery queue for tests and local processes. @public */
export class MemoryWebhookStore implements WebhookStore {
  readonly #subscriptions = new Map<string, WebhookSubscription>()
  readonly #deliveries = new Map<string, WebhookDelivery>()
  readonly #deliveryKeys = new Map<string, string>()

  createSubscription(subscription: WebhookSubscription): void {
    const key = subscriptionKey(subscription.tenantId, subscription.id)
    if (this.#subscriptions.has(key)) {
      throw new TypeError(`webhook subscription '${subscription.id}' already exists`)
    }
    this.#subscriptions.set(key, copySubscription(subscription))
  }

  getSubscription(tenantId: string, subscriptionId: string): WebhookSubscription | undefined {
    const subscription = this.#subscriptions.get(subscriptionKey(tenantId, subscriptionId))
    return subscription === undefined ? undefined : copySubscription(subscription)
  }

  listSubscriptions(query: WebhookSubscriptionQuery): readonly WebhookSubscription[] {
    return [...this.#subscriptions.values()]
      .filter(
        (subscription) =>
          subscription.tenantId === query.tenantId &&
          (query.status === undefined || subscription.status === query.status) &&
          (query.event === undefined || subscription.events.includes(query.event)),
      )
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .map(copySubscription)
  }

  updateSubscription(
    tenantId: string,
    subscriptionId: string,
    patch: WebhookSubscriptionPatch,
  ): WebhookSubscription | undefined {
    const key = subscriptionKey(tenantId, subscriptionId)
    const current = this.#subscriptions.get(key)
    if (current === undefined) return undefined
    let next: WebhookSubscription = {
      ...current,
      ...(patch.endpoint === undefined ? {} : { endpoint: patch.endpoint }),
      ...(patch.events === undefined ? {} : { events: [...patch.events] }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      updatedAt: patch.updatedAt,
    }
    if (patch.description === null) {
      const { description: _description, ...withoutDescription } = next
      next = withoutDescription
    } else if (patch.description !== undefined) next = { ...next, description: patch.description }
    if (patch.disabledReason === null) {
      const { disabledReason: _disabledReason, ...withoutDisabledReason } = next
      next = withoutDisabledReason
    } else if (patch.disabledReason !== undefined) {
      next = { ...next, disabledReason: patch.disabledReason }
    }
    this.#subscriptions.set(key, next)
    return copySubscription(next)
  }

  rotateSubscriptionSecret(
    tenantId: string,
    subscriptionId: string,
    secret: string,
    updatedAt: number,
  ): WebhookSubscription | undefined {
    const key = subscriptionKey(tenantId, subscriptionId)
    const current = this.#subscriptions.get(key)
    if (current === undefined) return undefined
    const next = { ...current, secret, updatedAt }
    this.#subscriptions.set(key, next)
    return copySubscription(next)
  }

  deleteSubscription(tenantId: string, subscriptionId: string): boolean {
    return this.#subscriptions.delete(subscriptionKey(tenantId, subscriptionId))
  }

  enqueueDeliveries(deliveries: readonly WebhookDelivery[]): WebhookEnqueueResult {
    const pending: WebhookDelivery[] = []
    const pendingIds = new Set<string>()
    const pendingKeys = new Set<string>()
    let duplicateCount = 0
    for (const delivery of deliveries) {
      const unique = deliveryKey(delivery)
      if (this.#deliveryKeys.has(unique) || pendingKeys.has(unique)) {
        duplicateCount++
        continue
      }
      if (this.#deliveries.has(delivery.id) || pendingIds.has(delivery.id)) {
        throw new TypeError(`webhook delivery '${delivery.id}' already exists`)
      }
      const stored = copyDelivery(delivery)
      pending.push(stored)
      pendingIds.add(stored.id)
      pendingKeys.add(unique)
    }
    for (const delivery of pending) {
      this.#deliveries.set(delivery.id, delivery)
      this.#deliveryKeys.set(deliveryKey(delivery), delivery.id)
    }
    const enqueued = pending.map(copyDelivery)
    return { enqueued, duplicateCount }
  }

  claimDeliveries(claim: WebhookDeliveryClaim): readonly WebhookDelivery[] {
    const due = [...this.#deliveries.values()]
      .filter(
        (delivery) =>
          (delivery.status === 'queued' && delivery.nextAttemptAt <= claim.now) ||
          (delivery.status === 'delivering' &&
            delivery.leaseExpiresAt !== undefined &&
            delivery.leaseExpiresAt <= claim.now),
      )
      .sort(
        (left, right) =>
          left.nextAttemptAt - right.nextAttemptAt ||
          left.createdAt - right.createdAt ||
          left.id.localeCompare(right.id),
      )
      .slice(0, claim.limit)
    return due.map((delivery) => {
      const claimed: WebhookDelivery = {
        ...delivery,
        status: 'delivering',
        leaseId: claim.leaseId,
        leaseExpiresAt: claim.leaseExpiresAt,
        updatedAt: claim.now,
      }
      this.#deliveries.set(claimed.id, claimed)
      return copyDelivery(claimed)
    })
  }

  settleDelivery(
    deliveryId: string,
    leaseId: string,
    settlement: WebhookDeliverySettlement,
  ): boolean {
    const current = this.#deliveries.get(deliveryId)
    if (current === undefined || current.status !== 'delivering' || current.leaseId !== leaseId) {
      return false
    }
    let next: WebhookDelivery
    switch (settlement.kind) {
      case 'deferred':
        next = {
          ...withoutLease(current),
          status: 'queued',
          nextAttemptAt: settlement.nextAttemptAt,
          updatedAt: settlement.at,
          error: settlement.error,
        }
        break
      case 'retry':
        next = {
          ...withoutResponse(withoutLease(current)),
          status: 'queued',
          attemptCount: settlement.attemptCount,
          nextAttemptAt: settlement.nextAttemptAt,
          updatedAt: settlement.at,
          lastAttemptAt: settlement.at,
          error: settlement.error,
          ...(settlement.responseStatus === undefined
            ? {}
            : { responseStatus: settlement.responseStatus }),
        }
        break
      case 'failed':
        next = {
          ...withoutResponse(withoutLease(current)),
          status: 'failed',
          attemptCount: settlement.attemptCount,
          updatedAt: settlement.at,
          lastAttemptAt: settlement.at,
          completedAt: settlement.at,
          error: settlement.error,
          ...(settlement.responseStatus === undefined
            ? {}
            : { responseStatus: settlement.responseStatus }),
        }
        break
      case 'succeeded':
        next = {
          ...withoutError(withoutLease(current)),
          status: 'succeeded',
          attemptCount: settlement.attemptCount,
          updatedAt: settlement.at,
          lastAttemptAt: settlement.at,
          completedAt: settlement.at,
          responseStatus: settlement.responseStatus,
        }
        break
    }
    this.#deliveries.set(deliveryId, next)
    return true
  }

  listDeliveries(query: WebhookDeliveryQuery): readonly WebhookDelivery[] {
    const limit = query.limit ?? 50
    return [...this.#deliveries.values()]
      .filter(
        (delivery) =>
          delivery.tenantId === query.tenantId &&
          delivery.subscriptionId === query.subscriptionId &&
          (query.status === undefined || delivery.status === query.status),
      )
      .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
      .slice(0, limit)
      .map(copyDelivery)
  }

  retryDelivery(
    tenantId: string,
    subscriptionId: string,
    deliveryId: string,
    now: number,
  ): WebhookDelivery | undefined {
    const current = this.#deliveries.get(deliveryId)
    if (
      current === undefined ||
      current.tenantId !== tenantId ||
      current.subscriptionId !== subscriptionId ||
      current.status !== 'failed'
    ) {
      return undefined
    }
    const next: WebhookDelivery = {
      ...withoutAttemptResult(withoutLease(current)),
      status: 'queued',
      attemptCount: 0,
      nextAttemptAt: now,
      updatedAt: now,
    }
    this.#deliveries.set(deliveryId, next)
    return copyDelivery(next)
  }
}

/** Create an in-memory store. Use a durable adapter in production. @public */
export function createMemoryWebhookStore(): MemoryWebhookStore {
  return new MemoryWebhookStore()
}

function subscriptionKey(tenantId: string, subscriptionId: string): string {
  return `${tenantId}\0${subscriptionId}`
}

function deliveryKey(delivery: WebhookDelivery): string {
  return `${delivery.tenantId}\0${delivery.subscriptionId}\0${delivery.messageId}`
}

function copySubscription(subscription: WebhookSubscription): WebhookSubscription {
  return { ...subscription, events: [...subscription.events] }
}

function copyDelivery(delivery: WebhookDelivery): WebhookDelivery {
  return { ...delivery }
}

function withoutLease(delivery: WebhookDelivery): WebhookDelivery {
  const { leaseId: _leaseId, leaseExpiresAt: _leaseExpiresAt, ...rest } = delivery
  return rest
}

function withoutResponse(delivery: WebhookDelivery): Omit<WebhookDelivery, 'responseStatus'> {
  const { responseStatus: _responseStatus, ...rest } = delivery
  return rest
}

function withoutError(delivery: WebhookDelivery): Omit<WebhookDelivery, 'error'> {
  const { error: _error, ...rest } = delivery
  return rest
}

function withoutAttemptResult(
  delivery: WebhookDelivery,
): Omit<WebhookDelivery, 'completedAt' | 'error' | 'lastAttemptAt' | 'responseStatus'> {
  const {
    completedAt: _completedAt,
    error: _error,
    lastAttemptAt: _lastAttemptAt,
    responseStatus: _responseStatus,
    ...rest
  } = delivery
  return rest
}
