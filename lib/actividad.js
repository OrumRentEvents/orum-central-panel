// Control de accesos e histórico de actividad (oct 2026) — /api/actividad/*
// y /api/accesos/*, solo Sergio. Tablas en sql/actividad.sql.
//
// Qué se apunta (decisión del usuario: pantallas + fichas + cambios +
// descargas, 12 meses, con alertas):
//  - Entradas, intentos fallidos y salidas: lo ve el filtro de /api al
//    terminar cada petición de login/PIN/dispositivo/Face ID/logout.
//  - Cambios: cualquier POST/PUT/DELETE con sesión, traducido a una frase
//    (ACCIONES); así no se escapa ninguna acción nueva que se añada.
//  - Descargas: un GET con sesión que devuelve un archivo (PDF, imagen,
//    Excel…) o que redirige a uno.
//  - Pantallas y fichas: las avisa el panel y la app (public/actividad-registro.js).
// Nunca se guarda el contenido de las peticiones: solo quién, qué, cuándo y
// sobre qué (proyecto, factura…). Se escribe en bloques cada pocos segundos
// para no frenar a nadie.
//
// También: usuarios desactivados (usuarios.activo), sesiones abiertas (en
// memoria, como las propias sesiones: se pierden al publicar), dispositivos
// recordados, alertas con push a Dirección, resumen diario y borrado del
// detalle a los 12 meses.
const push = require('./chatPush');

const ADMIN = 'sergio';
const DIAS_DETALLE = 365;
const TZ = 'Europe/Madrid';

// Peticiones que no son actividad de la persona (eventos en directo,
// comprobaciones automáticas, marcar leído…)
const IGNORAR = [
  /\/eventos$/, /^\/api\/sesion$/, /^\/api\/actividad\//, /\/opciones$/, /\/leido$/,
  /\/push\/estado$/, /^\/api\/rentman\/aviso$/, /^\/api\/isabella\/calcular$/
];
const ENTRADAS = {
  '/api/login': 'Entró con contraseña',
  '/api/login-pin': 'Entró con PIN',
  '/api/movil/dispositivo': 'Entró (dispositivo recordado)',
  '/api/biometria/entrar': 'Entró con Face ID / huella'
};
const SALIDAS = { '/api/logout': 'Salió', '/api/movil/salir': 'Salió y olvidó el dispositivo' };

