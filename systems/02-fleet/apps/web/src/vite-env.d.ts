/// <reference types="vite/client" />

interface FleetRuntimeConfig {
  apiUrl?: string
}

interface Window {
  __FLEET_CONFIG__?: FleetRuntimeConfig
}
