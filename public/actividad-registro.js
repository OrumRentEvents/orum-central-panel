// Registro de actividad desde el navegador (lib/actividad.js): qué pantalla y
// qué ficha abre cada persona.
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

  window.registrarVista = registrarVista;

  // Página suelta: su pantalla al cargar (si hay sesión; si no, el servidor no apunta nada)
  var yo = document.currentScript;
  var pantalla = yo && yo.getAttribute('data-pantalla');
  if (pantalla && !EMBEBIDO) {
    // La página puede tardar en entrar con la llave del dispositivo: se reintenta un par de veces
    var intentos = 0;
    var arrancar = function () {
      fetch('/api/sesion').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (d && d.usuario) registrarVista('pantalla', pantalla);
        else if (++intentos < 3) setTimeout(arrancar, 4000);
      }).catch(function () {});
    };
    if (document.readyState === 'complete') arrancar(); else window.addEventListener('load', arrancar);
  }
})();
