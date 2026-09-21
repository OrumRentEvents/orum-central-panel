// ================================================================
// Informes a comerciales y Dirección
// ================================================================
// Un único trabajo a las 8:00 (Madrid) cada día:
//   1. Guarda la foto del estado de todos los presupuestos (necesaria para
//      saber qué se transformó / canceló en una semana).
//   2. Lunes a viernes → INFORME DIARIO a cada comercial:
//        - proyectos de los próximos 15 días pendientes de aceptar
//        - proyectos de los próximos 10 días pendientes de pago
//        - presupuestos enviados (evento cuando sea) que llevan 2+ días
//          emitidos sin cerrar
//   3. Lunes → INFORME SEMANAL de la semana anterior (lunes-domingo):
//        - a cada comercial: cómo le fue
//        - a Dirección: objetivo semanal (el mismo del Informe Mensual:
//          ventas 2025 de esa semana +20 %), si se llegó o no, y análisis
//          de cada comercial.
//
// "Transformado" / "cancelado" se calcula comparando el estado de cada
// presupuesto con la foto base (tabla presupuestos_snapshot), porque
// Supabase solo guarda el estado actual, no cuándo cambió. "Enviados" y
// "ventas" no dependen de la foto.
//
// Envío: SMTP (cuenta de correo de ORUM) o API de Resend; ver enviarCorreo().
// Sin ninguna configurada todo se calcula y la foto se guarda, pero no se manda
// ningún correo.

const fetch = require('node-fetch');
const { supabase } = require('./supabaseSource');
const { VENTAS_2025_SEMANAL, CRECIMIENTO_OBJETIVO_INFORME } = require('./objetivoSemanal');

const TZ = 'Europe/Madrid';
const MS_DIA = 86400000;
const PIPELINE = ['pending', 'concept', 'inquiry'];
const DIAS_RETENCION_SNAPSHOT = 45;
const IVA = 1.21;          // valor del proyecto (sin IVA) -> importe a facturar; cuadra en todas las facturas salvo 2
const TOLERANCIA_EUR = 1;  // por debajo, diferencias de redondeo: no se avisa
const VENTANA_ACEPTAR_DIAS = 15;
const VENTANA_PAGO_DIAS = 10;
const DIAS_MIN_SEGUIMIENTO = 2; // un presupuesto pendiente se reclama cuando lleva 2+ días emitido

// ── Utilidades de texto / fechas (todo en ISO "YYYY-MM-DD", sin zonas) ──

function norm(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function limpiarNombre(s) { return (s || '').toString().replace(/\s+/g, ' ').trim(); }
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function categoria(estado) {
  const e = norm(estado);
  if (!e) return null;
  if (PIPELINE.includes(e)) return 'pipeline';
  if (e === 'canceled' || e === 'cancelado') return 'cancelado';
  return 'confirmado';
}
function isoDeRaw(raw) {
  const m = String(raw || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
const isoAMs = iso => Date.parse(iso + 'T00:00:00Z');
const sumarDias = (iso, n) => new Date(isoAMs(iso) + n * MS_DIA).toISOString().slice(0, 10);
const difDias = (a, b) => Math.round((isoAMs(a) - isoAMs(b)) / MS_DIA);
const diaSemana = iso => new Date(isoAMs(iso)).getUTCDay(); // 0 = domingo
const lunesDe = iso => sumarDias(iso, -((diaSemana(iso) || 7) - 1));
function semanaIso(iso) {
  const d = new Date(isoAMs(iso));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / MS_DIA + 1) / 7);
}
function hoyMadrid() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function fechaLarga(iso) {
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const [a, m, d] = iso.split('-');
  return `${dias[diaSemana(iso)]} ${d}/${m}/${a}`;
}
const fechaCorta = iso => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };
function eur(n) {
  return (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
}
const pct = (a, b) => (b > 0 ? Math.round(100 * a / b) : 0);
function msHastaHoraMadrid(hora) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date());
  const g = t => Number(p.find(x => x.type === t).value) % 24;
  let seg = hora * 3600 - (g('hour') * 3600 + g('minute') * 60 + g('second'));
  if (seg <= 0) seg += 86400;
  return seg * 1000;
}
function horaMadridActual() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).formatToParts(new Date());
  return Number(p.find(x => x.type === 'hour').value) % 24;
}

// ── Carga de datos ──

async function paginar(tabla, columnas, filtro) {
  let todas = [];
  for (let off = 0; ; off += 1000) {
    let q = supabase.from(tabla).select(columnas).range(off, off + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw error;
    todas = todas.concat(data);
    if (data.length < 1000) break;
  }
  return todas;
}

async function leerSnapshot(fecha) {
  const filas = await paginar('presupuestos_snapshot', 'proyecto_id,estado', q => q.eq('fecha', fecha));
  if (!filas.length) return null;
  return new Map(filas.map(f => [String(f.proyecto_id), f.estado]));
}

async function guardarSnapshot(fecha, presupuestos) {
  const filas = presupuestos.map(p => ({
    fecha, proyecto_id: String(p.proyecto_id), estado: p.estado || null, importe_sin_iva: p.importe_sin_iva
  }));
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await supabase.from('presupuestos_snapshot').upsert(filas.slice(i, i + 500), { onConflict: 'fecha,proyecto_id' });
    if (error) throw error;
  }
  const { error: errDel } = await supabase.from('presupuestos_snapshot').delete().lt('fecha', sumarDias(fecha, -DIAS_RETENCION_SNAPSHOT));
  if (errDel) console.error('[Informe] No se pudo purgar snapshots antiguos:', errDel.message);
}

// Foto más reciente en [fechaBase - tolerancia, fechaBase]. Devuelve {mapa, fecha} o null.
async function snapshotBase(fechaBase, tolerancia) {
  for (let k = 0; k <= tolerancia; k++) {
    const f = sumarDias(fechaBase, -k);
    const mapa = await leerSnapshot(f);
    if (mapa) return { mapa, fecha: f };
  }
  return null;
}

