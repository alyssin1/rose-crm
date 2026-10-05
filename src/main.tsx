import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/dm-sans'
import './i18n'
import './styles/tokens.css'
import './styles/app.css'
import './styles/extra.css'
import './styles/phase2.css'
import './styles/phase3.css'
import './styles/mobile.css'
import './styles/fixes.css'
import './styles/gcal.css'
import './styles/gcal2.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

