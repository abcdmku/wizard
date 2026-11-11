export * from './auth'
export * from './common'
export * from './order-input'
export * from './order-view'
export * from './partner'

export const fulfillmentRoutes = {
  customerOrders: '/api/customer/orders',
  customerOrder: '/api/customer/orders/:id',
  customerCancel: '/api/customer/orders/:id/cancel',
  operatorOrders: '/api/operator/orders',
  operatorOrder: '/api/operator/orders/:id',
  operatorFraudApprove: '/api/operator/orders/:id/fraud/approve',
  operatorFraudReject: '/api/operator/orders/:id/fraud/reject',
  partnerWebhook: '/api/webhooks/partner',
  health: '/health',
} as const