// Ventas de un tramo = proyectos confirmados con fecha de entrega en él, valor sin IVA.
// Mismo criterio que el Informe Mensual (construirReporteMes en server.js).
function calcularVentas(proyectos, desde, hasta) {
  const porComercial = new Map();
  let total = 0;
  proyectos.forEach(pr => {
    if (pr.cancelado || categoria(pr.estado) !== 'confirmado') return;
    const f = isoDeRaw(pr.entrega_fecha_raw);
    if (!f || f < desde || f > hasta) return;
    const v = Number(pr.valor) || 0;
    total += v;
    const k = norm(pr.comercial);
    const acc = porComercial.get(k) || { nombre: limpiarNombre(pr.comercial) || 'Sin comercial', total: 0, n: 0 };
    acc.total += v; acc.n += 1;
    porComercial.set(k, acc);
  });
  const y2025 = VENTAS_2025_SEMANAL[semanaIso(desde)] || 0;
  return { total, porComercial, objetivo: y2025 * (1 + CRECIMIENTO_OBJETIVO_INFORME), y2025, semanaIso: semanaIso(desde), desde, hasta };
}

async function cargarDatos(hoy) {
  const semDesde = sumarDias(lunesDe(hoy), -7);       // lunes de la última semana completa
  const semHasta = sumarDias(semDesde, 6);
  const semPrevDesde = sumarDias(semDesde, -7);
  const semPrevHasta = sumarDias(semDesde, -1);
  const curDesde = lunesDe(hoy);

  const [presupuestos, proyectos, facturas, baseSemana] = await Promise.all([
    paginar('presupuestos', 'proyecto_id,numero_proyecto,cliente,comercial,estado,importe_sin_iva,fecha_emision_raw,fecha_caducidad_raw'),
    paginar('proyectos', 'id,numero,nombre,cliente,comercial,estado,cancelado,evento_inicio_raw,entrega_fecha_raw,valor'),
    paginar('facturas', 'proyecto_id,numero,importe_con_iva,pendiente_cobro,esta_pagada,fecha_vencimiento_raw'),
    snapshotBase(sumarDias(semDesde, -1), 3)
  ]);

  const presPorProyecto = new Map(presupuestos.map(p => [String(p.proyecto_id), p]));
  const eventoPorProyecto = new Map(proyectos.map(p => [String(p.id), isoDeRaw(p.evento_inicio_raw) || isoDeRaw(p.entrega_fecha_raw)]));

  // Facturado y pendiente de cobro por proyecto
  const factPorProyecto = new Map();
  facturas.forEach(f => {
    const k = String(f.proyecto_id);
    const acc = factPorProyecto.get(k) || { facturado: 0, pendiente: 0, vencida: false };
    acc.facturado += Number(f.importe_con_iva) || 0;
    const pend = Number(f.pendiente_cobro) || 0;
    if (pend > 0 && !f.esta_pagada) {
      acc.pendiente += pend;
      const venc = isoDeRaw(f.fecha_vencimiento_raw);
      if (venc && venc < hoy) acc.vencida = true;
    }
    factPorProyecto.set(k, acc);
  });

  // Proyectos con evento en los próximos 15 días (la ventana más larga); cada lista filtra la suya.
  const limite = sumarDias(hoy, VENTANA_ACEPTAR_DIAS);
  const proximos = [];
  proyectos.forEach(pr => {
    if (pr.cancelado || categoria(pr.estado) === 'cancelado') return;
    const fecha = isoDeRaw(pr.evento_inicio_raw) || isoDeRaw(pr.entrega_fecha_raw);
    if (!fecha || fecha < hoy || fecha > limite) return;
    const pres = presPorProyecto.get(String(pr.id));
    const cad = pres ? isoDeRaw(pres.fecha_caducidad_raw) : null;
    const emision = pres ? isoDeRaw(pres.fecha_emision_raw) : null;
    const fa = factPorProyecto.get(String(pr.id)) || { facturado: 0, pendiente: 0, vencida: false };
    // Pendiente de pago = (a) facturas emitidas sin cobrar + (b) en proyectos ya
    // confirmados, la parte del valor (con IVA) aún sin facturar. Fianzas fuera.
    const sinFacturar = categoria(pr.estado) === 'confirmado' ? (Number(pr.valor) || 0) * IVA - fa.facturado : 0;
    const sinFacturarOk = sinFacturar > TOLERANCIA_EUR ? sinFacturar : 0;
    const facturadoPdte = fa.pendiente > TOLERANCIA_EUR ? fa.pendiente : 0;
    proximos.push({
      id: String(pr.id), numero: pr.numero, cliente: limpiarNombre(pr.cliente) || limpiarNombre(pr.nombre),
      comercial: limpiarNombre(pr.comercial), comKey: norm(pr.comercial), fecha, dias: difDias(fecha, hoy),
      importe: pres ? pres.importe_sin_iva : pr.valor,
      sinConfirmar: categoria(pr.estado) === 'pipeline',
      caducado: categoria(pr.estado) === 'pipeline' && cad !== null && cad < hoy,
      emitidoHace: emision ? difDias(hoy, emision) : null,
      pendiente: sinFacturarOk + facturadoPdte, sinFacturar: sinFacturarOk, facturadoPdte,
      vencida: fa.vencida && facturadoPdte > 0
    });
  });
  proximos.sort((a, b) => a.fecha.localeCompare(b.fecha));
  const porAceptar = proximos.filter(x => x.sinConfirmar);
  const porCobrar = proximos.filter(x => x.pendiente > 0 && x.dias <= VENTANA_PAGO_DIAS);
  const idsAceptar = new Set(porAceptar.map(x => x.id));

  // Presupuestos pendientes de cerrar: 2+ días emitidos, aún sin decisión y no caducados.
  // Los de evento en 15 días ya salen arriba (con su "emitido hace N d"): aquí solo el resto.
  const seguimiento = [];
  const caducadosSinCerrar = [];
  presupuestos.forEach(p => {
    if (categoria(p.estado) !== 'pipeline') return;
    const cad = isoDeRaw(p.fecha_caducidad_raw);
    const emision = isoDeRaw(p.fecha_emision_raw);
    const item = {
      id: String(p.proyecto_id), numero: p.numero_proyecto, cliente: limpiarNombre(p.cliente), comercial: limpiarNombre(p.comercial),
      comKey: norm(p.comercial), importe: p.importe_sin_iva, emitidoHace: emision ? difDias(hoy, emision) : null,
      caduca: cad ? difDias(cad, hoy) : null, evento: eventoPorProyecto.get(String(p.proyecto_id)) || null
    };
    if (cad && cad < hoy) { caducadosSinCerrar.push(item); return; }
    if (item.emitidoHace === null || item.emitidoHace < DIAS_MIN_SEGUIMIENTO) return;
    if (idsAceptar.has(item.id)) return;
    seguimiento.push(item);
  });
  seguimiento.sort((a, b) => b.emitidoHace - a.emitidoHace);

  return {
    hoy, semDesde, semHasta, semPrevDesde, semPrevHasta, presupuestos, baseSemana,
    porAceptar, porCobrar, seguimiento, caducadosSinCerrar,
    ventasSemana: calcularVentas(proyectos, semDesde, semHasta),
    ventasEnCurso: calcularVentas(proyectos, curDesde, sumarDias(curDesde, 6))
  };
}

