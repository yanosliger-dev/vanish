import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { MatrixProvider } from './matrix/client'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MatrixProvider>
      <App />
    </MatrixProvider>
  </React.StrictMode>
)
