// Rutas sin Google (oct 2026). Hasta ahora vehículo/vuelta/orden/notas y las
// paradas manuales se mandaban al Apps Script "ORUM CENTRAL", que escribía su
// hoja (RUTAS_ASIGNACIONES / RUTAS_MANUAL) y luego copiaba a Supabase; la
// lista de choferes y el historial vivían en "RUTA ORUM 2026". Ahora todo se
// escribe aquí, directo en Supabase, con la misma forma de los datos que
// dejaba el Apps Script (rutasSetAsignacion / rutasAddParadaManual /
// rutasUpdateParadaManual / rutasDelParadaManual en OrumCentral.gs), para que
// rutas.html, la app del conductor y la sincronización de Rentman no noten
// el cambio. SQL: sql/rutas_sin_google.sql

const TZ = 'Europe/Madrid';

// El frontend manda conductor como objeto ({} casi siempre); el Apps Script
// lo guardaba tal cual y en la tabla quedaba el texto "{}".
const textoConductor = c => (c == null || c === '' ? null : (typeof c === 'object' ? JSON.stringify(c) : String(c)));
const entero = v => { const n = parseInt(v); return isNaN(n) ? null : n; };
const urlMaps = dir => (dir ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(dir) : '');

function crearRutasGuardado(supabase) {
  const comprobar = (resp, que) => { if (resp.error) throw new Error(que + ': ' + resp.error.message); return resp.data; };

  // Vehículo / vuelta / orden / notas de una parada (de proyecto o manual).
  // rutas_paradas es lo que lee la pantalla; rutas_asignaciones guarda la
  // última asignación por clave (sirve para recuperarla si una
  // resincronización mueve la parada).
  async function setAsignacion(d) {
    const clave = String(d.clave || '');
    if (!clave) throw Object.assign(new Error('Falta la clave de la parada'), { status: 400 });
    const vuelta = entero(d.vuelta) || 1, orden = entero(d.orden) || 0;
    const conductor = textoConductor(d.conductor);
    comprobar(await supabase.from('rutas_asignaciones').upsert({
      clave, proyecto_id: entero(d.proyecto_id), tipo: d.tipo || null, fecha: d.fecha || null,
      vehiculo: d.vehiculo || null, conductor, notas: d.notas || null, vuelta, orden, ts: new Date().toISOString()
    }, { onConflict: 'clave' }), 'rutas_asignaciones');
    comprobar(await supabase.from('rutas_paradas')
      .update({ vehiculo: d.vehiculo || null, conductor, notas: d.notas || null, vuelta, orden })
      .eq('clave', clave), 'rutas_paradas');
  }

  // Parada manual nueva: id "MAN_<ms>", y en rutas_paradas la clave es
  // "MAN_" + id (ver id_manual en lib/supabaseSource.js).
  async function addManual(d, usuario) {
    const id = 'MAN_' + Date.now();
    const ahora = new Date().toISOString();
    comprobar(await supabase.from('rutas_manual').insert({
      id, tipo: d.tipo || 'OTRO', numero: entero(d.numero), descripcion: d.descripcion || null,
      fecha: d.fecha || null, hora: d.hora || null, direccion: d.direccion || null,
      vehiculo: d.vehiculo || null, conductor: textoConductor(d.conductor), usuario: usuario || null,
      ts_raw: ahora, columna_extra_raw: null, sincronizado_en: ahora
    }), 'rutas_manual');
    comprobar(await supabase.from('rutas_paradas').upsert({
      clave: 'MAN_' + id, tipo: d.tipo || 'OTRO', proyecto_id: null, numero: entero(d.numero),
      cliente: d.descripcion || null, localizacion: d.direccion || null, google_maps_url: urlMaps(d.direccion),
      estado: '', fecha: d.fecha || null, hora: d.hora || null, vehiculo: d.vehiculo || null,
      conductor: textoConductor(d.conductor), notas: d.notas || null, vuelta: 1, orden: 0, es_manual: true, sincronizado_en: ahora
    }, { onConflict: 'clave' }), 'rutas_paradas');
    return id;
  }

  // Solo se tocan los campos que vienen en la petición (igual que el Apps Script).
  async function updateManual(d) {
    const id = String(d.id || '');
    if (!id) throw Object.assign(new Error('Falta el id de la parada manual'), { status: 400 });
    const man = {}, par = {};
    if (d.tipo !== undefined) { man.tipo = d.tipo; par.tipo = d.tipo; }
    if (d.numero !== undefined) { man.numero = entero(d.numero); par.numero = entero(d.numero); }
    if (d.descripcion !== undefined) { man.descripcion = d.descripcion; par.cliente = d.descripcion; }
    if (d.fecha !== undefined) { man.fecha = d.fecha || null; par.fecha = d.fecha || null; }
    if (d.hora !== undefined) { man.hora = d.hora; par.hora = d.hora; }
    if (d.direccion !== undefined) { man.direccion = d.direccion; par.localizacion = d.direccion; par.google_maps_url = urlMaps(d.direccion); }
    if (d.vehiculo !== undefined) { man.vehiculo = d.vehiculo || null; par.vehiculo = d.vehiculo || null; }
    if (d.conductor !== undefined) { man.conductor = textoConductor(d.conductor); par.conductor = textoConductor(d.conductor); }
    if (d.notas !== undefined) { par.notas = d.notas || null; }
    if (Object.keys(man).length) comprobar(await supabase.from('rutas_manual').update(man).eq('id', id), 'rutas_manual');
    if (Object.keys(par).length) comprobar(await supabase.from('rutas_paradas').update(par).eq('clave', 'MAN_' + id), 'rutas_paradas');
  }

  async function delManual(id) {
    id = String(id || '');
    if (!id) throw Object.assign(new Error('Falta el id de la parada manual'), { status: 400 });
    comprobar(await supabase.from('rutas_manual').delete().eq('id', id), 'rutas_manual');
    comprobar(await supabase.from('rutas_paradas').delete().eq('clave', 'MAN_' + id), 'rutas_paradas');
  }

  // ── Lista de choferes ──
  async function getChoferes() {
    const data = comprobar(await supabase.from('rutas_config').select('valor').eq('clave', 'CHOFERES').maybeSingle(), 'rutas_config');
    return data && Array.isArray(data.valor) ? data.valor : [];
  }
  async function setChoferes(lista) {
    const limpia = (Array.isArray(lista) ? lista : []).map(x => String(x).trim()).filter(Boolean);
    comprobar(await supabase.from('rutas_config').upsert({ clave: 'CHOFERES', valor: limpia, updated: new Date().toISOString() }, { onConflict: 'clave' }), 'rutas_config');
    return limpia;
  }

  // ── Historial (quién hizo qué) ──
  // Nunca rompe la acción principal: si falla, solo se avisa en el log.
  async function logHistorial(usuario, accion, detalle) {
    const texto = typeof detalle === 'string' ? detalle : JSON.stringify(detalle || {});
    const { error } = await supabase.from('rutas_historial').insert({ usuario: usuario || 'Desconocido', accion: accion || '', detalle: texto.substring(0, 2000) });
    if (error) console.error('[Rutas historial]', accion, error.message);
  }
  // Misma forma que devolvía el Apps Script (ts "dd/MM/yyyy HH:mm" en Madrid).
  async function getHistorial(limit) {
    const n = Math.min(parseInt(limit) || 200, 3000);
    const data = comprobar(await supabase.from('rutas_historial').select('ts,usuario,accion,detalle').order('ts', { ascending: false }).limit(n), 'rutas_historial');
    const fmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    return (data || []).map(h => ({ ts: fmt.format(new Date(h.ts)).replace(',', ''), usuario: h.usuario || '', accion: h.accion || '', detalle: h.detalle || '' }));
  }

  // ── Paradas fijas semanales (nov 2026) ──
  // Lunes, miércoles y viernes hay que llevar/recoger los caminos de mesa del
  // restaurante; antes se metía a mano y se olvidaba. Se crean como paradas
  // manuales normales (se pueden asignar, mover, editar o borrar igual), con
  // id fijo por fecha para no duplicar nunca. Solo se generan una vez por
  // fecha (rutas_config FIJAS_GENERADAS_HASTA): si alguien borra una (festivo),
  // no vuelve a aparecer. Si ese día ya había una parada manual de caminos
  // puesta a mano, tampoco se crea.
  async function asegurarParadasFijas(diasAdelante = 21) {
    const cfg = comprobar(await supabase.from('rutas_config').select('valor').eq('clave', 'FIJAS_GENERADAS_HASTA').maybeSingle(), 'rutas_config');
    const generadasHasta = cfg && typeof cfg.valor === 'string' ? cfg.valor : '';
    const hoy = hoyMadrid();
    const fechas = fechasFijas(hoy, diasAdelante).filter(f => f > generadasHasta);
    const ultima = sumarDias(hoy, diasAdelante);
    if (!fechas.length) {
      if (ultima > generadasHasta) await guardarGeneradasHasta(ultima);
      return [];
    }
    const yaHay = comprobar(await supabase.from('rutas_manual').select('fecha,descripcion')
      .gte('fecha', fechas[0]).lte('fecha', fechas[fechas.length - 1] + 'T23:59:59Z'), 'rutas_manual') || [];
    const conCaminos = new Set(yaHay.filter(m => /camino/i.test(m.descripcion || '')).map(m => String(m.fecha).slice(0, 10)));
    const creadas = [];
    for (const fecha of fechas) {
      if (conCaminos.has(fecha)) continue;
      const id = 'FIJA_CAMINOS_' + fecha;
      const ahora = new Date().toISOString();
      comprobar(await supabase.from('rutas_manual').upsert({
        id, tipo: PARADA_FIJA.tipo, numero: null, descripcion: PARADA_FIJA.descripcion, fecha, hora: null,
        direccion: PARADA_FIJA.direccion, vehiculo: null, conductor: null, usuario: 'Automático',
        ts_raw: ahora, columna_extra_raw: null, sincronizado_en: ahora
      }, { onConflict: 'id', ignoreDuplicates: true }), 'rutas_manual');
      comprobar(await supabase.from('rutas_paradas').upsert({
        clave: 'MAN_' + id, tipo: PARADA_FIJA.tipo, proyecto_id: null, numero: null,
        cliente: PARADA_FIJA.descripcion, localizacion: PARADA_FIJA.direccion, google_maps_url: urlMaps(PARADA_FIJA.direccion),
        estado: '', fecha, hora: null, vehiculo: null, conductor: null, notas: PARADA_FIJA.notas,
        vuelta: 1, orden: 0, es_manual: true, sincronizado_en: ahora
      }, { onConflict: 'clave', ignoreDuplicates: true }), 'rutas_paradas');
      creadas.push(fecha);
    }
    await guardarGeneradasHasta(ultima);
    if (creadas.length) await logHistorial('Automático', 'add_manual', { descripcion: PARADA_FIJA.descripcion, fechas: creadas.join(', ') });
    return creadas;
  }
  async function guardarGeneradasHasta(fecha) {
    comprobar(await supabase.from('rutas_config').upsert({ clave: 'FIJAS_GENERADAS_HASTA', valor: fecha, updated: new Date().toISOString() }, { onConflict: 'clave' }), 'rutas_config');
  }

  return { setAsignacion, addManual, updateManual, delManual, getChoferes, setChoferes, logHistorial, getHistorial, asegurarParadasFijas };
}

// Parada fija: lunes (1), miércoles (3) y viernes (5).
const PARADA_FIJA = {
  dias: [1, 3, 5],
  tipo: 'OTRO',
  descripcion: 'CAMINOS ISABELLA AL CARBON',
  direccion: 'ISABELLA AL CARBON',
  notas: 'Parada fija L-X-V: entregar / recoger caminos de mesa del restaurante'
};

// Fechas en "YYYY-MM-DD" (día de Madrid), calculadas en UTC para no depender
// de la zona del servidor.
function hoyMadrid() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function sumarDias(fecha, n) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function fechasFijas(desde, diasAdelante) {
  const out = [];
  for (let i = 0; i <= diasAdelante; i++) {
    const f = sumarDias(desde, i);
    if (PARADA_FIJA.dias.includes(new Date(f + 'T12:00:00Z').getUTCDay())) out.push(f);
  }
  return out;
}

module.exports = { crearRutasGuardado, _test: { textoConductor, urlMaps, fechasFijas, sumarDias } };
