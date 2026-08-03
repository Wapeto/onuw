import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerServiceWorker } from './registerServiceWorker'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Only in production builds: `npm run dev` never registers a service worker,
// so local development is unaffected by shell caching.
if (import.meta.env.PROD) {
  registerServiceWorker(navigator.serviceWorker);
}
