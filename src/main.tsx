import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import {MaintenancePage} from './features/maintenance/MaintenancePage'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{window.location.hash==='#maintenance'?<MaintenancePage/>:<App />}</React.StrictMode>,
)
