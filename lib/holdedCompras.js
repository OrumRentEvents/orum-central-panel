// ================================================================
// FACTURAS DE GASTOS → HOLDED (5 oct 2026)
// ================================================================
// Las facturas de proveedores ya llegan a ORUM Central: PDF en Drive
// (carpeta por proveedor) → Apps Script FacturasProveedores → Sheet
// FACTURAS_LOG (ver /api/facturas-proveedores en server.js). Aquí se pasan
// a Holded como COMPRAS EN BORRADOR con el PDF adjunto: las contables las
// revisan y las aprueban en Holded (decidido por el usuario: siempre
// revisión antes de aprobar). Los pagos los registran ellas en Holded.
//
// Los datos salen de la lectura única de cada PDF (lib/lecturaFacturas.js,
// tabla facturas_proveedores) que hace la sincronización de las 6:00: aquí
// no se vuelve a leer nada salvo que se pulse "Releer" (o la factura se
// leyera antes del 5 oct 2026 y aún no tenga lectura guardada). La cuenta
// de gasto, el IVA 0 % y la retención se configuran por proveedor en
// holded_proveedores (pantalla /holded.html).
// Solo facturas posteriores al corte (las anteriores están en Sage).
// ================================================================

const { supabase } = require('./supabaseSource');
const h = require('./holded');
const { leerYGuardar, lecturaGuardada, normalizarNif, limpiarPdfBase64 } = require('./lecturaFacturas');

let appsScript = { url: null, token: null };
function configurar(cfg) { appsScript = cfg; }

// Tipo de IVA leído → impuesto de compra de Holded. El 0 % depende del
// proveedor (exento, no sujeto, intracomunitario, ISP…): va en su ficha.
const IVA_COMPRA = { 21: 'p_iva_21', 10: 'p_iva_10', 5: 'p_iva_5', 4: 'p_iva_4' };
// La retención del 19 % puede ser de alquiler o de capital: va en la ficha.
const RETENCION = { 15: 'p_ret_15', 7: 'p_ret_7' };
// Opciones para la ficha del proveedor (pantalla).
const OPCIONES_IVA_CERO = [
  { key: 'p_iva_exento', nombre: 'Exento (art. 20)' },
  { key: 'p_iva_nosujeto', nombre: 'No sujeto' },
  { key: 'p_iva_0', nombre: 'IVA 0 %' },
  { key: 'p_iva_adqintras_21', nombre: 'Adq. intracomunitaria de servicios 21 %' },
  { key: 'p_iva_adqintrab_21', nombre: 'Adq. intracomunitaria de bienes 21 %' },
  { key: 'p_iva_invsuj', nombre: 'Inversión del sujeto pasivo 21 %' },
];
const OPCIONES_RETENCION = [
  { key: 'p_ret_15', nombre: 'Retención 15 % (profesionales)' },
  { key: 'p_ret_7', nombre: 'Retención 7 % (profesionales inicio)' },
  { key: 'p_retrent_19', nombre: 'Retención 19 % alquiler de inmuebles' },
  { key: 'p_ret_19', nombre: 'Retención 19 % capital mobiliario' },
];

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// ---- Apps Script (Sheet de facturas de proveedores) ----
async function appsScriptGet(action, extra = {}) {
  if (!appsScript.url) throw new Error('Falta APPS_SCRIPT_FACTURAS_URL');
  const params = new URLSearchParams({ token: appsScript.token, action, ...extra });
  const r = await fetch(`${appsScript.url}?${params.toString()}`);
  const d = await r.json();
  if (d.error) throw new Error(`Apps Script ${action}: ${d.error}`);
  return d;
}

