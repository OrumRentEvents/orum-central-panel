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
// con el PDF adjunto y PAGADA (9 oct 2026: la fecha del pago la elige el
// contable; la tesorería sale de la forma de pago, ver TESORERIAS_PAGO).
// Solo facturas YA PAGADAS: con "Forma de pago" rellena en Facturas
// Proveedores; sin ella quedan "pendiente_pago" y no se preparan. El contable
// puede corregir fecha y vencimiento si la lectura del PDF se equivocó
// (holded_sync_compras.correccion).
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

// appsScript: solo para descargar el PDF de Drive. datos: listado y reparto
// de las facturas en Supabase (lib/facturasProveedoresDatos.js, oct 2026).
let appsScript = { url: null, token: null, datos: null };
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
  const [facturas, reparto] = await Promise.all([appsScript.datos.listado(), appsScript.datos.reparto()]);
  const repartoPorProv = {};
  (reparto || []).forEach(r => { (repartoPorProv[String(r.proveedor)] = repartoPorProv[String(r.proveedor)] || []).push(`${r.departamento} ${r.porcentaje}%`); });
  const porFile = {};
  (facturas || []).forEach(f => {
    const k = String(f.fileId);
    if (!porFile[k]) porFile[k] = { fileId: k, proveedor: String(f.proveedor), nombreArchivo: f.nombreArchivo, numero: String(f.numeroFactura || ''), fecha: h.fechaFila(null, f.fecha) /* DD/MM/YYYY o ISO */, total: 0, formaPago: '', filas: [], reparto: repartoPorProv[String(f.proveedor)] || [] };
    porFile[k].total = r2(porFile[k].total + (Number(f.importeTotal) || 0));
    // La forma de pago se rellena a mano y puede estar solo en una de las filas.
    if (!porFile[k].formaPago && String(f.formaPago || '').trim()) porFile[k].formaPago = String(f.formaPago).trim();
    if (f.fila) porFile[k].filas.push(f.fila);
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

// Cuentas 524 de leasing (20 nov 2026, pedido por el usuario): no están en
// cuentas_gasto (solo grupo 6), pero al aprobar hay que poder buscarlas para
// ver si un contrato ya tiene la suya. Salen de Holded (todas las 524) y de
// holded_leasing (las creadas desde ORUM), y se suman al plan solo al aprobar.
async function cuentasLeasingPlan() {
  const lista = new Map();
  const { data } = await supabase.from('holded_leasing').select('contrato,bien,cuenta_amortizacion');
  (data || []).forEach(c => {
    if (c.cuenta_amortizacion) lista.set(Number(c.cuenta_amortizacion), { numero: Number(c.cuenta_amortizacion), nombre: `LEASING ${c.bien || 'CONTRATO'} ${c.contrato}`, activa: true, leasing: true });
  });
  try {
    (await cuentasHolded()).filter(a => String(a.numero).startsWith(GRUPO_AMORTIZACION_LEASING))
      .forEach(a => lista.set(a.numero, { numero: a.numero, nombre: a.nombre || (lista.get(a.numero) || {}).nombre || 'LEASING', activa: true, leasing: true }));
  } catch (e) { console.error('[Holded gastos] cuentas 524 de Holded:', e.message); }
  return [...lista.values()];
}
async function planConLeasing(opciones) {
  const [plan, leasing] = await Promise.all([planCuentas(opciones), cuentasLeasingPlan()]);
  const ya = new Set(plan.map(c => c.numero));
  return plan.concat(leasing.filter(c => !ya.has(c.numero))).sort((a, b) => a.numero - b.numero);
}

// Histórico de Sage 2026 por NIF del proveedor (tabla sage_historico_proveedor,
// importada del diario + plan de cuentas de Sage): cuentas 6 que usó, de más
// a menos apuntes. Sirve para proponer la cuenta habitual y como pista al
// aprobar facturas de proveedores que reparten (luz por local, gasoil por
// matrícula…). Devuelve { nif: { nombre_sage, cuentas: [{cuenta, nombre, apuntes, importe}] } }.
async function historicoSage(nifs) {
  const lista = [...new Set((nifs || []).filter(Boolean).map(normalizarNif))];
  if (!lista.length) return {};
  const { data, error } = await supabase.from('sage_historico_proveedor').select('nif,nombre_sage,cuentas').in('nif', lista);
  if (error) { console.error('[Holded gastos] histórico Sage:', error.message); return {}; }
  const res = {};
  (data || []).forEach(x => { res[x.nif] = { nombre_sage: x.nombre_sage, cuentas: x.cuentas || [] }; });
  return res;
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
    .filter(a => /^(6|2|524)/.test(String(a.numero)))
    .sort((a, b) => a.numero - b.numero);
  cacheCuentas = { ts: Date.now(), lista };
  return lista;
}

// Cuenta de gasto nueva (19 nov 2026, pedido por el usuario): si está en el
// plan de ORUM (Config. Cuentas de gasto) y no en Holded, se crea en Holded con
// el mismo número y nombre (POST /accounting-accounts, prefix = 4 primeras
// cifras). Ya no hay que crearla a mano.
async function crearCuentaHolded(numero, nombre) {
  const creada = await h.holded('POST', '/accounting-accounts', { prefix: Number(String(numero).slice(0, 4)), number: Number(numero), name: nombre });
  const id = creada && (creada.id || (creada.data && creada.data.id));
  if (!id) throw new Error(`Holded no devolvió id al crear la cuenta ${numero}`);
  cacheCuentas = null;
  return { id, numero: Number(numero), nombre };
}

// ---- Leasing (19 nov 2026, decidido por el usuario) ----
// La cuota de un leasing se reparte en: amortización → una 524 por contrato,
// intereses → siempre la misma cuenta, seguro → una 625 por contrato. El
// reparto llega propuesto (lectura del PDF) y el contable lo confirma o lo
// corrige. Contrato nuevo: sus cuentas se crean solas en Holded con el número
// siguiente al último de su grupo.
const CUENTA_INTERESES_LEASING = 66230000;
const GRUPO_AMORTIZACION_LEASING = '5240';
const GRUPO_SEGURO_LEASING = '6250';
// "0182 4135 0501 00000001792798" y "1792798" son el mismo contrato.
const claveContrato = c => { const d = String(c || '').replace(/\D/g, ''); return d ? String(Number(d.slice(-14))) : ''; };

async function siguienteNumeroHolded(grupo) {
  const d = await h.holded('GET', '/accounting-accounts?include_empty=true');
  const items = (d && (d.items || d.data || d)) || [];
  const max = items.map(a => Number(a.number || a.num)).filter(n => String(n).startsWith(grupo))
    .reduce((m, n) => Math.max(m, n), Number(grupo + '0000'));
  if (!String(max + 1).startsWith(grupo)) throw new Error(`El grupo ${grupo} de Holded está lleno`);
  return max + 1;
}

// Cuentas del contrato; si es nuevo, las crea en Holded (y el seguro en el plan de ORUM).
async function cuentasLeasing(contrato, bien, usuario) {
  const k = claveContrato(contrato);
  if (!k) throw new Error('La cuota de leasing no trae número de contrato');
  const { data: ya } = await supabase.from('holded_leasing').select('*').eq('contrato', k).maybeSingle();
  if (ya && ya.cuenta_amortizacion && ya.cuenta_seguro) return ya;
  const que = String(bien || ya && ya.bien || '').trim().toUpperCase() || 'CONTRATO';
  const amort = (ya && ya.cuenta_amortizacion) || await siguienteNumeroHolded(GRUPO_AMORTIZACION_LEASING);
  if (!(ya && ya.cuenta_amortizacion)) await crearCuentaHolded(amort, `LEASING ${que} ${k}`);
  const seguro = (ya && ya.cuenta_seguro) || await siguienteNumeroHolded(GRUPO_SEGURO_LEASING);
  if (!(ya && ya.cuenta_seguro)) {
    await crearCuentaHolded(seguro, `SEGURO LEASING ${que} ${k}`);
    await supabase.from('cuentas_gasto').upsert({ numero: seguro, nombre: `SEGURO LEASING ${que} ${k}`, activa: true, actualizado_por: usuario || 'automático (leasing)', actualizado_en: new Date().toISOString() });
  }
  const fila = { contrato: k, bien: que, cuenta_amortizacion: amort, cuenta_seguro: seguro, creado_por: usuario || 'automático' };
  const { error } = await supabase.from('holded_leasing').upsert(fila);
  if (error) throw error;
  return fila;
}

// Reparto propuesto a partir de la lectura (solo un tipo de IVA y que cuadre
// con la base). Las cuentas de amortización y seguro se rellenan al mostrar
// (pueden no existir aún: "nueva").
function repartoPropuesto(ex) {
  const l = ex && ex.leasing;
  const iva = (ex && ex.lineas_iva) || [];
  if (!l || iva.length !== 1) return null;
  const base = r2(iva[0].base);
  const partes = [
    { tipo: 'amortizacion', importe: r2(l.amortizacion) },
    { tipo: 'intereses', importe: r2(l.intereses), cuenta: CUENTA_INTERESES_LEASING },
    { tipo: 'seguro', importe: r2(l.seguro) },
    { tipo: 'otros', importe: r2(l.otros) }
  ].filter(p => p.importe > 0);
  if (!partes.length || Math.abs(r2(partes.reduce((s, p) => s + p.importe, 0)) - base) > 0.011) return null;
  return { contrato: claveContrato(l.contrato), bien: l.bien || '', lineas: partes };
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

// Abonos de proveedor (9 oct 2026, pedido por el usuario): mismo camino que
// una factura de gasto (pendiente de pago → por aprobar → aceptar) pero en
// Holded van como DEVOLUCIÓN DE COMPRA, con las líneas en positivo (Holded les
// da la vuelta: 4xx D / 6xx H / 472 H) y el cobro de la devolución en positivo
// sobre el propio abono, igual que las notas de crédito de venta.
// Ruta de la API v2 sin probar todavía contra Holded.
const RUTA_COMPRA = { factura: '/purchases', abono: '/purchase-refunds' };
const rutaDe = ex => ex && ex.es_rectificativa ? RUTA_COMPRA.abono : RUTA_COMPRA.factura;

// mime: desde oct 2026 la factura también puede ser una foto subida desde el panel.
async function adjuntarPdf(ruta, purchaseId, base64, nombreArchivo, mime = 'application/pdf') {
  const form = new FormData();
  const esPdf = mime === 'application/pdf';
  form.append('file', new Blob([Buffer.from(esPdf ? limpiarPdfBase64(base64) : base64, 'base64')], { type: mime }), nombreArchivo || (esPdf ? 'factura.pdf' : 'factura.jpg'));
  const r = await fetch(`https://api.holded.com/api/v2${ruta}/${purchaseId}/attachments`, {
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
// correccion: {fecha?, vencimiento?} del contable (holded_sync_compras.correccion),
// sustituye a lo leído del PDF.
async function comprobarFactura(f, { releer = false, correccion = null } = {}) {
  // 1) Lectura única guardada en Supabase (solo se lee el PDF si no la hay o se pide releer)
  let pdf = null;
  let ex = releer ? null : await lecturaGuardada(f.fileId);
  if (!ex) {
    pdf = await appsScript.archivo(f.fileId); // { base64, mime }: Supabase, o Drive si es antigua sin copiar
    ex = await leerYGuardar({ fileId: f.fileId, proveedor: f.proveedor, nombreArchivo: f.nombreArchivo, base64: pdf.base64, mime: pdf.mime });
  }
  if (correccion) {
    ex = { ...ex };
    if (correccion.fecha) ex.fecha = correccion.fecha;
    if ('vencimiento' in correccion) ex.vencimiento = correccion.vencimiento || null;
  }
  // Abono: el PDF puede traer los importes en negativo; se trabaja en positivo
  // (en Holded la devolución de compra ya le da la vuelta).
  if (ex.es_rectificativa) {
    const abs = n => n == null ? n : Math.abs(Number(n) || 0);
    ex = { ...ex, total: abs(ex.total), retencion_importe: abs(ex.retencion_importe), lineas_iva: (ex.lineas_iva || []).map(l => ({ ...l, base: abs(l.base), cuota: abs(l.cuota) })) };
  }
  const nif = normalizarNif(ex.nif);
  const baseTotal = r2((ex.lineas_iva || []).reduce((s, l) => s + Number(l.base || 0), 0));
  const cuotaTotal = r2((ex.lineas_iva || []).reduce((s, l) => s + Number(l.cuota || 0), 0));
  const datos = { nif, numero: ex.numero, fecha: ex.fecha || null, total: r2(ex.total) };
  const fallo = motivo => ({ ok: false, motivo, datos, ex });

  // 2) Comprobaciones
  if (ex.fecha && ex.fecha <= h.FECHA_CORTE) return fallo(`Factura del ${ex.fecha}: anterior al corte (${h.FECHA_CORTE}), va en el saldo inicial de Sage`);
  if ((ex.moneda || 'EUR').toUpperCase() !== 'EUR') return fallo(`Factura en ${ex.moneda}: registrar a mano`);
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
  // Sin cuenta habitual: si en Sage este NIF siempre fue a la misma cuenta, se
  // toma esa (solo propuesta: el contable la confirma al aprobar).
  if (!prov.cuenta_gasto) {
    const hist = (await historicoSage([nif]))[nif];
    if (hist && hist.cuentas.length === 1) {
      prov.cuenta_gasto = hist.cuentas[0].cuenta;
      await supabase.from('holded_proveedores').update({ cuenta_gasto: prov.cuenta_gasto, actualizado_por: 'histórico Sage', actualizado_en: new Date().toISOString() }).eq('proveedor', f.proveedor);
    }
  }

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
  // Solo se vuelcan facturas YA PAGADAS (decidido por el usuario 9 oct 2026):
  // lo marca la columna "Forma de pago" de Facturas Proveedores, que se rellena
  // al pagar. Vacía = pendiente de pago: espera, no pasa a "por aprobar".
  if (!String(f.formaPago || '').trim()) {
    await guardar({ ...base, numero: f.numero || null, total: f.total || null, fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(f.fecha || '')) ? f.fecha : null, estado: 'pendiente_pago', error: 'Pendiente de asignar pago (sin forma de pago en Facturas Proveedores)' });
    return { estado: 'pendiente_pago' };
  }
  const c = await comprobarFactura(f, { releer, correccion: previa ? previa.correccion : null });
  if (!c.ok) {
    await guardar({ ...base, ...c.datos, extraccion: c.ex || null, estado: 'bloqueada', error: c.motivo });
    return { estado: 'bloqueada', motivo: c.motivo };
  }
  // La cuenta elegida a mano para esta factura (si la hubo) se respeta.
  await guardar({ ...base, ...c.datos, extraccion: c.ex, estado: 'por_aprobar', error: null, cuenta_gasto: previa ? previa.cuenta_gasto : null, forma_pago: String(f.formaPago).trim() });
  return { estado: 'por_aprobar' };
}

// El contable acepta la factura en ORUM Central → compra APROBADA en Holded
// con la cuenta elegida y el PDF adjunto. guardarHabitual: la cuenta pasa a
// ser también la habitual del proveedor.
// fecha / vencimiento (YYYY-MM-DD): corrección del contable si la lectura del
// PDF se equivocó; sustituyen a los leídos solo para esta factura.
// Una misma factura no se puede estar aceptando dos veces a la vez (doble
// clic o dos personas): crearía dos compras en Holded.
// Líneas del reparto → líneas de la compra de Holded. Cada línea: {tipo,
// cuenta, importe}; amortización/seguro sin cuenta = contrato nuevo (se crean).
const CONCEPTO_REPARTO = { amortizacion: 'Amortización leasing', intereses: 'Intereses leasing', seguro: 'Seguro leasing', otros: 'Otros' };
async function prepararReparto(reparto, c, ex, usuario) {
  if (c.lineas.length !== 1) return { motivo: 'Solo se puede repartir en varias cuentas una factura con un único tipo de IVA' };
  const base = r2(c.lineas[0].price);
  const lineas = reparto.map(l => ({ tipo: CONCEPTO_REPARTO[l.tipo] ? l.tipo : 'otros', cuenta: Number(String(l.cuenta || '').replace(/\D/g, '')) || null, importe: r2(Number(String(l.importe).replace(',', '.'))) }))
    .filter(l => l.importe);
  if (!lineas.length) return { motivo: 'El reparto está vacío' };
  if (lineas.some(l => !(l.importe > 0))) return { motivo: 'Los importes del reparto tienen que ser positivos' };
  const suma = r2(lineas.reduce((s, l) => s + l.importe, 0));
  if (Math.abs(suma - base) > 0.005) return { motivo: `El reparto suma ${suma} € y la base de la factura es ${base} €` };
  const prop = repartoPropuesto(ex);
  if (lineas.some(l => !l.cuenta && (l.tipo === 'amortizacion' || l.tipo === 'seguro'))) {
    try {
      const lz = await cuentasLeasing(prop ? prop.contrato : '', prop ? prop.bien : '', usuario);
      lineas.forEach(l => { if (!l.cuenta && l.tipo === 'amortizacion') l.cuenta = lz.cuenta_amortizacion; if (!l.cuenta && l.tipo === 'seguro') l.cuenta = lz.cuenta_seguro; });
    } catch (e) { return { motivo: `No se han podido crear las cuentas del leasing: ${e.message}` }; }
  }
  const sinCuenta = lineas.find(l => !l.cuenta);
  if (sinCuenta) return { motivo: `Falta la cuenta de la línea «${CONCEPTO_REPARTO[sinCuenta.tipo]}»` };
  const d = await h.holded('GET', '/accounting-accounts?include_empty=true');
  const idPorNumero = {};
  ((d && (d.items || d.data || d)) || []).forEach(a => { idPorNumero[Number(a.number || a.num)] = a.id; });
  const plan = await planConLeasing();
  for (const l of lineas) {
    if (idPorNumero[l.cuenta]) continue;
    const enPlan = plan.find(x => x.numero === l.cuenta);
    if (!enPlan) return { motivo: `La cuenta ${l.cuenta} no existe en Holded` };
    try { idPorNumero[l.cuenta] = (await crearCuentaHolded(l.cuenta, enPlan.nombre)).id; }
    catch (e) { return { motivo: `La cuenta ${l.cuenta} no existe en Holded y no se ha podido crear: ${e.message}` }; }
  }
  const sufijo = prop && prop.contrato ? ` ${prop.contrato}` : '';
  const items = lineas.map(l => ({ name: CONCEPTO_REPARTO[l.tipo] + (l.tipo === 'otros' ? '' : sufijo), units: 1, price: l.importe, taxes: c.lineas[0].taxes, account: idPorNumero[l.cuenta] }));
  // Cuenta "principal" para el listado: la de mayor importe del grupo 6 (o la mayor).
  const g6 = lineas.filter(l => String(l.cuenta).startsWith('6'));
  const principal = (g6.length ? g6 : lineas).reduce((a, b) => b.importe > a.importe ? b : a);
  return { items, lineas, cuentaPrincipal: principal.cuenta };
}

const aceptando = new Set();
async function aceptar(fileId, opciones = {}, usuario) {
  const k = String(fileId);
  if (aceptando.has(k)) return { estado: 'en_curso', motivo: 'Esta factura ya se está volcando a Holded' };
  aceptando.add(k);
  try { return await aceptarUna(k, opciones, usuario); }
  finally { aceptando.delete(k); }
}
// pagoFecha / pagoTesoreria: el pago se registra en Holded al aceptar (solo
// se vuelcan facturas pagadas); la fecha la elige el contable y la tesorería
// sale de la forma de pago (efectivo/otro: la elige el contable).
async function aceptarUna(fileId, { cuenta, guardarHabitual = false, fecha, vencimiento, pagoFecha, pagoTesoreria, reparto } = {}, usuario) {
  const { data: fila } = await supabase.from('holded_sync_compras').select('*').eq('file_id', String(fileId)).maybeSingle();
  if (!fila) return { estado: 'error', motivo: 'Factura no encontrada' };
  if (fila.holded_purchase_id) return { estado: fila.estado, motivo: 'Ya estaba volcada en Holded' };
  if (fila.estado !== 'por_aprobar') return { estado: fila.estado, motivo: fila.error || 'La factura no está lista para aprobar' };
  const f = (await facturasSheet()).find(x => x.fileId === String(fileId));
  if (!f) return { estado: 'error', motivo: 'Esa factura ya no está en la Sheet de proveedores' };
  if (!String(f.formaPago || '').trim()) {
    await guardar({ file_id: f.fileId, proveedor: f.proveedor, nombre_archivo: f.nombreArchivo, estado: 'pendiente_pago', error: 'Sin forma de pago en Facturas Proveedores: pendiente de pago' });
    return { estado: 'pendiente_pago', motivo: 'Esta factura no tiene forma de pago en Facturas Proveedores: está pendiente de pago y no se vuelca' };
  }

  // Corrección de fecha / vencimiento del contable: se guarda en la factura
  // para que la preparación diaria no vuelva a la fecha mal leída.
  const esFecha = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const correccion = { ...(fila.correccion || {}) };
  if (esFecha(fecha)) correccion.fecha = fecha;
  if (vencimiento === '' || vencimiento === null) correccion.vencimiento = null;
  else if (esFecha(vencimiento)) correccion.vencimiento = vencimiento;
  const hayCorreccion = Object.keys(correccion).length > 0;
  if (hayCorreccion) await supabase.from('holded_sync_compras').update({ correccion }).eq('file_id', f.fileId);

  // Se vuelve a comprobar todo: la ficha o la lectura pueden haber cambiado.
  const c = await comprobarFactura(f, { correccion: hayCorreccion ? correccion : null });
  if (!c.ok) {
    await guardar({ file_id: f.fileId, proveedor: f.proveedor, nombre_archivo: f.nombreArchivo, ...c.datos, estado: 'bloqueada', error: c.motivo });
    return { estado: 'bloqueada', motivo: c.motivo };
  }
  const ex = c.ex;
  if (!ex.fecha) return { estado: 'por_aprobar', motivo: 'Falta la fecha de la factura' };
  if (ex.vencimiento && ex.vencimiento < ex.fecha) return { estado: 'por_aprobar', motivo: `El vencimiento (${ex.vencimiento}) es anterior a la fecha de la factura (${ex.fecha}): corrígelo o déjalo vacío` };
  // Pago: fecha y tesorería obligatorias (se comprueba antes de crear nada).
  if (!esFecha(pagoFecha)) return { estado: 'por_aprobar', motivo: 'Indica la fecha en que se pagó' };
  const tesoreriaPago = pagoTesoreria || TESORERIA_POR_FORMA[String(f.formaPago).trim()];
  if (!TESORERIAS_PAGO.some(t => t.key === tesoreriaPago)) return { estado: 'por_aprobar', motivo: 'Elige desde dónde se pagó (banco o caja)' };
  const treasuryId = await h.tesoreriaDeMetodo(tesoreriaPago);
  if (!treasuryId) return { estado: 'por_aprobar', motivo: `La tesorería ${tesoreriaPago} no está enlazada con Holded` };
  let numCuenta, items, repartoFinal = null;
  if (Array.isArray(reparto) && reparto.length) {
    // Reparto en varias cuentas (leasing): mismo IVA en todas las líneas.
    const r = await prepararReparto(reparto, c, ex, usuario);
    if (r.motivo) return { estado: 'por_aprobar', motivo: r.motivo };
    items = r.items; numCuenta = r.cuentaPrincipal; repartoFinal = r.lineas;
  } else {
    numCuenta = Number(cuenta || fila.cuenta_gasto || c.prov.cuenta_gasto);
    if (!numCuenta) return { estado: 'por_aprobar', motivo: 'Elige la cuenta de gasto' };
    const enPlan = (await planConLeasing()).find(x => x.numero === numCuenta);
    if (!enPlan) return { estado: 'por_aprobar', motivo: `La cuenta ${numCuenta} no está en el plan de cuentas (Config. Cuentas de gasto)` };
    let enHolded = (await cuentasHolded()).find(x => x.numero === numCuenta);
    if (!enHolded) {
      try { enHolded = await crearCuentaHolded(numCuenta, enPlan.nombre); }
      catch (e) { return { estado: 'por_aprobar', motivo: `La cuenta ${numCuenta} ${enPlan.nombre} no existe en Holded y no se ha podido crear: ${e.message}` }; }
    }
    items = c.lineas.map(l => ({ ...l, account: enHolded.id }));
    if (guardarHabitual) await supabase.from('holded_proveedores').update({ cuenta_gasto: numCuenta, actualizado_por: usuario, actualizado_en: new Date().toISOString() }).eq('proveedor', f.proveedor);
  }

  const contacto = await contactoProveedor(c.nif, c.prov.nombre_fiscal || ex.emisor_nombre || f.proveedor);
  if (c.prov.holded_contact_id !== contacto.id) await supabase.from('holded_proveedores').update({ holded_contact_id: contacto.id }).eq('proveedor', f.proveedor);
  const ruta = rutaDe(ex), esAbono = ruta === RUTA_COMPRA.abono;
  const notas = [esAbono ? 'ABONO DE PROVEEDOR' : null, `Desde ORUM Central (Drive: ${f.nombreArchivo})`, `Aprobada por ${usuario}`, f.formaPago ? `Forma de pago: ${f.formaPago}` : null, f.reparto.length ? `Reparto: ${f.reparto.join(', ')}` : null, ex.dudas ? `Dudas de la lectura: ${ex.dudas}` : null].filter(Boolean).join(' · ');
  const payload = { contact_id: contacto.id, date: ex.fecha, number: ex.numero, items, notes: notas };
  if (ex.vencimiento) payload.due_date = ex.vencimiento;
  const base = { file_id: f.fileId, proveedor: f.proveedor, nombre_archivo: f.nombreArchivo, ...c.datos, cuenta_gasto: numCuenta, reparto: repartoFinal, aprobado_por: usuario, aprobado_en: new Date().toISOString() };

  let creada;
  try {
    creada = await h.holded('POST', ruta, payload);
  } catch (e) {
    await guardar({ ...base, estado: 'por_aprobar', error: `Holded rechazó ${esAbono ? 'el abono' : 'la compra'}: ${e.message}`, payload, respuesta: e.respuesta || null });
    return { estado: 'error', motivo: e.message };
  }
  const id = creada && (creada.id || (creada.data && creada.data.id));
  if (!id) {
    await guardar({ ...base, estado: 'por_aprobar', error: 'Holded no devolvió id de compra', payload, respuesta: creada });
    return { estado: 'error', motivo: 'Holded no devolvió id de compra' };
  }
  const avisos = [];
  let estado = 'aprobada';
  try { await h.holded('POST', `${ruta}/${id}/approve`); }
  catch (e) { estado = 'borrador'; avisos.push(`Creada en borrador, no se pudo aprobar: ${e.message}`); }
  try {
    const pdf = c.pdf || await appsScript.archivo(f.fileId);
    await adjuntarPdf(ruta, id, pdf.base64, f.nombreArchivo, pdf.mime);
  } catch (e) { avisos.push(`No se pudo adjuntar el PDF: ${e.message}`); }
  // Pago (la compra entra ya pagada). Se paga el total que ha calculado
  // Holded: si por redondeo del IVA difiere en céntimos del de la factura, se
  // avisa (si se pagara el de la factura quedaría ese céntimo pendiente).
  let pagoOk = false;
  if (estado === 'aprobada') {
    try {
      const doc = await h.holded('GET', `${ruta}/${id}`);
      const d = (doc && (doc.data || doc)) || {};
      const totalHolded = r2(Math.abs(h.numHolded(d.total)));
      const importe = isFinite(totalHolded) && totalHolded > 0 ? totalHolded : r2(ex.total);
      if (Math.abs(importe - r2(ex.total)) >= 0.01) avisos.push(`Holded calculó ${importe} € y la factura es de ${r2(ex.total)} € (redondeo del IVA): se ha pagado ${importe} €`);
      // En un abono es el cobro de la devolución, también en positivo sobre el propio abono.
      await h.holded('POST', `${ruta}/${id}/payments`, { amount: importe, treasury_id: treasuryId, date: pagoFecha, description: `${esAbono ? 'Devolución' : 'Pago'} ${f.formaPago} · ${f.proveedor} ${ex.numero || ''}`.trim() });
      pagoOk = true;
    } catch (e) { avisos.push(`${esAbono ? 'Abono aprobado' : 'Compra aprobada'}, pero no se pudo registrar el ${esAbono ? 'cobro de la devolución' : 'pago'}: ${e.message}`); }
  } else avisos.push('El pago no se ha registrado porque la compra quedó en borrador');
  // Facturas Proveedores: casilla «Contabilizada» marcada al quedar aprobada en
  // Holded (19 nov 2026), en todas las filas (periodos) de la factura; queda en
  // su historial con el nombre de quien aceptó.
  if (estado === 'aprobada') {
    try {
      for (const fila of f.filas) {
        const d = await appsScript.datos.actualizarCampo(fila, 'contabilizada', true, `${usuario} (al aceptar en Holded)`);
        if (d && d.error) throw new Error(d.error);
      }
    } catch (e) { avisos.push(`No se pudo marcar «Contabilizada» en Facturas Proveedores: ${e.message}`); }
  }
  const aviso = avisos.join(' · ') || null;
  await guardar({ ...base, estado, holded_purchase_id: id, payload, respuesta: creada, error: aviso, forma_pago: String(f.formaPago).trim(), pago_fecha: pagoOk ? pagoFecha : null, pago_tesoreria: pagoOk ? tesoreriaPago : null });
  return { estado, holded_purchase_id: id, aviso, pagada: pagoOk, abono: esAbono };
}

// Prepara todas las facturas de gastos posteriores al corte que falten (las
// deja por aprobar o bloqueadas). No envía nada a Holded.
let volcando = false;
async function volcarGastos({ origen = 'auto-gastos', usuario = null } = {}) {
  if (volcando) return { ok: false, motivo: 'Ya hay una preparación de gastos en marcha' };
  volcando = true;
  const hasta = h.ayerMadrid();
  const { data: ej } = await supabase.from('holded_sync_ejecuciones').insert({ origen, usuario, hasta_fecha: hasta }).select('id').single();
  const resumen = { compras_por_aprobar: 0, compras_bloqueadas: 0, compras_pendientes_pago: 0, compras_error: 0, errores: [] };
  try {
    const facturas = (await facturasSheet()).filter(f => !f.fecha || (f.fecha > h.FECHA_CORTE));
    const { data: hechas } = await supabase.from('holded_sync_compras').select('file_id,holded_purchase_id');
    const yaEnviadas = new Set((hechas || []).filter(x => x.holded_purchase_id).map(x => x.file_id));
    for (const f of facturas.filter(x => !yaEnviadas.has(x.fileId))) {
      try {
        const r = await procesarFactura(f);
        if (r.estado === 'por_aprobar') resumen.compras_por_aprobar++;
        else if (r.estado === 'bloqueada') resumen.compras_bloqueadas++;
        else if (r.estado === 'pendiente_pago') resumen.compras_pendientes_pago++;
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

// "Asignar pago" desde /holded.html: pone la forma de pago en todas las filas
// de la factura en Facturas Proveedores (misma acción del Apps Script que usa
// el listado, actualizarCampo) y la prepara al momento: pasa a "por aprobar".
const FORMAS_PAGO_FACTURA = ['Transferencia', 'Tarjeta', 'Domiciliación', 'Efectivo', 'Otro'];
// Tesorería de Holded desde la que se registra el pago de la compra al
// aceptarla (decidido por el usuario 9 oct 2026): transferencia, domiciliación
// → Banco; efectivo → caja de Marbella o de Monda, la elige el contable;
// "Otro" → la elige el contable. La clave es la de h.TESORERIAS.
// 19 nov 2026 (usuario): tarjeta de empresa → 55500001 «Tarjeta empresa»; a
// fin de mes, cuando el banco carga la tarjeta, se pasa a mano al banco
// (asiento 55500001 D / 57200001 H).
const TESORERIAS_PAGO = [
  { key: 'transferencia', nombre: 'Banco (57200001)' },
  { key: 'tarjeta-empresa', nombre: 'Tarjeta empresa (55500001)' },
  { key: 'efectivo-marbella', nombre: 'Efectivo Marbella (57000100)' },
  { key: 'efectivo-monda', nombre: 'Efectivo Monda (57000200)' },
];
const TESORERIA_POR_FORMA = { 'Transferencia': 'transferencia', 'Domiciliación': 'transferencia', 'Tarjeta': 'tarjeta-empresa' };
async function asignarFormaPago(fileId, formaPago, usuario) {
  if (!FORMAS_PAGO_FACTURA.includes(formaPago)) throw new Error('Forma de pago no válida');
  const f = (await facturasSheet()).find(x => x.fileId === String(fileId));
  if (!f) return { estado: 'error', motivo: 'Esa factura ya no está en la Sheet de proveedores' };
  if (!f.filas.length) return { estado: 'error', motivo: 'No se ha encontrado la fila de la factura en la Sheet' };
  for (const fila of f.filas) {
    const d = await appsScript.datos.actualizarCampo(fila, 'formaPago', formaPago, usuario);
    if (d.error) throw new Error(`Guardar forma de pago: ${d.error}`);
  }
  return procesarFactura({ ...f, formaPago });
}

async function reintentar(fileId, { releer = false } = {}) {
  const f = (await facturasSheet()).find(x => x.fileId === String(fileId));
  if (!f) return { estado: 'error', motivo: 'Esa factura ya no está en la Sheet de proveedores' };
  return procesarFactura(f, { releer });
}

// Datos de /holded.html: por aprobar, bloqueadas y últimas volcadas.
async function estadoGastos() {
  const [{ data: filas }, { data: provs }, plan] = await Promise.all([
    supabase.from('holded_sync_compras').select('file_id,proveedor,nombre_archivo,nif,numero,fecha,total,estado,holded_purchase_id,error,cuenta_gasto,aprobado_por,aprobado_en,extraccion,actualizado_en,forma_pago,pago_fecha,pago_tesoreria').order('fecha', { ascending: true }),
    supabase.from('holded_proveedores').select('proveedor,cuenta_gasto,nombre_fiscal'),
    planConLeasing({ soloActivas: true })
  ]);
  const habitual = {};
  (provs || []).forEach(p => { habitual[p.proveedor] = p.cuenta_gasto; });
  const todas = filas || [];
  const resumenLectura = x => {
    const ex = x.extraccion || {};
    const lineas = ex.lineas_iva || [];
    return { es_abono: !!ex.es_rectificativa, concepto: ex.concepto || null, dudas: ex.dudas || null, vencimiento: ex.vencimiento || null, base: r2(lineas.reduce((s, l) => s + Number(l.base || 0), 0)), iva: r2(lineas.reduce((s, l) => s + Number(l.cuota || 0), 0)), retencion: r2(ex.retencion_importe), tipos: lineas.map(l => Number(l.tipo)) };
  };
  const sinExtraccion = ({ extraccion, ...x }) => x;
  const porAprobar = todas.filter(x => !x.holded_purchase_id && x.estado === 'por_aprobar');
  const hist = await historicoSage(porAprobar.map(x => x.nif));
  // Leasing: reparto propuesto con las cuentas del contrato (null = se creará al aceptar).
  const { data: contratos } = await supabase.from('holded_leasing').select('*');
  const porContrato = {};
  (contratos || []).forEach(c => { porContrato[c.contrato] = c; });
  const reparto = x => {
    const r = repartoPropuesto(x.extraccion);
    if (!r) return null;
    const c = porContrato[r.contrato];
    r.lineas.forEach(l => {
      if (l.tipo === 'amortizacion') l.cuenta = c ? c.cuenta_amortizacion : null;
      if (l.tipo === 'seguro') l.cuenta = c ? c.cuenta_seguro : null;
      if (l.tipo === 'otros') l.cuenta = x.cuenta_gasto || habitual[x.proveedor] || null;
    });
    r.contrato_existe = !!c;
    return r;
  };
  return {
    por_aprobar: porAprobar.map(x => ({ ...sinExtraccion(x), ...resumenLectura(x), reparto: reparto(x), cuenta_propuesta: x.cuenta_gasto || habitual[x.proveedor] || null, cuenta_habitual: habitual[x.proveedor] || null, sage: (hist[normalizarNif(x.nif)] || {}).cuentas || [], pdf_url: `/api/facturas-proveedores/${encodeURIComponent(x.file_id)}/archivo` })), // archivo en Supabase (oct 2026), antes Drive
    pendientes: todas.filter(x => !x.holded_purchase_id && !['por_aprobar', 'pendiente_pago'].includes(x.estado)).map(sinExtraccion).reverse(),
    pendientes_pago: todas.filter(x => !x.holded_purchase_id && x.estado === 'pendiente_pago').map(sinExtraccion),
    enviadas: todas.filter(x => x.holded_purchase_id).sort((a, b) => String(b.aprobado_en || b.actualizado_en).localeCompare(String(a.aprobado_en || a.actualizado_en))).slice(0, 15).map(sinExtraccion),
    total_enviadas: todas.filter(x => x.holded_purchase_id).length,
    cuentas: plan,
    formas_pago: FORMAS_PAGO_FACTURA,
    tesorerias_pago: TESORERIAS_PAGO,
    tesoreria_por_forma: TESORERIA_POR_FORMA,
    cuenta_intereses_leasing: CUENTA_INTERESES_LEASING,
    contratos_leasing: contratos || [],
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
  const hist = await historicoSage((provs || []).map(p => p.nif));
  return {
    cuentas: plan.map(c => ({ ...c, en_holded: holdedRes.lista ? enHolded.has(c.numero) : null })),
    error_holded: holdedRes.error || null,
    proveedores: (provs || []).map(p => ({ ...p, sage: (hist[normalizarNif(p.nif)] || {}).cuentas || [] })),
    opciones_iva_cero: OPCIONES_IVA_CERO, opciones_retencion: OPCIONES_RETENCION
  };
}

// Siguiente número libre de un subgrupo (20 nov 2026): «629» → la mayor 629xxxxx
// del plan de ORUM (activas o no) o de Holded, más uno. Si no hay ninguna, la
// primera del subgrupo (62900000 → se usa 62900001 si la 0 es la cabecera).
async function siguienteCuentaGasto(prefijo) {
  const p = String(prefijo || '').replace(/\D/g, '');
  if (!/^6\d{2,6}$/.test(p)) throw new Error('Escribe el principio de la cuenta: de 3 a 7 cifras empezando por 6 (p. ej. 629)');
  const usados = new Set((await planCuentas()).map(c => Number(c.numero)));
  let holded = true;
  try { (await cuentasHolded()).forEach(a => usados.add(Number(a.numero))); } catch (e) { holded = false; }
  const delGrupo = [...usados].filter(n => String(n).length === 8 && String(n).startsWith(p));
  let n = delGrupo.length ? Math.max(...delGrupo) + 1 : Number(p.padEnd(8, '0')) + 1;
  while (usados.has(n)) n++;
  if (!String(n).startsWith(p)) throw new Error(`El subgrupo ${p} está lleno`);
  const ultima = delGrupo.length ? Math.max(...delGrupo) : null;
  return { numero: n, ultima, comprobado_holded: holded };
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
  // Las activas que no estén en Holded se crean allí con el mismo número.
  const creadas_holded = [], errores_holded = [];
  try {
    const enHolded = new Set((await cuentasHolded()).map(a => a.numero));
    for (const f of filas.filter(x => x.activa && !enHolded.has(x.numero))) {
      try { await crearCuentaHolded(f.numero, f.nombre); creadas_holded.push(f.numero); }
      catch (e) { errores_holded.push(`${f.numero}: ${e.message}`); }
    }
  } catch (e) { errores_holded.push(`No se pudo consultar Holded: ${e.message}`); }
  return { ok: true, guardadas: filas.length, creadas_holded, errores_holded };
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

module.exports = { siguienteCuentaGasto, configurar, volcarGastos, reintentar, asignarFormaPago, FORMAS_PAGO_FACTURA, aceptar, estadoGastos, configCuentas, guardarCuentas, guardarProveedor, programarVolcadoGastos };
