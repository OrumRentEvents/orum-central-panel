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

// ── CONFIGURACIÓN DE LA EMPRESA DE HOLDED ─────────────────────────
// La empresa actual de Holded es DE PRUEBA (hasta el 1 ene 2027); la
// definitiva será otra. Al cambiar de empresa hay que:
//   1. cambiar HOLDED_API_KEY en Railway por la de la empresa definitiva;
//   2. revisar HOLDED_FECHA_CORTE (fecha del asiento de apertura definitivo);
//   3. actualizar los IDs de CUENTA_INGRESOS y TESORERIAS de abajo (cambian en
//      cada empresa; los números de cuenta no);
//   4. vaciar holded_sync_facturas, holded_sync_cobros y
//      holded_sync_ejecuciones (si no, creería que ya está todo enviado).
// Facturas emitidas hasta esta fecha están dentro del saldo inicial
// (asiento de apertura): no se envían como factura.
const FECHA_CORTE = process.env.HOLDED_FECHA_CORTE || '2026-09-30';

// Ledger de Rentman (id) → cuenta de ingresos de Holded. `account` de una
// línea de Holded es el ID interno de la cuenta, no su número.
// Decidido 2 oct 2026: todos los conceptos a 70500000 Prestaciones de
// servicios (en Sage se usaba 70000001).
const CUENTA_INGRESOS = { numero: 70500000, id: '6abcddeed4d0ef5edb08be32' };
const LEDGERS = {
  1:  { nombre: 'Alquiler',   cuenta: CUENTA_INGRESOS },
  3:  { nombre: 'Personal',   cuenta: CUENTA_INGRESOS },
  4:  { nombre: 'Transporte', cuenta: CUENTA_INGRESOS },
  14: { nombre: 'Transporte', cuenta: CUENTA_INGRESOS },
  15: { nombre: 'Extras',     cuenta: CUENTA_INGRESOS },
};

// Tipo de IVA de Rentman (vatrate) → impuesto de Holded. El 0 % es ambiguo
// (exento / intracomunitario / exportación): se bloquea hasta revisarlo.
const IVA = { '0.21': 's_iva_21', '0.1': 's_iva_10', '0.04': 's_iva_4' };

