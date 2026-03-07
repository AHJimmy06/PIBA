import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DependenciesProvider } from './presentation/context/DependenciesProvider.tsx'
import { AuthProvider } from './presentation/context/AuthContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <DependenciesProvider>
        <App />
      </DependenciesProvider>
    </AuthProvider>
  </StrictMode>,
)
