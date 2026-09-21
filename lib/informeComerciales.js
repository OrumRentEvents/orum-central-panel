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
// Separador de miles siempre (toLocaleString('es-ES') lo omite en números de 4 cifras: "3400 €")
function eur(n) {
  const r = Math.round(Number(n) || 0);
  return (r < 0 ? '-' : '') + String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';
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
    ventasEnCurso: calcularVentas(proyectos, curDesde, sumarDias(curDesde, 6)),
    // Últimas 6 semanas completas (de la más antigua a la más reciente) para la gráfica de evolución
    historico: [5, 4, 3, 2, 1, 0].map(k => {
      const desde = sumarDias(semDesde, -7 * k);
      return calcularVentas(proyectos, desde, sumarDias(desde, 6));
    })
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
// Todo con tablas y estilos en línea (lo único que respetan Gmail y Outlook).
// Las "gráficas" son barras de tabla con anchos en %, sin JavaScript ni SVG.

const C = {
  tinta: '#1a1a18', gris: '#6b6b66', linea: '#e8e6df', fondo: '#efeee9', tarjeta: '#faf9f6', pista: '#e6e3da',
  dorado: '#b8893a', doradoClaro: '#f6eddc', rojo: '#a32d2d', rojoClaro: '#f8e6e4',
  verde: '#4c8c1f', verdeClaro: '#e8f1de', ambar: '#c77d0b', ambarClaro: '#fcefd6', azul: '#2f6f8f'
};
const PALETA = ['#b8893a', '#2f6f8f', '#4c8c1f', '#8a6bb0', '#a32d2d', '#5a5a55'];

function celdaBarra(pctAncho, color, alto) {
  return `<td width="${pctAncho.toFixed(1)}%" bgcolor="${color}" height="${alto}" style="background:${color};font-size:0;line-height:0;height:${alto}px;">&nbsp;</td>`;
}
// segmentos: [{pct, color}] con pct sobre 100. El resto se pinta como pista.
function barra(segmentos, alto, pista) {
  let resto = 100;
  const celdas = [];
  segmentos.forEach(s => {
    const p = Math.max(0, Math.min(resto, s.pct));
    if (p > 0.4) { celdas.push(celdaBarra(p, s.color, alto)); resto -= p; }
  });
  if (resto > 0.4) celdas.push(celdaBarra(resto, pista || C.pista, alto));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;border-radius:${Math.round(alto / 2)}px;overflow:hidden;"><tr>${celdas.join('')}</tr></table>`;
}
function pill(texto, color, fondo) {
  return `<span style="display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:700;color:${color};background:${fondo};white-space:nowrap;">${texto}</span>`;
}
function leyenda(items) {
  return `<div style="font-size:12px;color:${C.gris};margin-top:8px;line-height:1.9;">${items.map(i =>
    `<span style="white-space:nowrap;margin-right:14px;"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${i.color};margin-right:5px;"></span>${i.texto}</span>`).join('')}</div>`;
}
const H2 = (t, sub) => `<div style="margin:30px 0 12px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
  <td width="4" bgcolor="${C.dorado}" style="width:4px;background:${C.dorado};font-size:0;">&nbsp;</td>
  <td style="padding-left:10px;"><div style="font-size:16px;font-weight:700;color:${C.tinta};">${t}</div>${sub ? `<div style="font-size:12px;color:${C.gris};margin-top:2px;line-height:1.4;">${sub}</div>` : ''}</td></tr></table></div>`;

function kpi(etiqueta, valor, nota, color) {
  return `<td style="width:33%;padding:0 4px;vertical-align:top;">
    <div style="background:${C.tarjeta};border:1px solid ${C.linea};border-top:4px solid ${color};border-radius:8px;padding:12px 14px;">
      <div style="font-size:11px;color:${C.gris};text-transform:uppercase;letter-spacing:.06em;font-weight:700;">${etiqueta}</div>
      <div style="font-size:30px;font-weight:700;color:${C.tinta};line-height:1.15;margin-top:2px;">${valor}</div>
      <div style="font-size:12px;color:${C.gris};margin-top:1px;">${nota}</div>
    </div></td>`;
}
const kpiFila = (...celdas) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;margin:0 -4px;width:calc(100% + 8px);"><tr>${celdas.join('')}</tr></table>`;

// preheader = texto oculto que la bandeja de entrada muestra como "avance" junto al asunto.
function envolver(titulo, saludo, fechaTxt, cuerpo, pie, preheader) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title></head>
  <body style="margin:0;padding:0;background:${C.fondo};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${esc(preheader || '')}${'&nbsp;&zwnj;'.repeat(40)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.fondo}"><tr><td align="center" style="padding:22px 10px;">
    <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;font-family:Arial,Helvetica,sans-serif;color:${C.tinta};background:#ffffff;border:1px solid ${C.linea};border-radius:10px;overflow:hidden;">
      <tr><td bgcolor="${C.tinta}" style="background:${C.tinta};padding:24px 28px 22px;border-bottom:4px solid ${C.dorado};">
        <div style="font-size:11px;letter-spacing:.26em;color:${C.dorado};font-weight:700;">ORUM CENTRAL</div>
        <div style="font-size:24px;color:#ffffff;font-weight:700;margin-top:8px;line-height:1.2;">${titulo}</div>
        <div style="font-size:13px;color:#b9b7ae;margin-top:4px;">${saludo ? saludo + ' · ' : ''}${fechaTxt}</div></td></tr>
      <tr><td style="padding:2px 28px 28px;">${cuerpo}</td></tr>
      <tr><td bgcolor="${C.fondo}" style="background:${C.fondo};padding:16px 28px;font-size:11px;color:${C.gris};line-height:1.55;">${pie}</td></tr>
    </table></td></tr></table></body></html>`;
}

// Tabla de proyectos con filas alternas. filas = array de {izq, centro, der} ya en HTML.
function tablaFilas(filas) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:${C.tinta};border:1px solid ${C.linea};border-radius:8px;overflow:hidden;">${
    filas.map((f, i) => `<tr style="background:${i % 2 ? C.tarjeta : '#ffffff'};">
      <td style="padding:9px 10px;vertical-align:top;width:58px;">${f.izq}</td>
      <td style="padding:9px 6px;vertical-align:top;">${f.centro}</td>
      <td style="padding:9px 12px 9px 6px;vertical-align:top;text-align:right;white-space:nowrap;">${f.der}</td></tr>`).join('')}</table>`;
}
const masFilas = (total, max) => total > max ? `<div style="font-size:12px;color:${C.gris};margin:6px 2px 0;">+ ${total - max} más — consúltalos en ORUM Central</div>` : '';
const vacio = t => `<div style="background:${C.verdeClaro};color:${C.verde};border-radius:8px;padding:12px 14px;font-size:13px;font-weight:700;">✔ ${t}</div>`;

