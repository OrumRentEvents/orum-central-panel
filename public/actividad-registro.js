// Registro de actividad desde el navegador (lib/actividad.js): qué pantalla y
// qué ficha abre cada persona, y el aviso (una sola vez) de que su actividad
// en ORUM Central queda registrada.
//   registrarVista('pantalla', 'Caja')
//   registrarVista('ficha', 'proyecto', '2518')
// Las páginas sueltas (Preparación, Rutas, Chat…) apuntan su pantalla solas al
// cargar con data-pantalla en el <script>; dentro del panel (?embebido=1) no,
// porque ya la apunta el menú.
(function () {
  var EMBEBIDO = /[?&]embebido=1/.test(location.search);

  function registrarVista(tipo, accion, objeto) {
    if (!accion) return;
    try {
      fetch('/api/actividad/vista', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ tipo: tipo === 'ficha' ? 'ficha' : 'pantalla', accion: String(accion), objeto: objeto ? String(objeto) : null })
      }).catch(function () {});
    } catch (e) {}
  }

  // Aviso a la plantilla (RGPD): se enseña una vez por persona, en cualquier dispositivo
  var avisoPedido = false;
  function avisoActividad() {
    if (avisoPedido || EMBEBIDO) return;
    avisoPedido = true;
    fetch('/api/actividad/aviso').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.ok || d.visto) return;
      var fondo = document.createElement('div');
      fondo.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;';
      fondo.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:440px;width:100%;padding:22px 20px;color:#1a1a18;box-shadow:0 10px 40px rgba(0,0,0,.2);">' +
        '<div style="font-size:16px;font-weight:600;margin-bottom:10px;">Registro de actividad</div>' +
        '<div style="font-size:14px;line-height:1.5;color:#3d3c38;">Para la seguridad de la información de ORUM, la aplicación registra <b>cuándo entras</b>, <b>qué pantallas y fichas abres</b>, <b>los cambios que haces</b> y <b>los archivos que descargas</b>, con el dispositivo desde el que lo haces.<br><br>' +
        'No se guardan tus contraseñas, tu PIN ni el contenido de lo que escribes. Los datos se conservan 12 meses y solo los ve Dirección.</div>' +
        '<button style="margin-top:18px;width:100%;background:#1a1a18;color:#fff;border:none;border-radius:10px;padding:12px;font-size:15px;font-weight:600;cursor:pointer;">Entendido</button></div>';
      fondo.querySelector('button').onclick = function () {
        fetch('/api/actividad/aviso', { method: 'POST' }).catch(function () {});
        fondo.remove();
      };
      document.body.appendChild(fondo);
    }).catch(function () {});
  }

  window.registrarVista = registrarVista;
  window.avisoActividad = avisoActividad;

  // Página suelta: su pantalla al cargar (si hay sesión; si no, el servidor no apunta nada)
  var yo = document.currentScript;
  var pantalla = yo && yo.getAttribute('data-pantalla');
  if (pantalla && !EMBEBIDO) {
    // La página puede tardar en entrar con la llave del dispositivo: se reintenta un par de veces
    var intentos = 0;
    var arrancar = function () {
      fetch('/api/sesion').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (d && d.usuario) { registrarVista('pantalla', pantalla); avisoActividad(); }
        else if (++intentos < 3) setTimeout(arrancar, 4000);
      }).catch(function () {});
    };
    if (document.readyState === 'complete') arrancar(); else window.addEventListener('load', arrancar);
  }
})();
