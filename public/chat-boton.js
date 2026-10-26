// Botón "Chat" con los mensajes sin leer (oct 2026). Lo usan las pantallas
// de las tablets (Preparación y Mantenimiento) y el inicio de la app móvil.
// ponerBotonChat(elemento) lo mete dentro de ese elemento si el usuario
// tiene algún chat; al pulsarlo abre /chat y "Volver" regresa aquí.
// Dentro del panel (?embebido=1) no se pone: el panel tiene su propio Chat.
(function () {
  var CSS = '.chat-btn{position:relative;display:inline-flex;align-items:center;gap:6px;background:#1D9E75;border:none;color:#fff;font-size:13px;font-weight:600;padding:6px 12px;border-radius:6px;cursor:pointer;font-family:inherit;white-space:nowrap}' +
    '.chat-btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.chat-badge{background:#D93025;color:#fff;font-size:11px;font-weight:700;min-width:18px;height:18px;border-radius:9px;padding:0 5px;display:inline-flex;align-items:center;justify-content:center}';
  var ICONO = '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  window.chatSinLeer = function () {
    return fetch('/api/chat/canales').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (d) {
      if (!d || !d.canales || !d.canales.length) return null;
      return d.canales.reduce(function (n, c) { return n + (c.sin_leer || 0); }, 0);
    });
  };

  window.ponerBotonChat = function (contenedor, opciones) {
    if (!contenedor || new URLSearchParams(location.search).get('embebido') === '1') return;
    var o = opciones || {};
    if (!document.getElementById('chat-btn-css')) { var st = document.createElement('style'); st.id = 'chat-btn-css'; st.textContent = CSS; document.head.appendChild(st); }
    var boton = null;
    function actualizar() {
      if (document.hidden) return;
      window.chatSinLeer().then(function (n) {
        if (n === null) { if (boton) boton.remove(); boton = null; return; }
        if (!boton) {
          boton = document.createElement('button');
          boton.className = 'chat-btn';
          boton.onclick = function () { location.href = '/chat?volver=' + encodeURIComponent(location.pathname + location.search); };
          if (o.antesDe && o.antesDe.parentNode === contenedor) contenedor.insertBefore(boton, o.antesDe); else contenedor.appendChild(boton);
        }
        boton.innerHTML = ICONO + 'Chat' + (n ? '<span class="chat-badge">' + n + '</span>' : '');
      });
    }
    actualizar();
    setInterval(actualizar, 30000);
    document.addEventListener('visibilitychange', actualizar);
  };
})();