// Lista sencilla (número · cliente · importe) para transformados / cancelados / bajas
function listaProyectos(titulo, lista, color, fondo, max) {
  if (!lista.length) return '';
  const filas = lista.slice(0, max).map(p => ({
    izq: `<span style="color:${C.gris};">${esc(p.numero_proyecto)}</span>`,
    centro: esc(limpiarNombre(p.cliente)) || '—',
    der: `<strong>${eur(p.importe_sin_iva)}</strong>`
  }));
  return `<div style="margin-top:14px;"><div style="margin-bottom:6px;">${pill(titulo, color, fondo)}</div>${tablaFilas(filas)}${masFilas(lista.length, max)}</div>`;
}

function bloqueCartera(c) {
  const filas = c.porVencer.slice(0, 8).map(p => ({
    izq: `<span style="color:${C.gris};">${esc(p.numero_proyecto)}</span>`,
    centro: esc(limpiarNombre(p.cliente)) || '—',
    der: `${pill(p.dias === 0 ? 'caduca hoy' : 'caduca en ' + p.dias + ' d', p.dias <= 3 ? C.rojo : C.ambar, p.dias <= 3 ? C.rojoClaro : C.ambarClaro)} <strong style="margin-left:6px;">${eur(p.importe_sin_iva)}</strong>`
  }));
  return `${H2('Cartera pendiente de decisión', 'Presupuestos enviados que aún no se han aceptado ni cancelado')}
    ${kpiFila(
      kpi('Vigentes', c.vigentes.length, eur(suma(c.vigentes)), C.dorado),
      kpi('Caducan en 7 d', c.porVencer.length, c.porVencer.length ? 'seguimiento' : 'ninguno', C.ambar),
      kpi('Caducados', c.caducados.length, eur(suma(c.caducados)), C.gris))}
    ${c.caducados.length ? `<div style="font-size:12px;color:${C.gris};margin:8px 2px 0;">Los caducados siguen sin decisión en Rentman: conviene cerrarlos o cancelarlos para no arrastrarlos.</div>` : ''}
    ${filas.length ? `<div style="margin-top:14px;"><div style="margin-bottom:6px;">${pill('⏰ Caducan en 7 días o menos', C.ambar, C.ambarClaro)}</div>${tablaFilas(filas)}${masFilas(c.porVencer.length, 8)}</div>` : ''}`;
}