// Frase de cada cambio. [método, ruta, frase]; la primera que encaja gana.
const ACCIONES = [
  ['POST', /^\/api\/accesos\/cerrar-sesion$/, 'Cerró la sesión de otro usuario'],
  ['POST', /^\/api\/accesos\/olvidar-dispositivo$/, 'Olvidó un dispositivo de otro usuario'],
  ['POST', /^\/api\/accesos\/usuario\/[^/]+\/activo$/, 'Activó o desactivó un usuario'],
  ['POST', /^\/api\/accesos\/usuario\/[^/]+\/solo-lectura$/, 'Cambió el modo solo consulta de un usuario'],
  ['POST', /^\/api\/avisos\/\d+\/visto$/, 'Marcó «Visto» en un aviso de proyecto'],
  ['POST', /^\/api\/(avisos|chat)\/push\/suscribir$/, 'Activó los avisos en un dispositivo'],
  ['POST', /^\/api\/(avisos|chat)\/push\/quitar$/, 'Quitó los avisos de un dispositivo'],
  ['POST', /^\/api\/biometria\/registro$/, 'Activó Face ID / huella'],
  ['POST', /^\/api\/biometria\/quitar$/, 'Quitó Face ID / huella'],
  ['POST', /^\/api\/chat\/[^/]+\/mensajes$/, 'Escribió en el chat'],
  ['DELETE', /^\/api\/chat\/mensajes\//, 'Borró un mensaje del chat'],
  ['POST', /^\/api\/cuentas-gasto/, 'Cambió las cuentas de gasto'],
  ['POST', /^\/api\/(empleados|extras)-(alias|departamento)$/, 'Cambió la configuración de Personal'],
  ['POST', /^\/api\/extras-form\/(config|tarifas|estado)$/, 'Cambió la configuración de extras'],
  ['POST', /^\/api\/extras-form\/registros$/, 'Registró horas extra'],
  ['PUT', /^\/api\/extras-form\/registros\//, 'Modificó un registro de extras'],
  ['DELETE', /^\/api\/extras-form\/registros\//, 'Borró un registro de extras'],
  ['DELETE', /^\/api\/facturas-proveedores\/[^/]+$/, 'Borró una factura de proveedor'],
  ['POST', /^\/api\/facturas-proveedores\/[^/]+\/completar$/, 'Completó los datos de una factura de proveedor'],
  ['POST', /^\/api\/facturas-proveedores\/subir$/, 'Subió una factura de proveedor'],
  ['POST', /^\/api\/facturas-proveedores\/reparto$/, 'Repartió una factura de proveedor'],
  ['POST', /^\/api\/facturas-proveedores\//, 'Cambió una factura de proveedor'],
  ['POST', /^\/api\/fianzas/, 'Fianzas: recarga o prueba de correo'],
  ['POST', /^\/api\/gastos-anuales$/, 'Añadió un pago anual'],
  ['PUT', /^\/api\/gastos-anuales\//, 'Modificó un pago anual'],
  ['DELETE', /^\/api\/gastos-anuales\//, 'Borró un pago anual'],
  ['POST', /^\/api\/holded\/factura\/[^/]+\/cobros$/, 'Holded: registró cobros de una factura'],
  ['POST', /^\/api\/holded\/factura\/[^/]+\/enviar$/, 'Holded: envió una factura'],
  ['POST', /^\/api\/holded\/factura\/[^/]+\/aprobar$/, 'Holded: aprobó una factura'],
  ['POST', /^\/api\/holded\/gastos\/[^/]+\/aceptar$/, 'Holded: aceptó un gasto'],
  ['POST', /^\/api\/holded\//, 'Holded: volcado o cambio de gasto'],
  ['POST', /^\/api\/incidencias$/, 'Creó una incidencia'],
  ['POST', /^\/api\/incidencias\/\d+\/comentario$/, 'Comentó una incidencia'],
  ['POST', /^\/api\/incidencias\/\d+\/estado$/, 'Cambió el estado de una incidencia'],
  ['POST', /^\/api\/incidencias\/\d+\/responsable$/, 'Cambió el responsable de una incidencia'],
  ['POST', /^\/api\/informe/, 'Generó un informe'],
  ['POST', /^\/api\/isabella\/servicios$/, 'Registró un servicio Isabella'],
  ['DELETE', /^\/api\/isabella\/servicios\//, 'Borró un servicio Isabella'],
  ['POST', /^\/api\/isabella\/tarifas$/, 'Cambió las tarifas Isabella'],
  ['POST', /^\/api\/mantenimiento\/check$/, 'Marcó/desmarcó una revisión de Mantenimiento'],
  ['PUT', /^\/api\/mis-accesos$/, 'Cambió sus accesos directos'],
  ['POST', /^\/api\/movil\/olvidar-dispositivo$/, 'Olvidó un dispositivo'],
  ['DELETE', /^\/api\/nominas\//, 'Borró nóminas de un mes'],
  ['POST', /^\/api\/nominas\/subir$/, 'Subió nóminas'],
  ['POST', /^\/api\/preparacion\/check$/, 'Marcó/desmarcó un artículo en Preparación'],
  ['POST', /^\/api\/preparacion\/notas$/, 'Escribió una nota en Preparación'],
  ['PUT', /^\/api\/preparacion\/notas\//, 'Editó una nota de Preparación'],
  ['DELETE', /^\/api\/preparacion\/notas\//, 'Borró una nota de Preparación'],
  ['POST', /^\/api\/rentman\/sincronizar$/, 'Resincronizó un proyecto desde Rentman'],
  ['POST', /^\/api\/rutas\/manual$/, 'Rutas: parada manual'],
  ['POST', /^\/api\/rutas\/conductores$/, 'Rutas: cambió los conductores'],
  ['POST', /^\/api\/rutas\/estados-parada$/, 'Rutas: cambió el estado de una parada'],
  ['POST', /^\/api\/rutas\//, 'Rutas: cambió la planificación'],
  ['POST', /^\/api\/usuarios$/, 'Creó un usuario'],
  ['PUT', /^\/api\/usuarios\//, 'Modificó un usuario'],
  ['DELETE', /^\/api\/usuarios\//, 'Borró un usuario'],
  ['POST', /^\/api\/vehiculos/, 'Vehículos: registró un cambio'],
  ['PUT', /^\/api\/vehiculos/, 'Vehículos: modificó un dato'],
  ['DELETE', /^\/api\/vehiculos/, 'Vehículos: borró un dato'],
  ['POST', /^\/api\/recuperacion/, 'Material recuperado: confirmó o quitó un cargo']
];
// Lo único que puede hacer (POST/PUT) un usuario de solo consulta
const PERMITIDO_SOLO_LECTURA = [
  /^\/api\/(login|login-pin|logout)$/, /^\/api\/movil\/(dispositivo|salir|olvidar-dispositivo)$/, /^\/api\/biometria\//,
  /^\/api\/actividad\/(vista|aviso)$/, /^\/api\/mis-accesos$/, /^\/api\/(avisos|chat)\/push\//, /\/leido$/
];
const VERBO = { POST: 'Guardó', PUT: 'Modificó', PATCH: 'Modificó', DELETE: 'Borró' };

function fraseCambio(metodo, ruta) {
  const a = ACCIONES.find(([m, re]) => m === metodo && re.test(ruta));
  if (a) return a[2];
  return (VERBO[metodo] || metodo) + ' en ' + ruta.replace(/^\/api\//, '').split('/').filter(s => !/^\d+$/.test(s)).slice(0, 2).join(' / ');
}

// Sobre qué se hizo: proyecto, factura, incidencia… (solo identificadores)
function objetoDe(ruta, body) {
  const b = body || {};
  let m;
  if ((m = ruta.match(/^\/api\/incidencias\/(\d+)/))) return 'incidencia ' + m[1];
  if ((m = ruta.match(/^\/api\/facturas-proveedores\/([^/]+)\/(completar|archivo|historial)/)) || (m = ruta.match(/^\/api\/holded\/gastos\/([^/]+)\//))) return 'factura proveedor ' + decodeURIComponent(m[1]).slice(0, 60);
  if ((m = ruta.match(/^\/api\/holded\/factura\/([^/]+)\//))) return 'factura ' + decodeURIComponent(m[1]);
  if ((m = ruta.match(/^\/api\/(?:accesos\/)?usuarios?\/([^/]+)/))) return 'usuario ' + decodeURIComponent(m[1]);
  if (ruta === '/api/usuarios' && b.usuario) return 'usuario ' + String(b.usuario).slice(0, 40);
  if (b.numero) return 'proyecto ' + String(b.numero).slice(0, 20);
  if (b.proyecto_id) return 'proyecto id ' + String(b.proyecto_id).slice(0, 20);
  if (b.proyecto) return 'proyecto ' + String(b.proyecto).slice(0, 20);
  if (b.clave && typeof b.clave === 'string') return b.clave.slice(0, 80);
  if ((m = ruta.match(/\/(\d+)(\/|$)/))) return ruta.replace(/^\/api\//, '').split('/')[0] + ' ' + m[1];
  return null;
}

function dispositivoDe(ua) {
  ua = String(ua || '');
  const so = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua)) ? 'iPad'
    : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android' : 'Tablet Android') : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Otro';
  const nav = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return so + (nav ? ' · ' + nav : '');
}
const ipDe = req => String(req.headers['x-forwarded-for'] || req.ip || '').split(',').pop().trim();
const ROLES_TABLET = ['Lavanderia', 'Office', 'Mantenimiento'];
function appDe(req, u) {
  if (u && ROLES_TABLET.includes(u.rol)) return 'tablet';
  let p = '';
  try { p = new URL(req.get('referer') || '').pathname; } catch (e) {}
  if (p === '/' || p === '/index.html' || /embebido=1/.test(req.get('referer') || '')) return 'panel';
  return p ? 'móvil' : 'panel';
}
function horaMadrid(d) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d || new Date()).forEach(x => { p[x.type] = x.value; });
  return { hora: Number(p.hour) % 24, dia: p.year + '-' + p.month + '-' + p.day };
}

function registrar(app, { supabase, requiereLogin }) {
  async function q(promesa) {
    const { data, error } = await promesa;
    if (error) throw error;
    return data;
  }
  const ruta = (etiqueta, fn) => async (req, res) => {
    try {
      res.json({ ok: true, ...(await fn(req, res)) });
    } catch (err) {
      if (err.estado) return res.status(err.estado).json({ error: err.message });
      console.error('Error en ' + etiqueta + ':', err);
      res.status(500).json({ error: err.message });
    }
  };
  const fallo = (estado, msg) => Object.assign(new Error(msg), { estado });
  const soloSergio = (req, res, next) => {
    const u = req.session.usuario;
    if (!u) return res.status(401).json({ error: 'No autenticado' });
    if (String(u.usuario || '').toLowerCase() !== ADMIN) return res.status(403).json({ error: 'Solo Sergio puede ver la actividad' });
    next();
  };

  // ── Escritura en bloques ──
  let cola = [];
  async function vaciar() {
    if (!cola.length) return;
    const lote = cola; cola = [];
    try { await q(supabase.from('actividad').insert(lote)); }
    catch (err) { console.error('[Actividad] No se pudieron guardar ' + lote.length + ' registros:', err.message); }
  }
  setInterval(vaciar, 4000).unref();
  function apuntar(req, u, tipo, accion, extra) {
    const fila = Object.assign({
      creado_en: new Date().toISOString(),
      usuario: u ? u.usuario : null, nombre: u ? (u.nombre || null) : null, rol: u ? (u.rol || null) : null,
      tipo, accion: String(accion).slice(0, 200), app: appDe(req, u), dispositivo: dispositivoDe(req.get('user-agent')), ip: ipDe(req)
    }, extra || {});
    cola.push(fila);
    if (cola.length >= 200) vaciar();
    revisarAlertas(fila).catch(err => console.error('[Actividad] Alertas:', err.message));
  }

  // ── Usuarios desactivados y de solo consulta ──
  let desactivados = new Set(), soloLectura = new Set();
  async function cargarDesactivados() {
    try {
      const us = await q(supabase.from('usuarios').select('usuario,activo,solo_lectura').or('activo.eq.false,solo_lectura.eq.true'));
      desactivados = new Set(us.filter(u => u.activo === false).map(u => u.usuario));
      soloLectura = new Set(us.filter(u => u.solo_lectura === true).map(u => u.usuario));
    } catch (err) { console.error('[Actividad] No se pudieron leer los usuarios desactivados:', err.message); }
  }
  cargarDesactivados();
  setInterval(cargarDesactivados, 60000).unref();

  // ── Sesiones abiertas (en memoria) ──
  const sesiones = new Map(); // sid -> { usuario, nombre, rol, app, dispositivo, ip, desde, ultimo }

  // ── El filtro de /api ──
  app.use('/api', (req, res, next) => {
    const antes = req.session && req.session.usuario;
    if (antes && desactivados.has(antes.usuario)) {
      sesiones.delete(req.sessionID);
      return req.session.destroy(() => res.status(401).json({ error: 'Tu usuario está desactivado' }));
    }
    // Solo consulta: ve lo mismo que su rol pero no puede cambiar nada (lo
    // que no es GET se rechaza, salvo entrar/salir y lo suyo propio)
    if (antes) {
      const so = soloLectura.has(antes.usuario);
      if (!!antes.solo_lectura !== so) antes.solo_lectura = so; // la pantalla lo lee de /api/sesion
      const r = req.originalUrl.split('?')[0];
      if (so && req.method !== 'GET' && req.method !== 'HEAD' && !PERMITIDO_SOLO_LECTURA.some(re => re.test(r))) {
        apuntar(req, antes, 'cambio', 'Intentó: ' + fraseCambio(req.method, r) + ' (bloqueado, solo consulta)', { objeto: objetoDe(r, req.body), ruta: r.slice(0, 200), metodo: req.method, estado: 403 });
        return res.status(403).json({ error: 'Tu usuario es de solo consulta: puedes ver la información pero no cambiar nada' });
      }
    }
    // Un usuario desactivado no puede entrar con contraseña
    if (req.method === 'POST' && req.originalUrl.split('?')[0] === '/api/login' && desactivados.has(String((req.body || {}).usuario || '').toLowerCase())) {
      return res.status(403).json({ error: 'Tu usuario está desactivado' });
    }
    const t0 = Date.now();
    res.on('finish', () => {
      try { anotar(req, res, antes, t0); } catch (err) { console.error('[Actividad] Error al anotar:', err.message); }
    });
    next();
  });

  function anotar(req, res, antes, t0) {
    const r = req.originalUrl.split('?')[0];
    const u = (req.session && req.session.usuario) || antes;
    const estado = res.statusCode;
    if (u && req.session && req.session.usuario) {
      const s = sesiones.get(req.sessionID) || { desde: new Date().toISOString() };
      Object.assign(s, { usuario: u.usuario, nombre: u.nombre, rol: u.rol, app: appDe(req, u), dispositivo: dispositivoDe(req.get('user-agent')), ip: ipDe(req), ultimo: new Date().toISOString() });
      sesiones.set(req.sessionID, s);
    }
    if (ENTRADAS[r] && req.method === 'POST') {
      if (estado === 200 && req.session && req.session.usuario) return apuntar(req, req.session.usuario, 'entrada', ENTRADAS[r]);
      if ((estado === 401 || estado === 429) && (r === '/api/login' || r === '/api/login-pin')) {
        const intento = r === '/api/login' ? String((req.body || {}).usuario || '').toLowerCase().slice(0, 40) : null;
        return apuntar(req, intento ? { usuario: intento } : null, 'entrada_fallida', (r === '/api/login' ? 'Contraseña incorrecta' : 'PIN incorrecto') + (estado === 429 ? ' (bloqueado por intentos)' : ''), { estado });
      }
      return;
    }
    if (SALIDAS[r]) { sesiones.delete(req.sessionID); if (antes) apuntar(req, antes, 'salida', SALIDAS[r]); return; }
    if (!u || IGNORAR.some(re => re.test(r))) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const b = req.body || {};
      let frase = fraseCambio(req.method, r);
      if (/^\/api\/accesos\/usuario\/[^/]+\/activo$/.test(r)) frase = b.activo ? 'Activó un usuario' : 'Desactivó un usuario';
      if (/^\/api\/accesos\/usuario\/[^/]+\/solo-lectura$/.test(r)) frase = b.solo_lectura ? 'Puso un usuario en solo consulta' : 'Quitó el modo solo consulta a un usuario';
      return apuntar(req, u, 'cambio', frase + (estado >= 400 ? ' (dio error)' : ''), { objeto: objetoDe(r, req.body), ruta: r.slice(0, 200), metodo: req.method, estado });
    }
    // Descargas: un archivo (no JSON, no página, no eventos) o una redirección a uno
    const tipo = String(res.get('Content-Type') || '');
    const esArchivo = (estado === 200 && tipo && !/json|html|event-stream|javascript|text\/css/.test(tipo)) || ((estado === 302 || estado === 301) && /archivo|foto|pdf|descarg/.test(r));
    if (esArchivo) apuntar(req, u, 'descarga', 'Abrió o descargó un archivo', { objeto: objetoDe(r, req.query), ruta: r.slice(0, 200), metodo: 'GET', estado });
  }

  // Pantallas y fichas que avisa el panel/app (public/actividad-registro.js)
  const ultimaVista = new Map(); // usuario -> { clave, t }
  app.post('/api/actividad/vista', requiereLogin, (req, res) => {
    const u = req.session.usuario, b = req.body || {};
    const tipo = b.tipo === 'ficha' ? 'ficha' : 'pantalla';
    const accion = String(b.accion || '').trim().slice(0, 150);
    if (!accion) return res.json({ ok: true });
    const clave = tipo + '|' + accion + '|' + (b.objeto || '');
    const ult = ultimaVista.get(u.usuario);
    if (!ult || ult.clave !== clave || Date.now() - ult.t > 60000) {
      apuntar(req, u, tipo, (tipo === 'ficha' ? 'Abrió ' : 'Pantalla: ') + accion, { objeto: b.objeto ? String(b.objeto).slice(0, 80) : null });
      ultimaVista.set(u.usuario, { clave, t: Date.now() });
    }
    res.json({ ok: true });
  });

  // Aviso a la plantilla de que su actividad se registra (una vez por persona)
  app.get('/api/actividad/aviso', requiereLogin, ruta('GET actividad/aviso', async req => {
    const [f] = await q(supabase.from('usuarios').select('aviso_actividad_visto').eq('usuario', req.session.usuario.usuario));
    return { visto: !!(f && f.aviso_actividad_visto) };
  }));
  app.post('/api/actividad/aviso', requiereLogin, ruta('POST actividad/aviso', async req => {
    await q(supabase.from('usuarios').update({ aviso_actividad_visto: new Date().toISOString() }).eq('usuario', req.session.usuario.usuario));
    return {};
  }));

  // ── Alertas ──
  const recientes = { fallos: [], descargas: new Map(), avisadas: new Map() };
  const yaAvisada = (clave, ms) => {
    const t = recientes.avisadas.get(clave);
    if (t && Date.now() - t < ms) return true;
    recientes.avisadas.set(clave, Date.now());
    return false;
  };
  async function alerta(usuario, tipo, texto) {
    const [a] = await q(supabase.from('actividad_alertas').insert({ usuario, tipo, texto }).select());
    console.log('[Actividad] Alerta ' + tipo + ': ' + texto);
    const dir = await q(supabase.from('usuarios').select('usuario').eq('rol', 'Direccion'));
    const subs = dir.length ? await q(supabase.from('avisos_suscripciones').select('*').in('usuario', dir.map(d => d.usuario))) : [];
    push.enviar(subs, { titulo: '🛡️ Alerta de accesos', cuerpo: texto, url: '/?actividad=alertas', tag: 'alerta-' + a.id }, supabase, 'avisos_suscripciones');
  }
  async function revisarAlertas(f) {
    const ahora = Date.now();
    const quien = f.nombre || f.usuario || 'Alguien';
    if (f.tipo === 'entrada') {
      const { hora } = horaMadrid();
      if ((hora >= 22 || hora < 7) && !yaAvisada('horario|' + f.usuario, 3600e3)) {
        await alerta(f.usuario, 'fuera_horario', quien + ' ha entrado a las ' + new Date().toLocaleTimeString('es-ES', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) + ' (' + f.dispositivo + ', ' + f.app + ')');
      }
      // Dispositivo nuevo: no había entrado nunca desde uno igual en 90 días (y no es su primera entrada)
      const desde = new Date(ahora - 90 * 864e5).toISOString();
      const previas = await q(supabase.from('actividad').select('dispositivo').eq('usuario', f.usuario).eq('tipo', 'entrada').gte('creado_en', desde).lt('creado_en', f.creado_en).limit(500));
      if (previas.length && !previas.some(p => p.dispositivo === f.dispositivo) && !yaAvisada('disp|' + f.usuario + '|' + f.dispositivo, 864e5)) {
        await alerta(f.usuario, 'dispositivo_nuevo', quien + ' ha entrado desde un dispositivo nuevo: ' + f.dispositivo + ' (IP ' + f.ip + ')');
      }
    } else if (f.tipo === 'entrada_fallida') {
      recientes.fallos = recientes.fallos.filter(x => ahora - x.t < 15 * 60e3).concat([{ t: ahora, ip: f.ip, usuario: f.usuario }]);
      const mismaIp = recientes.fallos.filter(x => x.ip === f.ip).length;
      const mismoUsuario = f.usuario ? recientes.fallos.filter(x => x.usuario === f.usuario).length : 0;
      if (mismaIp >= 3 && !yaAvisada('fallos|' + f.ip, 15 * 60e3)) await alerta(f.usuario, 'intentos_fallidos', mismaIp + ' intentos de entrada fallidos en 15 min desde la IP ' + f.ip + (f.usuario ? ' (usuario «' + f.usuario + '»)' : ' (PIN)'));
      else if (mismoUsuario >= 3 && !yaAvisada('fallosu|' + f.usuario, 15 * 60e3)) await alerta(f.usuario, 'intentos_fallidos', mismoUsuario + ' contraseñas incorrectas en 15 min para el usuario «' + f.usuario + '»');
    } else if (f.tipo === 'descarga') {
      const lista = (recientes.descargas.get(f.usuario) || []).filter(t => ahora - t < 10 * 60e3).concat([ahora]);
      recientes.descargas.set(f.usuario, lista);
      if (lista.length >= 15 && !yaAvisada('desc|' + f.usuario, 3600e3)) await alerta(f.usuario, 'muchas_descargas', quien + ' ha abierto o descargado ' + lista.length + ' archivos en 10 minutos');
    }
  }

  // ── Resumen diario y borrado a los 12 meses (cada noche) ──
  function minutosDeUso(filas) {
    // Tiempo entre acciones seguidas, contando como mucho 10 min por hueco
    let min = 0;
    for (let i = 1; i < filas.length; i++) min += Math.min(10, (new Date(filas[i].creado_en) - new Date(filas[i - 1].creado_en)) / 60000);
    return Math.round(min + (filas.length ? 1 : 0));
  }
  async function resumirDia(dia) {
    // dia = 'aaaa-mm-dd' en hora de Madrid; se coge un margen y se filtra
    const desde = new Date(Date.parse(dia + 'T00:00:00Z') - 3 * 3600e3).toISOString();
    const hasta = new Date(Date.parse(dia + 'T00:00:00Z') + 27 * 3600e3).toISOString();
    let filas = [];
    for (let off = 0; ; off += 1000) {
      const lote = await q(supabase.from('actividad').select('usuario,tipo,estado,creado_en').gte('creado_en', desde).lt('creado_en', hasta).order('creado_en').range(off, off + 999));
      filas = filas.concat(lote);
      if (lote.length < 1000) break;
    }
    const porUsuario = {};
    filas.filter(f => f.usuario && horaMadrid(new Date(f.creado_en)).dia === dia).forEach(f => { (porUsuario[f.usuario] = porUsuario[f.usuario] || []).push(f); });
    const resumen = Object.keys(porUsuario).map(usuario => {
      const l = porUsuario[usuario], n = t => l.filter(f => f.tipo === t).length;
      return { usuario, dia, entradas: n('entrada'), pantallas: n('pantalla'), fichas: n('ficha'), cambios: n('cambio'), descargas: n('descarga'),
        errores: l.filter(f => f.estado >= 400).length, minutos: minutosDeUso(l), primera: l[0].creado_en, ultima: l[l.length - 1].creado_en };
    });
    if (resumen.length) await q(supabase.from('actividad_resumen').upsert(resumen, { onConflict: 'usuario,dia' }));
    return resumen.length;
  }
  async function tareaNocturna() {
    try {
      const ayer = horaMadrid(new Date(Date.now() - 864e5)).dia;
      const n = await resumirDia(ayer);
      const limite = new Date(Date.now() - DIAS_DETALLE * 864e5).toISOString();
      await q(supabase.from('actividad').delete().lt('creado_en', limite));
      await q(supabase.from('actividad_alertas').delete().lt('creado_en', limite));
      console.log('[Actividad] Resumen de ' + ayer + ': ' + n + ' usuarios; detalle anterior a ' + limite.slice(0, 10) + ' borrado');
    } catch (err) { console.error('[Actividad] Tarea nocturna:', err.message); }
  }
  // A las 3:xx de Madrid, una vez al día
  let ultimaNoche = null;
  setInterval(() => {
    const { hora, dia } = horaMadrid();
    if (hora === 3 && ultimaNoche !== dia) { ultimaNoche = dia; tareaNocturna(); }
  }, 10 * 60e3).unref();

  // ── Consultas (solo Sergio) ──
  // Línea de tiempo: ?usuario=&tipo=&objeto=&desde=aaaa-mm-dd&hasta=aaaa-mm-dd&antes=id
  app.get('/api/actividad', soloSergio, ruta('GET actividad', async req => {
    await vaciar(); // que salga también lo de los últimos segundos
    const p = req.query;
    let c = supabase.from('actividad').select('*').order('id', { ascending: false }).limit(Math.min(parseInt(p.limite) || 300, 1000));
    if (p.usuario) c = c.eq('usuario', p.usuario);
    if (p.tipo) c = c.in('tipo', String(p.tipo).split(','));
    if (p.objeto) c = c.ilike('objeto', '%' + String(p.objeto).replace(/[%_]/g, '') + '%');
    if (p.desde) c = c.gte('creado_en', new Date(p.desde + 'T00:00:00').toISOString());
    if (p.hasta) c = c.lt('creado_en', new Date(Date.parse(p.hasta + 'T00:00:00') + 864e5).toISOString());
    if (parseInt(p.antes)) c = c.lt('id', parseInt(p.antes));
    return { filas: await q(c) };
  }));

  // Resumen por usuario de los últimos ?dias= (por defecto 30): días cerrados
  // de actividad_resumen + hoy calculado al momento
  app.get('/api/actividad/resumen', soloSergio, ruta('GET actividad/resumen', async req => {
    await vaciar();
    const dias = Math.min(parseInt(req.query.dias) || 30, 366);
    const hoy = horaMadrid().dia;
    const desde = horaMadrid(new Date(Date.now() - dias * 864e5)).dia;
    await resumirDia(hoy);
    const [filas, usuarios, ultimas] = await Promise.all([
      q(supabase.from('actividad_resumen').select('*').gte('dia', desde).limit(10000)),
      q(supabase.from('usuarios').select('usuario,nombre,rol,activo').order('nombre')),
      q(supabase.from('actividad').select('usuario,creado_en,dispositivo,app').eq('tipo', 'entrada').order('creado_en', { ascending: false }).limit(2000))
    ]);
    const ultimaEntrada = {};
    ultimas.forEach(e => { if (!ultimaEntrada[e.usuario]) ultimaEntrada[e.usuario] = e; });
    const total = {};
    filas.forEach(f => {
      const t = total[f.usuario] || (total[f.usuario] = { dias_activo: 0, entradas: 0, pantallas: 0, fichas: 0, cambios: 0, descargas: 0, errores: 0, minutos: 0 });
      t.dias_activo++;
      ['entradas', 'pantallas', 'fichas', 'cambios', 'descargas', 'errores', 'minutos'].forEach(k => { t[k] += f[k] || 0; });
    });
    // Pantallas que más usa cada uno en el periodo
    const pantallas = await q(supabase.from('actividad').select('usuario,accion').eq('tipo', 'pantalla').gte('creado_en', new Date(Date.now() - dias * 864e5).toISOString()).limit(20000));
    const top = {};
    pantallas.forEach(p => { const m = top[p.usuario] || (top[p.usuario] = {}); const k = p.accion.replace(/^Pantalla: /, ''); m[k] = (m[k] || 0) + 1; });
    return {
      dias, usuarios: usuarios.map(u => Object.assign({ usuario: u.usuario, nombre: u.nombre, rol: u.rol, activo: u.activo !== false, ultima_entrada: ultimaEntrada[u.usuario] || null },
        total[u.usuario] || { dias_activo: 0, entradas: 0, pantallas: 0, fichas: 0, cambios: 0, descargas: 0, errores: 0, minutos: 0 },
        { mas_usadas: Object.entries(top[u.usuario] || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]) }))
    };
  }));

  app.get('/api/actividad/alertas', soloSergio, ruta('GET actividad/alertas', async () => {
    const filas = await q(supabase.from('actividad_alertas').select('*').order('creado_en', { ascending: false }).limit(200));
    return { alertas: filas, sin_revisar: filas.filter(a => !a.revisada_en).length };
  }));
  app.post('/api/actividad/alertas/:id/revisada', soloSergio, ruta('POST actividad/alertas/revisada', async req => {
    await q(supabase.from('actividad_alertas').update({ revisada_en: new Date().toISOString(), revisada_por: req.session.usuario.usuario }).eq('id', parseInt(req.params.id) || 0));
    return {};
  }));

  // ── Control de accesos ──
  app.get('/api/accesos', soloSergio, ruta('GET accesos', async req => {
    const [usuarios, dispositivos, credenciales] = await Promise.all([
      q(supabase.from('usuarios').select('usuario,nombre,rol,activo,solo_lectura,pin_hash').order('nombre')),
      q(supabase.from('movil_dispositivos').select('token_hash,usuario,descripcion,ultimo_uso').order('ultimo_uso', { ascending: false })),
      q(supabase.from('movil_credenciales').select('id,usuario,ultimo_uso').order('ultimo_uso', { ascending: false }))
    ]);
    // Sesiones que siguen vivas en el almacén de sesiones
    const vivas = await new Promise(ok => (req.sessionStore && req.sessionStore.all ? req.sessionStore.all((e, s) => ok(e ? {} : (s || {}))) : ok({})));
    const abiertas = [];
    Object.keys(vivas).forEach(sid => {
      const s = vivas[sid], u = s && s.usuario;
      if (!u) return;
      const info = sesiones.get(sid) || {};
      abiertas.push({ sid, usuario: u.usuario, nombre: u.nombre, rol: u.rol, app: info.app || null, dispositivo: info.dispositivo || null, ip: info.ip || null, desde: info.desde || null, ultimo: info.ultimo || null, yo: sid === req.sessionID });
    });
    abiertas.sort((a, b) => String(b.ultimo || '').localeCompare(String(a.ultimo || '')));
    return {
      usuarios: usuarios.map(({ pin_hash, ...u }) => Object.assign(u, { activo: u.activo !== false, solo_lectura: u.solo_lectura === true, tiene_pin: !!pin_hash })),
      sesiones: abiertas,
      dispositivos: dispositivos.map(d => ({ id: d.token_hash, usuario: d.usuario, dispositivo: dispositivoDe(d.descripcion), ultimo_uso: d.ultimo_uso, tipo: 'recordado' }))
        .concat(credenciales.map(c => ({ id: c.id, usuario: c.usuario, dispositivo: 'Face ID / huella', ultimo_uso: c.ultimo_uso, tipo: 'biometria' })))
    };
  }));
  app.post('/api/accesos/cerrar-sesion', soloSergio, ruta('POST accesos/cerrar-sesion', async req => {
    const sid = String((req.body || {}).sid || '');
    if (!sid || sid === req.sessionID) throw fallo(400, 'No puedes cerrar tu propia sesión desde aquí');
    await new Promise(ok => req.sessionStore.destroy(sid, ok));
    sesiones.delete(sid);
    return {};
  }));
  app.post('/api/accesos/olvidar-dispositivo', soloSergio, ruta('POST accesos/olvidar-dispositivo', async req => {
    const b = req.body || {};
    if (b.tipo === 'biometria') await q(supabase.from('movil_credenciales').delete().eq('id', String(b.id || '')));
    else await q(supabase.from('movil_dispositivos').delete().eq('token_hash', String(b.id || '')));
    return {};
  }));
  // Activar/desactivar: desactivado no entra de ninguna forma y se le cierran las sesiones
  app.post('/api/accesos/usuario/:usuario/activo', soloSergio, ruta('POST accesos/activo', async req => {
    const usuario = String(req.params.usuario);
    const activo = !!(req.body || {}).activo;
    if (usuario.toLowerCase() === ADMIN) throw fallo(400, 'No puedes desactivar tu propio usuario');
    const r = await q(supabase.from('usuarios').update({ activo }).eq('usuario', usuario).select('usuario'));
    if (!r.length) throw fallo(404, 'Usuario no encontrado');
    if (activo) desactivados.delete(usuario);
    else {
      desactivados.add(usuario);
      await q(supabase.from('movil_dispositivos').delete().eq('usuario', usuario));
      const vivas = await new Promise(ok => req.sessionStore.all((e, s) => ok(e ? {} : (s || {}))));
      await Promise.all(Object.keys(vivas).filter(sid => vivas[sid].usuario && vivas[sid].usuario.usuario === usuario)
        .map(sid => new Promise(ok => { sesiones.delete(sid); req.sessionStore.destroy(sid, ok); })));
    }
    return { activo };
  }));

  // Solo consulta: ve lo de su rol (sin Configuración) y no puede cambiar nada
  app.post('/api/accesos/usuario/:usuario/solo-lectura', soloSergio, ruta('POST accesos/solo-lectura', async req => {
    const usuario = String(req.params.usuario);
    const solo = !!(req.body || {}).solo_lectura;
    if (usuario.toLowerCase() === ADMIN) throw fallo(400, 'No puedes ponerte a ti mismo en solo consulta');
    const r = await q(supabase.from('usuarios').update({ solo_lectura: solo }).eq('usuario', usuario).select('usuario'));
    if (!r.length) throw fallo(404, 'Usuario no encontrado');
    if (solo) soloLectura.add(usuario); else soloLectura.delete(usuario);
    return { solo_lectura: solo };
  }));

  return { desactivados: () => desactivados, soloLectura: () => soloLectura, _test: { fraseCambio, objetoDe, dispositivoDe, resumirDia, minutosDeUso, vaciar } };
}

module.exports = { registrar };
