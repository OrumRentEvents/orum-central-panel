// Calendario (nov 2026) — /api/calendario/*. Junta en una sola vista:
// - Reuniones y visitas comerciales: de Google Calendar de cada usuario (lib/calendarioGoogle.js).
// - Vacaciones y días de descanso: de la Bolsa de horas (lib/ausencias.js).
// - Turnos de cada trabajador: tablas turnos_semana y turnos_dia (sql/calendario.sql).
// - Citas de taller: vencimientos de Vehículos con cita (cita_fecha).
//
// Quién ve qué (decisión del usuario: «según el rol»):
// - Reuniones y visitas: cada uno las suyas; Dirección las de todos.
// - Vacaciones, descansos, turnos y citas de taller: Dirección, Contabilidad y Logística.
// Turnos: los cambian Leo, Jesús Aguilera, Rafa Pérez y Sergio (los mismos que apuntan en la Bolsa).
const G = require('./calendarioGoogle');
const A = require('./ausencias');
const { puedeApuntar, construirPlantilla } = require('./bolsa');

const ROLES_CALENDARIO = ['Direccion', 'Contabilidad', 'Logistica', 'Comercial'];
const ROLES_PERSONAL = ['Direccion', 'Contabilidad', 'Logistica'];
const TIPOS = ['reunion', 'visita', 'vacaciones', 'descanso', 'turno', 'taller'];
const MAX_DIAS_RANGO = 62;
const CACHE_GOOGLE_MS = 2 * 60 * 1000;
const NOMBRE_VENCIMIENTO = { itv: 'ITV', seguro: 'Seguro', ivtm: 'Impuesto de circulación', revision: 'Revisión', tacografo: 'Tacógrafo', fin_renting: 'Fin de renting', otro: 'Taller' };

const fechaValida = f => /^\d{4}-\d{2}-\d{2}$/.test(String(f || '')) && !isNaN(new Date(f + 'T00:00:00Z'));
const horaValida = h => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ''));

function tiposVisibles(u) {
  return ROLES_PERSONAL.includes(u.rol) ? TIPOS.slice() : ['reunion', 'visita'];
}

