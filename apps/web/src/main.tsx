import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { healthSchema, type Health } from '@inv/contracts'

declare global {
  interface Window {
    desktop: { apiConfig(): Promise<{ baseUrl: string; token: string }> }
  }
}

async function loadHealth(): Promise<Health> {
  const { baseUrl, token } = await window.desktop.apiConfig()
  const response = await fetch(`${baseUrl}/health`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return healthSchema.parse(await response.json())
}

function App() {
  const [health, setHealth] = useState<Health>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    loadHealth()
      .then(setHealth)
      .catch((reason: unknown) => setError(String(reason)))
  }, [])

  if (error) return <p data-testid="health-error">{error}</p>
  if (!health) return <p>جاري التحميل…</p>

  return (
    <main>
      <h1>إدارة المخزون</h1>
      <p data-testid="health-status">{health.status}</p>
      <p>
        مرات التشغيل: <span data-testid="boot-count">{health.bootCount}</span>
      </p>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