// ── Saludo personalizado + frase motivadora ──
// Frases propias (no son citas de nadie). Cada día y cada persona recibe una distinta:
// índice = día del año + una semilla derivada del nombre. Para añadir o cambiar frases
// basta con editar estas listas.
const FRASES_DIARIAS = [
  'Cada llamada de seguimiento es una venta que todavía no ha ocurrido.',
  'Un presupuesto sin respuesta no es un no: es un todavía no.',
  'La constancia vende más que la suerte.',
  'Hoy es un buen día para cerrar lo que ayer dejaste abierto.',
  'Los clientes no compran material: compran tranquilidad. Dásela.',
  'Lo que se sigue, se cierra.',
  'El que llama primero, casi siempre gana.',
  'Un cliente bien atendido hoy es tu mejor comercial mañana.',
  'No esperes a que el cliente decida: ayúdale a decidir.',
  'Pequeños avances cada día suman grandes meses.',
  'La diferencia entre un presupuesto y un proyecto es una buena conversación.',
  'En un evento, los detalles son el servicio.',
  'Trabajar en equipo es sumar objetivos, no repartir esfuerzos.',
  'Hoy, una llamada más de las que te apetece hacer.',
  'Prepara hoy el evento que mañana querrás presumir.',
  'El mejor momento para reclamar un presupuesto es cuando aún se acuerdan de ti.',
  'Ordenar la cartera también es vender.',
  'Detrás de cada «sí» hay alguien que se atrevió a hacer seguimiento.',
  'Empieza por lo más incómodo: el resto del día será más ligero.',
  'Un buen día no se espera: se empieza con la primera llamada.',
  'La confianza del cliente se gana cumpliendo lo pequeño.',
  'Lo urgente llama a la puerta; lo importante hay que ir a buscarlo. Hoy, busca uno.',
  'Cobrar a tiempo también es cuidar al cliente y al equipo.',
  'Cada evento bien hecho es la mejor presentación para el siguiente.',
  'Ser constante cuando nadie mira es lo que se nota en los resultados.'
];
const FRASES_SEMANA_LOGRADA = [
  'Objetivo cumplido: esto se consigue en equipo. Gracias por el esfuerzo.',
  'Una semana así se construye llamada a llamada. Enhorabuena a todos.',
  'Cuando el equipo rema en la misma dirección, los objetivos llegan.',
  'Celebrarlo un momento y a por la siguiente: ese es el ritmo.'
];
const FRASES_SEMANA_ANIMO = [
  'Una semana no define el año: lo que suma es la constancia de las siguientes.',
  'Los objetivos se alcanzan semana a semana; esta empieza en blanco.',
  'Lo que no salió la semana pasada es la mejor pista de dónde está la oportunidad.',
  'Los grandes meses se hacen de semanas normales bien aprovechadas.'
];
function semillaNombre(nombre) {
  let h = 0;
  norm(nombre).split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) % 100003; });
  return h;
}
function elegirFrase(lista, iso, nombre) {
  const diaDelAnio = difDias(iso, iso.slice(0, 4) + '-01-01');
  return lista[(diaDelAnio + semillaNombre(nombre)) % lista.length];
}
function unirLista(partes) {
  if (partes.length <= 1) return partes.join('');
  return partes.slice(0, -1).join(', ') + ' y ' + partes[partes.length - 1];
}
function introHtml(parrafos, frase, etiqueta) {
  return `<div style="margin:22px 0 4px;font-size:15px;line-height:1.6;color:${C.tinta};">${parrafos.filter(Boolean).map(p => `<p style="margin:0 0 8px;">${p}</p>`).join('')}</div>
    <div style="margin:14px 0 4px;background:${C.doradoClaro};border-left:4px solid ${C.dorado};border-radius:0 8px 8px 0;padding:12px 16px;">
      <div style="font-size:10px;letter-spacing:.16em;color:${C.dorado};font-weight:700;">${etiqueta}</div>
      <div style="font-size:14px;font-style:italic;color:${C.tinta};margin-top:4px;line-height:1.5;">“${esc(frase)}”</div></div>`;
}
const cuandoTxt = dias => (dias === 0 ? 'hoy' : (dias === 1 ? 'mañana' : `en ${dias} días`));

function introDiario(primer, aceptar, pago, seg) {
  const p = [`Buenos días, <strong>${esc(primer)}</strong>.`];
  if (!aceptar.length && !pago.length && !seg.length) {
    p.push('Hoy no tienes nada pendiente de aceptar, cobrar ni cerrar. Buen día para adelantar trabajo y prospectar.');
    return p;
  }
  const partes = [];
  if (aceptar.length) partes.push(`<strong>${aceptar.length}</strong> por aceptar`);
  if (pago.length) partes.push(`<strong>${pago.length}</strong> por cobrar`);
  if (seg.length) partes.push(`<strong>${seg.length}</strong> presupuesto${seg.length === 1 ? '' : 's'} esperando respuesta`);
  p.push(`Hoy tienes ${unirLista(partes)}.`);
  const urgentes = [...aceptar, ...pago].sort((a, b) => a.dias - b.dias);
  if (urgentes.length) {
    const u = urgentes[0];
    p.push(`Lo más urgente: el proyecto <strong>${esc(u.numero)}</strong>${u.cliente ? ' (' + esc(u.cliente) + ')' : ''}, con evento ${cuandoTxt(u.dias)}.`);
  }
  if (pago.some(x => x.vencida)) p.push('Ojo: hay facturas ya vencidas entre los cobros pendientes.');
  return p;
}

function introSemanalComercial(d, primer, r) {
  const v = d.ventasSemana;
  const llegado = v.objetivo > 0 && v.total >= v.objetivo;
  const p = [`Buenos días, <strong>${esc(primer)}</strong>.`];
  p.push(`La semana pasada (${fechaCorta(d.semDesde)} – ${fechaCorta(d.semHasta)}) el equipo vendió <strong>${eur(v.total)}</strong>${v.objetivo > 0 ? ` frente a un objetivo de ${eur(v.objetivo)} (${pct(v.total, v.objetivo)} %)` : ''}. Tu aportación fue de <strong>${eur(r.ventas)}</strong>, el ${pct(r.ventas, v.total)} % del total.`);
  if (v.objetivo > 0) p.push(llegado ? '¡Objetivo cumplido! Gracias por tu parte.' : `Nos faltaron ${eur(v.objetivo - v.total)} para llegar; esta semana vamos a por ellos.`);
  if (r.periodo.historico) p.push(`En tus presupuestos: enviaste ${r.periodo.enviados.length} y ${r.periodo.transformados.length === 0 ? 'no se cerró ninguno' : 'se cerraron ' + r.periodo.transformados.length}.`);
  return { parrafos: p, llegado };
}

