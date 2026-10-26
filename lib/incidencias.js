// Incidencias (oct 2026) — /api/incidencias/*. Crear una incidencia,
// asignarla y seguirla hasta cerrarla. Tablas y reglas acordadas con el
// usuario en sql/incidencias.sql. Pantalla: public/incidencias.html (misma en
// la app móvil y en el panel con ?embebido=1).
//
// Quién: crean Dirección, Contabilidad, Logística y Comercial; cada uno ve las
// que creó y las que tiene asignadas (Dirección, todas); cambian el estado el
// responsable o Dirección. Nada se borra: comentarios y cambios van al
// historial (incidencias_seguimiento). Fotos como en el chat: bucket privado y
// enlace temporal.
const multer = require('multer');

const ROLES = ['Direccion', 'Contabilidad', 'Logistica', 'Comercial'];
const TIPOS = { material: 'Material dañado', vehiculo: 'Vehículo', cliente: 'Cliente / evento', almacen: 'Almacén', personal: 'Personal', facturacion: 'Facturación', fianza: 'Fianza', otro: 'Otro' };
const ESTADOS = { abierta: 'Abierta', en_curso: 'En curso', resuelta: 'Resuelta' };
const PRIORIDADES = ['normal', 'urgente'];
const ORIGENES = ['app', 'panel', 'rutas', 'preparacion', 'mantenimiento', 'vehiculo'];
const BUCKET = 'incidencias-fotos';
const MAX_TEXTO = 2000;
const MAX_FOTOS = 5;

// ── Permisos (sin red; probados en test/incidencias.test.js) ──
const puedeUsar = u => !!u && ROLES.includes(u.rol);
const esDireccion = u => !!u && u.rol === 'Direccion';
// Varios responsables (26 oct 2026): lista "responsables"; "responsable" es el
// campo antiguo (un solo usuario), que se sigue leyendo si la lista no está.
const responsablesDe = inc => Array.isArray(inc.responsables) ? inc.responsables : (inc.responsable ? [inc.responsable] : []);
const esResponsable = (inc, u) => !!u && !!u.usuario && responsablesDe(inc).includes(u.usuario);
const puedeVer = (inc, u) => puedeUsar(u) && (esDireccion(u) || inc.creado_por === u.usuario || esResponsable(inc, u));
const puedeCambiarEstado = (inc, u) => puedeUsar(u) && (esDireccion(u) || esResponsable(inc, u));
const puedeReasignar = (inc, u) => puedeVer(inc, u) && inc.estado !== 'resuelta';
// Responsables enviados: lista (JSON o array) en "responsables", o el campo
// antiguo "responsable". Sin vacíos ni repetidos.
function listaResponsables(b) {
  let v = b.responsables;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = v.split(','); } }
  if (v == null) v = b.responsable ? [b.responsable] : [];
  return [...new Set([].concat(v).map(x => String(x || '').trim()).filter(Boolean))];
}
function permisosDe(inc, u) {
  return { estado: puedeCambiarEstado(inc, u), responsable: puedeReasignar(inc, u), comentar: puedeVer(inc, u) };
}
// Un cambio de estado válido y lo que hay que guardar con él
function cambioEstado(inc, nuevo, solucion, quien) {
  if (!ESTADOS[nuevo]) return { error: 'Estado no válido' };
  if (nuevo === inc.estado) return { error: 'Ya está ' + ESTADOS[nuevo].toLowerCase() };
  const cambios = { estado: nuevo, actualizado_en: new Date().toISOString() };
  if (nuevo === 'resuelta') {
    const s = String(solucion || '').trim().slice(0, MAX_TEXTO);
    if (!s) return { error: 'Escribe cómo se ha resuelto' };
    Object.assign(cambios, { solucion: s, resuelta_por: quien, resuelta_en: cambios.actualizado_en });
  } else if (inc.estado === 'resuelta') {
    Object.assign(cambios, { solucion: null, resuelta_por: null, resuelta_en: null }); // reabierta
  }
  return { cambios };
}