// Facturas de la Sheet agrupadas por PDF (una factura con varios periodos
// ocupa varias filas con el mismo fileId).
async function facturasSheet() {
  const [{ facturas }, { reparto }] = await Promise.all([appsScriptGet('listado'), appsScriptGet('reparto')]);
  const repartoPorProv = {};
  (reparto || []).forEach(r => { (repartoPorProv[String(r.proveedor)] = repartoPorProv[String(r.proveedor)] || []).push(`${r.departamento} ${r.porcentaje}%`); });
  const porFile = {};
  (facturas || []).forEach(f => {
    const k = String(f.fileId);
    if (!porFile[k]) porFile[k] = { fileId: k, proveedor: String(f.proveedor), nombreArchivo: f.nombreArchivo, numero: String(f.numeroFactura || ''), fecha: h.fechaFila(null, f.fecha) /* DD/MM/YYYY o ISO */, total: 0, formaPago: f.formaPago || '', reparto: repartoPorProv[String(f.proveedor)] || [] };
    porFile[k].total = r2(porFile[k].total + (Number(f.importeTotal) || 0));
  });
  return Object.values(porFile);
}

// ---- Holded ----
let cacheCuentas = null;
async function cuentasGasto() {
  if (cacheCuentas && Date.now() - cacheCuentas.ts < 3600e3) return cacheCuentas.lista;
  const d = await h.holded('GET', '/accounting-accounts?include_empty=true');
  const items = (d && (d.items || d.data || d)) || [];
  const lista = items
    .map(a => ({ id: a.id, numero: Number(a.number || a.num), nombre: a.name }))
    .filter(a => /^(6|2)/.test(String(a.numero)))
    .sort((a, b) => a.numero - b.numero);
  cacheCuentas = { ts: Date.now(), lista };
  return lista;
}

async function contactoProveedor(nif, nombre) {
  const existente = await h.buscarContactoHolded(nif);
  if (existente) return existente;
  const creado = await h.holded('POST', '/contacts', { name: nombre, code: nif, type: 'supplier', is_person: /^[0-9XYZ]/.test(nif) });
  const id = creado && (creado.id || (creado.data && creado.data.id));
  if (!id) throw new Error(`Holded no devolvió id al crear el proveedor ${nif}`);
  h.contactosCreados[nif] = { id, name: nombre };
  return h.contactosCreados[nif];
}

async function adjuntarPdf(purchaseId, base64, nombreArchivo) {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(limpiarPdfBase64(base64), 'base64')], { type: 'application/pdf' }), nombreArchivo || 'factura.pdf');
  const r = await fetch(`https://api.holded.com/api/v2/purchases/${purchaseId}/attachments`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.HOLDED_API_KEY}` }, body: form
  });
  if (!r.ok) throw new Error(`adjuntar PDF devolvió ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

async function guardar(fila) {
  const { error } = await supabase.from('holded_sync_compras').upsert({ ...fila, actualizado_en: new Date().toISOString() });
  if (error) console.error('[Holded gastos] guardando holded_sync_compras:', error.message);
}