// ── Cálculo semanal ──

function calcularPeriodo(pres, base, desde, hasta) {
  const enviados = pres.filter(p => { const e = isoDeRaw(p.fecha_emision_raw); return e && e >= desde && e <= hasta; });
  const r = { enviados, transformados: [], cancelados: [], bajas: [], historico: !!base };
  if (!base) return r;
  pres.forEach(p => {
    const fin = categoria(p.estado);
    const previo = base.mapa.get(String(p.proyecto_id));
    const emision = isoDeRaw(p.fecha_emision_raw);
    // Sin fila en la foto base: si el presupuesto se emitió después de esa foto
    // partió de "pendiente"; si es anterior, no sabemos de dónde venía.
    const ini = previo !== undefined ? categoria(previo) : (emision && emision > base.fecha ? 'pipeline' : null);
    if (ini === 'pipeline' && fin === 'confirmado') r.transformados.push(p);
    else if (ini === 'pipeline' && fin === 'cancelado') r.cancelados.push(p);
    else if (ini === 'confirmado' && fin === 'cancelado') r.bajas.push(p);
  });
  return r;
}

function calcularCartera(pres, hoy) {
  const c = { vigentes: [], porVencer: [], caducados: [] };
  pres.forEach(p => {
    if (categoria(p.estado) !== 'pipeline') return;
    const cad = isoDeRaw(p.fecha_caducidad_raw);
    const dias = cad ? difDias(cad, hoy) : null;
    if (dias !== null && dias < 0) c.caducados.push(p);
    else {
      c.vigentes.push(p);
      if (dias !== null && dias <= 7) c.porVencer.push({ ...p, dias });
    }
  });
  c.porVencer.sort((a, b) => a.dias - b.dias);
  return c;
}

function resumenComercial(d, comKey) {
  const pres = comKey === null ? d.presupuestos : d.presupuestos.filter(p => norm(p.comercial) === comKey);
  const periodo = calcularPeriodo(pres, d.baseSemana, d.semDesde, d.semHasta);
  const enviadosPrev = calcularPeriodo(pres, null, d.semPrevDesde, d.semPrevHasta).enviados;
  const v = comKey === null ? null : d.ventasSemana.porComercial.get(comKey);
  return {
    periodo, enviadosPrev,
    cartera: calcularCartera(pres, d.hoy),
    ventas: comKey === null ? d.ventasSemana.total : (v ? v.total : 0),
    ventasN: comKey === null ? null : (v ? v.n : 0)
  };
}

const suma = lista => lista.reduce((s, p) => s + (Number(p.importe_sin_iva) || 0), 0);

// ── Componentes HTML ──

const C = { tinta: '#1a1a18', gris: '#6b6b66', linea: '#e4e2dc', fondo: '#f4f3ef', dorado: '#b8893a', rojo: '#a32d2d', verde: '#4c8c1f', ambar: '#c77d0b' };
const H2 = t => `<h2 style="font-size:15px;margin:24px 0 2px;color:${C.tinta};">${t}</h2>`;
const SUB = t => `<div style="font-size:12px;color:${C.gris};margin-bottom:6px;">${t}</div>`;

function kpi(etiqueta, valor, nota, color) {
  return `<td style="width:33%;padding:0 4px;vertical-align:top;">
    <div style="border:1px solid ${C.linea};border-top:3px solid ${color};border-radius:4px;padding:10px 12px;background:#fff;">
      <div style="font-size:11px;color:${C.gris};text-transform:uppercase;letter-spacing:.04em;">${etiqueta}</div>
      <div style="font-size:24px;font-weight:600;color:${C.tinta};line-height:1.2;">${valor}</div>
      <div style="font-size:12px;color:${C.gris};">${nota}</div>
    </div></td>`;
}
const kpiFila = (...celdas) => `<table style="width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;"><tr>${celdas.join('')}</tr></table>`;

function listaProyectos(titulo, lista, color, max) {
  if (!lista.length) return '';
  const filas = lista.slice(0, max).map(p =>
    `<tr><td style="padding:3px 0;color:${C.gris};width:52px;">${esc(p.numero_proyecto)}</td>
      <td style="padding:3px 6px;">${esc(limpiarNombre(p.cliente)) || '—'}</td>
      <td style="padding:3px 0;text-align:right;white-space:nowrap;">${eur(p.importe_sin_iva)}</td></tr>`).join('');
  const mas = lista.length > max ? `<tr><td colspan="3" style="padding:3px 0;color:${C.gris};font-size:12px;">+ ${lista.length - max} más</td></tr>` : '';
  return `<div style="margin:8px 4px 0;font-size:13px;">
    <div style="font-weight:600;color:${color};margin-bottom:2px;">${titulo}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;color:${C.tinta};">${filas}${mas}</table></div>`;
}

