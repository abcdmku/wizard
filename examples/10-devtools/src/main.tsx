import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createPipelineWizard } from './wizard'
import '@openwizard/devtools/style.css'
import './styles.css'

const wizard = createPipelineWizard()

const root = document.getElementById('root')
if (root === null) throw new Error('#root not found')
createRoot(root).render(
  <StrictMode>
    <App wizard={wizard} />
  </StrictMode>,
)