// Método de pago de Caja → cuenta de tesorería (tabla del proceso Sage).
// `tesoreria_id` = ID de la cuenta de banco/caja en Holded (Tesorería);
// Creadas el 1 oct 2026. `cuenta` = cuenta contable enlazada a cada
// tesorería en Holded (los TPV, decidido el 2 oct 2026: 44100010/44100020;
// en Sage eran 52000100/52000200).
// Sin ID, el cobro no se envía.
const TESORERIAS = {
  'tpv-marbella':      { cuenta: 44100010, tesoreria_id: '6abe6cdb978446b3660046b4' },
  'tpv-monda':         { cuenta: 44100020, tesoreria_id: '6abe6cee92c4b1aaea014b0d' },
  'transferencia':     { cuenta: 57200001, tesoreria_id: '6abe6d2d540b8e7b650290f6' },
  'efectivo-marbella': { cuenta: 57000100, tesoreria_id: '6abe6d45a16a1dd70a01e140' },
  'efectivo-monda':    { cuenta: 57000200, tesoreria_id: '6abe6d67aaac22d4190dd687' },
};
// Sin cuenta todavía (pendiente de decidir con la gestoría): fianzas
// aplicadas (560/180 contra 430) y factura0/rectificativa (compensaciones).
const METODOS_SIN_CUENTA = ['fianza-efectivo-marbella', 'fianza-efectivo-monda', 'fianza-transferencia', 'factura0', 'rectificativa'];

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const TZ = 'Europe/Madrid';
// Fecha (YYYY-MM-DD) en hora de Madrid: un timestamptz de Supabase viene en
// UTC y cortarlo a 10 caracteres movería al día anterior lo de 00:00-02:00.
function fechaMadrid(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return String(ts).slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
// Fecha de una fila de facturas/pagos. El webhook en tiempo real de Apps
// Script reescribe las filas solo con los campos _raw (DD/MM/YYYY) y deja el
// _ts a null hasta la siguiente pasada del cron; sin esto el volcado no las ve.
function fechaFila(ts, raw) {
  if (ts) return fechaMadrid(ts);
  const m = String(raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return raw ? fechaMadrid(raw) : '';
}
const hoyMadrid = () => fechaMadrid(new Date());
function ayerMadrid() {
  const [a, m, d] = hoyMadrid().split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10);
}
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

// Contactos creados en este proceso (NIF → id): si un cliente nuevo tiene
// dos facturas en el mismo volcado, la segunda no debe crearlo otra vez
// aunque la búsqueda de Holded aún no lo devuelva.
const contactosCreados = {};

async function buscarContactoHolded(nif) {
  if (!nif) return null;
  if (contactosCreados[nif]) return contactosCreados[nif];
  const data = await holded('GET', `/contacts?code=${encodeURIComponent(nif)}&limit=5`);
  const items = (data && data.items) || [];
  return items[0] || null;
}

// Cliente nuevo de Rentman que no está en Holded (la importación inicial de
// contactos fue el 30 sep 2026): se crea con sus datos de facturación.
// La cuenta 430 la asigna Holded.
async function crearContactoHolded(contactoR, nif) {
  const pais = String(contactoR.invoice_country || contactoR.country || 'es').toUpperCase();
  const calle = [contactoR.invoice_street, contactoR.invoice_number].filter(Boolean).join(' ').trim();
  const body = {
    name: contactoR.name || contactoR.displayname,
    code: nif,
    is_person: contactoR.type === 'private',
    type: 'client',
    email: contactoR.email_1 || null,
    phone: contactoR.phone_1 || null,
    bill_address: {
      address: calle || null,
      city: contactoR.invoice_city || null,
      postal_code: contactoR.invoice_postalcode || null,
      province: contactoR.invoice_state || null,
      country_code: pais
    }
  };
  const creado = await holded('POST', '/contacts', body);
  const id = creado && (creado.id || (creado.data && creado.data.id));
  if (!id) throw new Error(`Holded no devolvió id al crear el contacto ${nif}`);
  contactosCreados[nif] = { id, name: body.name };
  return contactosCreados[nif];
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

  const lineasBrutas = (await rentman(`/invoices/${inv.id}/invoicelines`)).data || [];
  // Rentman puede repetir el mismo ledger + IVA en varias líneas, incluso en
  // positivo y negativo que se anulan (p. ej. 261754: factura final que
  // descuenta lo ya facturado). Se agrupan por ledger + IVA y se quitan las
  // que quedan a 0, para que en Holded salga solo el neto por concepto.
  const grupos = {};
  lineasBrutas.forEach(l => {
    const k = idDeLink(l.ledger) + '|' + Number(l.vatrate);
    if (!grupos[k]) grupos[k] = { ledger: l.ledger, vatrate: l.vatrate, priceincl: 0, vatamount: 0 };
    grupos[k].priceincl += Number(l.priceincl) || 0;
    grupos[k].vatamount += Number(l.vatamount) || 0;
  });
  const lineasR = Object.values(grupos);
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
    if (!contactoH) avisos.push({ nivel: 'aviso', texto: `Cliente nuevo: no hay contacto en Holded con NIF ${nif}, se creará al enviar la factura` });
  }

  const ya = await supabase.from('holded_sync_facturas').select('*').eq('rentman_invoice_id', inv.id).maybeSingle();
  if (ya.data && ya.data.holded_invoice_id) avisos.push({ nivel: 'error', texto: `Ya enviada a Holded (${ya.data.estado}, id ${ya.data.holded_invoice_id})` });

  const payload = {
    contact_id: contactoH ? contactoH.id : null,
    date: fecha,
    number: String(inv.number),
    items: items.map(({ _cuenta, _iva, ...i }) => i)
  };

  const vista = {
    rentman: { id: inv.id, numero: inv.number, fecha, tipo: inv.invoicetype, base: r2(inv.price), iva: r2(inv.vat_amount), total: totalRentman, finalizada: !!inv.finalized },
    cliente: { rentman_id: customerId, nombre: contactoR ? contactoR.name : null, nif, holded_id: contactoH ? contactoH.id : null, holded_nombre: contactoH ? contactoH.name : null, cuenta: contactoH && contactoH.client_record ? contactoH.client_record.num : null },
    lineas: items.map(i => ({ concepto: i.name, cuenta: i._cuenta, base: i.price, iva: i.taxes[0] || null, cuota_iva: i._iva })),
    totales: { base: baseTotal, iva: ivaTotal, total: r2(baseTotal + ivaTotal) },
    sync: ya.data || null,
    payload,
    avisos,
    se_puede_enviar: !avisos.some(a => a.nivel === 'error')
  };
  // Ficha completa de Rentman, para crear el cliente en Holded si es nuevo.
  // No enumerable: no viaja en el JSON de la vista previa.
  Object.defineProperty(vista, '_contactoR', { value: contactoR, enumerable: false });
  return vista;
}