function introSemanalDireccion(d, filas) {
  const v = d.ventasSemana;
  const llegado = v.objetivo > 0 && v.total >= v.objetivo;
  const p = ['Buenos días.'];
  p.push(`Resumen de la semana ${fechaCorta(d.semDesde)} – ${fechaCorta(d.semHasta)}: <strong>${llegado ? 'objetivo alcanzado' : 'objetivo no alcanzado'}</strong>. Se vendieron ${eur(v.total)} de un objetivo de ${eur(v.objetivo)} (${pct(v.total, v.objetivo)} %).`);
  const top = filas.filter(f => f.r.ventas > 0)[0];
  if (top) p.push(`Mayor aportación: <strong>${esc(top.nombre)}</strong> con ${eur(top.r.ventas)} (${pct(top.r.ventas, v.total)} % del total).`);
  return { parrafos: p, llegado };
}

// ── INFORME DIARIO (por comercial) ──

function chipFecha(x) {
  const cuando = x.dias === 0 ? 'hoy' : (x.dias === 1 ? 'mañana' : `en ${x.dias} d`);
  const urgente = x.dias <= 2, medio = x.dias <= 5;
  const bg = urgente ? C.rojoClaro : (medio ? C.ambarClaro : C.fondo);
  const fg = urgente ? C.rojo : (medio ? C.ambar : C.gris);
  return `<div style="background:${bg};color:${fg};border-radius:7px;padding:5px 4px;text-align:center;font-size:13px;font-weight:700;line-height:1.2;">${fechaCorta(x.fecha)}<div style="font-size:10px;font-weight:700;">${cuando}</div></div>`;
}
const clienteDe = x => `<span style="color:${C.gris};">${esc(x.numero)}</span> <strong>${esc(x.cliente) || '—'}</strong>`;

function seccionAceptar(lista, max) {
  const titulo = H2(`Pendientes de aceptar <span style="color:${C.gris};font-weight:400;">(${lista.length})</span>`,
    `Proyectos con evento en los próximos ${VENTANA_ACEPTAR_DIAS} días cuyo presupuesto sigue sin aceptar`);
  if (!lista.length) return titulo + vacio(`Ningún proyecto de los próximos ${VENTANA_ACEPTAR_DIAS} días está pendiente de aceptar.`);
  const filas = lista.slice(0, max).map(x => ({
    izq: chipFecha(x),
    centro: `${clienteDe(x)}${x.emitidoHace !== null ? `<div style="font-size:12px;color:${C.gris};margin-top:2px;">Presupuesto emitido hace ${x.emitidoHace} d</div>` : ''}`,
    der: `${x.caducado ? pill('Caducado', C.rojo, C.rojoClaro) : pill('Sin aceptar', C.ambar, C.ambarClaro)}<div style="margin-top:4px;font-weight:700;">${eur(x.importe)}</div>`
  }));
  return titulo + tablaFilas(filas) + masFilas(lista.length, max);
}

function seccionPago(lista, max) {
  const titulo = H2(`Pendientes de pago <span style="color:${C.gris};font-weight:400;">(${lista.length})</span>`,
    `Proyectos con evento en los próximos ${VENTANA_PAGO_DIAS} días · importe con IVA aún sin facturar o sin cobrar (sin fianzas)`);
  if (!lista.length) return titulo + vacio(`Ningún proyecto de los próximos ${VENTANA_PAGO_DIAS} días tiene pagos pendientes.`);
  const totSin = lista.reduce((s, x) => s + x.sinFacturar, 0), totFac = lista.reduce((s, x) => s + x.facturadoPdte, 0);
  const tot = totSin + totFac;
  const resumen = `<div style="background:${C.tarjeta};border:1px solid ${C.linea};border-radius:8px;padding:12px 14px;margin-bottom:10px;">
    <div style="font-size:13px;">Total pendiente: <strong style="font-size:18px;">${eur(tot)}</strong></div>
    <div style="margin-top:8px;">${barra([{ pct: 100 * totSin / tot, color: C.ambar }, { pct: 100 * totFac / tot, color: C.rojo }], 12)}</div>
    ${leyenda([{ color: C.ambar, texto: `Sin facturar ${eur(totSin)}` }, { color: C.rojo, texto: `Facturado sin cobrar ${eur(totFac)}` }])}</div>`;
  const filas = lista.slice(0, max).map(x => ({
    izq: chipFecha(x),
    centro: `${clienteDe(x)}<div style="font-size:12px;color:${C.gris};margin-top:2px;">${[x.sinFacturar ? `${eur(x.sinFacturar)} sin facturar` : '', x.facturadoPdte ? `${eur(x.facturadoPdte)} facturado${x.vencida ? ' <span style="color:' + C.rojo + ';font-weight:700;">(vencido)</span>' : ' sin cobrar'}` : ''].filter(Boolean).join(' · ')}</div>`,
    der: `<span style="font-size:15px;font-weight:700;color:${x.vencida ? C.rojo : C.tinta};">${eur(x.pendiente)}</span>`
  }));
  return titulo + resumen + tablaFilas(filas) + masFilas(lista.length, max);
}

