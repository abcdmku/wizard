import {
  DeliverySchema,
  FleetDemoTokens,
  type Tenant,
  TenantSchema,
  VehicleSchema,
  ViewerSchema,
} from '@openwizard/fleet-shared'
import { Schema } from 'effect'

export const SeedTokenSchema = Schema.Struct({
  id: Schema.String,
  token: Schema.String,
  viewer: ViewerSchema,
})
export type SeedToken = typeof SeedTokenSchema.Type

export const SeedVehicleSchema = Schema.Struct({
  tenantId: Schema.String,
  vehicle: VehicleSchema,
})
export type SeedVehicle = typeof SeedVehicleSchema.Type

export const SeedDeliverySchema = Schema.Struct({
  tenantId: Schema.String,
  delivery: DeliverySchema,
})
export type SeedDelivery = typeof SeedDeliverySchema.Type

export const FleetSeedDataSchema = Schema.Struct({
  key: Schema.String,
  tenants: Schema.Array(TenantSchema),
  tokens: Schema.Array(SeedTokenSchema),
  vehicles: Schema.Array(SeedVehicleSchema),
  deliveries: Schema.Array(SeedDeliverySchema),
})
export type FleetSeedData = typeof FleetSeedDataSchema.Type

export const FleetSeedIds = {
  lakeshoreTenant: 'tenant-lakeshore',
  redwoodTenant: 'tenant-redwood',
  lakeshorePrimaryVehicle: 'vehicle-lakeshore-1',
  lakeshoreReserveVehicle: 'vehicle-lakeshore-2',
  redwoodPrimaryVehicle: 'vehicle-redwood-1',
  redwoodReserveVehicle: 'vehicle-redwood-2',
  lakeshoreDelivery: 'delivery-1',
  redwoodDelivery: 'delivery-2',
} satisfies Record<string, string>

const decodeTenant = Schema.decodeUnknownSync(TenantSchema)
const decodeViewer = Schema.decodeUnknownSync(ViewerSchema)
const decodeVehicle = Schema.decodeUnknownSync(VehicleSchema)
const decodeDelivery = Schema.decodeUnknownSync(DeliverySchema)

export const demoTenants: ReadonlyArray<Tenant> = [
  decodeTenant({
    id: FleetSeedIds.lakeshoreTenant,
    name: 'Lakeshore Logistics',
    timezone: 'America/Chicago',
  }),
  decodeTenant({
    id: FleetSeedIds.redwoodTenant,
    name: 'Redwood Courier',
    timezone: 'America/Los_Angeles',
  }),
]

export const demoTokens: ReadonlyArray<SeedToken> = [
  {
    id: 'token-lakeshore-dispatch',
    token: FleetDemoTokens.lakeshore,
    viewer: decodeViewer({ tenantId: FleetSeedIds.lakeshoreTenant, role: 'dispatcher' }),
  },
  {
    id: 'token-lakeshore-manager',
    token: FleetDemoTokens.lakeshoreManager,
    viewer: decodeViewer({ tenantId: FleetSeedIds.lakeshoreTenant, role: 'manager' }),
  },
  {
    id: 'token-lakeshore-simulator',
    token: FleetDemoTokens.lakeshoreSimulator,
    viewer: decodeViewer({ tenantId: FleetSeedIds.lakeshoreTenant, role: 'simulator' }),
  },
  {
    id: 'token-redwood-dispatch',
    token: FleetDemoTokens.redwood,
    viewer: decodeViewer({ tenantId: FleetSeedIds.redwoodTenant, role: 'dispatcher' }),
  },
  {
    id: 'token-seed',
    token: FleetDemoTokens.seed,
    viewer: decodeViewer({ tenantId: FleetSeedIds.lakeshoreTenant, role: 'seed' }),
  },
]