async function guardarSync(fila) {
  const { error } = await supabase.from('holded_sync_facturas').upsert({ ...fila, actualizado_en: new Date().toISOString() });
  if (error) console.error('[Holded] guardando holded_sync_facturas:', error.message);
}

// Crea la factura en Holded (borrador) y, si `aprobar`, la aprueba.
async function enviarFactura(numero, { aprobar = false } = {}) {
  const prev = await prepararFactura(numero);
  if (!prev.se_puede_enviar) {
    // Se apunta como "bloqueada" con el motivo para la lista de pendientes
    // (sin pisar una fila que ya tenga factura en Holded).
    if (!(prev.sync && prev.sync.holded_invoice_id)) {
      const motivo = prev.avisos.filter(a => a.nivel === 'error').map(a => a.texto).join(' · ');
      await guardarSync({ rentman_invoice_id: prev.rentman.id, numero: String(prev.rentman.numero), fecha_factura: prev.rentman.fecha, estado: 'bloqueada', error: motivo, payload: null, respuesta: null });
    }
    return { ok: false, motivo: 'Hay errores en la vista previa', vista: prev };
  }
  const fallo = { rentman_invoice_id: prev.rentman.id, numero: String(prev.rentman.numero), fecha_factura: prev.rentman.fecha };
  if (!prev.cliente.holded_id) {
    try {
      const c = await crearContactoHolded(prev._contactoR, prev.cliente.nif);
      prev.cliente.holded_id = c.id;
      prev.payload.contact_id = c.id;
    } catch (e) {
      await guardarSync({ ...fallo, estado: 'error', error: `No se pudo crear el cliente en Holded: ${e.message}`, payload: null, respuesta: e.respuesta || null });
      return { ok: false, motivo: e.message };
    }
  }
  const base = { ...fallo, total_enviado: prev.totales.total, holded_contact_id: prev.cliente.holded_id, payload: prev.payload };
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
  const { data: pagos, error } = await supabase.from('pagos').select('pago_id,factura_id,numero_factura,importe,fecha_pago_ts,fecha_pago_raw').eq('numero_factura', parseInt(numero, 10));
  if (error) throw error;
  return clasificarCobros(pagos || []);
}

