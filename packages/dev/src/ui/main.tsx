import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { httpBackend } from './api'
import { DevPortal } from './portal'

const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <DevPortal backend={httpBackend()} nav="hash" style={{ height: '100dvh' }} />
    </StrictMode>,
  )
