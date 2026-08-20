import { order } from './order-definition'

export const reserve = order.task(
  ({ context, deps, idempotencyKey }) =>
    deps.inventory.reserve(context.orderId, { idempotencyKey }),
  {
    idempotent: ({ context }) => `order:${context.orderId}:reserve`,
    retry: { attempts: 3, backoff: 'exponential' },
    timeout: '10s',
    compensate: ({ output, deps }) => deps.inventory.release(output.reservationId),
    next: 'done',
  },
)
