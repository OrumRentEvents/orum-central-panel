// Service worker de la app móvil: existe para que se pueda instalar en la
// pantalla de inicio y para recibir los avisos del chat (lib/chatPush.js).
// No cachea nada: todo va a la red, así siempre se ven la versión y los datos
// actuales.
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });

// Aviso de mensaje nuevo en el chat: { titulo, cuerpo, url, tag }
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { cuerpo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'ORUM Chat', {
    body: d.cuerpo || 'Mensaje nuevo',
    icon: '/icons/orum-192.png',
    badge: '/icons/orum-o.png',
    tag: d.tag || 'chat',
    renotify: true,
    data: { url: d.url || '/chat' }
  }));
});

// Al tocar el aviso: si el chat ya está abierto se lleva a ese canal; si no, se abre
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/chat';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
    for (var i = 0; i < lista.length; i++) {
      var c = lista[i];
      if (new URL(c.url).pathname === '/chat' && 'focus' in c) return c.navigate(url).then(function (w) { return (w || c).focus(); });
    }
    return self.clients.openWindow(url);
  }));
});
