// Acceso directo "⚠ Incidencia" (oct 2026) desde Rutas, Preparación y
// Mantenimiento. prepararIncidencias(cb) mira si el usuario puede crear
// incidencias (mismos roles que lib/incidencias.js; las tablets y los PIN
// sueltos de Rutas no) y deja window.INCIDENCIAS_OK; nuevaIncidencia(o) abre
// el formulario con el proyecto ya puesto. Dentro del panel (?embebido=1)
// abre Incidencias del propio panel; en la app, /incidencias y "Volver"
// regresa aquí.
(function () {
  var ROLES = ['Direccion', 'Contabilidad', 'Logistica', 'Comercial'];
  window.INCIDENCIAS_OK = false;

  window.prepararIncidencias = function (cb) {
    fetch('/api/sesion').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (d) {
      window.INCIDENCIAS_OK = !!(d && d.usuario && ROLES.indexOf(d.usuario.rol) !== -1);
      if (cb) cb(window.INCIDENCIAS_OK);
    });
  };

  // o = { proyecto, vehiculo, texto, origen }
  window.nuevaIncidencia = function (o) {
    o = o || {};
    var proyecto = String(o.proyecto || '').replace(/[^0-9]/g, '');
    var panel = null;
    try { panel = new URLSearchParams(location.search).get('embebido') === '1' && window.parent !== window && window.parent.cargarIncidencias; } catch (e) {}
    if (panel) { window.parent.cargarIncidencias({ nueva: true, proyecto: proyecto, vehiculo: o.vehiculo, origen: o.origen }); return; }
    var p = new URLSearchParams({ nueva: '1', origen: o.origen || 'app', volver: location.pathname + location.search });
    if (proyecto) p.set('proyecto', proyecto);
    if (o.vehiculo) p.set('vehiculo', o.vehiculo);
    if (o.texto) p.set('texto', o.texto);
    location.href = '/incidencias?' + p;
  };
})();
