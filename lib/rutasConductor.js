// App del conductor: una página por vehículo con SU ruta de hoy, para
// instalarla como app en el móvil de cada vehículo (pedido 23 oct 2026).
//
// - Cada vehículo tiene una dirección fija y secreta: /conductor/<vehiculo>-<codigo>/.
//   El código sale de un HMAC con la clave de Supabase del servidor, así que no
//   se puede deducir desde el repositorio (que es público) ni hay que guardarlo
//   en ninguna tabla. Si esa clave cambia, cambian todos los enlaces.
// - Sin PIN. Lo único que se cambia desde aquí es dar la parada por completada
//   (entregado / recogido, oct 2026); todo lo demás se hace en Rentman/Rutas.
// - Solo lo básico: tipo, dirección, contacto, traspa, montaje/desmontaje,
//   notas y material (artículo y cantidad). NUNCA importes ni precios: aquí no
//   se lee ninguna columna de dinero.
// - La lista de enlaces la ve logística/dirección con sesión en el panel
//   (public/conductor-enlaces.html → GET /api/conductor/enlaces).

const crypto = require('crypto');
const path = require('path');
const { selectAll, supabase } = require('./supabaseSource');

// Vehículos con app propia (nombres tal cual en rutas_vehiculos)
const VEHICULOS_CONDUCTOR = ['NISSAN', 'AZUL', 'FURGO NCW', 'IVECO', 'VOLKSWAGEN', 'RENAULT', 'COMERCIAL'];

const TZ = 'Europe/Madrid';
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });

const CLAVE = process.env.SUPABASE_SERVICE_KEY || 'solo-desarrollo-local';
const slug = veh => veh.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const codigoDe = veh => slug(veh) + '-' + crypto.createHmac('sha256', CLAVE).update('conductor:' + veh).digest('hex').slice(0, 10);
const POR_CODIGO = {};
VEHICULOS_CONDUCTOR.forEach(v => { POR_CODIGO[codigoDe(v)] = v; });

