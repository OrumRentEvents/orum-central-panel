// ================================================================
// Integración Rentman → Holded (1 oct 2026)
// ================================================================
// Rentman emite las facturas (numeración + Veri*factu); Holded solo lleva
// la contabilidad. Este módulo copia a Holded:
//   1. la factura (mismo número que en Rentman, líneas por cuenta de
//      ingresos + tipo de IVA, tal como las da /invoicelines de Rentman),
//      buscando el contacto en Holded por NIF (Rentman: contacts.VAT_code,
//      Holded: contacts.code);
//   2. sus cobros, tomando el método de pago de Caja (caja_registros), no de
//      Rentman — Rentman no guarda el método.
// Holded es una empresa de prueba hasta el 1 ene 2027: se puede probar con
// facturas reales. Las facturas aprobadas en Holded no se pueden borrar
// (solo anular), por eso por defecto se crean en BORRADOR.
//
// Idempotencia: holded_sync_facturas / holded_sync_cobros (sql/holded_sync.sql).
//
// Variables de entorno (Railway): HOLDED_API_KEY, RENTMAN_TOKEN.

const fetch = require('node-fetch');
const { supabase } = require('./supabaseSource');

const HOLDED_URL = 'https://api.holded.com/api/v2';
const RENTMAN_URL = 'https://api.rentman.net';

// Facturas emitidas hasta el 30/09/2026 están dentro del saldo inicial
// (asiento de apertura): no se envían como factura.
const FECHA_CORTE = '2026-09-30';

// Ledger de Rentman (id) → cuenta de ingresos de Holded. `account` de una
// línea de Holded es el ID interno de la cuenta, no su número.
// PROVISIONAL: todo a 70500000 Prestaciones de servicios hasta saber qué
// subcuentas usaba Sage para cada concepto.
const CUENTA_705 = { numero: 70500000, id: '6abcddeed4d0ef5edb08be32' };
const LEDGERS = {
  1:  { nombre: 'Alquiler',   cuenta: CUENTA_705 },
  3:  { nombre: 'Personal',   cuenta: CUENTA_705 },
  4:  { nombre: 'Transporte', cuenta: CUENTA_705 },
  14: { nombre: 'Transporte', cuenta: CUENTA_705 },
  15: { nombre: 'Extras',     cuenta: CUENTA_705 },
};

// Tipo de IVA de Rentman (vatrate) → impuesto de Holded. El 0 % es ambiguo
// (exento / intracomunitario / exportación): se bloquea hasta revisarlo.
const IVA = { '0.21': 's_iva_21', '0.1': 's_iva_10', '0.04': 's_iva_4' };

// Método de pago de Caja → cuenta de tesorería (tabla del proceso Sage).
// `tesoreria_id` = ID de la cuenta de banco/caja en Holded (Tesorería);
// Creadas el 1 oct 2026. `cuenta` = número que Holded les asignó (los TPV
// quedaron en 52000001/52000002, no en 52000100/52000200 como en Sage).
// Sin ID, el cobro no se envía.
const TESORERIAS = {
  'tpv-marbella':      { cuenta: 52000001, tesoreria_id: '6abe6cdb978446b3660046b4' },
  'tpv-monda':         { cuenta: 52000002, tesoreria_id: '6abe6cee92c4b1aaea014b0d' },
  'transferencia':     { cuenta: 57200001, tesoreria_id: '6abe6d2d540b8e7b650290f6' },
  'efectivo-marbella': { cuenta: 57000100, tesoreria_id: '6abe6d45a16a1dd70a01e140' },
  'efectivo-monda':    { cuenta: 57000200, tesoreria_id: '6abe6d67aaac22d4190dd687' },
};
// Sin cuenta todavía (pendiente de decidir con la gestoría): fianzas
// aplicadas (560/180 contra 430) y factura0/rectificativa (compensaciones).
const METODOS_SIN_CUENTA = ['fianza-efectivo-marbella', 'fianza-efectivo-monda', 'fianza-transferencia', 'factura0', 'rectificativa'];

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const idDeLink = link => link ? parseInt(String(link).split('/').pop(), 10) : null;

