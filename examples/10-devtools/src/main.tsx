import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createPipelineRun } from './wizard'
import '@openwizard/devtools/style.css'
import './styles.css'

const run = createPipelineRun()

const root = document.getElementById('root')
if (root === null) throw new Error('#root not found')
createRoot(root).render(
  <StrictMode>
    <App run={run} />
  </StrictMode>,
)