// Prepara (y si todo cuadra, crea en borrador) la compra de un PDF.
async function procesarFactura(f, { releer = false } = {}) {
  const { data: previa } = await supabase.from('holded_sync_compras').select('*').eq('file_id', f.fileId).maybeSingle();
  if (previa && previa.holded_purchase_id) return { estado: 'borrador', ya: true };
  const base = { file_id: f.fileId, proveedor: f.proveedor, nombre_archivo: f.nombreArchivo };
  const bloquear = async (motivo, extra = {}) => { await guardar({ ...base, ...extra, estado: 'bloqueada', error: motivo }); return { estado: 'bloqueada', motivo }; };

  // 1) Lectura única guardada en Supabase (solo se lee el PDF si no la hay o se pide releer)
  let pdf = null;
  let ex = releer ? null : await lecturaGuardada(f.fileId);
  if (!ex) {
    pdf = (await appsScriptGet('descargarArchivo', { fileId: f.fileId })).base64;
    ex = await leerYGuardar({ fileId: f.fileId, proveedor: f.proveedor, nombreArchivo: f.nombreArchivo, base64: pdf });
  }
  const nif = normalizarNif(ex.nif);
  const baseTotal = r2((ex.lineas_iva || []).reduce((s, l) => s + Number(l.base || 0), 0));
  const cuotaTotal = r2((ex.lineas_iva || []).reduce((s, l) => s + Number(l.cuota || 0), 0));
  const datos = { nif, numero: ex.numero, fecha: ex.fecha || null, total: r2(ex.total) };

  // 2) Comprobaciones
  if (ex.fecha && ex.fecha <= h.FECHA_CORTE) return bloquear(`Factura del ${ex.fecha}: anterior al corte (${h.FECHA_CORTE}), va en el saldo inicial de Sage`, datos);
  if ((ex.moneda || 'EUR').toUpperCase() !== 'EUR') return bloquear(`Factura en ${ex.moneda}: registrar a mano`, datos);
  if (ex.es_rectificativa) return bloquear('Abono / rectificativa de proveedor: registrar a mano en Holded (devolución de compra)', datos);
  if (!nif) return bloquear('No se ha podido leer el NIF del proveedor', datos);
  if (!(ex.lineas_iva || []).length) return bloquear('No se ha podido leer el cuadro de IVA', datos);
  const cuadre = r2(baseTotal + cuotaTotal - Number(ex.retencion_importe || 0));
  if (Math.abs(cuadre - r2(ex.total)) > 0.03) return bloquear(`La lectura no cuadra: base ${baseTotal} + IVA ${cuotaTotal} − retención ${r2(ex.retencion_importe)} = ${cuadre} ≠ total ${r2(ex.total)}`, datos);

  // 3) Ficha del proveedor (se aprende el NIF de la primera factura)
  let { data: prov } = await supabase.from('holded_proveedores').select('*').eq('proveedor', f.proveedor).maybeSingle();
  if (!prov) {
    prov = { proveedor: f.proveedor, nif, nombre_fiscal: ex.emisor_nombre };
    await supabase.from('holded_proveedores').upsert({ ...prov, actualizado_por: 'automático' });
  } else if (!prov.nif) {
    prov.nif = nif; prov.nombre_fiscal = prov.nombre_fiscal || ex.emisor_nombre;
    await supabase.from('holded_proveedores').update({ nif, nombre_fiscal: prov.nombre_fiscal }).eq('proveedor', f.proveedor);
  }
  if (normalizarNif(prov.nif) !== nif) return bloquear(`El NIF leído (${nif}) no es el del proveedor "${f.proveedor}" (${prov.nif}): ¿PDF en la carpeta equivocada?`, datos);
  if (!prov.cuenta_gasto) return bloquear(`Proveedor "${f.proveedor}" sin cuenta de gasto asignada`, datos);
  const cuenta = (await cuentasGasto()).find(c => c.numero === Number(prov.cuenta_gasto));
  if (!cuenta) return bloquear(`La cuenta ${prov.cuenta_gasto} no existe en Holded`, datos);

  // Duplicados: mismo proveedor y número ya enviado desde otro PDF
  const { data: dup } = await supabase.from('holded_sync_compras').select('file_id,nombre_archivo').eq('nif', nif).eq('numero', ex.numero).not('holded_purchase_id', 'is', null).neq('file_id', f.fileId).limit(1);
  if (dup && dup.length) return bloquear(`Duplicada: la factura ${ex.numero} de este proveedor ya se envió (${dup[0].nombre_archivo})`, datos);

  // 4) Impuestos por línea
  let retKey = null;
  if (Number(ex.retencion_importe) > 0) {
    retKey = prov.retencion || RETENCION[Number(ex.retencion_porcentaje)];
    if (!retKey) return bloquear(`Retención del ${ex.retencion_porcentaje} %: indicar el tipo en la ficha del proveedor`, datos);
  }
  const items = [];
  for (const l of ex.lineas_iva) {
    const tipo = Number(l.tipo);
    const ivaKey = tipo === 0 ? prov.iva_cero : IVA_COMPRA[tipo];
    if (!ivaKey) return bloquear(tipo === 0 ? 'Línea al 0 % de IVA: indicar en la ficha del proveedor si es exenta, no sujeta, intracomunitaria…' : `IVA del ${tipo} % sin equivalente en Holded`, datos);
    if (r2(l.base) === 0) continue;
    items.push({ name: ex.concepto || f.proveedor, units: 1, price: r2(l.base), taxes: retKey ? [ivaKey, retKey] : [ivaKey], account: cuenta.id });
  }

  // 5) Crear en borrador + adjuntar PDF
  const contacto = await contactoProveedor(nif, prov.nombre_fiscal || ex.emisor_nombre || f.proveedor);
  if (prov.holded_contact_id !== contacto.id) await supabase.from('holded_proveedores').update({ holded_contact_id: contacto.id }).eq('proveedor', f.proveedor);
  const notas = [`Desde ORUM Central (Drive: ${f.nombreArchivo})`, f.formaPago ? `Forma de pago: ${f.formaPago}` : null, f.reparto.length ? `Reparto: ${f.reparto.join(', ')}` : null, ex.dudas ? `Dudas de la lectura: ${ex.dudas}` : null].filter(Boolean).join(' · ');
  const payload = { contact_id: contacto.id, date: ex.fecha, number: ex.numero, items, notes: notas };
  if (ex.vencimiento) payload.due_date = ex.vencimiento;
  let creada;
  try {
    creada = await h.holded('POST', '/purchases', payload);
  } catch (e) {
    await guardar({ ...base, ...datos, estado: 'error', error: e.message, payload, respuesta: e.respuesta || null });
    return { estado: 'error', motivo: e.message };
  }
  const id = creada && (creada.id || (creada.data && creada.data.id));
  let avisoAdjunto = null;
  if (id) {
    try {
      if (!pdf) pdf = (await appsScriptGet('descargarArchivo', { fileId: f.fileId })).base64;
      await adjuntarPdf(id, pdf, f.nombreArchivo);
    } catch (e) { avisoAdjunto = `Creada, pero no se pudo adjuntar el PDF: ${e.message}`; }
  }
  await guardar({ ...base, ...datos, estado: id ? 'borrador' : 'error', holded_purchase_id: id || null, payload, respuesta: creada, error: id ? avisoAdjunto : 'Holded no devolvió id de compra' });
  return id ? { estado: 'borrador', holded_purchase_id: id, aviso: avisoAdjunto } : { estado: 'error', motivo: 'Holded no devolvió id de compra' };
}