function seccionSeguimiento(lista, resto, max) {
  const titulo = H2(`Presupuestos a cerrar <span style="color:${C.gris};font-weight:400;">(${lista.length})</span>`,
    `Enviados hace ${DIAS_MIN_SEGUIMIENTO} días o más y sin decisión, con evento posterior a los próximos ${VENTANA_ACEPTAR_DIAS} días (los anteriores ya salen arriba). Toca llamar al cliente`);
  const nota = resto ? `<div style="font-size:12px;color:${C.gris};margin:8px 2px 0;">Además tienes ${resto.n} presupuestos caducados sin cerrar (${eur(resto.imp)}): ciérralos o cancélalos en Rentman.</div>` : '';
  if (!lista.length) return titulo + vacio('No hay presupuestos vigentes pendientes de cerrar.') + nota;
  const filas = lista.slice(0, max).map(x => {
    const edad = x.emitidoHace >= 7 ? [C.rojo, C.rojoClaro] : (x.emitidoHace >= 4 ? [C.ambar, C.ambarClaro] : [C.gris, C.fondo]);
    const urg = x.caduca !== null && x.caduca <= 3;
    return {
      izq: `<div style="background:${edad[1]};color:${edad[0]};border-radius:7px;padding:5px 4px;text-align:center;font-size:12px;font-weight:700;line-height:1.2;">hace<br>${x.emitidoHace} d</div>`,
      centro: `${clienteDe(x)}<div style="font-size:12px;color:${C.gris};margin-top:2px;">${x.evento ? 'Evento el ' + fechaCorta(x.evento) : 'Sin fecha de evento'}</div>`,
      der: `<strong>${eur(x.importe)}</strong>${x.caduca !== null ? `<div style="margin-top:4px;">${pill(x.caduca === 0 ? 'caduca hoy' : 'caduca en ' + x.caduca + ' d', urg ? C.rojo : C.gris, urg ? C.rojoClaro : C.fondo)}</div>` : ''}`
    };
  });
  return titulo + tablaFilas(filas) + masFilas(lista.length, max) + nota;
}

function construirDiarioComercial(d, nombre) {
  const k = norm(nombre);
  const aceptar = d.porAceptar.filter(x => x.comKey === k);
  const pago = d.porCobrar.filter(x => x.comKey === k);
  const seg = d.seguimiento.filter(x => x.comKey === k);
  const cad = d.caducadosSinCerrar.filter(x => x.comKey === k);
  const primer = limpiarNombre(nombre).split(' ')[0];
  const cuerpo = introHtml(introDiario(primer, aceptar, pago, seg), elegirFrase(FRASES_DIARIAS, d.hoy, nombre), 'LA FRASE DEL DÍA') + `<div style="margin-top:20px;">${kpiFila(
      kpi('Por aceptar', aceptar.length, `próximos ${VENTANA_ACEPTAR_DIAS} días`, C.ambar),
      kpi('Por cobrar', pago.length, `${eur(pago.reduce((s, x) => s + x.pendiente, 0))} · ${VENTANA_PAGO_DIAS} días`, C.rojo),
      kpi('A cerrar', seg.length, 'presupuestos enviados', C.dorado))}</div>
    ${seccionAceptar(aceptar, 30)}${seccionPago(pago, 30)}
    ${seccionSeguimiento(seg, cad.length ? { n: cad.length, imp: cad.reduce((s, x) => s + (Number(x.importe) || 0), 0) } : null, 30)}`;
  return {
    asunto: `ORUM · ${primer}, tus pendientes de hoy · ${fechaCorta(d.hoy)}`,
    html: envolver('Pendientes del día', `Hola ${esc(primer)}`, fechaLarga(d.hoy), cuerpo,
      'Datos de ORUM Central a las 8:00. Importes de presupuestos sin IVA; los de «Pendientes de pago» con IVA (21 %) y sin fianzas.',
      `${primer}: ${aceptar.length} por aceptar · ${pago.length} por cobrar (${eur(pago.reduce((s, x) => s + x.pendiente, 0))}) · ${seg.length} presupuestos a cerrar`)
  };
}

// ── INFORME SEMANAL ──