async function rentman(path) {
  const token = process.env.RENTMAN_TOKEN;
  if (!token) throw new Error('Falta RENTMAN_TOKEN en Railway');
  const r = await fetch(RENTMAN_URL + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Rentman ${path} devolvió ${r.status}`);
  return r.json();
}

async function holded(method, path, body) {
  const key = process.env.HOLDED_API_KEY;
  if (!key) throw new Error('Falta HOLDED_API_KEY en Railway');
  const r = await fetch(HOLDED_URL + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const texto = await r.text();
  let data; try { data = texto ? JSON.parse(texto) : null; } catch (e) { data = { raw: texto }; }
  if (!r.ok) {
    const err = new Error(`Holded ${method} ${path} devolvió ${r.status}: ${texto.slice(0, 500)}`);
    err.respuesta = data;
    throw err;
  }
  return data;
}

async function buscarContactoHolded(nif) {
  if (!nif) return null;
  const data = await holded('GET', `/contacts?code=${encodeURIComponent(nif)}&limit=5`);
  const items = (data && data.items) || [];
  return items[0] || null;
}

// Lee la factura de Rentman y monta lo que se enviaría a Holded, con una
// lista de avisos (bloqueantes o no). No envía nada.
async function prepararFactura(numero) {
  const avisos = []; // { nivel: 'error' | 'aviso', texto }
  const lista = await rentman(`/invoices?number=${encodeURIComponent(numero)}`);
  const inv = (lista.data || [])[0];
  if (!inv) throw new Error(`No existe la factura ${numero} en Rentman`);

  const fecha = String(inv.date || '').slice(0, 10);
  if (fecha <= FECHA_CORTE) avisos.push({ nivel: 'error', texto: `Factura del ${fecha}: anterior al corte (${FECHA_CORTE}), ya está en el saldo inicial` });
  if (inv.invoicetype !== 'F') avisos.push({ nivel: 'error', texto: `Tipo "${inv.invoicetype}" (rectificativa): todavía no soportado` });

  const lineasR = (await rentman(`/invoices/${inv.id}/invoicelines`)).data || [];
  const items = [];
  lineasR.forEach(l => {
    const ledgerId = idDeLink(l.ledger);
    const ledger = LEDGERS[ledgerId];
    const base = r2((l.priceincl || 0) - (l.vatamount || 0));
    const tax = IVA[String(Number(l.vatrate))];
    if (!ledger) avisos.push({ nivel: 'error', texto: `Línea con ledger ${ledgerId} sin cuenta de ingresos asignada` });
    if (!tax) avisos.push({ nivel: 'error', texto: `IVA ${r2((l.vatrate || 0) * 100)} % sin equivalente en Holded (revisar si es exento / intracomunitario / exportación)` });
    if (base === 0) return;
    items.push({
      name: ledger ? ledger.nombre : `Ledger ${ledgerId}`,
      units: 1,
      price: base,
      taxes: tax ? [tax] : [],
      account: ledger ? ledger.cuenta.id : null,
      _cuenta: ledger ? ledger.cuenta.numero : null,
      _iva: r2(l.vatamount)
    });
  });

  const baseTotal = r2(items.reduce((s, i) => s + i.price, 0));
  const ivaTotal = r2(items.reduce((s, i) => s + i._iva, 0));
  const totalRentman = r2(inv.price_invat);
  if (Math.abs(baseTotal + ivaTotal - totalRentman) > 0.02) {
    avisos.push({ nivel: 'aviso', texto: `Suma de líneas ${r2(baseTotal + ivaTotal)} € ≠ total Rentman ${totalRentman} €` });
  }

  // Contacto: NIF de Rentman → Holded
  const customerId = idDeLink(inv.customer);
  const contactoR = customerId ? (await rentman(`/contacts/${customerId}`)).data : null;
  const nif = contactoR && contactoR.VAT_code ? String(contactoR.VAT_code).trim().toUpperCase().replace(/[\s.-]/g, '') : '';
  let contactoH = null;
  if (!nif) avisos.push({ nivel: 'error', texto: 'El cliente no tiene NIF en Rentman' });
  else {
    contactoH = await buscarContactoHolded(nif);
    if (!contactoH) avisos.push({ nivel: 'error', texto: `No hay contacto en Holded con NIF ${nif} (crearlo antes en Holded)` });
  }

  const ya = await supabase.from('holded_sync_facturas').select('*').eq('rentman_invoice_id', inv.id).maybeSingle();
  if (ya.data && ya.data.holded_invoice_id) avisos.push({ nivel: 'error', texto: `Ya enviada a Holded (${ya.data.estado}, id ${ya.data.holded_invoice_id})` });

  const payload = {
    contact_id: contactoH ? contactoH.id : null,
    date: fecha,
    number: String(inv.number),
    items: items.map(({ _cuenta, _iva, ...i }) => i)
  };

  return {
    rentman: { id: inv.id, numero: inv.number, fecha, tipo: inv.invoicetype, base: r2(inv.price), iva: r2(inv.vat_amount), total: totalRentman, finalizada: !!inv.finalized },
    cliente: { rentman_id: customerId, nombre: contactoR ? contactoR.name : null, nif, holded_id: contactoH ? contactoH.id : null, holded_nombre: contactoH ? contactoH.name : null, cuenta: contactoH && contactoH.client_record ? contactoH.client_record.num : null },
    lineas: items.map(i => ({ concepto: i.name, cuenta: i._cuenta, base: i.price, iva: i.taxes[0] || null, cuota_iva: i._iva })),
    totales: { base: baseTotal, iva: ivaTotal, total: r2(baseTotal + ivaTotal) },
    sync: ya.data || null,
    payload,
    avisos,
    se_puede_enviar: !avisos.some(a => a.nivel === 'error')
  };
}

async function guardarSync(fila) {
  const { error } = await supabase.from('holded_sync_facturas').upsert({ ...fila, actualizado_en: new Date().toISOString() });
  if (error) console.error('[Holded] guardando holded_sync_facturas:', error.message);
}

// Crea la factura en Holded (borrador) y, si `aprobar`, la aprueba.
async function enviarFactura(numero, { aprobar = false } = {}) {
  const prev = await prepararFactura(numero);
  if (!prev.se_puede_enviar) return { ok: false, motivo: 'Hay errores en la vista previa', vista: prev };
  const base = { rentman_invoice_id: prev.rentman.id, numero: String(prev.rentman.numero), holded_contact_id: prev.cliente.holded_id, payload: prev.payload };
  let creada;
  try {
    creada = await holded('POST', '/invoices', prev.payload);
  } catch (e) {
    await guardarSync({ ...base, estado: 'error', error: e.message, respuesta: e.respuesta || null });
    return { ok: false, motivo: e.message };
  }
  const holdedId = creada && (creada.id || (creada.data && creada.data.id));
  await guardarSync({ ...base, holded_invoice_id: holdedId, estado: 'borrador', respuesta: creada, error: null });
  if (!holdedId) return { ok: false, motivo: 'Holded no devolvió id de factura', respuesta: creada };
  if (aprobar) return aprobarFactura(prev.rentman.id);
  return { ok: true, estado: 'borrador', holded_invoice_id: holdedId, respuesta: creada };
}

async function aprobarFactura(rentmanInvoiceId) {
  const { data: fila } = await supabase.from('holded_sync_facturas').select('*').eq('rentman_invoice_id', rentmanInvoiceId).maybeSingle();
  if (!fila || !fila.holded_invoice_id) return { ok: false, motivo: 'La factura no está creada en Holded' };
  try {
    const resp = await holded('POST', `/invoices/${fila.holded_invoice_id}/approve`);
    await guardarSync({ ...fila, estado: 'aprobada', respuesta: resp, error: null });
    return { ok: true, estado: 'aprobada', holded_invoice_id: fila.holded_invoice_id, respuesta: resp };
  } catch (e) {
    await guardarSync({ ...fila, error: e.message });
    return { ok: false, motivo: e.message };
  }
}

// Cobros de Caja de una factura (por número), con la cuenta a la que irían.
async function prepararCobros(numero) {
  const { data: pagos, error } = await supabase.from('pagos').select('pago_id,factura_id,numero_factura,importe,fecha_pago_ts').eq('numero_factura', parseInt(numero, 10));
  if (error) throw error;
  const ids = (pagos || []).map(p => p.pago_id);
  const { data: regs } = ids.length ? await supabase.from('caja_registros').select('pago_id,split_idx,metodo_pago,importe,fecha_pago_ts').in('pago_id', ids) : { data: [] };
  const { data: enviados } = ids.length ? await supabase.from('holded_sync_cobros').select('*').in('pago_id', ids) : { data: [] };
  const filas = [];
  (pagos || []).forEach(p => {
    const lineas = (regs || []).filter(r => r.pago_id === p.pago_id);
    if (!lineas.length) {
      filas.push({ pago_id: p.pago_id, split_idx: 1, importe: r2(p.importe), fecha: String(p.fecha_pago_ts || '').slice(0, 10), metodo: null, cuenta: null, estado: 'sin_clasificar', motivo: 'Sin método en Caja' });
      return;
    }
    lineas.forEach(l => {
      const t = TESORERIAS[l.metodo_pago];
      const env = (enviados || []).find(e => e.pago_id === l.pago_id && e.split_idx === (l.split_idx || 1));
      let estado = 'listo', motivo = null;
      if (env && env.estado === 'enviado') { estado = 'enviado'; }
      else if (METODOS_SIN_CUENTA.includes(l.metodo_pago)) { estado = 'sin_cuenta'; motivo = 'Método sin cuenta decidida (fianza / compensación)'; }
      else if (!t) { estado = 'sin_cuenta'; motivo = `Método "${l.metodo_pago}" desconocido`; }
      else if (!t.tesoreria_id) { estado = 'sin_tesoreria'; motivo = `Falta crear la tesorería ${t.cuenta} en Holded`; }
      filas.push({ pago_id: l.pago_id, split_idx: l.split_idx || 1, importe: r2(l.importe), fecha: String(l.fecha_pago_ts || p.fecha_pago_ts || '').slice(0, 10), metodo: l.metodo_pago, cuenta: t ? t.cuenta : null, estado, motivo });
    });
  });
  return filas;
}

// Envía a Holded los cobros "listo" de una factura ya creada en Holded.
async function enviarCobros(numero) {
  const lista = await rentman(`/invoices?number=${encodeURIComponent(numero)}`);
  const inv = (lista.data || [])[0];
  if (!inv) return { ok: false, motivo: `No existe la factura ${numero} en Rentman` };
  const { data: fila } = await supabase.from('holded_sync_facturas').select('*').eq('rentman_invoice_id', inv.id).maybeSingle();
  if (!fila || fila.estado !== 'aprobada') return { ok: false, motivo: 'La factura tiene que estar creada y aprobada en Holded antes de enviar cobros' };
  const cobros = await prepararCobros(numero);
  const resultados = [];
  for (const c of cobros.filter(x => x.estado === 'listo')) {
    const body = { amount: c.importe, treasury_id: TESORERIAS[c.metodo].tesoreria_id, date: c.fecha, description: `Cobro Rentman pago ${c.pago_id}` };
    const base = { pago_id: c.pago_id, split_idx: c.split_idx, rentman_invoice_id: inv.id, numero_factura: String(numero), metodo_pago: c.metodo, importe: c.importe, fecha: c.fecha, actualizado_en: new Date().toISOString() };
    try {
      const resp = await holded('POST', `/invoices/${fila.holded_invoice_id}/payments`, body);
      await supabase.from('holded_sync_cobros').upsert({ ...base, estado: 'enviado', holded_ref: resp && (resp.id || null), respuesta: resp, error: null });
      resultados.push({ ...c, estado: 'enviado' });
    } catch (e) {
      await supabase.from('holded_sync_cobros').upsert({ ...base, estado: 'error', error: e.message, respuesta: e.respuesta || null });
      resultados.push({ ...c, estado: 'error', motivo: e.message });
    }
  }
  return { ok: !resultados.some(r => r.estado === 'error'), resultados };
}

module.exports = { prepararFactura, enviarFactura, aprobarFactura, prepararCobros, enviarCobros, FECHA_CORTE };
