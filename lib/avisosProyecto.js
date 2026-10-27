// Avisos de cambios en proyectos (oct 2026) — /api/avisos/*. Tabla
// avisos_proyecto (sql/avisos_proyecto.sql).
//
// Cada vez que la sincronización de Rentman (lib/rentmanSync.js) va a
// escribir un proyecto, se guarda cómo estaba antes; cuando el proyecto lleva
// ESPERA_MS sin cambios (un comercial guarda varias veces seguidas) se compara
// con cómo ha quedado y, si toca, se crea un aviso por departamento afectado:
//  - nuevo: se confirma un proyecto con entrega hoy o mañana → Logística y
//    cada departamento cuyo material lleva.
//  - material: cambia el material de un proyecto confirmado → el departamento
//    de ese material y Logística. Urgente si la entrega es hoy o mañana o si
//    el departamento ya había empezado a prepararlo (decisión del usuario).
//  - fecha: cambia la fecha/hora de entrega o recogida o la dirección →
//    Logística; si la entrega se adelanta, también los departamentos.
//  - cancelado: se cancela (o vuelve a pendiente) → Logística y los
//    departamentos que ya habían empezado a prepararlo.
// Solo proyectos sin recoger con entrega en los próximos VENTANA_DIAS días.
//
// Cómo llegan (decisión del usuario: sin correo): Lavandería, Office y
// Mantenimiento por un mensaje en el chat de su departamento (y su push) y en
// la banda de Preparación/Mantenimiento; Logística y Dirección por push
// (avisos_suscripciones) y en la misma banda. Al pulsar "Visto", el comercial
// del proyecto recibe un push de que el departamento se ha enterado.
const ESPERA_MS = Number(process.env.AVISOS_ESPERA_MS) || 3 * 60 * 1000;
const VENTANA_DIAS = 15;
const ESTADOS_NO_CONFIRMADO = ['pending', 'concept', 'inquiry', 'cancelado', 'canceled'];
// «En curso» no: Rentman lo pone ya la víspera, antes de que nadie prepare nada
const ESTADOS_PREPARADO = ['returned', 'cargado', 'marbella', 'on location', 'controlado', 'preparado', 'ejecucion realizada', 'redondeado'];
const AREAS = { lavanderia: 'Lavandería', office: 'Office', mantenimiento: 'Mantenimiento', logistica: 'Logística' };
const AREA_POR_ROL = { Lavanderia: 'lavanderia', Office: 'office', Mantenimiento: 'mantenimiento' };
const DIAS_LISTA = 3; // la banda enseña los avisos de los últimos 3 días
// Familias que no avisan: el material de embalaje y transporte que añade el
// propio almacén (racks, cajas grises, platibox, palets, jaulas…), decisión
// del usuario 27 oct 2026.
const FAMILIAS_SIN_AVISO = ['almacenaje'];

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const confirmado = p => !!p && !p.cancelado && !ESTADOS_NO_CONFIRMADO.includes(norm(p.estado));
const cant = n => Math.round((parseFloat(n) || 0) * 100) / 100;