function bloqueCartera(c) {
  const porVencer = c.porVencer.slice(0, 8).map(p =>
    `<tr><td style="padding:3px 0;color:${C.gris};width:52px;">${esc(p.numero_proyecto)}</td>
      <td style="padding:3px 6px;">${esc(limpiarNombre(p.cliente)) || '—'}</td>
      <td style="padding:3px 6px;color:${p.dias <= 3 ? C.rojo : C.ambar};white-space:nowrap;">${p.dias === 0 ? 'caduca hoy' : 'caduca en ' + p.dias + ' d'}</td>
      <td style="padding:3px 0;text-align:right;white-space:nowrap;">${eur(p.importe_sin_iva)}</td></tr>`).join('');
  const mas = c.porVencer.length > 8 ? `<tr><td colspan="4" style="padding:3px 0;color:${C.gris};font-size:12px;">+ ${c.porVencer.length - 8} más</td></tr>` : '';
  return `${H2('Cartera de presupuestos pendientes de decisión')}
    <div style="font-size:13px;margin:4px 4px 0;color:${C.tinta};"><strong>${c.vigentes.length}</strong> vigentes (${eur(suma(c.vigentes))})${c.caducados.length ? ` · <span style="color:${C.gris};">${c.caducados.length} caducados sin cerrar (${eur(suma(c.caducados))}) — conviene cerrarlos o cancelarlos en Rentman</span>` : ''}</div>
    ${c.porVencer.length ? `<div style="margin:8px 4px 0;font-size:13px;"><div style="font-weight:600;color:${C.ambar};margin-bottom:2px;">⏰ Caducan en 7 días o menos</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:${C.tinta};">${porVencer}${mas}</table></div>` : ''}`;
}

function envolver(titulo, saludo, fechaTxt, cuerpo, pie) {
  return `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:${C.fondo};">
  <div style="max-width:660px;margin:0 auto;padding:20px 12px;font-family:Arial,Helvetica,sans-serif;color:${C.tinta};">
    <div style="background:#fff;border:1px solid ${C.linea};border-radius:6px;padding:22px 20px;">
      <div style="font-size:11px;letter-spacing:.14em;color:${C.dorado};font-weight:600;">ORUM CENTRAL</div>
      <h1 style="font-size:20px;margin:4px 0 2px;font-weight:600;">${titulo}</h1>
      <div style="font-size:13px;color:${C.gris};">${saludo ? saludo + ' · ' : ''}${fechaTxt}</div>
      ${cuerpo}
      <div style="margin-top:26px;padding-top:12px;border-top:1px solid ${C.linea};font-size:11px;color:${C.gris};">${pie}</div>
    </div></div></body></html>`;
}

// ── INFORME DIARIO (por comercial) ──

function filaProyecto(x, derecha) {
  const cuando = x.dias === 0 ? 'hoy' : (x.dias === 1 ? 'mañana' : `en ${x.dias} d`);
  return `<tr style="border-top:1px solid ${C.linea};">
    <td style="padding:5px 0;white-space:nowrap;vertical-align:top;">${fechaCorta(x.fecha)}<div style="font-size:11px;color:${C.gris};">${cuando}</div></td>
    <td style="padding:5px 6px;vertical-align:top;"><span style="color:${C.gris};">${esc(x.numero)}</span> ${esc(x.cliente) || '—'}</td>
    <td style="padding:5px 0;text-align:right;vertical-align:top;font-size:12px;white-space:nowrap;">${derecha}</td></tr>`;
}
function seccionLista(titulo, sub, filas, total, max, vacio) {
  if (!total) return `${H2(titulo)}<div style="font-size:13px;margin:4px 4px 0;color:${C.verde};">✔ ${vacio}</div>`;
  const mas = total > max ? `<div style="font-size:12px;color:${C.gris};margin:4px 4px 0;">+ ${total - max} más — consúltalos en ORUM Central</div>` : '';
  return `${H2(`${titulo} <span style="font-weight:400;color:${C.gris};">(${total})</span>`)}${SUB(sub)}
    <table style="width:100%;border-collapse:collapse;font-size:13px;color:${C.tinta};">${filas}</table>${mas}`;
}

function seccionAceptar(lista, max) {
  const filas = lista.slice(0, max).map(x => filaProyecto(x,
    `<span style="color:${x.caducado ? C.rojo : C.ambar};">${x.caducado ? 'Presupuesto caducado' : 'Sin aceptar'}</span>
     <div style="color:${C.gris};">${eur(x.importe)}${x.emitidoHace !== null ? ` · emitido hace ${x.emitidoHace} d` : ''}</div>`)).join('');
  return seccionLista('⏳ Pendientes de aceptar', `Proyectos con evento en los próximos ${VENTANA_ACEPTAR_DIAS} días cuyo presupuesto sigue sin aceptar`,
    filas, lista.length, max, `Ningún proyecto de los próximos ${VENTANA_ACEPTAR_DIAS} días está pendiente de aceptar.`);
}
function seccionPago(lista, max) {
  const filas = lista.slice(0, max).map(x => filaProyecto(x,
    `<span style="color:${x.vencida ? C.rojo : C.ambar};font-weight:600;">${eur(x.pendiente)}</span>
     ${x.sinFacturar ? `<div style="color:${C.gris};">${eur(x.sinFacturar)} sin facturar</div>` : ''}
     ${x.facturadoPdte ? `<div style="color:${x.vencida ? C.rojo : C.gris};">${eur(x.facturadoPdte)} facturado${x.vencida ? ' (vencido)' : ' sin cobrar'}</div>` : ''}`)).join('');
  return seccionLista('💶 Pendientes de pago', `Proyectos con evento en los próximos ${VENTANA_PAGO_DIAS} días: importe con IVA aún sin facturar o sin cobrar (sin fianzas)`,
    filas, lista.length, max, `Ningún proyecto de los próximos ${VENTANA_PAGO_DIAS} días tiene pagos pendientes.`);
}
function seccionSeguimiento(lista, resto, max) {
  const filas = lista.slice(0, max).map(x => {
    const urg = x.caduca !== null && x.caduca <= 3;
    return `<tr style="border-top:1px solid ${C.linea};">
      <td style="padding:5px 0;vertical-align:top;white-space:nowrap;">hace ${x.emitidoHace} d</td>
      <td style="padding:5px 6px;vertical-align:top;"><span style="color:${C.gris};">${esc(x.numero)}</span> ${esc(x.cliente) || '—'}
        <div style="color:${C.gris};font-size:12px;">${x.evento ? 'evento ' + fechaCorta(x.evento) : 'sin fecha de evento'}</div></td>
      <td style="padding:5px 0;text-align:right;vertical-align:top;font-size:12px;white-space:nowrap;">${eur(x.importe)}
        ${x.caduca !== null ? `<div style="color:${urg ? C.rojo : C.gris};">${x.caduca === 0 ? 'caduca hoy' : 'caduca en ' + x.caduca + ' d'}</div>` : ''}</td></tr>`;
  }).join('');
  const nota = resto ? `<div style="font-size:12px;color:${C.gris};margin:6px 4px 0;">Además tienes ${resto.n} presupuestos caducados sin cerrar (${eur(resto.imp)}): ciérralos o cancélalos en Rentman.</div>` : '';
  return seccionLista('📨 Presupuestos pendientes de cerrar', `Enviados hace ${DIAS_MIN_SEGUIMIENTO} días o más, sin decisión, cuyo evento no es de los próximos ${VENTANA_ACEPTAR_DIAS} días (esos ya salen arriba). Toca llamar al cliente`,
    filas, lista.length, max, 'No hay presupuestos vigentes pendientes de cerrar.') + nota;
}

