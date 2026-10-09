// ================================================================
// FACTURAS DE GASTOS → HOLDED (5 oct 2026)
// ================================================================
// Las facturas de proveedores ya llegan a ORUM Central: PDF en Drive
// (carpeta por proveedor) → Apps Script FacturasProveedores → Sheet
// FACTURAS_LOG (ver /api/facturas-proveedores en server.js).
//
// NUEVO (9 oct 2026): el contable APRUEBA EN ORUM CENTRAL antes de volcar.
// El proceso de las 7:00 solo lee y comprueba cada factura y la deja
// "por aprobar" (no toca Holded). En /holded.html el contable ve el PDF, los
// importes y la cuenta de gasto propuesta (la habitual del proveedor), puede
// cambiarla para esa factura y pulsa Aceptar: entonces se crea la compra en
// Holded YA APROBADA (decidido por el usuario: se revisa una sola vez, aquí)
// con el PDF adjunto. Los pagos los registran las contables en Holded.
//
// Los datos salen de la lectura única de cada PDF (lib/lecturaFacturas.js,
// tabla facturas_proveedores) que hace la sincronización de las 6:00: aquí
// no se vuelve a leer nada salvo que se pulse "Releer" (o la factura se
// leyera antes del 5 oct 2026 y aún no tenga lectura guardada).
// La cuenta de gasto habitual, el IVA 0 % y la retención de cada proveedor
// se configuran en Financiero → Config. Cuentas de gasto (tabla
// holded_proveedores), eligiendo del plan de cuentas 6 de Sage (tabla
// cuentas_gasto). Config. Facturas Proveedores es otra cosa: solo el
// departamento al que se imputa el gasto.
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