// Vuelca todas las facturas de gastos posteriores al corte que falten.
let volcando = false;
async function volcarGastos({ origen = 'auto-gastos', usuario = null } = {}) {
  if (volcando) return { ok: false, motivo: 'Ya hay un volcado de gastos en marcha' };
  volcando = true;
  const hasta = h.ayerMadrid();
  const { data: ej } = await supabase.from('holded_sync_ejecuciones').insert({ origen, usuario, hasta_fecha: hasta }).select('id').single();
  const resumen = { compras_enviadas: 0, compras_bloqueadas: 0, compras_error: 0, errores: [] };
  try {
    const facturas = (await facturasSheet()).filter(f => !f.fecha || (f.fecha > h.FECHA_CORTE));
    const { data: hechas } = await supabase.from('holded_sync_compras').select('file_id,holded_purchase_id');
    const yaEnviadas = new Set((hechas || []).filter(x => x.holded_purchase_id).map(x => x.file_id));
    for (const f of facturas.filter(x => !yaEnviadas.has(x.fileId))) {
      try {
        const r = await procesarFactura(f);
        if (r.estado === 'borrador') resumen.compras_enviadas++;
        else if (r.estado === 'bloqueada') resumen.compras_bloqueadas++;
        else { resumen.compras_error++; resumen.errores.push(`${f.nombreArchivo}: ${r.motivo}`); }
      } catch (e) {
        resumen.compras_error++; resumen.errores.push(`${f.nombreArchivo}: ${e.message}`);
        await guardar({ file_id: f.fileId, proveedor: f.proveedor, nombre_archivo: f.nombreArchivo, estado: 'error', error: e.message });
      }
    }
    const ok = resumen.compras_error === 0;
    if (ej) await supabase.from('holded_sync_ejecuciones').update({ fin: new Date().toISOString(), ok, resumen }).eq('id', ej.id);
    console.log(`[Holded gastos] Volcado ${origen}:`, JSON.stringify({ ...resumen, errores: resumen.errores.length }));
    return { ok, resumen };
  } catch (e) {
    console.error('[Holded gastos] Error en volcado:', e);
    if (ej) await supabase.from('holded_sync_ejecuciones').update({ fin: new Date().toISOString(), ok: false, resumen, error: e.message }).eq('id', ej.id);
    return { ok: false, resumen, motivo: e.message };
  } finally {
    volcando = false;
  }
}

