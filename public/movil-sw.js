// Service worker mínimo de la app móvil: solo existe para que se pueda instalar
// en la pantalla de inicio. No cachea nada: todo va a la red, así siempre se ven
// la versión y los datos actuales.
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
