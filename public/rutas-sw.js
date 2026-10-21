// Service worker minimo de la app Rutas: solo existe para que el movil la pueda
// instalar en la pantalla de inicio. No cachea nada (ni la pagina ni /api ni el SSE):
// todo sigue yendo a la red, asi siempre se ve la version y los datos actuales.
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