function registrar(app, { supabase, requiereLogin, datosExtras }) {
  const fallo = (estado, msg) => Object.assign(new Error(msg), { estado });
  const quien = req => req.session.usuario.nombre || req.session.usuario.usuario;
  const usuarioDe = req => String(req.session.usuario.usuario || '').toLowerCase();
  async function q(promesa) {
    const { data, error } = await promesa;
    if (error) throw new Error(error.message);
    return data || [];
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
  const permite = (req, res, next) => ROLES_CALENDARIO.includes(req.session.usuario.rol) ? next() : res.status(403).json({ error: 'No autorizado para este apartado' });
  const mw = [requiereLogin, permite];
  async function todo(tabla, filtro, orden = 'clave') {
    const filas = [];
    for (let desde = 0; ; desde += 1000) {
      let c = supabase.from(tabla).select('*').order(orden).range(desde, desde + 999);
      if (filtro) c = filtro(c);
      const trozo = await q(c);
      filas.push(...trozo);
      if (trozo.length < 1000) return filas;
    }
  }

  // ── Bolsa de horas: vacaciones y descansos ──
  async function ausencias(desde, hasta) {
    const antes = A.sumarDias(desde, -400); // un descanso de varios días puede empezar antes del rango
    const [vacaciones, movimientos, extras] = await Promise.all([
      q(supabase.from('bolsa_vacaciones').select('*').is('anulado_en', null).lte('fecha_inicio', hasta).gte('fecha_fin', desde)),
      q(supabase.from('bolsa_movimientos').select('*').eq('tipo', 'descanso').lt('cantidad', 0).is('anulado_en', null).gte('fecha', antes).lte('fecha', hasta)),
      q(supabase.from('extras_registros').select('empresa_nif,formato_origen,num_empleado,nombre_libre,nombre_trabajador,tipo,fecha,estado,notas').ilike('tipo', 'descanso%').gte('fecha', desde).lte('fecha', hasta))
    ]);
    return A.ausenciasPorDia({ desde, hasta, vacaciones, movimientos, registros: extras });
  }

  // Para Rutas: { fecha: [{ chofer, tipo, medio }] } con los nombres de la lista de choferes
  async function ausenciasRutas(desde, hasta, choferes) {
    if (!fechaValida(desde) || !fechaValida(hasta) || hasta < desde) return {};
    const porDia = await ausencias(desde, hasta);
    let fijos = {};
    try {
      const [f] = await q(supabase.from('rutas_config').select('valor').eq('clave', 'CHOFERES_BOLSA'));
      if (f && f.valor && typeof f.valor === 'object') fijos = f.valor;
    } catch (e) { /* sin correcciones a mano */ }
    return A.ausenciasDeChoferes(porDia, choferes || [], fijos);
  }

  // ── Plantilla (la misma que la Bolsa de horas) ──
  async function plantilla() {
    const [extras, anadidos] = await Promise.all([datosExtras(), q(supabase.from('bolsa_empleados').select('*'))]);
    return construirPlantilla(extras.trabajadores, anadidos, {}).map(e => ({ clave: e.clave, nombre: e.nombre, area: e.area }));
  }

  // ── Turnos ──
  async function turnosEnRango(desde, hasta) {
    const [semana, dias, empleados] = await Promise.all([
      todo('turnos_semana', null, 'clave'),
      todo('turnos_dia', c => c.gte('fecha', desde).lte('fecha', hasta), 'fecha'),
      plantilla()
    ]);
    const claves = [...new Set([...semana.map(s => s.clave), ...dias.map(d => d.clave)])];
    const nombreDe = {}; empleados.forEach(e => { nombreDe[e.clave] = e.nombre; });
    semana.concat(dias).forEach(t => { if (!nombreDe[t.clave]) nombreDe[t.clave] = t.nombre; });
    const enPlantilla = new Set(empleados.map(e => e.clave));
    const out = [];
    A.diasDelRango(desde, hasta).forEach(fecha => {
      claves.forEach(clave => {
        // Quien ya no está en la plantilla solo sale con cambios de un día concretos
        const t = A.turnoDelDia(clave, fecha, enPlantilla.has(clave) ? semana : [], dias);
        if (!t) return;
        const texto = t.libre ? 'Libre' : [t.entrada + '–' + t.salida, t.entrada2 && t.salida2 ? t.entrada2 + '–' + t.salida2 : null].filter(Boolean).join(' y ');
        out.push({
          id: 't:' + clave + ':' + fecha, tipo: 'turno', persona: nombreDe[clave], clave,
          titulo: texto, inicio: fecha, fin: fecha, todo_el_dia: true,
          hora: t.libre ? null : t.entrada, libre: t.libre, cambio: t.cambio, detalle: t.nota
        });
      });
    });
    return out;
  }

  // ── Citas de taller ──
  async function citasTaller(desde, hasta) {
    const [venc, vehiculos] = await Promise.all([
      q(supabase.from('vehiculos_vencimientos').select('id,vehiculo_id,tipo,descripcion,cita_fecha,cita_lugar,cita_nota,activo').eq('activo', true).gte('cita_fecha', desde).lte('cita_fecha', hasta)),
      q(supabase.from('vehiculos').select('id,matricula,marca,modelo,nombre_rutas'))
    ]);
    const vDe = {}; vehiculos.forEach(v => { vDe[v.id] = v; });
    return venc.map(c => {
      const v = vDe[c.vehiculo_id] || {};
      const coche = v.nombre_rutas || [v.marca, v.modelo].filter(Boolean).join(' ') || v.matricula || 'Vehículo';
      return {
        id: 'v:' + c.id, tipo: 'taller', persona: null, vehiculo_id: c.vehiculo_id,
        titulo: (NOMBRE_VENCIMIENTO[c.tipo] || 'Taller') + ' · ' + coche,
        inicio: c.cita_fecha, fin: c.cita_fecha, todo_el_dia: true,
        lugar: c.cita_lugar || null, detalle: [c.descripcion, v.matricula, c.cita_nota].filter(Boolean).join(' · ') || null
      };
    });
  }

  // ── Google ──
  const cacheGoogle = new Map(); // usuario|desde|hasta → { en, eventos, error }
  async function eventosGoogleDe(fila, nombre, desde, hasta) {
    const clave = fila.usuario + '|' + desde + '|' + hasta;
    const ya = cacheGoogle.get(clave);
    if (ya && Date.now() - ya.en < CACHE_GOOGLE_MS) return ya;
    const res = { en: Date.now(), eventos: [], error: null };
    try {
      const token = await G.tokenAcceso(fila.usuario, fila.token_cifrado);
      // Margen de un día a cada lado por la diferencia horaria; el navegador recorta
      const desdeISO = A.sumarDias(desde, -1) + 'T00:00:00Z', hastaISO = A.sumarDias(hasta, 2) + 'T00:00:00Z';
      const elegidos = (fila.calendarios || []).filter(c => c.tipo === 'reunion' || c.tipo === 'visita');
      for (const cal of elegidos) {
        const lista = await G.eventos(token, cal.id, desdeISO, hastaISO);
        lista.forEach(e => res.eventos.push(G.convertir(e, { tipo: G.tipoDeEvento(e, cal.tipo), usuario: fila.usuario, nombre, calendario: cal.nombre })));
      }
      if (fila.ultimo_error) await q(supabase.from('calendario_google').update({ ultimo_error: null, ultimo_error_en: null }).eq('usuario', fila.usuario).select());
    } catch (err) {
      res.error = err.revocado ? 'Google ha retirado el permiso: vuelve a conectar' : err.message;
      G.olvidarAcceso(fila.usuario);
      await q(supabase.from('calendario_google').update({ ultimo_error: res.error, ultimo_error_en: new Date().toISOString() }).eq('usuario', fila.usuario).select()).catch(() => {});
    }
    cacheGoogle.set(clave, res);
    return res;
  }
  const olvidarCacheDe = usuario => { for (const k of cacheGoogle.keys()) if (k.startsWith(usuario + '|')) cacheGoogle.delete(k); };

  // Lo que el calendario cuenta de la conexión de Google de este usuario
  function estadoGoogle(fila) {
    return {
      disponible: G.disponible(),
      conectado: !!fila,
      email: fila ? fila.google_email : null,
      calendarios: fila ? (fila.calendarios || []) : [],
      error: fila ? fila.ultimo_error : null
    };
  }

  // ── Calendario ──
  app.get('/api/calendario', mw, ruta('GET calendario', async req => {
    const u = req.session.usuario, desde = String(req.query.desde || ''), hasta = String(req.query.hasta || '');
    if (!fechaValida(desde) || !fechaValida(hasta) || hasta < desde) throw fallo(400, 'Rango de fechas no válido');
    if (A.diasDelRango(desde, hasta).length > MAX_DIAS_RANGO) throw fallo(400, 'Como mucho ' + MAX_DIAS_RANGO + ' días de golpe');
    const visibles = tiposVisibles(u);
    const veTodoGoogle = u.rol === 'Direccion';
    const yo = usuarioDe(req);

    const [filasGoogle, usuarios] = await Promise.all([
      q(supabase.from('calendario_google').select('*')),
      q(supabase.from('usuarios').select('usuario,nombre'))
    ]);
    const nombreUsuario = {}; usuarios.forEach(x => { if (x.usuario) nombreUsuario[String(x.usuario).toLowerCase()] = x.nombre || x.usuario; });
    const miFila = filasGoogle.find(f => f.usuario === yo) || null;

    const tareas = [];
    const eventos = [], avisos = [];
    if (G.disponible()) {
      const deQuien = filasGoogle.filter(f => veTodoGoogle || f.usuario === yo);
      tareas.push(Promise.all(deQuien.map(f => eventosGoogleDe(f, nombreUsuario[f.usuario] || f.usuario, desde, hasta))).then(res => {
        res.forEach((r, i) => {
          eventos.push(...r.eventos);
          if (r.error) avisos.push((deQuien[i].usuario === yo ? 'Tu Google Calendar' : 'Google Calendar de ' + (nombreUsuario[deQuien[i].usuario] || deQuien[i].usuario)) + ': ' + r.error);
        });
      }));
    }
    if (visibles.includes('vacaciones')) {
      tareas.push(ausencias(desde, hasta).then(porDia => {
        // Días seguidos de la misma persona y el mismo tipo → un solo evento
        const tramos = {};
        Object.keys(porDia).sort().forEach(fecha => porDia[fecha].forEach(a => {
          const k = a.clave + '|' + a.tipo + '|' + (a.medio ? 'm' : '');
          const t = tramos[k] && tramos[k][tramos[k].length - 1];
          if (t && A.sumarDias(t.fin, 1) === fecha) t.fin = fecha;
          else (tramos[k] = tramos[k] || []).push({ ...a, inicio: fecha, fin: fecha });
        }));
        Object.values(tramos).forEach(l => l.forEach(t => eventos.push({
          id: (t.tipo === 'vacaciones' ? 'a:' : 'd:') + t.clave + ':' + t.inicio, tipo: t.tipo, persona: t.nombre, clave: t.clave,
          titulo: t.tipo === 'vacaciones' ? 'Vacaciones' : (t.medio ? 'Medio día de descanso' : 'Descanso'),
          inicio: t.inicio, fin: t.fin, todo_el_dia: true, medio: t.medio, detalle: t.nota
        })));
      }));
    }
    if (visibles.includes('turno')) tareas.push(turnosEnRango(desde, hasta).then(l => eventos.push(...l)));
    if (visibles.includes('taller')) tareas.push(citasTaller(desde, hasta).then(l => eventos.push(...l)));
    await Promise.all(tareas);

    return {
      desde, hasta, tipos: visibles, eventos, avisos,
      google: estadoGoogle(miFila),
      puede_turnos: puedeApuntar(u)
    };
  }));

  // ── Conectar Google ──
  const urlVuelta = req => req.protocol + '://' + req.get('host') + '/api/calendario/google/vuelta';
  app.get('/api/calendario/google/conectar', mw, (req, res) => {
    if (!G.disponible()) return res.status(503).send('La conexión con Google no está configurada todavía.');
    const state = require('crypto').randomBytes(16).toString('hex');
    // Desde el panel se vuelve al panel; desde la app, a /calendario
    req.session.calendarioGoogle = { state, volver: req.query.desde === 'panel' ? '/?calendario=1' : '/calendario' };
    req.session.save(() => res.redirect(G.urlConsentimiento(urlVuelta(req), state)));
  });
  app.get('/api/calendario/google/vuelta', requiereLogin, async (req, res) => {
    const pend = req.session.calendarioGoogle || {};
    const volver = (pend.volver || '/calendario') + ((pend.volver || '').includes('?') ? '&' : '?');
    delete req.session.calendarioGoogle;
    if (req.query.error) return res.redirect(volver + 'google=cancelado');
    if (!pend.state || req.query.state !== pend.state || !req.query.code) return res.redirect(volver + 'google=error');
    try {
      const t = await G.canjearCodigo(String(req.query.code), urlVuelta(req));
      const yo = usuarioDe(req);
      const [antes] = await q(supabase.from('calendario_google').select('*').eq('usuario', yo));
      // Google solo da el permiso permanente la primera vez o con prompt=consent
      if (!t.refresh_token && !antes) throw new Error('Google no ha dado el permiso permanente');
      const token = t.access_token;
      const lista = await G.listaCalendarios(token);
      const previos = {}; ((antes && antes.calendarios) || []).forEach(c => { previos[c.id] = c.tipo; });
      // Por defecto solo el calendario principal, como reuniones (los comerciales, como visitas)
      const tipoPorDefecto = req.session.usuario.rol === 'Comercial' ? 'visita' : 'reunion';
      const calendarios = lista.map(c => ({ id: c.id, nombre: c.nombre, principal: c.principal, tipo: previos[c.id] || (c.principal ? tipoPorDefecto : 'no') }));
      await q(supabase.from('calendario_google').upsert({
        usuario: yo, google_email: G.emailDeIdToken(t.id_token) || (antes && antes.google_email) || null,
        token_cifrado: t.refresh_token ? G.cifrar(t.refresh_token) : antes.token_cifrado,
        calendarios, conectado_en: new Date().toISOString(), ultimo_error: null, ultimo_error_en: null
      }).select());
      G.olvidarAcceso(yo); olvidarCacheDe(yo);
      res.redirect(volver + 'google=conectado');
    } catch (err) {
      console.error('[Calendario] Error al conectar Google:', err.message);
      res.redirect(volver + 'google=error');
    }
  });

  // Elegir qué calendarios de Google salen y si son reuniones o visitas
  app.post('/api/calendario/google/calendarios', mw, ruta('POST calendario/google/calendarios', async req => {
    const yo = usuarioDe(req);
    const [fila] = await q(supabase.from('calendario_google').select('*').eq('usuario', yo));
    if (!fila) throw fallo(400, 'Primero conecta tu Google Calendar');
    const elegido = {};
    (Array.isArray(req.body && req.body.calendarios) ? req.body.calendarios : []).forEach(c => { if (c && ['reunion', 'visita', 'no'].includes(c.tipo)) elegido[c.id] = c.tipo; });
    const calendarios = (fila.calendarios || []).map(c => ({ ...c, tipo: elegido[c.id] || c.tipo }));
    await q(supabase.from('calendario_google').update({ calendarios }).eq('usuario', yo).select());
    olvidarCacheDe(yo);
    return { google: estadoGoogle({ ...fila, calendarios }) };
  }));

  app.post('/api/calendario/google/desconectar', mw, ruta('POST calendario/google/desconectar', async req => {
    const yo = usuarioDe(req);
    const [fila] = await q(supabase.from('calendario_google').select('token_cifrado').eq('usuario', yo));
    if (fila) {
      // Se retira también el permiso en Google (si falla, se borra igualmente aquí)
      try { await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(G.descifrar(fila.token_cifrado)), { method: 'POST' }); } catch (e) {}
      await q(supabase.from('calendario_google').delete().eq('usuario', yo).select());
    }
    G.olvidarAcceso(yo); olvidarCacheDe(yo);
    return { google: estadoGoogle(null) };
  }));

  // ── Turnos ──
  const soloPersonal = (req, res, next) => ROLES_PERSONAL.includes(req.session.usuario.rol) ? next() : res.status(403).json({ error: 'No autorizado' });
  const soloEditan = (req, res, next) => puedeApuntar(req.session.usuario) ? next() : res.status(403).json({ error: 'Los turnos los cambian Leo, Jesús Aguilera, Rafa Pérez y Sergio' });

  app.get('/api/calendario/turnos', mw, soloPersonal, ruta('GET calendario/turnos', async req => {
    const [empleados, semana] = await Promise.all([plantilla(), todo('turnos_semana', null, 'clave')]);
    return { empleados, semana: semana.map(s => ({ clave: s.clave, dia: s.dia, entrada: s.entrada && s.entrada.slice(0, 5), salida: s.salida && s.salida.slice(0, 5), entrada2: s.entrada2 && s.entrada2.slice(0, 5), salida2: s.salida2 && s.salida2.slice(0, 5), libre: s.libre })), puede_editar: puedeApuntar(req.session.usuario) };
  }));

  // Un tramo de turno válido: libre, o entrada y salida (y la segunda parte si es partido)
  function tramo(t) {
    if (t.libre) return { entrada: null, salida: null, entrada2: null, salida2: null, libre: true };
    const e = String(t.entrada || ''), s = String(t.salida || ''), e2 = String(t.entrada2 || ''), s2 = String(t.salida2 || '');
    if (!horaValida(e) || !horaValida(s)) return null;
    if ((e2 || s2) && (!horaValida(e2) || !horaValida(s2))) return null;
    return { entrada: e, salida: s, entrada2: e2 || null, salida2: s2 || null, libre: false };
  }
  async function empleadoDe(clave) {
    const e = (await plantilla()).find(x => x.clave === clave);
    if (!e) throw fallo(400, 'Trabajador no encontrado');
    return e;
  }

  // Horario semanal de una persona: los días sin horario se quitan
  app.put('/api/calendario/turnos/semana', mw, soloPersonal, soloEditan, ruta('PUT turnos/semana', async req => {
    const b = req.body || {};
    const e = await empleadoDe(String(b.clave || ''));
    const filas = [];
    for (const d of Array.isArray(b.dias) ? b.dias : []) {
      const dia = Number(d && d.dia);
      if (!(dia >= 1 && dia <= 7)) throw fallo(400, 'Día no válido');
      if (!d.libre && !d.entrada && !d.salida) continue; // sin horario ese día
      const t = tramo(d);
      if (!t) throw fallo(400, 'Revisa las horas (formato 08:00)');
      filas.push({ clave: e.clave, dia, nombre: e.nombre, ...t, actualizado_por: quien(req), actualizado_en: new Date().toISOString() });
    }
    await q(supabase.from('turnos_semana').delete().eq('clave', e.clave).select());
    if (filas.length) await q(supabase.from('turnos_semana').insert(filas).select());
    return { guardados: filas.length };
  }));

  // Cambio para un día (o varios seguidos: desde..hasta)
  app.put('/api/calendario/turnos/dia', mw, soloPersonal, soloEditan, ruta('PUT turnos/dia', async req => {
    const b = req.body || {};
    const e = await empleadoDe(String(b.clave || ''));
    const desde = String(b.fecha || ''), hasta = String(b.hasta || b.fecha || '');
    if (!fechaValida(desde) || !fechaValida(hasta) || hasta < desde) throw fallo(400, 'Indica la fecha');
    const dias = A.diasDelRango(desde, hasta);
    if (dias.length > 62) throw fallo(400, 'Como mucho 62 días de golpe');
    const t = tramo(b);
    if (!t) throw fallo(400, 'Revisa las horas (formato 08:00) o marca «Libre»');
    const nota = String(b.nota || '').trim().slice(0, 300) || null;
    await q(supabase.from('turnos_dia').upsert(dias.map(fecha => ({ clave: e.clave, fecha, nombre: e.nombre, ...t, nota, registrado_por: quien(req), creado_en: new Date().toISOString() }))).select());
    return { guardados: dias.length };
  }));

  // Quitar el cambio de un día: vuelve a su horario semanal
  app.delete('/api/calendario/turnos/dia', mw, soloPersonal, soloEditan, ruta('DELETE turnos/dia', async req => {
    const clave = String(req.query.clave || ''), fecha = String(req.query.fecha || '');
    if (!clave || !fechaValida(fecha)) throw fallo(400, 'Faltan datos');
    await q(supabase.from('turnos_dia').delete().eq('clave', clave).eq('fecha', fecha).select());
    return {};
  }));

  return { ausenciasRutas };
}

module.exports = { registrar, tiposVisibles, TIPOS };