async function reintentar(fileId, { releer = false } = {}) {
  const f = (await facturasSheet()).find(x => x.fileId === String(fileId));
  if (!f) return { estado: 'error', motivo: 'Esa factura ya no está en la Sheet de proveedores' };
  return procesarFactura(f, { releer });
}

// Datos de la pantalla: pendientes, últimas enviadas, fichas de proveedor.
async function estadoGastos() {
  const [{ data: filas }, { data: provs }] = await Promise.all([
    supabase.from('holded_sync_compras').select('file_id,proveedor,nombre_archivo,nif,numero,fecha,total,estado,holded_purchase_id,error,actualizado_en').order('actualizado_en', { ascending: false }),
    supabase.from('holded_proveedores').select('*').order('proveedor')
  ]);
  let cuentas = [], errorCuentas = null;
  try { cuentas = await cuentasGasto(); } catch (e) { errorCuentas = e.message; }
  const todas = filas || [];
  return {
    pendientes: todas.filter(x => !x.holded_purchase_id),
    enviadas: todas.filter(x => x.holded_purchase_id).slice(0, 15),
    total_enviadas: todas.filter(x => x.holded_purchase_id).length,
    proveedores: provs || [],
    cuentas, error_cuentas: errorCuentas,
    opciones_iva_cero: OPCIONES_IVA_CERO, opciones_retencion: OPCIONES_RETENCION,
    volcando
  };
}

async function guardarProveedor({ proveedor, nif, cuenta_gasto, iva_cero, retencion }, usuario) {
  if (!proveedor) throw new Error('Falta el proveedor');
  const fila = { proveedor, nif: nif ? normalizarNif(nif) : null, cuenta_gasto: cuenta_gasto ? Number(cuenta_gasto) : null, iva_cero: iva_cero || null, retencion: retencion || null, actualizado_por: usuario, actualizado_en: new Date().toISOString() };
  const { error } = await supabase.from('holded_proveedores').upsert(fila);
  if (error) throw error;
  return { ok: true };
}

// A las 7:00 (Madrid): después de la lectura de PDFs de las 6:00.
function programarVolcadoGastos() {
  const ahora = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  const obj = new Date(ahora); obj.setHours(7, 0, 0, 0);
  if (obj <= ahora) obj.setDate(obj.getDate() + 1);
  setTimeout(async () => {
    try { await volcarGastos(); } catch (e) { console.error('[Holded gastos] volcado automático:', e.message); }
    finally { programarVolcadoGastos(); }
  }, obj - ahora);
}

module.exports = { configurar, volcarGastos, reintentar, estadoGastos, guardarProveedor, programarVolcadoGastos };
