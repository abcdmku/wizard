export const FleetRoutes = {
  health: '/health',
  dispatch: '/api/dispatch',
  dispatchLive: '/api/dispatch/live',
  intervention: '/api/deliveries/:id/interventions',
  deliverySignal: '/api/deliveries/:id/signals',
  vehicleTelemetry: '/api/vehicles/:id/telemetry',
  coldChainDrill: '/api/drills/cold-chain',
  seed: '/api/seed',
} as const

export const FleetDemoTokens = {
  lakeshore: 'fleet-demo-lakeshore',
  lakeshoreManager: 'fleet-demo-lakeshore-manager',
  lakeshoreSimulator: 'fleet-demo-lakeshore-simulator',
  redwood: 'fleet-demo-redwood',
  seed: 'fleet-demo-seed',
} as const
