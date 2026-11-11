import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/base.css'
import './styles/entry.css'
import './styles/game.css'
import './styles/overlays.css'
import './styles/responsive.css'

const root = document.getElementById('root')
if (root === null) throw new Error('Missing root element')
createRoot(root).render(<App />)