// ---- Plan de cuentas de gasto ----
// Tabla cuentas_gasto: grupo 6 con los nombres de Sage. Es lo que se elige en
// Config. Cuentas de gasto y al aprobar cada factura.
async function planCuentas({ soloActivas = false } = {}) {
  let q = supabase.from('cuentas_gasto').select('numero,nombre,activa').order('numero');
  if (soloActivas) q = q.eq('activa', true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Cuentas que existen en Holded (para saber su id: la línea de la compra
// lleva el id de la cuenta, no el número). Tienen que estar creadas en Holded
// con el mismo número que en el plan.
let cacheCuentas = null;
async function cuentasHolded() {
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

// Lee y comprueba la factura de un PDF (no toca Holded). Devuelve
// { ok:false, motivo } si algo no cuadra, o los datos para crear la compra.
async function comprobarFactura(f, { releer = false } = {}) {
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
  const fallo = motivo => ({ ok: false, motivo, datos, ex });

  // 2) Comprobaciones
  if (ex.fecha && ex.fecha <= h.FECHA_CORTE) return fallo(`Factura del ${ex.fecha}: anterior al corte (${h.FECHA_CORTE}), va en el saldo inicial de Sage`);
  if ((ex.moneda || 'EUR').toUpperCase() !== 'EUR') return fallo(`Factura en ${ex.moneda}: registrar a mano`);
  if (ex.es_rectificativa) return fallo('Abono / rectificativa de proveedor: registrar a mano en Holded (devolución de compra)');
  if (!nif) return fallo('No se ha podido leer el NIF del proveedor');
  if (!(ex.lineas_iva || []).length) return fallo('No se ha podido leer el cuadro de IVA');
  const cuadre = r2(baseTotal + cuotaTotal - Number(ex.retencion_importe || 0));
  if (Math.abs(cuadre - r2(ex.total)) > 0.03) return fallo(`La lectura no cuadra: base ${baseTotal} + IVA ${cuotaTotal} − retención ${r2(ex.retencion_importe)} = ${cuadre} ≠ total ${r2(ex.total)}`);

  // 3) Ficha del proveedor (se aprende el NIF de la primera factura)
  let { data: prov } = await supabase.from('holded_proveedores').select('*').eq('proveedor', f.proveedor).maybeSingle();
  if (!prov) {
    prov = { proveedor: f.proveedor, nif, nombre_fiscal: ex.emisor_nombre };
    await supabase.from('holded_proveedores').upsert({ ...prov, actualizado_por: 'automático' });
  } else if (!prov.nif) {
    prov.nif = nif; prov.nombre_fiscal = prov.nombre_fiscal || ex.emisor_nombre;
    await supabase.from('holded_proveedores').update({ nif, nombre_fiscal: prov.nombre_fiscal }).eq('proveedor', f.proveedor);
  }
  if (normalizarNif(prov.nif) !== nif) return fallo(`El NIF leído (${nif}) no es el del proveedor "${f.proveedor}" (${prov.nif}): ¿PDF en la carpeta equivocada?`);

  // Duplicados: mismo proveedor y número ya enviado desde otro PDF
  const { data: dup } = await supabase.from('holded_sync_compras').select('file_id,nombre_archivo').eq('nif', nif).eq('numero', ex.numero).not('holded_purchase_id', 'is', null).neq('file_id', f.fileId).limit(1);
  if (dup && dup.length) return fallo(`Duplicada: la factura ${ex.numero} de este proveedor ya se envió (${dup[0].nombre_archivo})`);

  // 4) Impuestos por línea (la cuenta se pone al aprobar)
  let retKey = null;
  if (Number(ex.retencion_importe) > 0) {
    retKey = prov.retencion || RETENCION[Number(ex.retencion_porcentaje)];
    if (!retKey) return fallo(`Retención del ${ex.retencion_porcentaje} %: indicar el tipo en Config. Cuentas de gasto`);
  }
  const lineas = [];
  for (const l of ex.lineas_iva) {
    const tipo = Number(l.tipo);
    const ivaKey = tipo === 0 ? prov.iva_cero : IVA_COMPRA[tipo];
    if (!ivaKey) return fallo(tipo === 0 ? 'Línea al 0 % de IVA: indicar en Config. Cuentas de gasto si es exenta, no sujeta, intracomunitaria…' : `IVA del ${tipo} % sin equivalente en Holded`);
    if (r2(l.base) === 0) continue;
    lineas.push({ name: ex.concepto || f.proveedor, units: 1, price: r2(l.base), taxes: retKey ? [ivaKey, retKey] : [ivaKey] });
  }
  return { ok: true, ex, pdf, nif, prov, datos, lineas };
}

// Prepara la factura de un PDF: si cuadra queda "por aprobar" (sin tocar Holded).
async function procesarFactura(f, { releer = false } = {}) {
  const { data: previa } = await supabase.from('holded_sync_compras').select('*').eq('file_id', f.fileId).maybeSingle();
  if (previa && previa.holded_purchase_id) return { estado: previa.estado, ya: true };
  const base = { file_id: f.fileId, proveedor: f.proveedor, nombre_archivo: f.nombreArchivo };
  const c = await comprobarFactura(f, { releer });
  if (!c.ok) {
    await guardar({ ...base, ...c.datos, extraccion: c.ex || null, estado: 'bloqueada', error: c.motivo });
    return { estado: 'bloqueada', motivo: c.motivo };
  }
  // La cuenta elegida a mano para esta factura (si la hubo) se respeta.
  await guardar({ ...base, ...c.datos, extraccion: c.ex, estado: 'por_aprobar', error: null, cuenta_gasto: previa ? previa.cuenta_gasto : null });
  return { estado: 'por_aprobar' };
}

// El contable acepta la factura en ORUM Central → compra APROBADA en Holded
// con la cuenta elegida y el PDF adjunto. guardarHabitual: la cuenta pasa a
// ser también la habitual del proveedor.
async function aceptar(fileId, { cuenta, guardarHabitual = false } = {}, usuario) {
  const { data: fila } = await supabase.from('holded_sync_compras').select('*').eq('file_id', String(fileId)).maybeSingle();
  if (!fila) return { estado: 'error', motivo: 'Factura no encontrada' };
  if (fila.holded_purchase_id) return { estado: fila.estado, motivo: 'Ya estaba volcada en Holded' };
  if (fila.estado !== 'por_aprobar') return { estado: fila.estado, motivo: fila.error || 'La factura no está lista para aprobar' };
  const f = (await facturasSheet()).find(x => x.fileId === String(fileId));
  if (!f) return { estado: 'error', motivo: 'Esa factura ya no está en la Sheet de proveedores' };

  // Se vuelve a comprobar todo: la ficha o la lectura pueden haber cambiado.
  const c = await comprobarFactura(f);
  if (!c.ok) {
    await guardar({ file_id: f.fileId, proveedor: f.proveedor, nombre_archivo: f.nombreArchivo, ...c.datos, estado: 'bloqueada', error: c.motivo });
    return { estado: 'bloqueada', motivo: c.motivo };
  }
  const numCuenta = Number(cuenta || fila.cuenta_gasto || c.prov.cuenta_gasto);
  if (!numCuenta) return { estado: 'por_aprobar', motivo: 'Elige la cuenta de gasto' };
  const enPlan = (await planCuentas()).find(x => x.numero === numCuenta);
  if (!enPlan) return { estado: 'por_aprobar', motivo: `La cuenta ${numCuenta} no está en el plan de cuentas (Config. Cuentas de gasto)` };
  const enHolded = (await cuentasHolded()).find(x => x.numero === numCuenta);
  if (!enHolded) return { estado: 'por_aprobar', motivo: `La cuenta ${numCuenta} ${enPlan.nombre} no existe en Holded: hay que crearla allí con el mismo número` };
  if (guardarHabitual) await supabase.from('holded_proveedores').update({ cuenta_gasto: numCuenta, actualizado_por: usuario, actualizado_en: new Date().toISOString() }).eq('proveedor', f.proveedor);

  const ex = c.ex;
  const contacto = await contactoProveedor(c.nif, c.prov.nombre_fiscal || ex.emisor_nombre || f.proveedor);
  if (c.prov.holded_contact_id !== contacto.id) await supabase.from('holded_proveedores').update({ holded_contact_id: contacto.id }).eq('proveedor', f.proveedor);
  const notas = [`Desde ORUM Central (Drive: ${f.nombreArchivo})`, `Aprobada por ${usuario}`, f.formaPago ? `Forma de pago: ${f.formaPago}` : null, f.reparto.length ? `Reparto: ${f.reparto.join(', ')}` : null, ex.dudas ? `Dudas de la lectura: ${ex.dudas}` : null].filter(Boolean).join(' · ');
  const payload = { contact_id: contacto.id, date: ex.fecha, number: ex.numero, items: c.lineas.map(l => ({ ...l, account: enHolded.id })), notes: notas };
  if (ex.vencimiento) payload.due_date = ex.vencimiento;
  const base = { file_id: f.fileId, proveedor: f.proveedor, nombre_archivo: f.nombreArchivo, ...c.datos, cuenta_gasto: numCuenta, aprobado_por: usuario, aprobado_en: new Date().toISOString() };

  let creada;
  try {
    creada = await h.holded('POST', '/purchases', payload);
  } catch (e) {
    await guardar({ ...base, estado: 'por_aprobar', error: `Holded rechazó la compra: ${e.message}`, payload, respuesta: e.respuesta || null });
    return { estado: 'error', motivo: e.message };
  }
  const id = creada && (creada.id || (creada.data && creada.data.id));
  if (!id) {
    await guardar({ ...base, estado: 'por_aprobar', error: 'Holded no devolvió id de compra', payload, respuesta: creada });
    return { estado: 'error', motivo: 'Holded no devolvió id de compra' };
  }
  const avisos = [];
  let estado = 'aprobada';
  try { await h.holded('POST', `/purchases/${id}/approve`); }
  catch (e) { estado = 'borrador'; avisos.push(`Creada en borrador, no se pudo aprobar: ${e.message}`); }
  try {
    const pdf = c.pdf || (await appsScriptGet('descargarArchivo', { fileId: f.fileId })).base64;
    await adjuntarPdf(id, pdf, f.nombreArchivo);
  } catch (e) { avisos.push(`No se pudo adjuntar el PDF: ${e.message}`); }
  const aviso = avisos.join(' · ') || null;
  await guardar({ ...base, estado, holded_purchase_id: id, payload, respuesta: creada, error: aviso });
  return { estado, holded_purchase_id: id, aviso };
}

// Prepara todas las facturas de gastos posteriores al corte que falten (las
// deja por aprobar o bloqueadas). No envía nada a Holded.
let volcando = false;
async function volcarGastos({ origen = 'auto-gastos', usuario = null } = {}) {
  if (volcando) return { ok: false, motivo: 'Ya hay una preparación de gastos en marcha' };
  volcando = true;
  const hasta = h.ayerMadrid();
  const { data: ej } = await supabase.from('holded_sync_ejecuciones').insert({ origen, usuario, hasta_fecha: hasta }).select('id').single();
  const resumen = { compras_por_aprobar: 0, compras_bloqueadas: 0, compras_error: 0, errores: [] };
  try {
    const facturas = (await facturasSheet()).filter(f => !f.fecha || (f.fecha > h.FECHA_CORTE));
    const { data: hechas } = await supabase.from('holded_sync_compras').select('file_id,holded_purchase_id');
    const yaEnviadas = new Set((hechas || []).filter(x => x.holded_purchase_id).map(x => x.file_id));
    for (const f of facturas.filter(x => !yaEnviadas.has(x.fileId))) {
      try {
        const r = await procesarFactura(f);
        if (r.estado === 'por_aprobar') resumen.compras_por_aprobar++;
        else if (r.estado === 'bloqueada') resumen.compras_bloqueadas++;
      } catch (e) {
        resumen.compras_error++; resumen.errores.push(`${f.nombreArchivo}: ${e.message}`);
        await guardar({ file_id: f.fileId, proveedor: f.proveedor, nombre_archivo: f.nombreArchivo, estado: 'error', error: e.message });
      }
    }
    const ok = resumen.compras_error === 0;
    if (ej) await supabase.from('holded_sync_ejecuciones').update({ fin: new Date().toISOString(), ok, resumen }).eq('id', ej.id);
    console.log(`[Holded gastos] Preparación ${origen}:`, JSON.stringify({ ...resumen, errores: resumen.errores.length }));
    return { ok, resumen };
  } catch (e) {
    console.error('[Holded gastos] Error preparando gastos:', e);
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

// Datos de /holded.html: por aprobar, bloqueadas y últimas volcadas.
async function estadoGastos() {
  const [{ data: filas }, { data: provs }, plan] = await Promise.all([
    supabase.from('holded_sync_compras').select('file_id,proveedor,nombre_archivo,nif,numero,fecha,total,estado,holded_purchase_id,error,cuenta_gasto,aprobado_por,aprobado_en,extraccion,actualizado_en').order('fecha', { ascending: true }),
    supabase.from('holded_proveedores').select('proveedor,cuenta_gasto,nombre_fiscal'),
    planCuentas({ soloActivas: true })
  ]);
  const habitual = {};
  (provs || []).forEach(p => { habitual[p.proveedor] = p.cuenta_gasto; });
  const todas = filas || [];
  const resumenLectura = x => {
    const ex = x.extraccion || {};
    const lineas = ex.lineas_iva || [];
    return { concepto: ex.concepto || null, dudas: ex.dudas || null, base: r2(lineas.reduce((s, l) => s + Number(l.base || 0), 0)), iva: r2(lineas.reduce((s, l) => s + Number(l.cuota || 0), 0)), retencion: r2(ex.retencion_importe), tipos: lineas.map(l => Number(l.tipo)) };
  };
  const sinExtraccion = ({ extraccion, ...x }) => x;
  return {
    por_aprobar: todas.filter(x => !x.holded_purchase_id && x.estado === 'por_aprobar').map(x => ({ ...sinExtraccion(x), ...resumenLectura(x), cuenta_propuesta: x.cuenta_gasto || habitual[x.proveedor] || null, cuenta_habitual: habitual[x.proveedor] || null, pdf_url: `https://drive.google.com/file/d/${x.file_id}/view` })),
    pendientes: todas.filter(x => !x.holded_purchase_id && x.estado !== 'por_aprobar').map(sinExtraccion).reverse(),
    enviadas: todas.filter(x => x.holded_purchase_id).sort((a, b) => String(b.aprobado_en || b.actualizado_en).localeCompare(String(a.aprobado_en || a.actualizado_en))).slice(0, 15).map(sinExtraccion),
    total_enviadas: todas.filter(x => x.holded_purchase_id).length,
    cuentas: plan,
    volcando
  };
}

// ---- Config. Cuentas de gasto (Financiero) ----
async function configCuentas() {
  const [plan, { data: provs }, holdedRes] = await Promise.all([
    planCuentas(),
    supabase.from('holded_proveedores').select('*').order('proveedor'),
    cuentasHolded().then(l => ({ lista: l }), e => ({ error: e.message }))
  ]);
  const enHolded = new Set((holdedRes.lista || []).map(c => c.numero));
  return {
    cuentas: plan.map(c => ({ ...c, en_holded: holdedRes.lista ? enHolded.has(c.numero) : null })),
    error_holded: holdedRes.error || null,
    proveedores: provs || [],
    opciones_iva_cero: OPCIONES_IVA_CERO, opciones_retencion: OPCIONES_RETENCION
  };
}

// Alta / cambio de cuentas del plan. lineas: [{numero, nombre, activa?}].
async function guardarCuentas(lineas, usuario) {
  const filas = [];
  for (const l of lineas || []) {
    const numero = Number(String(l.numero || '').replace(/\D/g, ''));
    const nombre = String(l.nombre || '').trim();
    if (!numero || !nombre) continue;
    if (!/^6\d{7}$/.test(String(numero))) throw new Error(`La cuenta ${l.numero} no es del grupo 6 con 8 dígitos`);
    filas.push({ numero, nombre, activa: l.activa !== false, actualizado_por: usuario, actualizado_en: new Date().toISOString() });
  }
  if (!filas.length) throw new Error('No hay ninguna cuenta válida (número de 8 dígitos y nombre)');
  const { error } = await supabase.from('cuentas_gasto').upsert(filas);
  if (error) throw error;
  return { ok: true, guardadas: filas.length };
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
    try { await volcarGastos(); } catch (e) { console.error('[Holded gastos] preparación automática:', e.message); }
    finally { programarVolcadoGastos(); }
  }, obj - ahora);
}

module.exports = { configurar, volcarGastos, reintentar, aceptar, estadoGastos, configCuentas, guardarCuentas, guardarProveedor, programarVolcadoGastos };