// Tarjeta del objetivo. segmentos = [{nombre, total, color}] que componen lo vendido.
function tarjetaObjetivo(v, segmentos, etiquetaEquipo) {
  const llegado = v.objetivo > 0 && v.total >= v.objetivo;
  const ratio = v.objetivo > 0 ? v.total / v.objetivo : 0;
  const color = llegado ? C.verde : (ratio >= 0.8 ? C.ambar : C.rojo);
  const fondo = llegado ? C.verdeClaro : (ratio >= 0.8 ? C.ambarClaro : C.rojoClaro);
  const dif = v.total - v.objetivo;
  const barraObj = v.objetivo > 0 ? barra(segmentos.map(s => ({ pct: 100 * s.total / v.objetivo, color: s.color })), 18, '#ffffff') : '';
  const titulo = v.objetivo <= 0 ? 'Sin objetivo definido para esta semana'
    : (llegado ? `✔ ${etiquetaEquipo ? 'Objetivo del equipo alcanzado' : 'Objetivo alcanzado'}` : `✖ ${etiquetaEquipo ? 'Objetivo del equipo no alcanzado' : 'Objetivo no alcanzado'}`);
  const num = (etq, val, c) => `<td style="padding:0 6px 0 0;vertical-align:top;"><div style="font-size:11px;color:${C.gris};text-transform:uppercase;letter-spacing:.06em;font-weight:700;">${etq}</div><div style="font-size:26px;font-weight:700;color:${c || C.tinta};line-height:1.2;">${val}</div></td>`;
  return `<div style="background:${fondo};border-radius:10px;padding:18px 20px;">
    <div style="font-size:12px;color:${C.gris};font-weight:700;">SEMANA ${v.semanaIso} · ${fechaCorta(v.desde)} – ${fechaCorta(v.hasta)}</div>
    <div style="font-size:20px;font-weight:700;color:${color};margin:4px 0 12px;">${titulo}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${num(etiquetaEquipo ? 'Vendido entre todos' : 'Vendido', eur(v.total))}${num('Objetivo', eur(v.objetivo))}${num('Cumplimiento', v.objetivo > 0 ? pct(v.total, v.objetivo) + ' %' : '—', color)}
    </tr></table>
    ${v.objetivo > 0 ? `<div style="margin-top:14px;">${barraObj}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:5px;font-size:11px;color:${C.gris};"><tr><td>0 €</td><td align="right">Objetivo ${eur(v.objetivo)}</td></tr></table></div>
      <div style="font-size:13px;margin-top:8px;color:${C.tinta};">${llegado ? `Se superó el objetivo en <strong>${eur(dif)}</strong>.` : `Faltaron <strong>${eur(-dif)}</strong> para llegar al objetivo.`}</div>` : ''}
  </div>`;
}

function bloqueEmbudo(p) {
  const max = Math.max(1, p.enviados.length, p.transformados.length, p.cancelados.length);
  const fila = (etq, n, imp, color) => `<tr>
    <td style="width:104px;padding:5px 8px 5px 0;font-size:13px;color:${C.tinta};font-weight:700;">${etq}</td>
    <td style="padding:5px 0;">${barra([{ pct: 100 * n / max, color }], 16)}</td>
    <td style="width:112px;padding:5px 0 5px 10px;font-size:13px;text-align:right;white-space:nowrap;"><strong>${n}</strong> <span style="color:${C.gris};">· ${eur(imp)}</span></td></tr>`;
  const dec = p.transformados.length + p.cancelados.length;
  const tasa = p.historico && dec > 0 ? `<div style="margin-bottom:10px;">${pill(`Tasa de cierre ${pct(p.transformados.length, dec)} %`, C.verde, C.verdeClaro)}</div>` : '';
  const sinHist = p.historico ? '' : `<div style="font-size:12px;color:${C.ambar};margin-top:8px;">Transformados y cancelados: aún sin histórico suficiente. Los enviados sí son exactos.</div>`;
  return `${tasa}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${fila('Enviados', p.enviados.length, suma(p.enviados), C.dorado)}
    ${p.historico ? fila('Transformados', p.transformados.length, suma(p.transformados), C.verde) : ''}
    ${p.historico ? fila('Cancelados', p.cancelados.length, suma(p.cancelados), C.rojo) : ''}</table>${sinHist}`;
}

