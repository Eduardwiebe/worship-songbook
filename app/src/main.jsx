import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { LocaleProvider } from './i18n'
import { ThemeProvider } from './theme.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <LocaleProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </LocaleProvider>
    </ThemeProvider>
  </StrictMode>,
)
