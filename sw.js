// Service worker mínimo: permite instalar la app en el teléfono.
// No guarda datos en caché, para que siempre se vea el estado real.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
