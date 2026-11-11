import type { FulfillmentApi } from './api-contract'
import { DemoFulfillmentApi } from './demo-api'
import { HttpFulfillmentApi } from './http-api'

export function createFulfillmentApi(): FulfillmentApi {
  if (import.meta.env.VITE_API_MODE === 'live') {
    return new HttpFulfillmentApi(import.meta.env.VITE_API_BASE_URL ?? '/api')
  }
  return new DemoFulfillmentApi()
}
