import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/auth.css'
import './styles/base.css'
import './styles/dashboard.css'
import './styles/detail.css'
import './styles/dialog.css'
import './styles/map.css'
import './styles/queue.css'
import './styles/responsive.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Missing #root mount element.')

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