export const demoVehicles: ReadonlyArray<SeedVehicle> = [
  {
    tenantId: FleetSeedIds.lakeshoreTenant,
    vehicle: decodeVehicle({
      id: FleetSeedIds.lakeshorePrimaryVehicle,
      label: 'LS-17',
      driverName: 'Maya Chen',
      status: 'en_route',
      position: { x: 18, y: 64, heading: 92 },
      activeDeliveryId: FleetSeedIds.lakeshoreDelivery,
      updatedAt: '2026-01-15T14:00:00.000Z',
    }),
  },
  {
    tenantId: FleetSeedIds.lakeshoreTenant,
    vehicle: decodeVehicle({
      id: FleetSeedIds.lakeshoreReserveVehicle,
      label: 'LS-23',
      driverName: 'Owen Brooks',
      status: 'available',
      position: { x: 34, y: 72, heading: 180 },
      updatedAt: '2026-01-15T14:00:00.000Z',
    }),
  },
  {
    tenantId: FleetSeedIds.redwoodTenant,
    vehicle: decodeVehicle({
      id: FleetSeedIds.redwoodPrimaryVehicle,
      label: 'RW-08',
      driverName: 'Priya Shah',
      status: 'en_route',
      position: { x: 72, y: 38, heading: 248 },
      activeDeliveryId: FleetSeedIds.redwoodDelivery,
      updatedAt: '2026-01-15T14:00:00.000Z',
    }),
  },
  {
    tenantId: FleetSeedIds.redwoodTenant,
    vehicle: decodeVehicle({
      id: FleetSeedIds.redwoodReserveVehicle,
      label: 'RW-14',
      driverName: 'Luis Ortega',
      status: 'available',
      position: { x: 60, y: 24, heading: 12 },
      updatedAt: '2026-01-15T14:00:00.000Z',
    }),
  },
]

export const demoDeliveries: ReadonlyArray<SeedDelivery> = [
  {
    tenantId: FleetSeedIds.lakeshoreTenant,
    delivery: decodeDelivery({
      id: FleetSeedIds.lakeshoreDelivery,
      reference: 'LS-CC-1042',
      status: 'in_transit',
      customer: 'Mercy North Pharmacy',
      origin: 'Lakeshore Cold Storage',
      destination: 'Mercy North Pharmacy',
      eta: '2026-01-15T14:45:00.000Z',
      vehicleId: FleetSeedIds.lakeshorePrimaryVehicle,
      cargo: { label: 'Vaccines', coldChain: true, tempC: 3.2, minC: 2, maxC: 5 },
      procedure: [
        {
          id: 'ls-pickup',
          label: 'Pickup confirmed',
          status: 'complete',
          timestamp: '2026-01-15T13:50:00.000Z',
        },
        { id: 'ls-monitor', label: 'Monitor cold chain', status: 'active' },
        { id: 'ls-deliver', label: 'Confirm delivery', status: 'pending' },
      ],
    }),
  },
  {
    tenantId: FleetSeedIds.redwoodTenant,
    delivery: decodeDelivery({
      id: FleetSeedIds.redwoodDelivery,
      reference: 'RW-2208',
      status: 'in_transit',
      customer: 'Redwood Community Clinic',
      origin: 'Bay Distribution Center',
      destination: 'Redwood Community Clinic',
      eta: '2026-01-15T15:10:00.000Z',
      vehicleId: FleetSeedIds.redwoodPrimaryVehicle,
      cargo: { label: 'Medical supplies', coldChain: false },
      procedure: [
        {
          id: 'rw-pickup',
          label: 'Pickup confirmed',
          status: 'complete',
          timestamp: '2026-01-15T13:55:00.000Z',
        },
        { id: 'rw-deliver', label: 'Confirm delivery', status: 'active' },
      ],
    }),
  },
]

export const fleetSeedData = Schema.decodeUnknownSync(FleetSeedDataSchema)({
  key: 'fleet-demo-v1',
  tenants: demoTenants,
  tokens: demoTokens,
  vehicles: demoVehicles,
  deliveries: demoDeliveries,
})
