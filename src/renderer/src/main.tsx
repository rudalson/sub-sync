import { createRoot } from 'react-dom/client'
import { initializeNativeApi } from './api'
import './styles.css'

async function start() {
  await initializeNativeApi()
  // The store reads window.api at module initialization.
  const { App } = await import('./App')
  createRoot(document.getElementById('root')!).render(<App />)
}

void start().catch((error) => {
  document.getElementById('root')!.textContent = `앱을 시작할 수 없습니다: ${String(error)}`
})