// Cruza pagos de Rentman con su clasificación en Caja y lo ya enviado.
async function clasificarCobros(pagos) {
  const ids = pagos.map(p => p.pago_id);
  const regs = [], enviados = [];
  for (let i = 0; i < ids.length; i += 200) {
    const tanda = ids.slice(i, i + 200);
    const a = await supabase.from('caja_registros').select('pago_id,split_idx,metodo_pago,importe,fecha_pago_ts').in('pago_id', tanda);
    const b = await supabase.from('holded_sync_cobros').select('*').in('pago_id', tanda);
    if (a.error) throw a.error;
    if (b.error) throw b.error;
    regs.push(...(a.data || [])); enviados.push(...(b.data || []));
  }
  const filas = [];
  pagos.forEach(p => {
    const lineas = regs.filter(r => r.pago_id === p.pago_id);
    if (!lineas.length) {
      filas.push({ pago_id: p.pago_id, split_idx: 1, numero_factura: p.numero_factura, importe: r2(p.importe), fecha: fechaFila(p.fecha_pago_ts, p.fecha_pago_raw), metodo: null, cuenta: null, estado: 'sin_clasificar', motivo: 'Sin método en Caja' });
      return;
    }
    lineas.forEach(l => {
      const t = TESORERIAS[l.metodo_pago];
      const env = enviados.find(e => e.pago_id === l.pago_id && e.split_idx === (l.split_idx || 1));
      let estado = 'listo', motivo = null;
      if (env && env.estado === 'enviado') { estado = 'enviado'; }
      else if (METODOS_SIN_CUENTA.includes(l.metodo_pago)) { estado = 'sin_cuenta'; motivo = 'Método sin cuenta decidida (fianza / compensación)'; }
      else if (!t) { estado = 'sin_cuenta'; motivo = `Método "${l.metodo_pago}" desconocido`; }
      else if (!t.tesoreria_id) { estado = 'sin_tesoreria'; motivo = `Falta crear la tesorería ${t.cuenta} en Holded`; }
      // Cobro ya enviado pero luego reclasificado o cambiado en Caja: Holded no se entera.
      if (env && env.estado === 'enviado' && (env.metodo_pago !== l.metodo_pago || Math.abs(r2(env.importe) - r2(l.importe)) > 0.01)) {
        motivo = `Cambiado en Caja después de enviarlo (se envió ${env.metodo_pago} ${r2(env.importe)} €) — corregir a mano en Holded`;
        estado = 'modificado';
      }
      filas.push({ pago_id: l.pago_id, split_idx: l.split_idx || 1, numero_factura: p.numero_factura, importe: r2(l.importe), fecha: l.fecha_pago_ts ? fechaMadrid(l.fecha_pago_ts) : fechaFila(p.fecha_pago_ts, p.fecha_pago_raw), metodo: l.metodo_pago, cuenta: t ? t.cuenta : null, estado, motivo });
    });
  });
  return filas;
}

