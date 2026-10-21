// ================================================================
// Sincronización Rentman → Supabase, proyecto a proyecto, desde el servidor
// ================================================================
// Hace lo mismo que procesarProyectoCompleto() de OrumCentral.gs (Apps
// Script), con los mismos campos y las mismas reglas, pero escribiendo en
// Supabase directamente: sin pasar por la hoja de Google ni por su cola.
// La hoja sigue existiendo como copia de seguridad, a su ritmo.
//
// Por qué: la cola de Google se revisa cada 5 min, va de un proyecto en uno
// y un cuelgue (límite de 6 min de Apps Script) bloquea a todos los que
// esperan detrás — un cambio de fecha en Rentman podía tardar 15 min en
// verse en Rutas. Aquí un proyecto se sincroniza en segundos y uno lento no
// frena a los demás.
//
// Este archivo solo LEE de Rentman. Las escrituras a Supabase están en
// escribirProyecto(); construirProyecto() no escribe nada y se puede usar
// para comparar (ver compararProyecto()).

const fetch = require('node-fetch');
const { supabase } = require('./supabaseSource');

const RENTMAN_URL = 'https://api.rentman.net';
const ABREBOTELLAS = '/equipment/1600';
const TZ = 'Europe/Madrid';
const ESTADOS_FUERA_DE_RUTA = ['pending', 'concept', 'inquiry', 'cancelado', 'canceled'];

// ── Rentman: lectura con límite de tiempo y reintento ──
// Sin límite de tiempo, una consulta colgada dejaría colgada la
// sincronización entera (justo lo que pasaba en Apps Script).
async function rentman(ruta, { opcional = false } = {}) {
  const token = process.env.RENTMAN_TOKEN;
  if (!token) throw new Error('RENTMAN_TOKEN sin configurar');
  const url = ruta.startsWith('http') ? ruta : RENTMAN_URL + ruta;
  let ultimoError;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, timeout: 20000 });
      if (resp.status === 404 && opcional) return null;
      if (resp.status === 429 || resp.status >= 500) throw new Error('Rentman HTTP ' + resp.status);
      if (!resp.ok) throw new Error('Rentman HTTP ' + resp.status + ' en ' + ruta);
      return (await resp.json()).data;
    } catch (err) {
      ultimoError = err;
      if (intento < 3) await new Promise(r => setTimeout(r, 800 * intento));
    }
  }
  throw ultimoError;
}

// Nombres que casi nunca cambian (estados, contactos, familias de artículo):
// se recuerdan en memoria para no preguntar a Rentman lo mismo en cada proyecto.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map(); // ruta -> { valor, ts }
async function conCache(clave, calcular, ttl) {
  const c = cache.get(clave);
  if (c && Date.now() - c.ts < (ttl || CACHE_TTL_MS)) return c.valor;
  const valor = await calcular();
  cache.set(clave, { valor, ts: Date.now() });
  return valor;
}
const nombreEstado = ruta => !ruta ? '' : conCache('est:' + ruta, async () => ((await rentman(ruta, { opcional: true })) || {}).name || '');
const nombreContacto = ruta => !ruta ? '' : conCache('con:' + ruta, async () => ((await rentman(ruta, { opcional: true })) || {}).displayname || '');
const urlMaps = ruta => !ruta ? '' : conCache('map:' + ruta, async () => {
  const c = (await rentman(ruta, { opcional: true })) || {};
  const dir = [c.visit_street, c.visit_number, c.visit_postalcode, c.visit_city, c.visit_state].filter(Boolean).join(' ');
  return dir ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(dir) : '';
});
// Teléfono general de la ficha del cliente. Caché corta: si se corrige un teléfono en Rentman
// justo antes de una entrega, tiene que verse pronto.
const telefonoDeContacto = ruta => !ruta ? '' : conCache('tel:' + ruta, async () => {
  const c = (await rentman(ruta, { opcional: true })) || {};
  return String(c.phone_1 || c.phone_2 || '').trim();
}, 10 * 60 * 1000);
const familiaDeArticulo = ruta => !ruta ? '' : conCache('fam:' + ruta, async () => {
  const art = await rentman(ruta, { opcional: true });
  if (!art || !art.folder) return '';
  const carpeta = (await rentman(art.folder, { opcional: true })) || {};
  return carpeta.name || carpeta.displayname || '';
});