function construirDiarioComercial(d, nombre) {
  const k = norm(nombre);
  const aceptar = d.porAceptar.filter(x => x.comKey === k);
  const pago = d.porCobrar.filter(x => x.comKey === k);
  const seg = d.seguimiento.filter(x => x.comKey === k);
  const cad = d.caducadosSinCerrar.filter(x => x.comKey === k);
  const primer = limpiarNombre(nombre).split(' ')[0];
  const resumen = kpiFila(
    kpi('Por aceptar', aceptar.length, `próximos ${VENTANA_ACEPTAR_DIAS} días`, C.ambar),
    kpi('Por cobrar', pago.length, `${eur(pago.reduce((s, x) => s + x.pendiente, 0))} · ${VENTANA_PAGO_DIAS} días`, C.rojo),
    kpi('A cerrar', seg.length, 'presupuestos enviados', C.dorado));
  const cuerpo = `<div style="margin-top:14px;">${resumen}</div>
    ${seccionAceptar(aceptar, 30)}${seccionPago(pago, 30)}
    ${seccionSeguimiento(seg, cad.length ? { n: cad.length, imp: cad.reduce((s, x) => s + (Number(x.importe) || 0), 0) } : null, 30)}`;
  return {
    asunto: `ORUM · Pendientes de hoy · ${fechaCorta(d.hoy)}`,
    html: envolver('Pendientes del día', `Hola ${esc(primer)}`, fechaLarga(d.hoy), cuerpo,
      'Datos de ORUM Central a las 8:00. Importes de presupuestos sin IVA; los de «Pendientes de pago» con IVA (21 %) y sin fianzas.')
  };
}

// ── INFORME SEMANAL ──

function bloqueSemana(titulo, sub, p) {
  const dec = p.transformados.length + p.cancelados.length;
  const tasa = p.historico && dec > 0 ? ` · tasa de cierre ${pct(p.transformados.length, dec)} %` : '';
  const sinHist = p.historico ? '' :
    `<div style="margin:6px 4px 0;font-size:12px;color:${C.ambar};">Transformados y cancelados: aún sin histórico suficiente. Enviados y ventas sí son exactos.</div>`;
  return `${H2(titulo)}${SUB(sub + tasa)}
    ${kpiFila(
      kpi('Enviados', p.enviados.length, eur(suma(p.enviados)), C.dorado),
      p.historico ? kpi('Transformados', p.transformados.length, eur(suma(p.transformados)), C.verde) : kpi('Transformados', '—', 'sin histórico', C.linea),
      p.historico ? kpi('Cancelados', p.cancelados.length, eur(suma(p.cancelados)), C.rojo) : kpi('Cancelados', '—', 'sin histórico', C.linea))}${sinHist}
    ${listaProyectos('✔ Transformados en proyecto', p.transformados, C.verde, 10)}
    ${listaProyectos('✖ Cancelados', p.cancelados, C.rojo, 10)}
    ${listaProyectos('⚠ Proyectos ya confirmados que se han cancelado', p.bajas, C.rojo, 10)}`;
}

// Objetivo del equipo: el comercial solo ve el total del equipo y SU aportación,
// nunca lo que ha hecho cada compañero.
function bloqueObjetivoEquipo(d, aportacion) {
  const v = d.ventasSemana;
  const llegado = v.objetivo > 0 && v.total >= v.objetivo;
  const dif = v.total - v.objetivo;
  return `${H2('Objetivo del equipo')}${SUB(`Semana ${v.semanaIso} · ${fechaCorta(v.desde)} – ${fechaCorta(v.hasta)}`)}
    <div style="border:1px solid ${C.linea};border-left:5px solid ${llegado ? C.verde : C.rojo};border-radius:4px;padding:12px 14px;background:#fff;">
      <div style="font-size:16px;font-weight:600;color:${llegado ? C.verde : C.rojo};">${v.objetivo <= 0 ? 'Sin objetivo definido para esta semana' : (llegado ? '✔ Objetivo del equipo alcanzado' : '✖ Objetivo del equipo no alcanzado')}</div>
      <div style="font-size:13px;margin-top:4px;color:${C.tinta};">Entre todos hemos vendido <strong>${eur(v.total)}</strong> · el objetivo de la semana era <strong>${eur(v.objetivo)}</strong>${v.objetivo > 0 ? ` (${pct(v.total, v.objetivo)} %) · ${llegado ? 'por encima en' : 'faltaron'} ${eur(Math.abs(dif))}` : ''}</div>
      <div style="font-size:13px;margin-top:6px;padding-top:6px;border-top:1px solid ${C.linea};color:${C.tinta};">Tu aportación: <strong>${eur(aportacion.total)}</strong> (${pct(aportacion.total, v.total)} % del total) en ${aportacion.n} proyecto${aportacion.n === 1 ? '' : 's'}</div>
    </div>`;
}

