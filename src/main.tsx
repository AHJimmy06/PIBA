import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DependenciesProvider } from './presentation/context/DependenciesProvider.tsx'
import { AuthProvider } from './presentation/context/AuthContext.ts'
import { registerProductionSessionTelemetry } from './infrastructure/api/SessionApi.ts'

registerProductionSessionTelemetry(import.meta.env.PROD)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <DependenciesProvider>
        <App />
      </DependenciesProvider>
    </AuthProvider>
  </StrictMode>,
)