const vehsDeParada = p => String(p.vehiculo || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const normalizar = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// "MONTAJE GARDEN", "MONTAJE/DESMONTAJE"... — montaje va con la entrega y desmontaje con la recogida
const esMontaje = s => /(^|[^S])MONTAJE/.test(normalizar(s));
const esDesmontaje = s => normalizar(s).indexOf('DESMONTAJE') !== -1;

async function rutaDeHoy(vehiculo) {
  const fecha = hoyMadrid();
  const todas = await selectAll('rutas_paradas', 'clave,tipo,proyecto_id,numero,cliente,localizacion,google_maps_url,vehiculo,notas,vuelta,orden,es_manual,subproyectos', q => q.eq('fecha', fecha));
  const mias = todas.filter(p => vehsDeParada(p).indexOf(vehiculo) !== -1);
  const ids = [...new Set(mias.map(p => p.proyecto_id).filter(Boolean).map(String))];

  const claves = mias.map(p => p.clave).filter(Boolean);
  const [proyectos, servicios, transpales, conMaterial, completadas, asignados] = await Promise.all([
    ids.length ? selectAll('proyectos', 'id,contacto_nombre,contacto_telefono', q => q.in('id', ids)) : [],
    ids.length ? selectAll('servicios', 'proyecto_id,servicio', q => q.in('proyecto_id', ids)) : [],
    selectAll('rutas_transpale', 'clave', q => q.eq('transpale', true)),
    ids.length ? selectAll('equipment', 'proyecto_id', q => q.in('proyecto_id', ids)) : [],
    // Sin el SQL de sql/preparacion_zona.sql la columna no existe: ninguna completada
    claves.length ? selectAll('rutas_estados_parada', 'clave,completado_en,completado_por', q => q.in('clave', claves).eq('completado', true)).catch(() => []) : [],
    // Conductores que Logística ha puesto en este vehículo hoy (por vuelta)
    selectAll('rutas_conductores', 'vuelta,conductores,conductor', q => q.eq('fecha', fecha).eq('vehiculo', vehiculo))
  ]);
  const conductoresVuelta = {};
  asignados.forEach(a => { conductoresVuelta[Number(a.vuelta) || 1] = (Array.isArray(a.conductores) ? a.conductores : []).map(String).filter(Boolean); });
  const completadaPor = {};
  completadas.forEach(c => { completadaPor[c.clave] = c.completado_por || ''; });
  const completadaEn = {};
  completadas.forEach(c => { completadaEn[c.clave] = c.completado_en; });
  const proyPorId = {};
  proyectos.forEach(p => { proyPorId[String(p.id)] = p; });
  const servPorId = {};
  servicios.forEach(s => { (servPorId[String(s.proyecto_id)] = servPorId[String(s.proyecto_id)] || []).push(s.servicio || ''); });
  const tp = new Set(transpales.map(t => t.clave));
  const tieneMaterial = new Set(conMaterial.map(e => String(e.proyecto_id)));

  const paradas = mias.map(p => {
    const pid = p.proyecto_id ? String(p.proyecto_id) : '';
    const proy = proyPorId[pid] || {};
    const tipo = String(p.tipo || 'OTRO').toUpperCase();
    // Misma clave que usa Rutas para el traspa (claveTranspale en rutas.html)
    const claveTp = pid && (tipo === 'ENTREGA' || tipo === 'RECOGIDA') ? pid + '_' + tipo : (p.clave || '');
    const serv = servPorId[pid] || [];
    const montaje = tipo === 'ENTREGA' ? serv.filter(esMontaje) : tipo === 'RECOGIDA' ? serv.filter(esDesmontaje) : [];
    return {
      vuelta: Number(p.vuelta) || 1, orden: Number(p.orden) || 0,
      tipo, es_manual: !!p.es_manual, numero: p.numero || null, proyecto_id: pid || null, clave: p.clave || '',
      cliente: p.cliente || '', direccion: p.localizacion || '', maps: p.google_maps_url || '',
      contacto: proy.contacto_telefono ? (proy.contacto_nombre || '') : '', telefono: proy.contacto_telefono || '',
      traspa: tp.has(claveTp), montaje: [...new Set(montaje)], notas: p.notas || '', subproyectos: p.subproyectos || '',
      material: !!pid && tieneMaterial.has(pid),
      completado_en: (p.clave && completadaEn[p.clave]) || null,
      completado_por: (p.clave && completadaPor[p.clave]) || '',
      con: vehsDeParada(p).filter(v => v !== vehiculo)
    };
  }).sort((a, b) => a.vuelta - b.vuelta || a.orden - b.orden);

  const vueltas = [];
  paradas.forEach(p => {
    let v = vueltas.find(x => x.vuelta === p.vuelta);
    if (!v) vueltas.push(v = { vuelta: p.vuelta, conductores: conductoresVuelta[p.vuelta] || [], paradas: [] });
    v.paradas.push(p);
  });
  // Todos los que van hoy en el vehículo: el móvil pregunta quién lo lleva si hay más de uno
  const conductores = [...new Set(vueltas.reduce((t, v) => t.concat(v.conductores), []))];
  return { ok: true, vehiculo, fecha, conductores, vueltas };
}

function registrar(app, { requiereLogin, bloquearComercial, emitirRutas, logHistorialRutas }) {
  const vehDe = req => POR_CODIGO[req.params.codigo] || null;
  const noEncontrado = res => res.status(404).send('No encontrado');

  // Express trata igual /conductor/x y /conductor/x/: sin la barra final, la
  // página y su manifest quedarían fuera del mismo ámbito, así que se añade.
  app.get('/conductor/:codigo', (req, res) => {
    if (!vehDe(req)) return noEncontrado(res);
    if (!req.path.endsWith('/')) return res.redirect(302,'/conductor/' + req.params.codigo + '/');
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, '..', 'public', 'conductor.html'));
  });

  app.get('/conductor/:codigo/manifest.webmanifest', (req, res) => {
    const veh = vehDe(req);
    if (!veh) return noEncontrado(res);
    const base = '/conductor/' + req.params.codigo + '/';
    res.type('application/manifest+json').send(JSON.stringify({
      name: 'Ruta ' + veh, short_name: veh, description: 'Ruta de hoy del vehículo ' + veh,
      id: base, start_url: base, scope: base, display: 'standalone', orientation: 'portrait',
      background_color: '#eeeee9', theme_color: '#1a1a18', lang: 'es',
      icons: [
        { src: '/icons/rutas-192.png?v=2', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/rutas-512.png?v=2', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/rutas-maskable-512.png?v=2', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
      ]
    }));
  });

  // Mismo service worker mínimo que Rutas (no cachea nada), dentro del ámbito de cada vehículo
  app.get('/conductor/:codigo/sw.js', (req, res) => vehDe(req) ? res.sendFile(path.join(__dirname, '..', 'public', 'rutas-sw.js')) : noEncontrado(res));

  app.get('/api/conductor/:codigo/hoy', async (req, res) => {
    const veh = vehDe(req);
    if (!veh) return res.status(404).json({ error: 'No encontrado' });
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await rutaDeHoy(veh));
    } catch (err) {
      console.error('[Conductor] Error en ruta de hoy:', err);
      res.status(500).json({ error: 'No se ha podido cargar la ruta' });
    }
  });

  // Material de una parada: solo de proyectos que están hoy en la ruta de ese vehículo
  app.get('/api/conductor/:codigo/material', async (req, res) => {
    const veh = vehDe(req);
    if (!veh) return res.status(404).json({ error: 'No encontrado' });
    try {
      const pid = String(req.query.proyecto_id || '');
      const ruta = await rutaDeHoy(veh);
      const enRuta = ruta.vueltas.some(v => v.paradas.some(p => p.proyecto_id === pid));
      if (!pid || !enRuta) return res.status(404).json({ error: 'Esta parada no está en la ruta de hoy' });
      // Proyecto con varias entregas/recogidas: solo el material de esta parada (rutas_paradas.material)
      const clave = String(req.query.clave || '');
      let filas = null;
      if (clave) {
        const par = (await selectAll('rutas_paradas', 'material', q => q.eq('clave', clave).eq('proyecto_id', pid)))[0];
        if (par && Array.isArray(par.material)) filas = par.material;
      }
      if (!filas) filas = await selectAll('equipment', 'familia,articulo,cantidad', q => q.eq('proyecto_id', pid));
      filas.sort((a, b) => String(a.familia || '').localeCompare(String(b.familia || '')) || String(a.articulo || '').localeCompare(String(b.articulo || '')));
      res.json({ ok: true, material: filas.map(f => ({ familia: f.familia || '', articulo: f.articulo || '', cantidad: f.cantidad })) });
    } catch (err) {
      console.error('[Conductor] Error en material:', err);
      res.status(500).json({ error: 'No se ha podido cargar el material' });
    }
  });

  // El conductor da por hecha una parada de su ruta de hoy (o lo deshace). En
  // Rutas el estado pasa a Entregado / Recogido. Va a la misma fila que
  // Preparado / Cargado / Incidencia sin tocar esas casillas.
  app.post('/api/conductor/:codigo/completar', async (req, res) => {
    const veh = vehDe(req);
    if (!veh) return res.status(404).json({ error: 'No encontrado' });
    try {
      const clave = String((req.body || {}).clave || '');
      const completado = !!(req.body || {}).completado;
      const persona = String((req.body || {}).persona || '').trim().slice(0, 80);
      const ruta = await rutaDeHoy(veh);
      const parada = clave && ruta.vueltas.reduce((m, v) => m || v.paradas.find(p => p.clave === clave), null);
      if (!parada) return res.status(404).json({ error: 'Esta parada no está en la ruta de hoy' });
      // Quien lleva el móvil tiene que ser uno de los conductores asignados hoy al vehículo
      if (completado && ruta.conductores.length && !ruta.conductores.includes(persona)) return res.status(400).json({ error: 'Elige quién lleva el móvil' });
      const ahora = new Date().toISOString();
      const fila = { clave, completado, completado_en: completado ? ahora : null, completado_por: completado ? (persona ? persona + ' · ' + veh : veh) : null, updated_raw: ahora };
      const { error } = await supabase.from('rutas_estados_parada').upsert(fila);
      if (error) throw error;
      emitirRutas('parada_completada', { clave, completado, completado_en: fila.completado_en, completado_por: fila.completado_por });
      logHistorialRutas(persona ? persona + ' (' + veh + ')' : 'Conductor ' + veh, 'completar_parada', { clave, completado, tipo: parada.tipo, numero: parada.numero });
      res.json({ ok: true, completado_en: fila.completado_en });
    } catch (err) {
      console.error('[Conductor] Error al completar parada:', err);
      res.status(500).json({ error: 'No se ha podido guardar. Inténtalo otra vez.' });
    }
  });

  // Incidencia desde el móvil del vehículo (sobre todo: el conductor asignado está mal).
  // No hay sesión: se crea a nombre del vehículo y se asigna a los usuarios de Logística.
  app.post('/api/conductor/:codigo/incidencia', async (req, res) => {
    const veh = vehDe(req);
    if (!veh) return res.status(404).json({ error: 'No encontrado' });
    try {
      const b = req.body || {};
      const texto = String(b.texto || '').trim().slice(0, 2000);
      const persona = String(b.persona || '').trim().slice(0, 80);
      if (!texto) return res.status(400).json({ error: 'Escribe qué pasa' });
      const { data: logistica, error: e1 } = await supabase.from('usuarios').select('usuario,activo').eq('rol', 'Logistica');
      if (e1) throw e1;
      const responsables = (logistica || []).filter(u => u.activo !== false).map(u => u.usuario);
      const creador = 'conductor-' + slug(veh), nombre = (persona || 'Conductor') + ' (' + veh + ')';
      const fila = { texto: 'Desde el móvil del vehículo ' + veh + ':\n' + texto, tipo: 'personal', prioridad: 'normal', origen: 'rutas', creado_por: creador, creado_por_nombre: nombre };
      if (responsables.length) Object.assign(fila, { responsables, responsable: responsables[0] });
      const { data, error } = await supabase.from('incidencias').insert(fila).select('id');
      if (error) throw error;
      const id = data[0].id;
      await supabase.from('incidencias_seguimiento').insert({ incidencia_id: id, tipo: 'creada', texto: null, usuario: creador, nombre });
      logHistorialRutas(nombre, 'incidencia_conductor', { incidencia: id });
      res.json({ ok: true, id });
    } catch (err) {
      console.error('[Conductor] Error al crear incidencia:', err);
      res.status(500).json({ error: 'No se ha podido enviar. Llama a Logística.' });
    }
  });

  app.get('/api/conductor/enlaces', requiereLogin, bloquearComercial, (req, res) => {
    // Railway pasa por un proxy: el protocolo real llega en x-forwarded-proto
    const base = (req.get('x-forwarded-proto') || req.protocol).split(',')[0] + '://' + req.get('host');
    res.json({ ok: true, enlaces: VEHICULOS_CONDUCTOR.map(v => ({ vehiculo: v, url: base + '/conductor/' + codigoDe(v) + '/' })) });
  });

  if (CLAVE === 'solo-desarrollo-local') console.warn('[Conductor] Sin SUPABASE_SERVICE_KEY: enlaces de desarrollo, no válidos en producción');
}

module.exports = { registrar, VEHICULOS_CONDUCTOR, _test: { codigoDe, rutaDeHoy, esMontaje, esDesmontaje } };
