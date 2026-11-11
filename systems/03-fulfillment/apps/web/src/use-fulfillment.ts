import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFulfillmentApi } from './api'
import type { CreateOrder, CustomerOrder, FraudDecision, OperatorOrder } from './contracts'

const api = createFulfillmentApi()

export interface FulfillmentState {
  readonly customerOrders: CustomerOrder[]
  readonly operatorOrders: OperatorOrder[]
  readonly initialLoading: boolean
  readonly refreshing: boolean
  readonly error: string | null
  readonly notice: string | null
  readonly isDemo: boolean
  readonly refresh: () => Promise<void>
  readonly clearNotice: () => void
  readonly isPending: (key: string) => boolean
  readonly actionError: (key: string) => string | undefined
  readonly createOrder: (request: CreateOrder) => Promise<CustomerOrder | undefined>
  readonly cancelOrder: (orderId: string) => Promise<CustomerOrder | undefined>
  readonly decideFraud: (
    orderId: string,
    request: FraudDecision,
  ) => Promise<OperatorOrder | undefined>
}

export function useFulfillment(): FulfillmentState {
  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([])
  const [operatorOrders, setOperatorOrders] = useState<OperatorOrder[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set())
  const [actionErrors, setActionErrors] = useState<ReadonlyMap<string, string>>(() => new Map())

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true)
    else setInitialLoading(true)
    try {
      const [customer, operator] = await Promise.all([
        api.listCustomerOrders(),
        api.listOperatorOrders(),
      ])
      setCustomerOrders(customer)
      setOperatorOrders(operator)
      setError(null)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setInitialLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
  }, [load])

  const begin = useCallback((key: string) => {
    setPending((current) => new Set(current).add(key))
    setActionErrors((current) => {
      const next = new Map(current)
      next.delete(key)
      return next
    })
  }, [])

  const finish = useCallback((key: string) => {
    setPending((current) => {
      const next = new Set(current)
      next.delete(key)
      return next
    })
  }, [])

  const fail = useCallback((key: string, cause: unknown) => {
    setActionErrors((current) => new Map(current).set(key, messageOf(cause)))
  }, [])

  const createOrder = useCallback(
    async (request: CreateOrder) => {
      const key = 'create-order'
      begin(key)
      try {
        const order = await api.createOrder(request)
        setCustomerOrders((current) => [order, ...current])
        setOperatorOrders(await api.listOperatorOrders())
        setNotice('Order created. Payment and inventory checks are running.')
        return order
      } catch (cause) {
        fail(key, cause)
        return undefined
      } finally {
        finish(key)
      }
    },
    [begin, fail, finish],
  )

  const cancelOrder = useCallback(
    async (orderId: string) => {
      const key = `cancel:${orderId}`
      begin(key)
      try {
        const order = await api.cancelOrder(orderId, { reason: 'Customer requested cancellation' })
        setCustomerOrders((current) =>
          current.map((candidate) => (candidate.id === order.id ? order : candidate)),
        )
        setOperatorOrders(await api.listOperatorOrders())
        setNotice('The order is cancelling. Completed work is being reversed.')
        return order
      } catch (cause) {
        fail(key, cause)
        return undefined
      } finally {
        finish(key)
      }
    },
    [begin, fail, finish],
  )

  const decideFraud = useCallback(
    async (orderId: string, request: FraudDecision) => {
      const key = `fraud:${orderId}:${request.decision}`
      begin(key)
      try {
        const order = await api.decideFraud(orderId, request)
        setOperatorOrders((current) =>
          current.map((candidate) => (candidate.id === order.id ? order : candidate)),
        )
        setCustomerOrders(await api.listCustomerOrders())
        setNotice(
          request.decision === 'approve'
            ? 'The order was approved and moved to shipping.'
            : 'The order was rejected. Compensation has started.',
        )
        return order
      } catch (cause) {
        fail(key, cause)
        return undefined
      } finally {
        finish(key)
      }
    },
    [begin, fail, finish],
  )

  return useMemo(
    () => ({
      customerOrders,
      operatorOrders,
      initialLoading,
      refreshing,
      error,
      notice,
      isDemo: api.isDemo,
      refresh: () => load(true),
      clearNotice: () => setNotice(null),
      isPending: (key: string) => pending.has(key),
      actionError: (key: string) => actionErrors.get(key),
      createOrder,
      cancelOrder,
      decideFraud,
    }),
    [
      actionErrors,
      cancelOrder,
      createOrder,
      customerOrders,
      decideFraud,
      error,
      initialLoading,
      load,
      notice,
      operatorOrders,
      pending,
      refreshing,
    ],
  )
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return 'Something went wrong. Try again.'
}