// ── Formatos (los mismos textos que escribe el Apps Script) ──
function partesMadrid(iso) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  const g = t => p.find(x => x.type === t).value;
  return { dd: g('day'), mm: g('month'), aaaa: g('year'), hh: g('hour') === '24' ? '00' : g('hour'), min: g('minute') };
}
const fecha = iso => { if (!iso) return ''; const p = partesMadrid(iso); return `${p.dd}/${p.mm}/${p.aaaa}`; };
const hora = iso => { if (!iso) return ''; const p = partesMadrid(iso); return `${p.hh}:${p.min}`; };
const fechaHora = iso => iso ? fecha(iso) + ' ' + hora(iso) : '';
const r2 = n => Math.round((parseFloat(n) || 0) * 100) / 100;
// Columnas *_ts: el cron histórico guardaba la hora de Madrid como si fuera UTC;
// se mantiene igual para que las consultas que ya las usan no cambien de resultado.
function tsDeRaw(f, h) {
  const m = String(f || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const hm = String(h || '').match(/(\d{2}):(\d{2})/) || [null, '00', '00'];
  return `${m[3]}-${m[2]}-${m[1]}T${hm[1]}:${hm[2]}:00.000Z`;
}
const isoDeFecha = f => { const m = String(f || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; };
const idDeRuta = ruta => Number(String(ruta || '').split('/').pop()) || null;

// ── Lectura completa de un proyecto ──
// Devuelve las filas listas para cada tabla. No escribe nada.
async function construirProyecto(proyectoId) {
  const pid = Number(proyectoId);
  const p = await rentman('/projects/' + pid, { opcional: true });
  if (!p) return null; // borrado en Rentman: no se toca lo que haya en Supabase

  // Ordenados por id: el "primer" subproyecto (estado, ubicación, enlace de almacén) es el
  // más antiguo, igual que en buscarDesajustes().
  const subs = ((await rentman('/subprojects?project=/projects/' + pid + '&limit=50')) || []).sort((a, b) => a.id - b.id);
  const sub = subs[0] || null;

  const estado = sub ? await nombreEstado(sub.status) : '';
  const cancelado = estado === 'Cancelado' || estado === 'Canceled';
  const rutaLoc = (sub && sub.location) ? sub.location : p.location;
  const [cliente, comercial, locNombre, googleMapsUrl] = await Promise.all([
    nombreContacto(p.customer), nombreContacto(p.account_manager), nombreContacto(rutaLoc), urlMaps(rutaLoc)
  ]);
  const localizacion = locNombre.replace(/^LOC\s+/i, '');

  // Teléfono para la hoja de rutas: la persona de contacto elegida en el proyecto (su móvil,
  // o su fijo) y, aparte, el teléfono general del cliente.
  const persona = p.cust_contact ? ((await rentman(p.cust_contact, { opcional: true })) || {}) : {};
  const contactoNombre = String(persona.displayname || '').trim();
  const contactoTelefono = String(persona.mobilephone || persona.phone || '').trim();
  const clienteTelefono = await telefonoDeContacto(p.customer);

  const entregaFecha = fecha(p.planperiod_start), entregaHora = hora(p.planperiod_start);
  const recogidaFecha = fecha(p.planperiod_end), recogidaHora = hora(p.planperiod_end);
  const ahora = new Date().toISOString();

  // Material de TODOS los subproyectos (21 oct 2026). Antes solo se leía el primero y se
  // perdía lo añadido en subproyectos como "AÑADE" o "EXTRA" (nº 2323: 27 líneas de 58).
  let esAbrebotellas = false;
  const equipment = [];
  for (const s of subs) {
    const grupos = (await rentman('/projectequipmentgroup?subproject=/subprojects/' + s.id + '&limit=100')) || [];
    for (const grupo of grupos) {
      const lineas = (await rentman('/projectequipment?equipment_group=/projectequipmentgroup/' + grupo.id + '&limit=300')) || [];
      for (const item of lineas) {
        if (item.equipment === ABREBOTELLAS) { esAbrebotellas = true; continue; }
        const cantidad = item.quantity_total || item.quantity || 0;
        const precio = item.unit_price || 0;
        equipment.push({
          proyecto_id: pid, familia: await familiaDeArticulo(item.equipment), articulo: item.name || item.displayname || '',
          cantidad, precio_unit: precio, importe: Math.round(cantidad * precio * 100) / 100, updated_raw: ahora
        });
      }
    }
  }

  // Facturas y sus pagos
  const facturasRentman = (await rentman('/invoices?project=/projects/' + pid + '&limit=20')) || [];
  const facturas = facturasRentman.map(f => ({
    factura_id: f.id, proyecto_id: pid, numero: f.number || null, cliente,
    importe_sin_iva: r2(f.price), importe_con_iva: r2(f.price_invat), total_pagado: r2(f.total_paid),
    pendiente_cobro: r2(f.outstanding_balance), esta_pagada: !!f.is_paid,
    fecha_emision_raw: fecha(f.date), fecha_vencimiento_raw: fecha(f.expiration), updated_raw: ahora
  }));
  const pagos = [];
  for (const f of facturasRentman) {
    const lista = (await rentman('/payments?invoice=/invoices/' + f.id + '&limit=50')) || [];
    lista.forEach(pago => pagos.push({
      proyecto_id: pid, factura_id: f.id, numero_factura: f.number || null, pago_id: pago.id,
      importe: r2(pago.amount), fecha_pago_raw: fecha(pago.moment), descripcion: pago.description || '', updated_raw: ahora
    }));
  }

  // Costes adicionales (roturas / no devuelto)
  const estaCobrado = facturas.length > 0 && facturas.every(f => f.esta_pagada);
  const costes = ((await rentman('/costs?project=/projects/' + pid + '&limit=50')) || []).map(c => {
    const cantidad = parseFloat(c.quantity) || 0, precio = parseFloat(c.sale_price) || 0;
    return {
      proyecto_id: pid, numero: p.number || null, articulo: c.name || c.displayname || '', cantidad, precio_unit: precio,
      importe: Math.round(cantidad * precio * 100) / 100, esta_cobrado: estaCobrado,
      fecha_entrega: p.planperiod_start ? new Date(p.planperiod_start).toISOString() : null, updated: ahora
    };
  });

  // Servicios (montaje, nocturno, recogida...). price_total de Rentman no es fiable: se calcula.
  const servicios = [];
  ((await rentman('/projectfunctions?project=/projects/' + pid + '&limit=50')) || []).forEach(fn => {
    const cantidad = parseFloat(fn.amount) || 0;
    const importe = Math.round(cantidad * (parseFloat(fn.price_fixed) || 0) * 100) / 100;
    if (importe === 0) return;
    servicios.push({ proyecto_id: pid, numero: p.number || null, servicio: fn.name || fn.displayname || '', cantidad, importe, fecha_entrega_raw: entregaFecha, updated_raw: ahora });
  });

  // Presupuesto: solo la última versión
  let presupuesto = null;
  const quotes = (await rentman('/quotes?project=/projects/' + pid + '&limit=20&sort=-created')) || [];
  if (quotes.length) {
    const q = quotes.reduce((mejor, x) => {
      if (!mejor) return x;
      const vm = parseInt(mejor.version) || 0, vx = parseInt(x.version) || 0;
      if (vx !== vm) return vx > vm ? x : mejor;
      return new Date(x.created) > new Date(mejor.created) ? x : mejor;
    }, null);
    presupuesto = {
      presupuesto_id: q.id, proyecto_id: pid, numero_proyecto: p.number || null,
      cliente: q.customer ? await nombreContacto(q.customer) : cliente, comercial: await nombreContacto(q.creator),
      version: q.version || 1, fecha_emision_raw: fecha(q.date), fecha_caducidad_raw: fecha(q.expiration_date), estado,
      importe_sin_iva: q.price || 0, importe_con_iva: q.price_invat || 0, updated_raw: ahora
    };
  }

  const pc = p.custom || {};
  const proyecto = {
    // Vacíos como null, igual que los guardaba la copia histórica desde la hoja
    id: pid, subproyecto_id: sub ? sub.id : null,
    numero: p.number || null, nombre: p.name || p.displayname || null, cliente: cliente || null, comercial: comercial || null,
    estado: estado || null, localizacion: localizacion || null,
    valor: p.project_total_price || 0,
    entrega_fecha_raw: entregaFecha, entrega_hora_raw: entregaHora, recogida_fecha_raw: recogidaFecha, recogida_hora_raw: recogidaHora,
    evento_inicio_raw: fechaHora(p.usageperiod_start), evento_fin_raw: fechaHora(p.usageperiod_end),
    es_abrebotellas: esAbrebotellas, cancelado,
    already_invoiced: p.already_invoiced || 0, rental_price: p.project_rental_price || 0, transport_price: p.project_transport_price || 0,
    crew_price: p.project_crew_price || 0, sale_price: p.project_sale_price || 0, other_price: p.project_other_price || 0,
    insurance_price: p.project_insurance_price || 0,
    google_maps_url: googleMapsUrl || null, updated_raw: ahora, fecha_creacion_raw: fecha(p.created),
    importe_fianza: parseFloat(pc.custom_3) || 0,
    forma_pago_fianza_id: pc.custom_4 != null ? String(pc.custom_4) : null,
    estado_fianza_id: pc.custom_5 != null ? String(pc.custom_5) : null,
    importe_devuelto_fianza: parseFloat(pc.custom_6) || 0,
    num_operacion_tpv_cobro: pc.custom_10 || null, num_operacion_tpv_devolucion: pc.custom_15 || null,
    contacto_nombre: contactoNombre || null, contacto_telefono: contactoTelefono || null, cliente_telefono: clienteTelefono || null,
    entrega_ts: tsDeRaw(entregaFecha, entregaHora), recogida_ts: tsDeRaw(recogidaFecha, recogidaHora),
    evento_inicio_ts: tsDeRaw(fecha(p.usageperiod_start), hora(p.usageperiod_start)),
    evento_fin_ts: tsDeRaw(fecha(p.usageperiod_end), hora(p.usageperiod_end)),
    fecha_creacion_ts: tsDeRaw(fecha(p.created), ''), updated_ts: ahora, sincronizado_en: ahora
  };

  // Paradas de Rutas: 0–2 filas (ENTREGA / RECOGIDA), misma regla que doGetRutas.
  // No llevan vehículo, vuelta, orden ni notas: al hacer upsert se conservan los que ya tuviera la parada.
  const estNorm = estado.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const enRuta = !cancelado && !ESTADOS_FUERA_DE_RUTA.includes(estNorm);
  const locMayus = localizacion.toUpperCase();
  const esNave = locMayus.includes('NAVE MARBELLA') || locMayus.includes('NAVE MONDA') || locMayus.includes('ALMACEN');
  const paradas = [];
  const parada = (tipo, f, h) => ({
    clave: `${pid}_${tipo}_${isoDeFecha(f)}`, tipo, proyecto_id: pid, numero: p.number || null, cliente: cliente || null,
    localizacion: localizacion || null, google_maps_url: googleMapsUrl || null, estado: estado || null,
    fecha: isoDeFecha(f), hora: h || null, es_manual: false, sincronizado_en: ahora
  });
  if (enRuta && entregaFecha) paradas.push(parada('ENTREGA', entregaFecha, entregaHora));
  if (enRuta && recogidaFecha && !esNave) paradas.push(parada('RECOGIDA', recogidaFecha, recogidaHora));

  return { proyecto, equipment, facturas, pagos, costes, servicios, presupuesto, paradas };
}

// ── Escritura en Supabase ──
function comprobar(resultado, que) {
  if (resultado.error) throw new Error(que + ': ' + resultado.error.message);
}

async function escribirProyecto(d) {
  const pid = d.proyecto.id;
  comprobar(await supabase.from('proyectos').upsert(d.proyecto, { onConflict: 'id' }), 'proyectos');

  // Paradas de Rutas: se crean o actualizan las de las fechas actuales y se borran las de
  // fechas antiguas del mismo proyecto (antes quedaban "fantasma" hasta el repaso de 15 min).
  const previas = await supabase.from('rutas_paradas').select('clave,tipo,notas').eq('proyecto_id', pid).eq('es_manual', false);
  comprobar(previas, 'rutas_paradas (lectura)');
  if (d.paradas.length) comprobar(await supabase.from('rutas_paradas').upsert(d.paradas, { onConflict: 'clave' }), 'rutas_paradas');

  // Cambio de fecha: la parada del día nuevo hereda la NOTA de la del día antiguo (una nota como
  // "llamar antes de entregar" sigue valiendo). El vehículo, la vuelta y el orden no se heredan:
  // la ruta de otro día hay que montarla de nuevo. Va en un update aparte y no dentro del upsert,
  // porque un upsert con "notas" en unas filas y no en otras pondría a null las de las demás.
  const clavesNuevas = new Set(d.paradas.map(x => x.clave));
  const clavesPrevias = new Set((previas.data || []).map(x => x.clave));
  for (const nueva of d.paradas) {
    if (clavesPrevias.has(nueva.clave)) continue;
    const antigua = (previas.data || []).find(x => x.tipo === nueva.tipo && !clavesNuevas.has(x.clave) && x.notas);
    if (antigua) comprobar(await supabase.from('rutas_paradas').update({ notas: antigua.notas }).eq('clave', nueva.clave).is('notas', null), 'rutas_paradas (nota heredada)');
  }

  let borrar = supabase.from('rutas_paradas').delete().eq('proyecto_id', pid).eq('es_manual', false);
  if (d.paradas.length) borrar = borrar.not('clave', 'in', '(' + d.paradas.map(x => '"' + x.clave + '"').join(',') + ')');
  comprobar(await borrar, 'rutas_paradas (antiguas)');

  // Tablas con identificador propio: upsert y borrado de lo que ya no existe en Rentman
  const conId = async (tabla, campoId, filas) => {
    if (filas.length) comprobar(await supabase.from(tabla).upsert(filas, { onConflict: campoId }), tabla);
    let q = supabase.from(tabla).delete().eq('proyecto_id', pid);
    if (filas.length) q = q.not(campoId, 'in', '(' + filas.map(f => f[campoId]).join(',') + ')');
    comprobar(await q, tabla + ' (antiguas)');
  };
  await conId('facturas', 'factura_id', d.facturas);
  await conId('pagos', 'pago_id', d.pagos);
  await conId('presupuestos', 'presupuesto_id', d.presupuesto ? [d.presupuesto] : []);

  // Tablas sin identificador propio: se sustituyen las filas del proyecto
  const sustituir = async (tabla, filas) => {
    comprobar(await supabase.from(tabla).delete().eq('proyecto_id', pid), tabla + ' (borrado)');
    if (filas.length) comprobar(await supabase.from(tabla).insert(filas), tabla);
  };
  await sustituir('equipment', d.equipment);
  await sustituir('servicios', d.servicios);
  await sustituir('costes_adicionales', d.costes);
}

// ── Cola del servidor ──
// Cada proyecto se sincroniza como mucho una vez a la vez; si llega otro aviso del mismo
// proyecto mientras tanto, se repite una sola vez al terminar. Varios proyectos distintos
// avanzan en paralelo (hasta MAX_PARALELO), así uno lento no frena a los demás.
const MAX_PARALELO = 2;
const enCurso = new Map();   // pid -> { repetir }
const esperando = [];        // pids en espera de hueco
let alSincronizar = () => {};
const escrituraActiva = () => process.env.RENTMAN_SYNC === 'on';

async function sincronizarProyecto(pid) {
  const t0 = Date.now();
  const d = await construirProyecto(pid);
  if (!d) { console.log('[Rentman] Proyecto ' + pid + ' no existe en Rentman, no se toca.'); return { ok: true, existe: false }; }
  if (!escrituraActiva()) {
    console.log('[Rentman] (modo prueba, sin escribir) proyecto ' + pid + ' leído en ' + (Date.now() - t0) + ' ms');
    return { ok: true, escrito: false, datos: d };
  }
  await escribirProyecto(d);
  console.log('[Rentman] Proyecto ' + pid + ' (' + d.proyecto.numero + ') sincronizado en ' + (Date.now() - t0) + ' ms');
  try { alSincronizar(d); } catch (e) { /* un fallo al avisar a las pantallas no invalida la sincronización */ }
  return { ok: true, escrito: true, datos: d };
}

function encolar(pid) {
  pid = Number(pid);
  if (!pid) return;
  const actual = enCurso.get(pid);
  if (actual) { actual.repetir = true; return; }
  if (esperando.includes(pid)) return;
  esperando.push(pid);
  avanzarCola();
}
function avanzarCola() {
  while (enCurso.size < MAX_PARALELO && esperando.length) {
    const pid = esperando.shift();
    const estado = { repetir: false };
    enCurso.set(pid, estado);
    sincronizarProyecto(pid)
      .catch(err => console.error('[Rentman] Error sincronizando proyecto ' + pid + ':', err.message))
      .finally(() => {
        enCurso.delete(pid);
        if (estado.repetir) esperando.push(pid);
        avanzarCola();
      });
  }
}

// A qué proyecto se refiere un aviso de Rentman (mismo criterio que extraerProyectoIdRelay
// en OrumCentral.gs, más los avisos cuyo "padre" es un subproyecto: p. ej. un cambio de
// fechas en un grupo de equipo, que no modifica el proyecto en sí).
async function proyectoDeAviso(data) {
  const item = data && data.items && data.items[0];
  if (!item) return null;
  const padre = item.parent || {};
  if (padre.itemType === 'Project' && padre.id) return Number(padre.id);
  if (data.itemType === 'Project' && item.id) return Number(item.id);
  if (data.itemType === 'Factuur' && item.id) return idDeRuta(((await rentman('/invoices/' + item.id, { opcional: true })) || {}).project);
  const subId = data.itemType === 'Subproject' ? item.id : (padre.itemType === 'Subproject' ? padre.id : null);
  if (subId) return idDeRuta(((await rentman('/subprojects/' + subId, { opcional: true })) || {}).project);
  return null;
}

// ── Red de seguridad ──
// Compara fechas y estado de todos los proyectos de Rentman con Supabase y resincroniza
// los que no coincidan (un aviso perdido, un tipo de cambio del que Rentman no avisa...).
// No compara horas: las guardadas históricamente tienen 25 min de desfase y eso
// marcaría todos los proyectos de golpe.
const MAX_POR_PASADA = 25;
async function listarRentman(recurso, campos) {
  let todos = [];
  for (let off = 0; ; off += 300) {
    const lote = (await rentman('/' + recurso + '?limit=300&offset=' + off + '&fields=' + campos)) || [];
    todos = todos.concat(lote);
    if (lote.length < 300) break;
  }
  return todos;
}
async function buscarDesajustes() {
  const [proyectos, subs] = await Promise.all([
    listarRentman('projects', 'id,planperiod_start,planperiod_end,custom'),
    listarRentman('subprojects', 'id,project,status')
  ]);
  const estadoDe = new Map(); // primer subproyecto de cada proyecto
  subs.sort((a, b) => a.id - b.id).forEach(sp => { const pid = idDeRuta(sp.project); if (pid && !estadoDe.has(pid)) estadoDe.set(pid, sp.status); });
  let enSupabase = [];
  for (let off = 0; ; off += 1000) {
    const r = await supabase.from('proyectos').select('id,estado,entrega_fecha_raw,recogida_fecha_raw,importe_fianza,estado_fianza_id').range(off, off + 999);
    comprobar(r, 'proyectos');
    enSupabase = enSupabase.concat(r.data);
    if (r.data.length < 1000) break;
  }
  const porId = new Map(enSupabase.map(x => [Number(x.id), x]));
  const soloFecha = f => String(f || '').slice(0, 10);
  const desajustes = [];
  for (const p of proyectos) {
    const actual = porId.get(p.id);
    if (!actual) { desajustes.push({ id: p.id, motivo: 'no está en Supabase' }); continue; }
    const estado = await nombreEstado(estadoDe.get(p.id));
    if (soloFecha(actual.entrega_fecha_raw) !== fecha(p.planperiod_start)) desajustes.push({ id: p.id, motivo: 'entrega ' + actual.entrega_fecha_raw + ' → ' + fecha(p.planperiod_start) });
    else if (soloFecha(actual.recogida_fecha_raw) !== fecha(p.planperiod_end)) desajustes.push({ id: p.id, motivo: 'recogida ' + actual.recogida_fecha_raw + ' → ' + fecha(p.planperiod_end) });
    else if ((actual.estado || '') !== estado) desajustes.push({ id: p.id, motivo: 'estado ' + actual.estado + ' → ' + estado });
    // Fianza (custom_3 importe, custom_5 estado): cambiarla en Rentman no siempre
    // dispara el aviso, y la app Caja la lee de Supabase (20 oct 2026).
    else {
      const pc = p.custom || {};
      const importe = parseFloat(pc.custom_3) || 0, estadoF = pc.custom_5 != null ? String(pc.custom_5) : null;
      if (Math.abs((Number(actual.importe_fianza) || 0) - importe) > 0.005 || (actual.estado_fianza_id != null ? String(actual.estado_fianza_id) : null) !== estadoF)
        desajustes.push({ id: p.id, motivo: 'fianza ' + actual.importe_fianza + '/' + actual.estado_fianza_id + ' → ' + importe + '/' + estadoF });
    }
  }
  return desajustes;
}
async function proyectosConVariosSubproyectos() {
  const cuenta = new Map();
  (await listarRentman('subprojects', 'id,project')).forEach(sp => {
    const pid = idDeRuta(sp.project);
    if (pid) cuenta.set(pid, (cuenta.get(pid) || 0) + 1);
  });
  return [...cuenta].filter(([, n]) => n > 1).map(([pid]) => pid);
}
async function pasadaRedSeguridad() {
  if (!escrituraActiva()) return;
  try {
    const desajustes = await buscarDesajustes();
    if (desajustes.length) console.log('[Rentman] Red de seguridad: ' + desajustes.length + ' proyecto(s) desajustado(s)', desajustes.slice(0, MAX_POR_PASADA));
    desajustes.slice(0, MAX_POR_PASADA).forEach(x => encolar(x.id));
  } catch (err) {
    console.error('[Rentman] Red de seguridad falló:', err.message);
  }
}

// ── Rutas HTTP ──
// opciones.alSincronizar(datos): se llama tras cada escritura (para vaciar cachés y avisar a las pantallas).
function registrar(app, requiereLogin, opciones) {
  alSincronizar = (opciones && opciones.alSincronizar) || alSincronizar;
  const soloDireccion = (req, res, next) => {
    if (req.session.usuario.rol !== 'Direccion') return res.status(403).json({ error: 'No autorizado' });
    next();
  };

  // Aviso de Rentman reenviado por el script de Google "RUTA ORUM 2026".
  // Responde al instante; el trabajo se hace después en la cola del servidor.
  app.post('/api/rentman/aviso', (req, res) => {
    const token = process.env.RENTMAN_AVISO_TOKEN;
    if (!token || req.query.token !== token) return res.status(401).json({ error: 'No autorizado' });
    res.json({ ok: true });
    proyectoDeAviso(req.body)
      .then(pid => { if (pid) encolar(pid); })
      .catch(err => console.error('[Rentman] No se pudo interpretar un aviso:', err.message));
  });

  // Forzar la sincronización de un proyecto a mano: POST { "id": 2811 }
  app.post('/api/rentman/sincronizar', requiereLogin, soloDireccion, async (req, res) => {
    try {
      const r = await sincronizarProyecto(Number(req.body && req.body.id));
      res.json({ ok: r.ok, existe: r.existe !== false, escrito: !!r.escrito, proyecto: r.datos ? r.datos.proyecto : null, paradas: r.datos ? r.datos.paradas : null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Ver qué proyectos no coinciden entre Rentman y Supabase, sin tocar nada
  app.get('/api/rentman/desajustes', requiereLogin, soloDireccion, async (req, res) => {
    try { res.json({ ok: true, escritura_activa: escrituraActiva(), desajustes: await buscarDesajustes() }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // Resincronizar de una vez los proyectos con entrega o recogida desde hace "dias" días en adelante
  // (por defecto 7). Sirve tras activar la escritura, para corregir las horas con 25 min de desfase
  // de lo que está por venir sin releer todo el histórico. Abrir en el navegador con sesión de Dirección.
  app.get('/api/rentman/resincronizar-proximos', requiereLogin, soloDireccion, async (req, res) => {
    try {
      if (!escrituraActiva()) return res.status(400).json({ error: 'La escritura está desactivada (RENTMAN_SYNC distinto de "on")' });
      const dias = Number(req.query.dias || 7);
      const desde = new Date(Date.now() - dias * 86400000).toISOString();
      const proyectos = await listarRentman('projects', 'id,planperiod_start,planperiod_end');
      const ids = proyectos.filter(p => (p.planperiod_start && p.planperiod_start >= desde) || (p.planperiod_end && p.planperiod_end >= desde)).map(p => p.id);
      ids.forEach(encolar);
      res.json({ ok: true, encolados: ids.length, nota: 'Se van sincronizando de dos en dos; con 200 proyectos tarda unos 10 minutos.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Resincronizar de una vez los proyectos con más de un subproyecto (21 oct 2026): hasta
  // entonces solo se guardaba el material del primero. Las fechas no cambian, así que sus
  // paradas de Rutas conservan vehículo, vuelta y orden. Abrir con sesión de Dirección.
  app.get('/api/rentman/resincronizar-subproyectos', requiereLogin, soloDireccion, async (req, res) => {
    try {
      if (!escrituraActiva()) return res.status(400).json({ error: 'La escritura está desactivada (RENTMAN_SYNC distinto de "on")' });
      const ids = await proyectosConVariosSubproyectos();
      ids.forEach(encolar);
      res.json({ ok: true, encolados: ids.length, nota: 'Se van sincronizando de dos en dos; tarda unos minutos.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const cadaMin = Number(process.env.RENTMAN_RED_SEGURIDAD_MIN || 10);
  setInterval(pasadaRedSeguridad, cadaMin * 60 * 1000).unref();
  console.log('[Rentman] Sincronización directa: ' + (escrituraActiva() ? 'ACTIVA' : 'en modo prueba (no escribe; se activa con RENTMAN_SYNC=on)'));
}

module.exports = { registrar, construirProyecto, sincronizarProyecto, encolar, buscarDesajustes, rentman, _test: { fecha, hora, tsDeRaw, idDeRuta, proyectoDeAviso, escribirProyecto, proyectosConVariosSubproyectos } };