function construirSemanalComercial(d, nombre) {
  const r = resumenComercial(d, norm(nombre));
  const primer = limpiarNombre(nombre).split(' ')[0];
  const aportacion = { total: r.ventas, n: r.ventasN || 0 };
  const cuerpo = bloqueObjetivoEquipo(d, aportacion) +
    bloqueSemana('Tu actividad', 'Presupuestos de tu semana', r.periodo) + bloqueCartera(r.cartera);
  return {
    asunto: `ORUM · Tu semana ${fechaCorta(d.semDesde)}–${fechaCorta(d.semHasta)}`,
    html: envolver('Cómo fue tu semana', `Hola ${esc(primer)}`, `${fechaCorta(d.semDesde)} – ${fechaCorta(d.semHasta)}`, cuerpo,
      'Importes sin IVA. «Transformado» = presupuesto que pasa de pendiente a confirmado; «cancelado» = pasa a cancelado (se detecta comparando con la foto diaria del estado). «Ventas» = proyectos confirmados con entrega en la semana; el objetivo del equipo es el del Informe Mensual (ventas de esa semana en 2025 +20 %).')
  };
}

// Frases de análisis por comercial (reglas simples, sin inventar causas)
function lecturaComercial(r) {
  const p = r.periodo, l = [];
  const dif = p.enviados.length - r.enviadosPrev.length;
  l.push(`Envió <strong>${p.enviados.length}</strong> presupuestos (${eur(suma(p.enviados))}), ${dif === 0 ? 'igual que' : (dif > 0 ? '+' + dif + ' respecto a' : dif + ' respecto a')} la semana anterior.`);
  if (p.historico) {
    const dec = p.transformados.length + p.cancelados.length;
    l.push(`Cerró <strong>${p.transformados.length}</strong> (${eur(suma(p.transformados))}) y perdió ${p.cancelados.length} (${eur(suma(p.cancelados))})${dec ? ` · tasa de cierre ${pct(p.transformados.length, dec)} %` : ''}.`);
  } else l.push('Cierres: aún sin histórico suficiente.');
  l.push(`Cartera: ${r.cartera.vigentes.length} presupuestos vigentes (${eur(suma(r.cartera.vigentes))}) y ${r.cartera.caducados.length} caducados sin cerrar.`);
  const alertas = [];
  if (p.enviados.length === 0) alertas.push('no envió ningún presupuesto');
  if (p.bajas.length) alertas.push(`${p.bajas.length} proyecto${p.bajas.length > 1 ? 's' : ''} confirmado${p.bajas.length > 1 ? 's' : ''} cancelado${p.bajas.length > 1 ? 's' : ''} (${eur(suma(p.bajas))})`);
  if (p.historico && p.transformados.length + p.cancelados.length >= 3 && pct(p.transformados.length, p.transformados.length + p.cancelados.length) < 30) alertas.push('tasa de cierre baja');
  if (r.cartera.caducados.length >= 15) alertas.push('cartera con muchos caducados sin cerrar');
  if (r.cartera.porVencer.length >= 5) alertas.push(`${r.cartera.porVencer.length} presupuestos caducan esta semana`);
  return { lineas: l, alertas };
}