// Envía a Holded los cobros "listo" de una factura ya creada en Holded.
// `hastaFecha` (YYYY-MM-DD): solo cobros de esa fecha o anteriores.
async function enviarCobros(numero, { hastaFecha = null } = {}) {
  const lista = await rentman(`/invoices?number=${encodeURIComponent(numero)}`);
  const inv = (lista.data || [])[0];
  if (!inv) return { ok: false, motivo: `No existe la factura ${numero} en Rentman` };
  const { data: fila } = await supabase.from('holded_sync_facturas').select('*').eq('rentman_invoice_id', inv.id).maybeSingle();
  if (!fila || fila.estado !== 'aprobada') return { ok: false, motivo: 'La factura tiene que estar creada y aprobada en Holded antes de enviar cobros' };
  const cobros = await prepararCobros(numero);
  const resultados = [];
  for (const c of cobros.filter(x => x.estado === 'listo' && (!hastaFecha || !x.fecha || x.fecha <= hastaFecha))) {
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

// ================================================================
// VOLCADO DIARIO (6:00 Madrid) Y PENDIENTES
// ================================================================
// Cada mañana se vuelca a Holded todo lo del día anterior o antes que aún
// no esté: facturas (creadas y aprobadas) y sus cobros clasificados en Caja.
// Lo ya enviado nunca se repite (tablas holded_sync_*). Lo que no puede
// pasar queda en la lista de pendientes con su motivo y se reintenta en el
// siguiente volcado.

let volcando = false;

async function facturasDesdeCorte(hasta) {
  const todas = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase.from('facturas')
      .select('factura_id,numero,cliente,importe_con_iva,fecha_emision_ts,fecha_emision_raw')
      .or(`fecha_emision_ts.gte.${FECHA_CORTE}T00:00:00Z,fecha_emision_ts.is.null`)
      .order('numero').range(off, off + 999);
    if (error) throw error;
    todas.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return todas
    .map(f => ({ ...f, fecha: fechaFila(f.fecha_emision_ts, f.fecha_emision_raw) }))
    .filter(f => f.fecha > FECHA_CORTE && (!hasta || f.fecha <= hasta));
}

async function filasSync() {
  const { data, error } = await supabase.from('holded_sync_facturas').select('*');
  if (error) throw error;
  const porNumero = {};
  (data || []).forEach(r => { porNumero[String(r.numero)] = r; });
  return porNumero;
}

async function pagosDeFacturas(numeros) {
  const pagos = [];
  for (let i = 0; i < numeros.length; i += 200) {
    const { data, error } = await supabase.from('pagos').select('pago_id,factura_id,numero_factura,importe,fecha_pago_ts,fecha_pago_raw').in('numero_factura', numeros.slice(i, i + 200).map(Number));
    if (error) throw error;
    pagos.push(...(data || []));
  }
  return pagos;
}

async function volcarTodo({ origen = 'auto', usuario = null, incluirHoy = false } = {}) {
  if (volcando) return { ok: false, motivo: 'Ya hay un volcado en marcha' };
  volcando = true;
  const hasta = incluirHoy ? hoyMadrid() : ayerMadrid();
  const { data: ej } = await supabase.from('holded_sync_ejecuciones').insert({ origen, usuario, hasta_fecha: hasta }).select('id').single();
  const resumen = { facturas_enviadas: 0, facturas_aprobadas: 0, facturas_bloqueadas: 0, facturas_error: 0, cobros_enviados: 0, cobros_error: 0, errores: [] };
  try {
    const facturas = await facturasDesdeCorte(hasta);
    let sync = await filasSync();
    for (const f of facturas) {
      const fila = sync[String(f.numero)];
      if (fila && fila.estado === 'aprobada') continue;
      try {
        const r = (fila && fila.estado === 'borrador' && fila.holded_invoice_id)
          ? await aprobarFactura(fila.rentman_invoice_id)
          : await enviarFactura(f.numero, { aprobar: true });
        if (r.ok) { if (fila && fila.estado === 'borrador') resumen.facturas_aprobadas++; else resumen.facturas_enviadas++; }
        else if (r.vista) resumen.facturas_bloqueadas++;
        else { resumen.facturas_error++; resumen.errores.push(`${f.numero}: ${r.motivo}`); }
      } catch (e) {
        resumen.facturas_error++; resumen.errores.push(`${f.numero}: ${e.message}`);
      }
    }

    // Cobros de las facturas ya aprobadas en Holded
    sync = await filasSync();
    const aprobadas = Object.values(sync).filter(r => r.estado === 'aprobada').map(r => r.numero);
    const cobros = await clasificarCobros(await pagosDeFacturas(aprobadas));
    const conListos = [...new Set(cobros.filter(c => c.estado === 'listo' && c.fecha && c.fecha <= hasta).map(c => String(c.numero_factura)))];
    for (const numero of conListos) {
      try {
        const r = await enviarCobros(numero, { hastaFecha: hasta });
        (r.resultados || []).forEach(x => { if (x.estado === 'enviado') resumen.cobros_enviados++; else { resumen.cobros_error++; resumen.errores.push(`Cobro ${x.pago_id} (${numero}): ${x.motivo}`); } });
        if (!r.resultados && !r.ok) { resumen.cobros_error++; resumen.errores.push(`Cobros ${numero}: ${r.motivo}`); }
      } catch (e) {
        resumen.cobros_error++; resumen.errores.push(`Cobros ${numero}: ${e.message}`);
      }
    }
    const ok = resumen.facturas_error === 0 && resumen.cobros_error === 0;
    if (ej) await supabase.from('holded_sync_ejecuciones').update({ fin: new Date().toISOString(), ok, resumen }).eq('id', ej.id);
    console.log(`[Holded] Volcado ${origen} hasta ${hasta}:`, JSON.stringify({ ...resumen, errores: resumen.errores.length }));
    return { ok, hasta, resumen };
  } catch (e) {
    console.error('[Holded] Error en volcado:', e);
    if (ej) await supabase.from('holded_sync_ejecuciones').update({ fin: new Date().toISOString(), ok: false, resumen, error: e.message }).eq('id', ej.id);
    return { ok: false, hasta, resumen, motivo: e.message };
  } finally {
    volcando = false;
  }
}

// Lista de lo que no ha pasado a Holded (o ha cambiado después).
async function pendientes() {
  const hasta = ayerMadrid();
  const facturas = await facturasDesdeCorte(null);
  const sync = await filasSync();
  const porNumero = {};
  facturas.forEach(f => { porNumero[String(f.numero)] = f; });

  const facturasPend = [];
  const modificadas = [];
  facturas.forEach(f => {
    const fila = sync[String(f.numero)];
    if (!fila) {
      if (f.fecha <= hasta) facturasPend.push({ numero: f.numero, fecha: f.fecha, cliente: f.cliente, total: r2(f.importe_con_iva), estado: 'sin_procesar', motivo: 'Aún no procesada (se enviará en el próximo volcado)' });
      return;
    }
    if (fila.estado !== 'aprobada') {
      facturasPend.push({ numero: f.numero, fecha: f.fecha, cliente: f.cliente, total: r2(f.importe_con_iva), estado: fila.estado, motivo: fila.error || (fila.estado === 'borrador' ? 'Creada en borrador, falta aprobar' : '') });
    } else if (fila.total_enviado != null && Math.abs(r2(fila.total_enviado) - r2(f.importe_con_iva)) > 0.02) {
      modificadas.push({ numero: f.numero, fecha: f.fecha, cliente: f.cliente, total_enviado: r2(fila.total_enviado), total_rentman: r2(f.importe_con_iva), motivo: 'Cambiada en Rentman después de enviarla a Holded — corregir con rectificativa' });
    }
  });

  const aprobadas = Object.values(sync).filter(r => r.estado === 'aprobada').map(r => r.numero);
  const cobros = (await clasificarCobros(await pagosDeFacturas(aprobadas)))
    .filter(c => c.estado !== 'enviado' && !(c.estado === 'listo' && c.fecha > hasta))
    .map(c => ({ ...c, cliente: (porNumero[String(c.numero_factura)] || {}).cliente || '' }));

  const { data: ult } = await supabase.from('holded_sync_ejecuciones').select('*').order('inicio', { ascending: false }).limit(5);
  return { hasta, fecha_corte: FECHA_CORTE, facturas: facturasPend, modificadas, cobros, ejecuciones: ult || [], volcando };
}

// Programa el volcado diario a las 6:00 (Madrid). Si el servidor arranca
// después de las 6:00 y hoy no ha habido volcado automático (redeploy de
// Railway a esa hora), lo lanza al minuto. HOLDED_VOLCADO_AUTO=off lo apaga.
const HORA_VOLCADO = 6;
function msHasta(hora) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date());
  const g = t => Number(p.find(x => x.type === t).value) % 24;
  let seg = hora * 3600 - (g('hour') * 3600 + g('minute') * 60 + g('second'));
  if (seg <= 0) seg += 86400;
  return seg * 1000;
}
function programarVolcadoDiario() {
  if (process.env.HOLDED_VOLCADO_AUTO === 'off' || !process.env.HOLDED_API_KEY) {
    console.log('[Holded] Volcado automático desactivado (HOLDED_VOLCADO_AUTO=off o falta HOLDED_API_KEY).');
    return;
  }
  const delay = msHasta(HORA_VOLCADO);
  setTimeout(async () => {
    try { await volcarTodo({ origen: 'auto' }); } catch (e) { /* registrado dentro */ }
    finally { programarVolcadoDiario(); }
  }, delay);
  console.log(`[Holded] Próximo volcado en ${Math.round(delay / 60000)} min (${HORA_VOLCADO}:00 Madrid).`);
}
async function recuperarVolcadoDeHoy() {
  if (process.env.HOLDED_VOLCADO_AUTO === 'off' || !process.env.HOLDED_API_KEY) return;
  const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date())) % 24;
  if (hora < HORA_VOLCADO) return;
  const { data } = await supabase.from('holded_sync_ejecuciones').select('id').eq('origen', 'auto').eq('hasta_fecha', ayerMadrid()).limit(1);
  if (!data || !data.length) setTimeout(() => volcarTodo({ origen: 'auto' }).catch(() => {}), 60 * 1000);
}

module.exports = { prepararFactura, enviarFactura, aprobarFactura, prepararCobros, enviarCobros, volcarTodo, pendientes, programarVolcadoDiario, recuperarVolcadoDeHoy, FECHA_CORTE };
