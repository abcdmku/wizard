/**
 * Composition root. The only place that knows both halves: it starts the in-page "server" and
 * hands the client its transport. In production `startServer()` disappears from the bundle and
 * `createClient(...)` receives an SSE/WS transport pointing at your API.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createClient } from './client'
import { startServer } from './server'
import './styles.css'

const { transport } = startServer() // ← replace with your SSE/WS/HTTP transport in production
const mirror = createClient(transport)

const root = document.getElementById('root')
if (root === null) throw new Error('#root not found')
createRoot(root).render(
  <StrictMode>
    <App mirror={mirror} />
  </StrictMode>,
)
