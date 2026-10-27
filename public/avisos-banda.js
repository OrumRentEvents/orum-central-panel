// Avisos de cambios en proyectos (lib/avisosProyecto.js): banda arriba de
// Preparación y Mantenimiento con los avisos sin ver y el botón «Visto», y el
// mismo dibujo para la pantalla /avisos.
//   ponerBandaAvisos(elementoDelante)   → banda que se actualiza sola
//   pintarAvisos(contenedor, datos, recargar) → lista (la usa avisos.html)
(function () {
  var css = '' +
    '.av-banda{max-width:680px;margin:12px auto 0;padding:0 16px;}' +
    '.av-banda:empty{display:none;}' +
    '.av-tarjeta{background:#fff;border:0.5px solid #e0cba6;border-left:4px solid #c9a227;border-radius:12px;padding:12px 14px;margin-bottom:10px;font-size:13px;color:#1a1a18;}' +
    '.av-tarjeta.urgente{border-color:#e7b4b4;border-left-color:#A32D2D;background:#fdf6f6;}' +
    '.av-cab{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;}' +
    '.av-tit{font-weight:600;font-size:14px;}' +
    '.av-sub{color:#6b6a64;font-size:12px;margin-top:2px;}' +
    '.av-hora{color:#9a988f;font-size:11px;white-space:nowrap;}' +
    '.av-lineas{margin:8px 0 0;padding:0;list-style:none;}' +
    '.av-lineas li{padding:2px 0;line-height:1.35;}' +
    '.av-lineas li.mas{color:#6b6a64;}' +
    '.av-pie{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px;}' +
    '.av-chip{font-size:11px;padding:3px 8px;border-radius:20px;background:#f3f2ee;color:#6b6a64;}' +
    '.av-chip.ok{background:#EAF3DE;color:#3B6D11;}' +
    '.av-chip.no{background:#FCEBEB;color:#A32D2D;}' +
    '.av-visto{margin-left:auto;background:#1a1a18;color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:14px;font-weight:600;cursor:pointer;}' +
    '.av-visto:disabled{opacity:.5;}' +
    '.av-todos{display:block;text-align:right;font-size:12.5px;color:#8a6d1e;text-decoration:none;margin:-2px 2px 10px;}' +
    '.av-urg{display:inline-block;background:#A32D2D;color:#fff;font-size:10px;font-weight:700;letter-spacing:.5px;padding:2px 6px;border-radius:4px;margin-right:6px;vertical-align:1px;}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function horaDe(iso) {
    var d = new Date(iso), hoy = new Date();
    var h = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === hoy.toDateString() ? h : d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' }) + ' ' + h;
  }

  // Una tarjeta por proyecto (por tanda de cambios). Se enseñan las líneas del
  // aviso que la persona puede marcar (su departamento) o, si no marca
  // ninguno, las de Logística, que lleva el cambio completo.
  function tarjeta(g, datos) {
    var marca = datos.marca || [], areas = datos.areas || {};
    var mios = g.avisos.filter(function (a) { return marca.indexOf(a.area) !== -1; });
    var base = mios[0] || g.avisos.filter(function (a) { return a.area === 'logistica'; })[0] || g.avisos[0];
    var lineas = base.lineas || [];
    var MAX = 12;
    var h = '<div class="av-tarjeta' + (g.urgente ? ' urgente' : '') + '">' +
      '<div class="av-cab"><div><div class="av-tit">' + (g.urgente ? '<span class="av-urg">URGENTE</span>' : '🔔 ') + esc(base.titulo) + '</div>' +
      '<div class="av-sub">Nº ' + esc(g.numero || g.proyecto_id) + ' · ' + esc(g.cliente || '') + (g.entrega ? ' · Entrega ' + esc(g.entrega) : '') + '</div></div>' +
      '<div class="av-hora">' + horaDe(g.creado_en) + '</div></div>' +
      '<ul class="av-lineas">' + lineas.slice(0, MAX).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') +
      (lineas.length > MAX ? '<li class="mas">… y ' + (lineas.length - MAX) + ' más</li>' : '') + '</ul><div class="av-pie">';
    // Quién lo ha visto (los avisos que no marca esta persona)
    g.avisos.forEach(function (a) {
      if (marca.indexOf(a.area) !== -1) return;
      h += '<span class="av-chip ' + (a.visto_en ? 'ok' : 'no') + '">' + esc(areas[a.area] || a.area) + ': ' +
        (a.visto_en ? '✓ visto ' + horaDe(a.visto_en) + (a.visto_nombre && a.visto_nombre !== areas[a.area] ? ' (' + esc(a.visto_nombre) + ')' : '') : 'sin ver') + '</span>';
    });
    mios.forEach(function (a) {
      if (a.visto_en) h += '<span class="av-chip ok">' + esc(areas[a.area]) + ': ✓ visto ' + horaDe(a.visto_en) + (a.visto_nombre && a.visto_nombre !== areas[a.area] ? ' (' + esc(a.visto_nombre) + ')' : '') + '</span>';
      else h += '<button class="av-visto" data-av-visto="' + a.id + '">Visto' + (mios.length > 1 ? ' · ' + esc(areas[a.area]) : '') + '</button>';
    });
    return h + '</div></div>';
  }

  function pintarAvisos(cont, datos, recargar) {
    cont.innerHTML = (datos.proyectos || []).map(function (g) { return tarjeta(g, datos); }).join('');
    cont.onclick = function (e) {
      var b = e.target.closest('[data-av-visto]');
      if (!b) return;
      b.disabled = true;
      fetch('/api/avisos/' + b.getAttribute('data-av-visto') + '/visto', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (!d.ok) { alert(d.error || 'No se ha podido marcar'); b.disabled = false; } else recargar(); })
        .catch(function () { b.disabled = false; });
    };
  }

  // Banda que se actualiza sola: al llegar o verse un aviso (eventos del
  // servidor) y cada minuto por si se corta la conexión.
  function ponerBandaAvisos(delante) {
    if (!delante || document.getElementById('banda-avisos')) return;
    var cont = document.createElement('div');
    cont.id = 'banda-avisos'; cont.className = 'av-banda';
    delante.parentNode.insertBefore(cont, delante);
    function cargar() {
      fetch('/api/avisos?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d || !d.ok) return;
        pintarAvisos(cont, d, cargar);
        // Al pulsar «Visto» la tarjeta desaparece: quién lo vio se consulta en /avisos
        var embebido = /[?&]embebido=1/.test(location.search);
        cont.insertAdjacentHTML('beforeend', '<a class="av-todos" href="/avisos?vista=todos' + (embebido ? '&embebido=1' : '&volver=' + encodeURIComponent(location.pathname)) + '">Ver los avisos de los últimos 3 días y quién los ha visto →</a>');
      }).catch(function () {});
    }
    cargar();
    try { new EventSource('/api/avisos/eventos').onmessage = cargar; } catch (e) {}
    setInterval(function () { if (!document.hidden) cargar(); }, 60000);
  }

  window.ponerBandaAvisos = ponerBandaAvisos;
  window.pintarAvisos = pintarAvisos;
})();