function construirSemanalDireccion(d) {
  const v = d.ventasSemana;
  const llegado = v.total >= v.objetivo && v.objetivo > 0;
  const dif = v.total - v.objetivo;
  const vs2025 = v.y2025 > 0 ? Math.round(100 * (v.total / v.y2025 - 1)) : null;
  const cur = d.ventasEnCurso;

  const objetivoHtml = `${H2('Objetivo de la semana')}${SUB(`${fechaCorta(v.desde)} – ${fechaCorta(v.hasta)} (semana ${v.semanaIso}) · mismo objetivo que el Informe Mensual: ventas de esa semana en 2025 +${Math.round(CRECIMIENTO_OBJETIVO_INFORME * 100)} %`)}
    <div style="border:1px solid ${C.linea};border-left:5px solid ${llegado ? C.verde : C.rojo};border-radius:4px;padding:12px 14px;background:#fff;">
      <div style="font-size:16px;font-weight:600;color:${llegado ? C.verde : C.rojo};">${v.objetivo <= 0 ? 'Sin objetivo definido para esta semana' : (llegado ? '✔ Objetivo alcanzado' : '✖ Objetivo no alcanzado')}</div>
      <div style="font-size:13px;margin-top:4px;color:${C.tinta};">Ventas <strong>${eur(v.total)}</strong> de un objetivo de <strong>${eur(v.objetivo)}</strong>${v.objetivo > 0 ? ` (${pct(v.total, v.objetivo)} %) · ${llegado ? 'por encima en' : 'faltan'} ${eur(Math.abs(dif))}` : ''}</div>
      ${vs2025 !== null ? `<div style="font-size:12px;color:${C.gris};margin-top:2px;">${vs2025 >= 0 ? '+' : ''}${vs2025} % respecto a la misma semana de 2025 (${eur(v.y2025)})</div>` : ''}
    </div>
    ${cur.objetivo > 0 ? `<div style="font-size:12px;color:${C.gris};margin:8px 4px 0;">Semana en curso (${fechaCorta(cur.desde)} – ${fechaCorta(cur.hasta)}): ya hay confirmados <strong style="color:${C.tinta};">${eur(cur.total)}</strong> de un objetivo de ${eur(cur.objetivo)} (${pct(cur.total, cur.objetivo)} %).</div>` : ''}`;

  // Comerciales con actividad
  const nombres = new Map();
  d.presupuestos.forEach(p => { const k = norm(p.comercial); if (!nombres.has(k)) nombres.set(k, limpiarNombre(p.comercial) || 'Sin comercial'); });
  v.porComercial.forEach((x, k) => { if (!nombres.has(k)) nombres.set(k, x.nombre); });
  const filas = [];
  nombres.forEach((nombre, k) => {
    const r = resumenComercial(d, k);
    const act = r.periodo.enviados.length + r.periodo.transformados.length + r.periodo.cancelados.length + r.ventas + r.cartera.vigentes.length;
    if (act > 0) filas.push({ nombre, r });
  });
  filas.sort((a, b) => b.r.ventas - a.r.ventas);
  const total = resumenComercial(d, null);

  const celda = (n, imp, hist) => hist === false
    ? `<td style="padding:6px 4px;text-align:center;color:${C.gris};">—</td>`
    : `<td style="padding:6px 4px;text-align:center;"><strong>${n}</strong><div style="font-size:11px;color:${C.gris};">${eur(imp)}</div></td>`;
  const fila = (nombre, r, negrita) => `<tr style="border-top:1px solid ${C.linea};${negrita ? 'background:' + C.fondo + ';font-weight:600;' : ''}">
    <td style="padding:6px 4px;">${esc(nombre)}</td>
    ${celda(r.periodo.enviados.length, suma(r.periodo.enviados))}
    ${celda(r.periodo.transformados.length, suma(r.periodo.transformados), r.periodo.historico)}
    ${celda(r.periodo.cancelados.length, suma(r.periodo.cancelados), r.periodo.historico)}
    <td style="padding:6px 4px;text-align:center;"><strong>${eur(r.ventas)}</strong><div style="font-size:11px;color:${C.gris};">${pct(r.ventas, v.total)} %</div></td>
    ${celda(r.cartera.vigentes.length, suma(r.cartera.vigentes))}
    <td style="padding:6px 4px;text-align:center;">${r.cartera.caducados.length}</td></tr>`;
  const th = t => `<th style="padding:6px 4px;font-size:11px;color:${C.gris};font-weight:600;text-transform:uppercase;letter-spacing:.03em;">${t}</th>`;
  const tabla = `<table style="width:100%;border-collapse:collapse;font-size:13px;color:${C.tinta};margin-top:6px;">
    <tr>${th('Comercial')}${th('Enviados')}${th('Transf.')}${th('Cancel.')}${th('Ventas')}${th('Cartera')}${th('Caduc.')}</tr>
    ${filas.map(f => fila(f.nombre, f.r, false)).join('')}${fila('TOTAL', total, true)}</table>
    ${total.periodo.historico ? '' : `<div style="margin:6px 4px 0;font-size:12px;color:${C.ambar};">Transformados y cancelados: aún sin histórico suficiente.</div>`}`;

  const analisis = filas.map(f => {
    const l = lecturaComercial(f.r);
    return `<div style="margin:12px 4px 0;font-size:13px;">
      <div style="font-weight:600;">${esc(f.nombre)}</div>
      <ul style="margin:4px 0 0;padding-left:18px;color:${C.tinta};">${l.lineas.map(x => `<li style="margin:2px 0;">${x}</li>`).join('')}
      <li style="margin:2px 0;">Ventas: <strong>${eur(f.r.ventas)}</strong> (${pct(f.r.ventas, v.total)} % del total, ${f.r.ventasN} proyecto${f.r.ventasN === 1 ? '' : 's'}).</li></ul>
      ${l.alertas.length ? `<div style="margin-top:4px;color:${C.rojo};font-size:12px;">⚠ ${l.alertas.join(' · ')}</div>` : ''}</div>`;
  }).join('');

  const bajas = listaProyectos('⚠ Proyectos ya confirmados que se cancelaron esta semana', total.periodo.bajas, C.rojo, 15);
  const cuerpo = `${objetivoHtml}${H2('Resumen por comercial')}${tabla}${H2('Análisis por comercial')}${analisis}${bajas}`;
  return {
    asunto: `ORUM · Informe semanal de dirección ${fechaCorta(d.semDesde)}–${fechaCorta(d.semHasta)} · ${llegado ? 'objetivo alcanzado' : 'objetivo no alcanzado'}`,
    html: envolver('Informe semanal · Dirección', '', `${fechaCorta(d.semDesde)} – ${fechaCorta(d.semHasta)}`, cuerpo,
      'Importes sin IVA. «Ventas» = proyectos confirmados con fecha de entrega en la semana (mismo criterio y objetivo que el Informe Mensual). «Cartera» = presupuestos vigentes pendientes de decisión; «Caduc.» = caducados sin cerrar.')
  };
}

// ── Envío ──

// Dos vías de envío, según variables de entorno:
//   1) SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS): desde una cuenta de correo
//      normal de ORUM (Gmail/Google Workspace, Microsoft 365, hosting...). No requiere DNS.
//   2) Resend (RESEND_API_KEY + INFORME_FROM): requiere verificar el dominio en DNS.
// Si hay SMTP_HOST se usa SMTP; si no, Resend; si tampoco, no se envía nada.
let transporteSmtp = null;
function obtenerTransporteSmtp() {
  if (transporteSmtp) return transporteSmtp;
  const nodemailer = require('nodemailer');
  const port = Number(process.env.SMTP_PORT || 465);
  transporteSmtp = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return transporteSmtp;
}