// Fechas "dd/mm/aaaa" de Rentman → número de días desde hoy (hora de Madrid)
function hoyMadrid() {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
  return Date.UTC(+p.year, +p.month - 1, +p.day);
}
function diasDesdeHoy(raw) {
  const m = String(raw || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return Math.round((Date.UTC(+m[3], +m[2] - 1, +m[1]) - hoyMadrid()) / 864e5);
}
const cuando = (fechaRaw, horaRaw) => {
  const d = diasDesdeHoy(fechaRaw);
  const dia = d === 0 ? 'hoy' : d === 1 ? 'mañana' : d === -1 ? 'ayer' : String(fechaRaw || '').split(' ')[0];
  return dia + (horaRaw ? ' ' + horaRaw : '');
};

function registrar(app, { supabase, requiereLogin, areasDeLinea, chat }) {
  const push = require('./chatPush');
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

  // Material agrupado por artículo: { 'familia|articulo': { familia, articulo, cantidad } }
  // (sin las familias de FAMILIAS_SIN_AVISO)
  function agrupar(equipment) {
    const m = {};
    (equipment || []).filter(e => !FAMILIAS_SIN_AVISO.includes(norm(e.familia))).forEach(e => {
      const k = (e.familia || '') + '|' + (e.articulo || '');
      if (!m[k]) m[k] = { familia: e.familia || '', articulo: e.articulo || '', cantidad: 0 };
      m[k].cantidad = cant(m[k].cantidad + cant(e.cantidad));
    });
    return m;
  }
  // Departamentos de un artículo (sin Logística, que los ve todos)
  const areasDe = l => areasDeLinea(l.familia, l.articulo).filter(a => a !== 'logistica');

  // ── Antes/después de cada sincronización ──
  const pendientes = new Map(); // pid -> { antes, despues, temporizador }

  async function antesDeEscribir(d) {
    const pid = d.proyecto.id;
    if (pendientes.has(pid)) return; // ya se guardó cómo estaba antes de esta tanda de cambios
    const [proyectos, equipment] = await Promise.all([
      q(supabase.from('proyectos').select('id,numero,nombre,cliente,comercial,estado,cancelado,localizacion,entrega_fecha_raw,entrega_hora_raw,recogida_fecha_raw,recogida_hora_raw').eq('id', pid)),
      q(supabase.from('equipment').select('familia,articulo,cantidad').eq('proyecto_id', pid))
    ]);
    pendientes.set(pid, { antes: { proyecto: proyectos[0] || null, material: agrupar(equipment) }, despues: null, temporizador: null });
  }

  function trasEscribir(d) {
    const e = pendientes.get(d.proyecto.id);
    if (!e) return;
    e.despues = { proyecto: d.proyecto, material: agrupar(d.equipment) };
    clearTimeout(e.temporizador);
    e.temporizador = setTimeout(() => {
      pendientes.delete(d.proyecto.id);
      evaluar(e.antes, e.despues).catch(err => console.error('[Avisos] Error con el proyecto ' + d.proyecto.id + ':', err));
    }, ESPERA_MS);
    if (e.temporizador.unref) e.temporizador.unref();
  }

  // ¿Qué departamentos han empezado a preparar el proyecto?
  async function empezados(p) {
    if (ESTADOS_PREPARADO.includes(norm(p.estado))) return new Set(['lavanderia', 'office', 'mantenimiento', 'logistica']);
    const [prep, mant] = await Promise.all([
      q(supabase.from('preparacion_checks').select('area').eq('proyecto_id', p.id)),
      q(supabase.from('mantenimiento_checks').select('clave').eq('proyecto_id', String(p.id)))
    ]);
    const s = new Set(prep.map(x => x.area));
    if (mant.length) s.add('mantenimiento');
    return s;
  }

  // Compara cómo estaba y cómo ha quedado y crea los avisos que toquen
  async function evaluar(antes, despues) {
    const p0 = antes.proyecto, p1 = despues.proyecto;
    const ref = confirmado(p1) ? p1 : p0;
    if (!ref) return;
    const diasEntrega = diasDesdeHoy(ref.entrega_fecha_raw);
    const diasRecogida = diasDesdeHoy(ref.recogida_fecha_raw);
    const sinRecoger = diasRecogida == null ? (diasEntrega != null && diasEntrega >= 0) : diasRecogida >= 0;
    if (diasEntrega == null || !sinRecoger || diasEntrega > VENTANA_DIAS) return;
    const pronto = diasEntrega <= 1; // hoy, mañana o ya entregado y sin recoger

    const porArea = {}; // area -> { tipo, lineas: [], urgente }
    const anadir = (area, tipo, linea, urgente) => {
      const x = porArea[area] || (porArea[area] = { tipo, lineas: [], urgente: false });
      if (linea && !x.lineas.includes(linea)) x.lineas.push(linea);
      x.urgente = x.urgente || !!urgente;
    };

    if (!confirmado(p0) && confirmado(p1)) {
      // Recién confirmado: solo avisa si se entrega hoy o mañana
      if (!pronto) return;
      const lineas = Object.values(despues.material);
      const cuenta = { almacen: 0 };
      lineas.forEach(l => {
        const deps = areasDe(l);
        deps.forEach(a => { anadir(a, 'nuevo', l.cantidad + ' × ' + l.articulo, true); cuenta[a] = (cuenta[a] || 0) + 1; });
        if (!deps.length) cuenta.almacen++;
      });
      // Logística: cuántos artículos van a cada departamento
      const NOMBRES = Object.assign({ almacen: 'Almacén' }, AREAS);
      anadir('logistica', 'nuevo', Object.keys(cuenta).filter(a => cuenta[a]).map(a => NOMBRES[a] + ': ' + cuenta[a] + (cuenta[a] === 1 ? ' artículo' : ' artículos')).join(' · ') || 'Sin material', true);
    } else if (confirmado(p0) && !confirmado(p1)) {
      const yaEmpezado = await empezados(p0);
      const motivo = p1 && (p1.cancelado || ['cancelado', 'canceled'].includes(norm(p1.estado))) ? 'Cancelado' : 'Vuelve a ' + ((p1 && p1.estado) || 'pendiente');
      anadir('logistica', 'cancelado', motivo, pronto || yaEmpezado.size > 0);
      yaEmpezado.forEach(a => { if (a !== 'logistica') anadir(a, 'cancelado', motivo + ': ya lo habíais empezado a preparar', true); });
    } else if (confirmado(p0) && confirmado(p1)) {
      const yaEmpezado = await empezados(p1);
      // Material
      const claves = new Set([...Object.keys(antes.material), ...Object.keys(despues.material)]);
      claves.forEach(k => {
        const a = antes.material[k], b = despues.material[k];
        const ca = a ? a.cantidad : 0, cb = b ? b.cantidad : 0;
        if (ca === cb) return;
        const l = b || a;
        const texto = !ca ? '+ ' + cb + ' × ' + l.articulo + ' (nuevo)'
          : !cb ? '− ' + l.articulo + ' (quitado, eran ' + ca + ')'
          : l.articulo + ': ' + ca + ' → ' + cb;
        areasDe(l).forEach(area => anadir(area, 'material', texto, pronto || yaEmpezado.has(area)));
        anadir('logistica', 'material', texto, pronto || yaEmpezado.size > 0);
      });
      // Fechas y dirección
      const entregaAntes = (p0.entrega_fecha_raw || '') + ' ' + (p0.entrega_hora_raw || '');
      const entregaAhora = (p1.entrega_fecha_raw || '') + ' ' + (p1.entrega_hora_raw || '');
      if (entregaAntes !== entregaAhora) {
        const texto = 'Entrega: ' + cuando(p0.entrega_fecha_raw, p0.entrega_hora_raw) + ' → ' + cuando(p1.entrega_fecha_raw, p1.entrega_hora_raw);
        anadir('logistica', 'fecha', texto, pronto);
        // Si se adelanta de día, los departamentos tienen menos tiempo
        const d0 = diasDesdeHoy(p0.entrega_fecha_raw);
        if (d0 != null && diasEntrega < d0) {
          const deps = new Set();
          Object.values(despues.material).forEach(l => areasDe(l).forEach(a => deps.add(a)));
          deps.forEach(a => anadir(a, 'fecha', 'Se adelanta la entrega: ' + cuando(p1.entrega_fecha_raw, p1.entrega_hora_raw), pronto || yaEmpezado.has(a)));
        }
      }
      if ((p0.recogida_fecha_raw || '') + (p0.recogida_hora_raw || '') !== (p1.recogida_fecha_raw || '') + (p1.recogida_hora_raw || '')) {
        anadir('logistica', 'fecha', 'Recogida: ' + cuando(p0.recogida_fecha_raw, p0.recogida_hora_raw) + ' → ' + cuando(p1.recogida_fecha_raw, p1.recogida_hora_raw), diasRecogida != null && diasRecogida <= 1);
      }
      if ((p0.localizacion || '') !== (p1.localizacion || '')) {
        anadir('logistica', 'fecha', 'Dirección: ' + (p0.localizacion || '—') + ' → ' + (p1.localizacion || '—'), pronto);
      }
      // Un aviso de departamento por material + fecha a la vez sigue siendo "material"
      Object.values(porArea).forEach(x => { if (x.lineas.some(l => !/^(Entrega|Recogida|Dirección|Se adelanta)/.test(l))) x.tipo = 'material'; });
      Object.keys(porArea).forEach(a => { if (a !== 'logistica' && yaEmpezado.has(a) && porArea[a].tipo === 'material') porArea[a].lineas.unshift('⚠ Ya habíais empezado a prepararlo'); });
    }

    if (!Object.keys(porArea).length) return;
    await crearAvisos(ref, porArea);
  }

  const TITULOS = { nuevo: 'Nuevo proyecto confirmado', material: 'Cambio de material', fecha: 'Cambio de fecha', cancelado: 'Proyecto cancelado' };

  async function crearAvisos(p, porArea) {
    const entrega = [p.entrega_fecha_raw, p.entrega_hora_raw].filter(Boolean).join(' ');
    const filas = Object.keys(porArea).map(area => ({
      proyecto_id: p.id, numero: p.numero != null ? String(p.numero) : null, cliente: p.cliente || null, comercial: p.comercial || null,
      area, tipo: porArea[area].tipo, urgente: porArea[area].urgente, titulo: TITULOS[porArea[area].tipo],
      lineas: porArea[area].lineas.slice(0, 60), entrega: entrega || null
    }));
    const creados = await q(supabase.from('avisos_proyecto').insert(filas).select());
    console.log('[Avisos] Proyecto ' + p.id + ' (' + p.numero + '): ' + creados.map(a => a.area + '/' + a.tipo + (a.urgente ? '!' : '')).join(', '));
    emitir();

    // Push de Logística y Dirección: uno por proyecto con el resumen
    const suyos = await suscripcionesDeRoles(['Logistica', 'Direccion']);
    const log = creados.find(a => a.area === 'logistica') || creados[0];
    const deps = creados.filter(a => a.area !== 'logistica').map(a => AREAS[a.area]);
    push.enviar(suyos, {
      titulo: (creados.some(a => a.urgente) ? '🔴 ' : '🔔 ') + 'Nº ' + (p.numero || p.id) + ' · ' + log.titulo,
      cuerpo: [(p.cliente || '') + ' — entrega ' + cuando(p.entrega_fecha_raw, p.entrega_hora_raw)].concat(log.lineas.slice(0, 3)).join('\n') + (deps.length ? '\nAvisado: ' + deps.join(', ') : ''),
      url: '/avisos', tag: 'aviso-' + p.id
    }, supabase, 'avisos_suscripciones');

    // Departamentos: mensaje en su chat (su push lo manda el chat), sin repetir
    // el push a los dispositivos que ya reciben el de arriba
    const yaAvisados = suyos.map(s => s.endpoint);
    for (const a of creados) {
      if (a.area === 'logistica' || !chat) continue;
      const texto = (a.urgente ? '🔴 URGENTE · ' : '🔔 ') + a.titulo + '\nNº ' + (a.numero || a.proyecto_id) + ' · ' + (a.cliente || '') +
        '\nEntrega ' + cuando(p.entrega_fecha_raw, p.entrega_hora_raw) + '\n\n' + a.lineas.join('\n') + '\n\nPulsa «Visto» en Preparación para que lo sepan Logística y el comercial.';
      try { await chat.publicarAviso(a.area, texto.slice(0, 2000), yaAvisados); } catch (err) { console.error('[Avisos] No se pudo escribir en el chat ' + a.area + ':', err.message); }
    }
  }

  async function suscripcionesDeUsuarios(usuarios) {
    if (!usuarios.length) return [];
    return q(supabase.from('avisos_suscripciones').select('*').in('usuario', usuarios));
  }
  async function suscripcionesDeRoles(roles) {
    const us = await q(supabase.from('usuarios').select('usuario').in('rol', roles));
    return suscripcionesDeUsuarios(us.map(u => u.usuario));
  }

  // ── Tiempo real: las bandas abiertas se recargan al llegar o verse un aviso ──
  const clientes = new Set();
  function emitir() { clientes.forEach(res => { try { res.write('data: {"tipo":"avisos"}\n\n'); } catch (e) {} }); }
  setInterval(() => { clientes.forEach(res => { try { res.write(': latido\n\n'); } catch (e) {} }); }, 25000).unref();
  app.get('/api/avisos/eventos', requiereLogin, (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    clientes.add(res);
    req.on('close', () => clientes.delete(res));
  });

  // Qué puede ver y marcar cada uno
  function permisos(u) {
    const area = AREA_POR_ROL[u.rol];
    if (area) return { ve: [area], marca: [area] };
    if (u.rol === 'Direccion') return { ve: Object.keys(AREAS), marca: Object.keys(AREAS) };
    if (u.rol === 'Logistica') {
      const marca = ['logistica'];
      if (String(u.usuario || '').toLowerCase() === 'leo') marca.push('mantenimiento'); // Leo también hace mantenimiento
      return { ve: Object.keys(AREAS), marca };
    }
    if (u.rol === 'Comercial') return { ve: Object.keys(AREAS), marca: [], comercial: u.comercial_filtro || '__ninguno__' };
    return { ve: [], marca: [] };
  }

  // Avisos agrupados por proyecto. Por defecto los que tienen algo sin ver;
  // ?todos=1 también los ya vistos de los últimos días.
  app.get('/api/avisos', requiereLogin, ruta('GET avisos', async req => {
    const u = req.session.usuario, perm = permisos(u);
    if (!perm.ve.length) return { proyectos: [], sin_ver: 0, marca: [] };
    const desde = new Date(Date.now() - DIAS_LISTA * 864e5).toISOString();
    let consulta = supabase.from('avisos_proyecto').select('*').in('area', perm.ve).gte('creado_en', desde).order('creado_en', { ascending: false }).limit(300);
    if (perm.comercial) consulta = consulta.eq('comercial', perm.comercial);
    const filas = await q(consulta);
    const todos = req.query.todos === '1' || !!perm.comercial;
    // Un proyecto sale mientras alguno de sus avisos esté sin ver (o con ?todos)
    const grupos = new Map();
    filas.forEach(a => {
      const k = a.proyecto_id + '|' + a.creado_en.slice(0, 16); // los de una misma tanda van juntos
      if (!grupos.has(k)) grupos.set(k, { proyecto_id: a.proyecto_id, numero: a.numero, cliente: a.cliente, entrega: a.entrega, creado_en: a.creado_en, avisos: [] });
      grupos.get(k).avisos.push(a);
    });
    const proyectos = [...grupos.values()]
      .filter(g => todos || g.avisos.some(a => !a.visto_en))
      .map(g => Object.assign(g, { urgente: g.avisos.some(a => a.urgente), titulo: (g.avisos.find(a => a.area === 'logistica') || g.avisos[0]).titulo }));
    const sinVer = filas.filter(a => !a.visto_en && perm.marca.includes(a.area)).length;
    return { proyectos, sin_ver: sinVer, marca: perm.marca, areas: AREAS };
  }));

  // "Visto": lo marca el departamento del aviso y se avisa al comercial
  app.post('/api/avisos/:id/visto', requiereLogin, ruta('POST avisos/visto', async req => {
    const u = req.session.usuario, perm = permisos(u);
    const [a] = await q(supabase.from('avisos_proyecto').select('*').eq('id', parseInt(req.params.id) || 0));
    if (!a) throw fallo(404, 'Ese aviso no existe');
    if (!perm.marca.includes(a.area)) throw fallo(403, 'Este aviso lo marca ' + AREAS[a.area]);
    if (a.visto_en) return { aviso: a };
    const nombre = AREA_POR_ROL[u.rol] ? AREAS[a.area] : (u.nombre || u.usuario);
    const [hecho] = await q(supabase.from('avisos_proyecto').update({ visto_por: u.usuario, visto_nombre: nombre, visto_en: new Date().toISOString() })
      .eq('id', a.id).is('visto_en', null).select());
    if (!hecho) return { aviso: a };
    emitir();
    // Push al comercial del proyecto (usuarios con ese comercial_filtro)
    if (a.comercial) {
      const comerciales = await q(supabase.from('usuarios').select('usuario').eq('rol', 'Comercial').eq('comercial_filtro', a.comercial));
      const subs = await suscripcionesDeUsuarios(comerciales.map(c => c.usuario));
      push.enviar(subs, {
        titulo: '✅ ' + AREAS[a.area] + ' lo ha visto',
        cuerpo: 'Nº ' + (a.numero || a.proyecto_id) + ' · ' + (a.cliente || '') + '\n' + a.titulo + (nombre !== AREAS[a.area] ? ' (' + nombre + ')' : ''),
        url: '/avisos', tag: 'aviso-visto-' + a.id
      }, supabase, 'avisos_suscripciones');
    }
    return { aviso: hecho };
  }));

  // ── Push de avisos en este dispositivo (Logística, Dirección, comerciales) ──
  const endpointValido = e => typeof e === 'string' && /^https:\/\//.test(e) && e.length < 1000;
  const conPush = u => ['Logistica', 'Direccion', 'Comercial'].includes(u.rol);
  app.get('/api/avisos/push/estado', requiereLogin, ruta('GET avisos/push/estado', async req => {
    const u = req.session.usuario;
    let activo = false;
    if (push.disponible && endpointValido(req.query.endpoint)) {
      activo = (await q(supabase.from('avisos_suscripciones').select('endpoint').eq('endpoint', req.query.endpoint).eq('usuario', u.usuario))).length > 0;
    }
    return { disponible: push.disponible && conPush(u), clave: push.disponible ? push.clavePublica : null, activo };
  }));
  app.post('/api/avisos/push/suscribir', requiereLogin, ruta('POST avisos/push/suscribir', async req => {
    const u = req.session.usuario, s = (req.body && req.body.suscripcion) || {}, keys = s.keys || {};
    if (!push.disponible) throw fallo(503, 'Los avisos no están configurados en el servidor');
    if (!conPush(u)) throw fallo(403, 'Tu usuario recibe los avisos por el chat de su departamento');
    if (!endpointValido(s.endpoint) || !keys.p256dh || !keys.auth) throw fallo(400, 'Suscripción no válida');
    await q(supabase.from('avisos_suscripciones').upsert({ endpoint: s.endpoint, usuario: u.usuario, p256dh: String(keys.p256dh), auth: String(keys.auth) }));
    return { activo: true };
  }));
  app.post('/api/avisos/push/quitar', requiereLogin, ruta('POST avisos/push/quitar', async req => {
    const endpoint = req.body && req.body.endpoint;
    if (!endpointValido(endpoint)) throw fallo(400, 'Falta el dispositivo');
    await q(supabase.from('avisos_suscripciones').delete().eq('endpoint', endpoint).eq('usuario', req.session.usuario.usuario));
    return { activo: false };
  }));

  return { antesDeEscribir, trasEscribir, _test: { evaluar, agrupar, diasDesdeHoy } };
}

module.exports = { registrar, AREAS };
