import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

// Someone opening a share link isn't using the app: don't install the offline
// app (and precache it) for them. Band members already have it installed.
if (!window.location.pathname.startsWith('/share/')) {
  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Check for new SW every 60 seconds
      setInterval(() => registration.update(), 60 * 1000);
    },
  })
}

// When a new SW takes control, reload to pick up fresh precached assets. Not on
// the first install (no SW controlled the page yet): the page already has the
// current assets, and reloading would throw away whatever the visitor is doing.
const hadController = !!navigator.serviceWorker?.controller;
let refreshing = false;
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (refreshing || !hadController) return;
  refreshing = true;
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