function registrar(app, { supabase, requiereLogin }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: MAX_FOTOS } });
  const subirFotos = (req, res, next) => upload.array('fotos', MAX_FOTOS)(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Una foto supera los 10 MB' : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Como mucho ' + MAX_FOTOS + ' fotos' : err.message });
    next();
  });
  const permite = (req, res, next) => puedeUsar(req.session.usuario) ? next() : res.status(403).json({ error: 'No autorizado para este apartado' });

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
  const nombreDe = u => u.nombre || u.usuario;

  // Usuarios que pueden ser responsables (los roles del módulo, sin tablets)
  async function usuarios() {
    const filas = await q(supabase.from('usuarios').select('usuario,nombre,rol').in('rol', ROLES).order('nombre'));
    // Sin las filas con "usuario" vacío (hay una de Ana González): no se pueden asignar
    return filas.filter(f => String(f.usuario || '').trim()).map(f => ({ usuario: f.usuario, nombre: f.nombre || f.usuario, rol: f.rol }));
  }
  const nombreVehiculo = v => [v.matricula, v.nombre_rutas || [v.marca, v.modelo].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || ('Vehículo ' + v.id);
  async function proyectoPorNumero(numero) {
    const n = parseInt(numero);
    if (!n) throw fallo(400, 'Número de proyecto no válido');
    const [p] = await q(supabase.from('proyectos').select('id,numero,nombre,cliente').eq('numero', n).gt('id', 0));
    if (!p) throw fallo(404, 'No encuentro el proyecto ' + n);
    return p;
  }
  async function cargar(id) {
    const [inc] = await q(supabase.from('incidencias').select('*').eq('id', parseInt(id) || 0));
    if (!inc) throw fallo(404, 'Esa incidencia no existe');
    return inc;
  }
  async function cargarVisible(req) {
    const inc = await cargar(req.params.id);
    if (!puedeVer(inc, req.session.usuario)) throw fallo(403, 'No tienes acceso a esta incidencia');
    return inc;
  }
  // Añade proyecto, vehículo y nombres a una lista de incidencias
  async function completar(lista) {
    const idsP = [...new Set(lista.map(i => i.proyecto_id).filter(Boolean))];
    const idsV = [...new Set(lista.map(i => i.vehiculo_id).filter(Boolean))];
    const ids = lista.map(i => i.id);
    const [proys, vehs, users, fotos] = await Promise.all([
      idsP.length ? q(supabase.from('proyectos').select('id,numero,nombre,cliente').in('id', idsP)) : [],
      idsV.length ? q(supabase.from('vehiculos').select('id,matricula,marca,modelo,nombre_rutas').in('id', idsV)) : [],
      usuarios(),
      ids.length ? q(supabase.from('incidencias_fotos').select('incidencia_id').in('incidencia_id', ids)) : []
    ]);
    const P = new Map(proys.map(p => [p.id, p])), V = new Map(vehs.map(v => [v.id, v])), U = new Map(users.map(x => [x.usuario, x.nombre]));
    const nFotos = {}; fotos.forEach(f => { nFotos[f.incidencia_id] = (nFotos[f.incidencia_id] || 0) + 1; });
    return lista.map(i => {
      const p = P.get(i.proyecto_id), v = V.get(i.vehiculo_id);
      return {
        ...i,
        proyecto: p ? { id: p.id, numero: p.numero, cliente: p.cliente, nombre: p.nombre } : (i.proyecto_numero ? { numero: i.proyecto_numero } : null),
        vehiculo: v ? { id: v.id, nombre: nombreVehiculo(v) } : null,
        responsables: responsablesDe(i),
        responsables_nombres: responsablesDe(i).map(r => U.get(r) || r),
        responsable_nombre: responsablesDe(i).length ? responsablesDe(i).map(r => U.get(r) || r).join(', ') : null,
        resuelta_por_nombre: i.resuelta_por ? (U.get(i.resuelta_por) || i.resuelta_por) : null,
        fotos: nFotos[i.id] || 0
      };
    });
  }
  // Incidencias que ve este usuario (Dirección todas; el resto creadas + asignadas)
  async function visibles(u, filtro) {
    const base = () => { let c = supabase.from('incidencias').select('*'); if (filtro) c = filtro(c); return c; };
    if (esDireccion(u)) return q(base().order('creado_en', { ascending: false }).limit(1000));
    const [creadas, asignadas] = await Promise.all([q(base().eq('creado_por', u.usuario)), q(base().contains('responsables', [u.usuario]))]);
    const m = new Map(); creadas.concat(asignadas).forEach(i => m.set(i.id, i));
    return [...m.values()].sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en));
  }
  async function guardarFotos(files, incidencia_id, seguimiento_id, usuario) {
    for (const f of files || []) {
      const ext = f.mimetype === 'image/png' ? 'png' : f.mimetype === 'image/webp' ? 'webp' : 'jpg';
      const ruta = incidencia_id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const { error } = await supabase.storage.from(BUCKET).upload(ruta, f.buffer, { contentType: f.mimetype });
      if (error) throw error;
      await q(supabase.from('incidencias_fotos').insert({ incidencia_id, seguimiento_id, ruta, usuario }));
    }
  }
  const soloFotos = files => { if ((files || []).some(f => !/^image\//.test(f.mimetype))) throw fallo(400, 'Solo se pueden adjuntar fotos'); };
  const apuntar = (incidencia_id, tipo, texto, u) =>
    q(supabase.from('incidencias_seguimiento').insert({ incidencia_id, tipo, texto: texto || null, usuario: u.usuario, nombre: nombreDe(u) }).select()).then(f => f[0]);

  // Lo que necesita el formulario: tipos, responsables posibles y vehículos activos
  app.get('/api/incidencias/opciones', requiereLogin, permite, ruta('GET incidencias/opciones', async req => {
    const [users, vehs] = await Promise.all([
      usuarios(),
      q(supabase.from('vehiculos').select('id,matricula,marca,modelo,nombre_rutas,activo').eq('activo', true).order('matricula'))
    ]);
    return { tipos: TIPOS, estados: ESTADOS, usuarios: users, vehiculos: vehs.map(v => ({ id: v.id, nombre: nombreVehiculo(v) })), yo: req.session.usuario.usuario, ver_todas: esDireccion(req.session.usuario) };
  }));

  // Lista (?vehiculo_id= para la ficha del vehículo)
  app.get('/api/incidencias', requiereLogin, permite, ruta('GET incidencias', async req => {
    const u = req.session.usuario, veh = parseInt(req.query.vehiculo_id);
    const lista = await completar(await visibles(u, veh ? c => c.eq('vehiculo_id', veh) : null));
    return { incidencias: lista.map(i => ({ ...i, permisos: permisosDe(i, u) })) };
  }));

  // Contador para el menú del panel y el inicio de la app
  app.get('/api/incidencias/resumen', requiereLogin, permite, ruta('GET incidencias/resumen', async req => {
    const u = req.session.usuario;
    const abiertas = (await visibles(u, c => c.neq('estado', 'resuelta')));
    return { abiertas: abiertas.length, mias: abiertas.filter(i => esResponsable(i, u)).length, urgentes: abiertas.filter(i => i.prioridad === 'urgente').length };
  }));

  app.get('/api/incidencias/proyecto/:numero', requiereLogin, permite, ruta('GET incidencias/proyecto', async req => {
    const p = await proyectoPorNumero(req.params.numero);
    return { proyecto: { id: p.id, numero: p.numero, nombre: p.nombre, cliente: p.cliente } };
  }));

  // Foto: enlace temporal de Supabase, solo para quien ve la incidencia
  app.get('/api/incidencias/foto/:id', requiereLogin, permite, async (req, res) => {
    try {
      const [f] = await q(supabase.from('incidencias_fotos').select('incidencia_id,ruta').eq('id', parseInt(req.params.id) || 0));
      if (!f) return res.status(404).send('No encontrada');
      if (!puedeVer(await cargar(f.incidencia_id), req.session.usuario)) return res.status(403).send('Sin acceso');
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(f.ruta, 600);
      if (error) throw error;
      res.set('Cache-Control', 'private, max-age=500');
      res.redirect(data.signedUrl);
    } catch (err) {
      if (err.estado) return res.status(err.estado).send(err.message);
      console.error('Error en GET incidencias/foto:', err);
      res.status(500).send('Error');
    }
  });

  // Ficha: datos, historial y fotos
  app.get('/api/incidencias/:id', requiereLogin, permite, ruta('GET incidencias/:id', async req => {
    const u = req.session.usuario;
    const inc = await cargarVisible(req);
    const [[completa], seguimiento, fotos] = await Promise.all([
      completar([inc]),
      q(supabase.from('incidencias_seguimiento').select('*').eq('incidencia_id', inc.id).order('id')),
      q(supabase.from('incidencias_fotos').select('id,seguimiento_id,usuario,creado_en').eq('incidencia_id', inc.id).order('id'))
    ]);
    return { incidencia: { ...completa, permisos: permisosDe(inc, u) }, seguimiento, fotos };
  }));

  // Nueva incidencia (multipart: texto, tipo, prioridad, proyecto_numero, vehiculo_id, responsable, origen, fotos[])
  app.post('/api/incidencias', requiereLogin, permite, subirFotos, ruta('POST incidencias', async req => {
    const u = req.session.usuario, b = req.body || {};
    const texto = String(b.texto || '').trim().slice(0, MAX_TEXTO);
    if (!texto) throw fallo(400, 'Describe qué ha pasado');
    soloFotos(req.files);
    const fila = {
      texto,
      tipo: TIPOS[b.tipo] ? b.tipo : 'otro',
      prioridad: PRIORIDADES.includes(b.prioridad) ? b.prioridad : 'normal',
      origen: ORIGENES.includes(b.origen) ? b.origen : 'app',
      creado_por: u.usuario, creado_por_nombre: nombreDe(u)
    };
    if (String(b.proyecto_numero || '').trim()) {
      const p = await proyectoPorNumero(b.proyecto_numero);
      Object.assign(fila, { proyecto_id: p.id, proyecto_numero: p.numero });
    }
    if (parseInt(b.vehiculo_id)) {
      const [v] = await q(supabase.from('vehiculos').select('id').eq('id', parseInt(b.vehiculo_id)));
      if (!v) throw fallo(400, 'Ese vehículo no existe');
      fila.vehiculo_id = v.id;
    }
    const resp = listaResponsables(b);
    if (resp.length) {
      const users = await usuarios();
      if (resp.some(r => !users.some(x => x.usuario === r))) throw fallo(400, 'Ese responsable no existe');
      Object.assign(fila, { responsables: resp, responsable: resp[0] });
    }
    const [inc] = await q(supabase.from('incidencias').insert(fila).select());
    await apuntar(inc.id, 'creada', null, u);
    await guardarFotos(req.files, inc.id, null, u.usuario);
    return { incidencia: inc };
  }));

  app.post('/api/incidencias/:id/comentario', requiereLogin, permite, subirFotos, ruta('POST incidencias/comentario', async req => {
    const u = req.session.usuario;
    const inc = await cargarVisible(req);
    const texto = String((req.body && req.body.texto) || '').trim().slice(0, MAX_TEXTO);
    soloFotos(req.files);
    if (!texto && !(req.files || []).length) throw fallo(400, 'Escribe algo o adjunta una foto');
    const seg = await apuntar(inc.id, 'comentario', texto, u);
    await guardarFotos(req.files, inc.id, seg.id, u.usuario);
    await q(supabase.from('incidencias').update({ actualizado_en: new Date().toISOString() }).eq('id', inc.id));
    return {};
  }));

  // Estado: abierta / en_curso / resuelta (con solución). Responsable o Dirección.
  app.post('/api/incidencias/:id/estado', requiereLogin, permite, ruta('POST incidencias/estado', async req => {
    const u = req.session.usuario;
    const inc = await cargarVisible(req);
    if (!puedeCambiarEstado(inc, u)) throw fallo(403, 'Solo el responsable o Dirección pueden cambiar el estado');
    const r = cambioEstado(inc, req.body && req.body.estado, req.body && req.body.solucion, u.usuario);
    if (r.error) throw fallo(400, r.error);
    await q(supabase.from('incidencias').update(r.cambios).eq('id', inc.id));
    const reabierta = inc.estado === 'resuelta';
    await apuntar(inc.id, 'estado', (reabierta ? 'Reabierta: ' : '') + ESTADOS[r.cambios.estado] + (r.cambios.solucion ? ' — ' + r.cambios.solucion : ''), u);
    return {};
  }));

  // Responsables (lista vacía = sin asignar). Quien la ve, mientras no esté
  // resuelta. Body { responsables: [...] } (o { responsable } de antes).
  app.post('/api/incidencias/:id/responsable', requiereLogin, permite, ruta('POST incidencias/responsable', async req => {
    const u = req.session.usuario;
    const inc = await cargarVisible(req);
    if (!puedeReasignar(inc, u)) throw fallo(403, 'Una incidencia resuelta no se reasigna; reábrela antes');
    const nuevos = listaResponsables(req.body || {});
    const antes = responsablesDe(inc);
    const anadidos = nuevos.filter(r => !antes.includes(r)), quitados = antes.filter(r => !nuevos.includes(r));
    if (!anadidos.length && !quitados.length) return {};
    const users = await usuarios();
    if (anadidos.some(r => !users.some(x => x.usuario === r))) throw fallo(400, 'Ese responsable no existe');
    const nombre = r => (users.find(x => x.usuario === r) || {}).nombre || r;
    await q(supabase.from('incidencias').update({ responsables: nuevos, responsable: nuevos[0] || null, actualizado_en: new Date().toISOString() }).eq('id', inc.id));
    const texto = !nuevos.length ? 'Sin responsable'
      : [anadidos.length ? 'Añadido: ' + anadidos.map(nombre).join(', ') : '', quitados.length ? 'Quitado: ' + quitados.map(nombre).join(', ') : ''].filter(Boolean).join(' · ');
    await apuntar(inc.id, 'responsable', texto, u);
    return {};
  }));
}

module.exports = { registrar, ROLES, TIPOS, ESTADOS, puedeUsar, puedeVer, puedeCambiarEstado, puedeReasignar, cambioEstado, responsablesDe, listaResponsables };
