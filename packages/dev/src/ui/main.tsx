import '@openwizard/devtools/style.css'
import './styles.css'
import './page.css'
import './tables.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'

const root = document.getElementById('root')
if (root !== null)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