async function enviarCorreo(para, asunto, html) {
  const destinos = Array.isArray(para) ? para : [para];
  if (process.env.SMTP_HOST) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return { ok: false, motivo: 'SMTP_USER / SMTP_PASS sin configurar' };
    try {
      await obtenerTransporteSmtp().sendMail({
        from: process.env.INFORME_FROM || `ORUM Central <${process.env.SMTP_USER}>`, to: destinos, subject: asunto, html
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, motivo: 'SMTP: ' + err.message };
    }
  }
  const key = process.env.RESEND_API_KEY;
  const from = process.env.INFORME_FROM;
  if (!key || !from) return { ok: false, motivo: 'Sin configurar: define SMTP_HOST/SMTP_USER/SMTP_PASS o RESEND_API_KEY/INFORME_FROM' };
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: destinos, subject: asunto, html })
    });
    if (!resp.ok) return { ok: false, motivo: `Resend ${resp.status}: ${(await resp.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
}

async function leerDestinatarios() {
  const { data, error } = await supabase.from('informe_destinatarios').select('tipo,comercial,email,activo').eq('activo', true);
  if (error) throw error;
  return data || [];
}

// tipo: 'diario' (a cada comercial) | 'semanal' (a cada comercial + Dirección).
// Con "soloA" manda copias de prueba a esa dirección en vez de a los destinatarios reales.
async function generarYEnviar(d, tipo, { soloA } = {}) {
  const destinatarios = await leerDestinatarios();
  const resultados = [];
  const enviar = async (etiqueta, informe, para) => {
    if (!para.length) { resultados.push({ informe: `${tipo}:${etiqueta}`, ok: false, motivo: 'sin destinatarios' }); return; }
    const r = await enviarCorreo(soloA ? [soloA] : para, (soloA ? '[PRUEBA] ' : '') + informe.asunto, informe.html);
    resultados.push({ informe: `${tipo}:${etiqueta}`, para: soloA ? [soloA] : para, ...r });
  };
  const porComercial = new Map();
  destinatarios.filter(x => x.tipo === 'comercial').forEach(x => {
    const k = norm(x.comercial);
    porComercial.set(k, { nombre: x.comercial, emails: [...((porComercial.get(k) || { emails: [] }).emails), x.email] });
  });
  for (const [, c] of porComercial) {
    await enviar(c.nombre, tipo === 'diario' ? construirDiarioComercial(d, c.nombre) : construirSemanalComercial(d, c.nombre), c.emails);
  }
  if (tipo === 'semanal') {
    await enviar('DIRECCION', construirSemanalDireccion(d), destinatarios.filter(x => x.tipo === 'direccion').map(x => x.email));
  }
  return resultados;
}

// ── Ejecución programada ──

async function ejecutarInformeDiario({ forzar = false } = {}) {
  const hoy = hoyMadrid();
  // Cerrojo: una fila por día. Si ya existe, otro proceso (o un reinicio) ya lo hizo.
  if (!forzar) {
    const { error } = await supabase.from('informe_envios').insert({ fecha: hoy });
    if (error) {
      if (error.code === '23505') { console.log('[Informe] Ya ejecutado hoy, se omite.'); return { omitido: true }; }
      throw error;
    }
  }
  try {
    const d = await cargarDatos(hoy);
    // La foto de las 8:00 = estado al cierre de ayer (de noche no se toca nada).
    await guardarSnapshot(sumarDias(hoy, -1), d.presupuestos);
    const dow = diaSemana(hoy);
    const resultados = [];
    if (dow >= 1 && dow <= 5) resultados.push(...await generarYEnviar(d, 'diario'));
    if (dow === 1) resultados.push(...await generarYEnviar(d, 'semanal'));
    console.log(`[Informe] ${hoy}: ${resultados.filter(r => r.ok).length}/${resultados.length} correos enviados.`, resultados.filter(r => !r.ok));
    await supabase.from('informe_envios').upsert({ fecha: hoy, resultado: resultados });
    return { resultados };
  } catch (err) {
    console.error('[Informe] Error generando los informes:', err);
    if (!forzar) await supabase.from('informe_envios').delete().eq('fecha', hoy); // permite reintentar
    throw err;
  }
}

function programarInformeDiario() {
  const hora = Number(process.env.INFORME_HORA || 8);
  const delay = msHastaHoraMadrid(hora);
  setTimeout(async () => {
    try { await ejecutarInformeDiario(); }
    catch (err) { /* ya registrado dentro */ }
    finally { programarInformeDiario(); }
  }, delay);
  console.log(`[Informe] Próxima ejecución en ${Math.round(delay / 60000)} min (${hora}:00 Madrid).`);

  // Si el servidor se reinició justo a esa hora, recupera el envío del día
  // (solo hasta las 11:00, para no mandar correos a deshoras tras un redeploy).
  const h = horaMadridActual();
  if (h >= hora && h < 11) setTimeout(() => ejecutarInformeDiario().catch(() => {}), 60 * 1000);
}

// ── Rutas (solo Dirección) ──

function registrarRutas(app, requiereLogin) {
  const soloDireccion = (req, res, next) => {
    if (req.session.usuario.rol !== 'Direccion') return res.status(403).json({ error: 'No autorizado' });
    next();
  };
  const construir = (d, tipo, comercial) => {
    if (tipo === 'semanal') return comercial ? construirSemanalComercial(d, comercial) : construirSemanalDireccion(d);
    if (!comercial) throw new Error('El informe diario es por comercial: añade ?comercial=Nombre');
    return construirDiarioComercial(d, comercial);
  };

  // Vista previa en el navegador:
  //   /api/informe-comerciales/preview?tipo=diario&comercial=Danilo%20Castellano
  //   /api/informe-comerciales/preview?tipo=semanal&comercial=Danilo%20Castellano
  //   /api/informe-comerciales/preview?tipo=semanal            (Dirección)
  app.get('/api/informe-comerciales/preview', requiereLogin, soloDireccion, async (req, res) => {
    try {
      const tipo = req.query.tipo === 'semanal' ? 'semanal' : 'diario';
      const d = await cargarDatos(hoyMadrid());
      res.type('html').send(construir(d, tipo, req.query.comercial).html);
    } catch (err) {
      console.error('Error en preview del informe:', err);
      res.status(400).json({ error: err.message });
    }
  });

  // Prueba de envío: POST { "para": "tu@correo.com", "tipo": "diario" | "semanal" }
  // manda copias SOLO a esa dirección (nunca a los comerciales).
  app.post('/api/informe-comerciales/prueba', requiereLogin, soloDireccion, async (req, res) => {
    try {
      const para = String((req.body && req.body.para) || '').trim();
      const tipo = req.body && req.body.tipo === 'semanal' ? 'semanal' : 'diario';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) return res.status(400).json({ error: 'Falta "para" con un email válido' });
      const d = await cargarDatos(hoyMadrid());
      res.json({ resultados: await generarYEnviar(d, tipo, { soloA: para }) });
    } catch (err) {
      console.error('Error en prueba del informe:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = {
  registrarRutas, programarInformeDiario, ejecutarInformeDiario,
  // exportado para pruebas
  _test: { enviarCorreo, construirDiarioComercial, construirSemanalComercial, construirSemanalDireccion, calcularPeriodo, calcularVentas, semanaIso, lunesDe, categoria, isoDeRaw, hoyMadrid }
};