function construirSemanalComercial(d, nombre) {
  const r = resumenComercial(d, norm(nombre));
  const v = d.ventasSemana;
  const primer = limpiarNombre(nombre).split(' ')[0];
  const resto = Math.max(0, v.total - r.ventas);
  const objetivoHtml = H2('Objetivo del equipo', 'El objetivo es de todo el equipo, no individual') +
    tarjetaObjetivo(v, [{ nombre: 'Tu aportación', total: r.ventas, color: C.dorado }, { nombre: 'Resto del equipo', total: resto, color: C.tinta }], true) +
    leyenda([{ color: C.dorado, texto: `Tu aportación: ${eur(r.ventas)} (${pct(r.ventas, v.total)} % del total · ${r.ventasN || 0} proyecto${r.ventasN === 1 ? '' : 's'})` },
      { color: C.tinta, texto: `Resto del equipo: ${eur(resto)}` }]);
  const intro = introSemanalComercial(d, primer, r);
  const cuerpo = introHtml(intro.parrafos, elegirFrase(intro.llegado ? FRASES_SEMANA_LOGRADA : FRASES_SEMANA_ANIMO, d.hoy, nombre), 'PARA ESTA SEMANA') + objetivoHtml +
    H2('Tu actividad', 'Presupuestos de tu semana') + bloqueEmbudo(r.periodo) +
    listaProyectos('✔ Transformados en proyecto', r.periodo.transformados, C.verde, C.verdeClaro, 10) +
    listaProyectos('✖ Cancelados', r.periodo.cancelados, C.rojo, C.rojoClaro, 10) +
    listaProyectos('⚠ Proyectos ya confirmados que se han cancelado', r.periodo.bajas, C.rojo, C.rojoClaro, 10) +
    bloqueCartera(r.cartera);
  return {
    asunto: `ORUM · ${primer}, así fue tu semana ${fechaCorta(d.semDesde)}–${fechaCorta(d.semHasta)}`,
    html: envolver('Cómo fue tu semana', `Hola ${esc(primer)}`, `${fechaCorta(d.semDesde)} – ${fechaCorta(d.semHasta)}`, cuerpo,
      'Importes sin IVA. «Transformado» = presupuesto que pasa de pendiente a confirmado; «cancelado» = pasa a cancelado (se detecta comparando con la foto diaria del estado). «Ventas» = proyectos confirmados con entrega en la semana; el objetivo del equipo es el del Informe Mensual (ventas de esa semana en 2025 +20 %).',
      `${primer}: el equipo ${eur(v.total)} de ${eur(v.objetivo)} (${pct(v.total, v.objetivo)} %) · tu aportación ${eur(r.ventas)}`)
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

// Evolución de las últimas semanas: ventas frente a objetivo, en la misma escala.
function graficaEvolucion(historico) {
  const escala = Math.max(1, ...historico.map(w => Math.max(w.total, w.objetivo)));
  const filas = historico.map((w, i) => {
    const ok = w.objetivo > 0 && w.total >= w.objetivo;
    const ultima = i === historico.length - 1;
    const color = ok ? C.verde : C.rojo;
    return `<tr>
      <td style="width:74px;padding:6px 8px 6px 0;font-size:12px;color:${C.tinta};font-weight:${ultima ? 700 : 400};white-space:nowrap;vertical-align:middle;">S${w.semanaIso}<div style="font-size:10px;color:${C.gris};font-weight:400;">${fechaCorta(w.desde)}</div></td>
      <td style="padding:6px 0;vertical-align:middle;">
        <div>${barra([{ pct: 100 * w.total / escala, color }], 10)}</div>
        <div style="margin-top:3px;">${barra([{ pct: 100 * w.objetivo / escala, color: '#c9c5b8' }], 5)}</div></td>
      <td style="width:118px;padding:6px 0 6px 10px;font-size:12px;text-align:right;white-space:nowrap;vertical-align:middle;"><strong>${eur(w.total)}</strong>
        <div style="color:${C.gris};">${w.objetivo > 0 ? pct(w.total, w.objetivo) + ' % del obj.' : 'sin objetivo'}</div></td></tr>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>
    ${leyenda([{ color: C.verde, texto: 'Ventas (objetivo alcanzado)' }, { color: C.rojo, texto: 'Ventas (por debajo)' }, { color: '#c9c5b8', texto: 'Objetivo de la semana' }])}`;
}

function construirSemanalDireccion(d) {
  const v = d.ventasSemana;
  const llegado = v.objetivo > 0 && v.total >= v.objetivo;
  const vs2025 = v.y2025 > 0 ? Math.round(100 * (v.total / v.y2025 - 1)) : null;
  const cur = d.ventasEnCurso;

  // Comerciales con actividad, ordenados por ventas; cada uno con su color en todo el informe
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
  filas.forEach((f, i) => { f.color = PALETA[i % PALETA.length]; });
  const total = resumenComercial(d, null);

  const objetivoHtml = H2('Objetivo de la semana', `Objetivo de equipo, igual que en el Informe Mensual: ventas de esa semana en 2025 +${Math.round(CRECIMIENTO_OBJETIVO_INFORME * 100)} %`) +
    tarjetaObjetivo(v, filas.filter(f => f.r.ventas > 0).map(f => ({ nombre: f.nombre, total: f.r.ventas, color: f.color })), false) +
    leyenda(filas.filter(f => f.r.ventas > 0).map(f => ({ color: f.color, texto: `${esc(f.nombre)} ${eur(f.r.ventas)}` }))) +
    `<div style="font-size:12px;color:${C.gris};margin-top:10px;line-height:1.6;">${vs2025 !== null ? `${vs2025 >= 0 ? '▲' : '▼'} <strong style="color:${vs2025 >= 0 ? C.verde : C.rojo};">${vs2025 >= 0 ? '+' : ''}${vs2025} %</strong> respecto a la misma semana de 2025 (${eur(v.y2025)}).<br>` : ''}${cur.objetivo > 0 ? `Semana en curso (${fechaCorta(cur.desde)} – ${fechaCorta(cur.hasta)}): ya hay confirmados <strong style="color:${C.tinta};">${eur(cur.total)}</strong> de un objetivo de ${eur(cur.objetivo)} (${pct(cur.total, cur.objetivo)} %).` : ''}</div>`;

  const evolucionHtml = H2('Evolución de las últimas 6 semanas', 'Ventas frente al objetivo de cada semana') + graficaEvolucion(d.historico);

  const celda = (n, imp, hist) => hist === false
    ? `<td style="padding:8px 4px;text-align:center;color:${C.gris};">—</td>`
    : `<td style="padding:8px 4px;text-align:center;"><strong>${n}</strong><div style="font-size:11px;color:${C.gris};">${eur(imp)}</div></td>`;
  const fila = (nombre, r, color, negrita, i) => `<tr style="background:${negrita ? C.doradoClaro : (i % 2 ? C.tarjeta : '#ffffff')};${negrita ? 'font-weight:700;' : ''}">
    <td style="padding:8px 6px;white-space:nowrap;">${color ? `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${color};margin-right:6px;"></span>` : ''}${esc(nombre)}</td>
    ${celda(r.periodo.enviados.length, suma(r.periodo.enviados))}
    ${celda(r.periodo.transformados.length, suma(r.periodo.transformados), r.periodo.historico)}
    ${celda(r.periodo.cancelados.length, suma(r.periodo.cancelados), r.periodo.historico)}
    <td style="padding:8px 4px;text-align:center;"><strong>${eur(r.ventas)}</strong><div style="font-size:11px;color:${C.gris};">${pct(r.ventas, v.total)} %</div></td>
    ${celda(r.cartera.vigentes.length, suma(r.cartera.vigentes))}
    <td style="padding:8px 4px;text-align:center;">${r.cartera.caducados.length}</td></tr>`;
  const th = t => `<th style="padding:8px 4px;font-size:10px;color:#ffffff;font-weight:700;text-transform:uppercase;letter-spacing:.05em;background:${C.tinta};">${t}</th>`;
  const tabla = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;color:${C.tinta};border:1px solid ${C.linea};border-radius:8px;overflow:hidden;">
    <tr>${th('Comercial')}${th('Enviados')}${th('Transf.')}${th('Cancel.')}${th('Ventas')}${th('Cartera')}${th('Caduc.')}</tr>
    ${filas.map((f, i) => fila(f.nombre, f.r, f.color, false, i)).join('')}${fila('TOTAL', total, null, true, 0)}</table>
    ${total.periodo.historico ? '' : `<div style="font-size:12px;color:${C.ambar};margin-top:8px;">Transformados y cancelados: aún sin histórico suficiente.</div>`}`;

  const analisis = filas.map(f => {
    const l = lecturaComercial(f.r);
    return `<div style="border:1px solid ${C.linea};border-left:5px solid ${f.color};border-radius:8px;padding:12px 16px;margin-bottom:10px;background:#ffffff;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:15px;font-weight:700;">${esc(f.nombre)}</td>
        <td align="right" style="font-size:12px;color:${C.gris};">${eur(f.r.ventas)} · ${pct(f.r.ventas, v.total)} % de las ventas</td></tr></table>
      <div style="margin-top:6px;">${barra([{ pct: pct(f.r.ventas, v.total), color: f.color }], 6)}</div>
      <ul style="margin:8px 0 0;padding-left:18px;font-size:13px;line-height:1.55;color:${C.tinta};">${l.lineas.map(x => `<li>${x}</li>`).join('')}
        <li>Ventas: <strong>${eur(f.r.ventas)}</strong> en ${f.r.ventasN} proyecto${f.r.ventasN === 1 ? '' : 's'}.</li></ul>
      ${l.alertas.length ? `<div style="margin-top:8px;">${l.alertas.map(a => pill('⚠ ' + a, C.rojo, C.rojoClaro)).join(' ')}</div>` : ''}</div>`;
  }).join('');

  const intro = introSemanalDireccion(d, filas);
  const cuerpo = introHtml(intro.parrafos, elegirFrase(intro.llegado ? FRASES_SEMANA_LOGRADA : FRASES_SEMANA_ANIMO, d.hoy, 'direccion'), 'PARA ESTA SEMANA') + objetivoHtml + evolucionHtml + H2('Resumen por comercial') + tabla + H2('Análisis por comercial') + analisis +
    listaProyectos('⚠ Proyectos ya confirmados que se cancelaron esta semana', total.periodo.bajas, C.rojo, C.rojoClaro, 15);
  return {
    asunto: `ORUM · Informe semanal de dirección ${fechaCorta(d.semDesde)}–${fechaCorta(d.semHasta)} · ${llegado ? 'objetivo alcanzado' : 'objetivo no alcanzado'}`,
    html: envolver('Informe semanal · Dirección', '', `Semana ${fechaCorta(d.semDesde)} – ${fechaCorta(d.semHasta)}`, cuerpo,
      'Importes sin IVA. «Ventas» = proyectos confirmados con fecha de entrega en la semana (mismo criterio y objetivo que el Informe Mensual). «Cartera» = presupuestos vigentes pendientes de decisión; «Caduc.» = caducados sin cerrar.',
      `${llegado ? 'Objetivo alcanzado' : 'Objetivo no alcanzado'}: ${eur(v.total)} de ${eur(v.objetivo)} (${pct(v.total, v.objetivo)} %)`)
  };
}

// ── Envío ──

// Dos vías de envío, según variables de entorno:
//   1) SMTP (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS): desde una cuenta de correo
//      normal de ORUM (Gmail/Google Workspace, Microsoft 365, hosting...). No requiere DNS.
//   2) Resend (RESEND_API_KEY + INFORME_FROM): requiere verificar el dominio en DNS.
// Si hay SMTP_HOST se usa SMTP; si no, Resend; si tampoco, no se envía nada.
// Versión de texto plano del informe (para clientes que no muestran HTML y para
// los filtros de spam, que penalizan los correos solo-HTML).
function htmlATexto(html) {
  return String(html)
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<div style="display:none[\s\S]*?<\/div>/i, '')
    .replace(/<\/(tr|div|li|h1|h2|p)>|<br\s*\/?>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&zwnj;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{3,}/g, '  ')
    .trim();
}

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
        from: process.env.INFORME_FROM || `ORUM Central <${process.env.SMTP_USER}>`, to: destinos, subject: asunto, html, text: htmlATexto(html)
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
      body: JSON.stringify({ from, to: destinos, subject: asunto, html, text: htmlATexto(html) })
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
  _test: { htmlATexto, cargarDatos, enviarCorreo, construirDiarioComercial, construirSemanalComercial, construirSemanalDireccion, calcularPeriodo, calcularVentas, semanaIso, lunesDe, categoria, isoDeRaw, hoyMadrid }
};
