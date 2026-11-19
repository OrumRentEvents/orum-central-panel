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
// Hasta el 1 ene 2027 se trabaja con una empresa DE PRUEBA; la definitiva es
// otra. Desde el 19 nov 2026 los IDs internos de Holded (cuenta de ingresos,
// tesorerías, cuentas de gasto) NO están escritos aquí: se buscan en la
// empresa por NÚMERO de cuenta (resolverEmpresa). Al cambiar de empresa:
//   1. cambiar HOLDED_API_KEY en Railway;
//   2. revisar HOLDED_FECHA_CORTE (fecha del asiento de apertura);
//   3. en la empresa nueva, crear las cuentas y tesorerías con los mismos
//      números ("Comprobar empresa Holded" en /holded.html dice qué falta);
//   4. vaciar las tablas holded_sync_* (sql/holded_vaciar_sync.sql).
// Facturas emitidas hasta esta fecha están dentro del saldo inicial
// (asiento de apertura): no se envían como factura.
const FECHA_CORTE = process.env.HOLDED_FECHA_CORTE || '2026-09-30';

// Ledger de Rentman (id) → cuenta de ingresos de Holded. `account` de una
// línea de Holded es el ID interno de la cuenta, no su número.
// Decidido 2 oct 2026: todos los conceptos a 70500000 Prestaciones de
// servicios (en Sage se usaba 70000001).
const CUENTA_INGRESOS = { numero: 70500000 };
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
// `cuenta` = cuenta contable enlazada a la tesorería (banco/tarjeta/caja) en
// Holded; la tesorería se busca por ese número (los TPV, decidido el 2 oct
// 2026: 44100010/44100020; en Sage eran 52000100/52000200).
// Si la empresa no tiene una tesorería con esa cuenta, el cobro no se envía.
const TESORERIAS = {
  'tpv-marbella':      { cuenta: 44100010, nombre: 'TPV Marbella', tipo: 'card' },
  'tpv-monda':         { cuenta: 44100020, nombre: 'TPV Monda', tipo: 'card' },
  'transferencia':     { cuenta: 57200001, nombre: 'Banco', tipo: 'bank' },
  'efectivo-marbella': { cuenta: 57000100, nombre: 'Efectivo Marbella', tipo: 'cash' },
  'efectivo-monda':    { cuenta: 57000200, nombre: 'Efectivo Monda', tipo: 'cash' },
  // Compensaciones (5 oct 2026): "factura0" / "rectificativa" de Caja son
  // cobros sin dinero — el +X de la factura y el −X de su rectificativa se
  // anulan entre sí. Van a una tesorería puente que debe quedar siempre a 0:
  // cobro factura → 555 D / 430 H; cobro nota de crédito → 430 D / 555 H.
  // Si no está a 0 hay una compensación sin pareja o mal clasificada en Caja
  // (sale en pendientes, "Compensaciones descuadradas"). Así factura y
  // rectificativa quedan cobradas en Holded y la 430 del cliente a 0.
  // Tesorería "Compensaciones" (tipo caja, cuenta 55500010): se crea a mano
  // en Holded (la API no deja enlazar la cuenta contable).
  // Pagos de facturas de gasto con la tarjeta de empresa (19 nov 2026): van a
  // 55500001 hasta que el banco carga la tarjeta a fin de mes (asiento manual
  // 55500001 D / 57200001 H). No es un método de Caja: solo lo usan los gastos.
  'tarjeta-empresa':   { cuenta: 55500001, nombre: 'Tarjeta empresa', tipo: 'card' },
  'factura0':          { cuenta: 55500010, nombre: 'Compensaciones', tipo: 'cash' },
  'rectificativa':     { cuenta: 55500010, nombre: 'Compensaciones', tipo: 'cash' },
};
const METODOS_COMPENSACION = ['factura0', 'rectificativa'];
// Sin cuenta todavía (pendiente de decidir con la gestoría): fianzas
// aplicadas (560/180 contra 430).
const METODOS_SIN_CUENTA = ['fianza-efectivo-marbella', 'fianza-efectivo-monda', 'fianza-transferencia'];

// Documento de Holded según el tipo de Rentman: F factura, C rectificativa.
const RUTA_DOC = { F: '/invoices', C: '/credit-notes' };

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const r4 = n => Math.round((Number(n) || 0) * 10000) / 10000;
// Importe de Holded: puede venir como número o como texto con coma decimal ("2617,73").
const numHolded = v => typeof v === 'number' ? v : Number(String(v == null ? '' : v).replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
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

// ── IDs de la empresa de Holded, buscados por número de cuenta ────
// Holded identifica cuentas y tesorerías por un ID interno distinto en cada
// empresa; aquí se buscan por número y se guardan 1 h. `forzar` recarga
// (p. ej. tras crear una cuenta en Holded).
let cacheEmpresa = null;
// Ruta de las tesorerías en la API v2: GET /treasury/accounts (documentación
// de Holded, «Listado de cuentas bancarias», comprobado el 19 nov 2026; las
// otras dan 404). Se deja la lista por si Holded la cambia.
const RUTAS_TESORERIAS = ['/treasury/accounts'];
let rutaTesorerias = null;

async function listar(path) {
  const d = await holded('GET', path);
  return Array.isArray(d) ? d : (d && (d.items || d.data)) || [];
}

// Lista paginada por cursor (límite 50: un límite mayor puede dar 400, y eso
// se confundía con "esta ruta no existe"; 19 nov 2026).
async function listarPaginado(path) {
  const todos = [];
  let cursor = null;
  for (let i = 0; i < 50; i++) {
    const d = await holded('GET', `${path}?limit=50${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
    const items = Array.isArray(d) ? d : (d && (d.items || d.data)) || [];
    todos.push(...items);
    cursor = d && !Array.isArray(d) ? d.cursor : null;
    if (!cursor || !(d.has_more === undefined || d.has_more) || !items.length) break;
  }
  return todos;
}

async function listarTesorerias() {
  const rutas = rutaTesorerias ? [rutaTesorerias] : RUTAS_TESORERIAS;
  const fallos = [];
  for (const r of rutas) {
    try { const l = await listarPaginado(r); rutaTesorerias = r; return l; }
    catch (e) { fallos.push(e.message); if (!/devolvió (400|404|405)/.test(e.message)) throw e; }
  }
  throw new Error('No se encuentra la lista de tesorerías en la API de Holded. ' + fallos.join(' | '));
}

async function resolverEmpresa({ forzar = false } = {}) {
  if (!forzar && cacheEmpresa && Date.now() - cacheEmpresa.ts < 3600e3) return cacheEmpresa;
  const [cuentas, tesorerias] = await Promise.all([
    listar('/accounting-accounts?include_empty=true'),
    listarTesorerias()
  ]);
  const idPorCuenta = {}, nombrePorCuenta = {};
  cuentas.forEach(a => {
    const n = Number(a.number || a.num);
    if (n) { idPorCuenta[n] = a.id; nombrePorCuenta[n] = a.name; }
  });
  const tesoreriaPorCuenta = {};
  tesorerias.filter(t => !t.archived).forEach(t => {
    const n = Number(t.accounting_account_number);
    if (n && !tesoreriaPorCuenta[n]) tesoreriaPorCuenta[n] = { id: t.id, nombre: t.name, tipo: t.type };
  });
  cacheEmpresa = { ts: Date.now(), idPorCuenta, nombrePorCuenta, tesoreriaPorCuenta, cuentas, tesorerias };
  return cacheEmpresa;
}

// ID de la tesorería de Holded para un método de pago de Caja (o null).
async function tesoreriaDeMetodo(metodo) {
  const t = TESORERIAS[metodo];
  if (!t) return null;
  const emp = await resolverEmpresa();
  return (emp.tesoreriaPorCuenta[t.cuenta] || {}).id || null;
}

// Lo que necesita la integración en la empresa de Holded y si está creado.
async function comprobarEmpresa() {
  const emp = await resolverEmpresa({ forzar: true });
  const cuenta = (numero, para) => ({ numero, para, existe: !!emp.idPorCuenta[numero], nombre_holded: emp.nombrePorCuenta[numero] || null });
  const ingresos = [cuenta(CUENTA_INGRESOS.numero, 'Ingresos de todas las facturas de Rentman')];
  const vistas = {};
  Object.entries(TESORERIAS).forEach(([metodo, t]) => {
    if (!vistas[t.cuenta]) vistas[t.cuenta] = { cuenta: t.cuenta, nombre: t.nombre, tipo: t.tipo, metodos: [], tesoreria: emp.tesoreriaPorCuenta[t.cuenta] || null };
    vistas[t.cuenta].metodos.push(metodo);
  });
  const tesorerias = Object.values(vistas);
  // Cuentas de gasto activas en ORUM (Config. Cuentas de gasto).
  const { data: cg } = await supabase.from('cuentas_gasto').select('numero,nombre').eq('activa', true).order('numero');
  const gastos = (cg || []).map(c => ({ numero: Number(c.numero), nombre: c.nombre, existe: !!emp.idPorCuenta[Number(c.numero)] }));
  const contactos = await holded('GET', '/contacts?limit=1').catch(() => null);
  // Nombre de la empresa de la clave (GET /account), para no confundir la de
  // prueba con la definitiva. Si la clave no tiene permiso, se deja vacío.
  const infoCuenta = await holded('GET', '/account').catch(() => null);
  const ic = (infoCuenta && (infoCuenta.data || infoCuenta)) || {};
  return {
    empresa: ic.name || ic.trade_name || null,
    fecha_corte: FECHA_CORTE,
    ruta_tesorerias: rutaTesorerias,
    total_cuentas_holded: Object.keys(emp.idPorCuenta).length,
    hay_contactos: !!(contactos && ((contactos.items || contactos.data || contactos).length)),
    ingresos,
    tesorerias,
    gastos_faltan: gastos.filter(g => !g.existe),
    gastos_total: gastos.length,
    todo_listo: ingresos.every(c => c.existe) && tesorerias.every(t => t.tesoreria)
  };
}

// Holded rechaza emails con caracteres invisibles (p. ej. U+2060 pegado al
// copiar). Se limpian; si aun así no parece un email, se crea sin email.
function emailLimpio(v) {
  const invisible = c => c <= 32 || c === 0xA0 || (c >= 0x200B && c <= 0x200F) || (c >= 0x2028 && c <= 0x202F) || (c >= 0x2060 && c <= 0x206F) || c === 0xFEFF;
  const e = Array.from(String(v || '')).filter(ch => !invisible(ch.codePointAt(0))).join('');
  return /^[^@]+@[^@]+\.[^@]+$/.test(e) ? e : null;
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
    email: emailLimpio(contactoR.email_1),
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
  if (!RUTA_DOC[inv.invoicetype]) avisos.push({ nivel: 'error', texto: `Tipo de factura "${inv.invoicetype}" desconocido` });
  // Rectificativa: en Rentman va en negativo; en Holded es una nota de
  // crédito con las líneas en positivo (Holded ya le da la vuelta: 430 H /
  // 705 D / 477 D).
  const esRect = inv.invoicetype === 'C';
  const signo = esRect ? -1 : 1;

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
  const emp = await resolverEmpresa();
  const idCuentaIngresos = emp.idPorCuenta[CUENTA_INGRESOS.numero] || null;
  if (!idCuentaIngresos) avisos.push({ nivel: 'error', texto: `La cuenta ${CUENTA_INGRESOS.numero} no existe en la empresa de Holded` });
  lineasR.forEach(l => {
    const ledgerId = idDeLink(l.ledger);
    const ledger = LEDGERS[ledgerId];
    // Base con los decimales de Rentman (9 oct 2026): Rentman guarda la base
    // con 3 decimales (261778: 2.163,407) y redondea solo el total. Si se
    // manda redondeada a 2, Holded calcula el IVA sobre 2.163,41 y la factura
    // sale 1 céntimo más cara que la de Rentman (cobros con 0,01 pendiente).
    const base = r4((l.priceincl || 0) - (l.vatamount || 0));
    const tax = IVA[String(Number(l.vatrate))];
    if (!ledger) avisos.push({ nivel: 'error', texto: `Línea con ledger ${ledgerId} sin cuenta de ingresos asignada` });
    if (!tax) avisos.push({ nivel: 'error', texto: `IVA ${r2((l.vatrate || 0) * 100)} % sin equivalente en Holded (revisar si es exento / intracomunitario / exportación)` });
    if (base === 0) return;
    items.push({
      name: ledger ? ledger.nombre : `Ledger ${ledgerId}`,
      units: 1,
      price: signo * base,
      taxes: tax ? [tax] : [],
      account: ledger ? emp.idPorCuenta[ledger.cuenta.numero] || null : null,
      _cuenta: ledger ? ledger.cuenta.numero : null,
      _iva: signo * r4(l.vatamount)
    });
  });
  // Factura de 0 € (Rentman las emite, p. ej. material sin cargo): Holded no
  // acepta un documento sin líneas. Se manda una línea a 0 € para que la
  // numeración de Rentman quede completa en Holded; no genera importe.
  if (!items.length) {
    avisos.push({ nivel: 'aviso', texto: 'Factura de 0 €: se envía con una línea a 0 € (sin asiento de importe)' });
    items.push({ name: 'Factura sin importe', units: 1, price: 0, taxes: ['s_iva_21'], account: idCuentaIngresos, _cuenta: CUENTA_INGRESOS.numero, _iva: 0 });
  }

  // Céntimo de Holded (19 nov 2026): Holded calcula por línea IVA = redondeo
  // (precio × tipo) y redondea el total, mientras que Rentman redondea solo el
  // total. Con bases de 3 decimales (261803: 2.040,935 → Rentman 2.469,53,
  // Holded 2.469,54) la factura quedaba con 0,01 € pendiente tras el cobro
  // (31 de 395 en el ensayo). Se ajusta al céntimo la base de la línea mayor
  // para que el total de Holded sea el de Rentman. Se calcula como Holded, en
  // enteros (milésimas y céntimos, redondeo de la mitad hacia fuera): el
  // modelo coincide con el total de Holded en las 389 facturas comprobadas.
  const PCT = { s_iva_21: 21, s_iva_10: 10, s_iva_4: 4 };
  const div = (a, b) => Math.sign(a) * Math.floor((2 * Math.abs(a) + b) / (2 * b)); // a/b redondeado, mitad hacia fuera
  const totalCentimos = lineas => div(lineas.reduce((s, l) => s + l.m + div(l.m * l.pct, 1000) * 10, 0), 10);
  // (las líneas van en positivo también en las rectificativas)
  const meta = Math.round(Math.abs(Number(inv.price_invat) || 0) * 100);
  if (items.length && meta > 0 && items.every(i => PCT[i.taxes[0]] != null)) {
    const lineas = items.map(i => ({ m: Math.round(i.price * 1000), pct: PCT[i.taxes[0]] }));
    if (totalCentimos(lineas) !== meta) {
      // Se prueba primero la línea mayor y, si no basta, las demás; con el
      // cambio más pequeño posible (hasta ±0,015 € en la base de una línea).
      const deltas = Array.from({ length: 31 }, (_, k) => k - 15).sort((a, b) => Math.abs(a) - Math.abs(b));
      const orden = lineas.map((l, k) => k).sort((a, b) => Math.abs(lineas[b].m) - Math.abs(lineas[a].m));
      for (const j of orden) {
        const original = lineas[j].m;
        const d = deltas.find(x => { lineas[j].m = original + x; return totalCentimos(lineas) === meta; });
        if (d !== undefined) { items[j].price = (original + d) / 1000; break; }
        lineas[j].m = original;
      }
    }
  }

  const baseExacta = items.reduce((s, i) => s + i.price, 0);
  const ivaExacto = items.reduce((s, i) => s + i._iva, 0);
  const baseTotal = r2(baseExacta);
  const ivaTotal = r2(ivaExacto);
  // Total como lo redondea Rentman: sobre la suma sin redondear.
  const totalExacto = r2(baseExacta + ivaExacto);
  const totalRentman = r2(inv.price_invat);
  if (Math.abs(signo * totalExacto - totalRentman) > 0.02) {
    avisos.push({ nivel: 'aviso', texto: `Suma de líneas ${r2(signo * totalExacto)} € ≠ total Rentman ${totalRentman} €` });
  }
  if (esRect && baseTotal <= 0) avisos.push({ nivel: 'error', texto: 'Rectificativa con importe positivo o a 0: revisar en Rentman' });
  if (!esRect && baseTotal < 0) avisos.push({ nivel: 'error', texto: 'Factura con importe negativo: debería ser una rectificativa' });

  // Rentman no guarda qué factura rectifica; se buscan las del mismo
  // proyecto (la API de Holded tampoco deja enlazarlas: va en las notas).
  let rectifica = [];
  if (esRect) {
    const proyectoId = idDeLink(inv.project);
    if (proyectoId) {
      const { data: fs } = await supabase.from('facturas')
        .select('numero,importe_con_iva,fecha_emision_ts,fecha_emision_raw')
        .eq('proyecto_id', proyectoId).gt('importe_con_iva', 0).order('numero');
      const cand = (fs || []).map(f => ({ numero: String(f.numero), total: r2(f.importe_con_iva), fecha: fechaFila(f.fecha_emision_ts, f.fecha_emision_raw) }))
        .filter(f => !f.fecha || f.fecha <= fecha);
      const exacta = cand.filter(f => Math.abs(f.total + totalRentman) <= 0.02);
      rectifica = exacta.length === 1 ? exacta : cand;
    }
    if (!rectifica.length) avisos.push({ nivel: 'aviso', texto: 'No se encuentra en el mismo proyecto la factura que rectifica' });
    const antes = rectifica.filter(f => f.fecha && f.fecha <= FECHA_CORTE);
    if (antes.length) avisos.push({ nivel: 'aviso', texto: `Rectifica una factura anterior al corte (${antes.map(f => f.numero).join(', ')}): esa factura está en el saldo inicial, no en Holded; su compensación de Caja quedará descuadrada hasta volcar los cobros de antes del corte` });
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
  if (esRect) payload.notes = `Rectificativa ${inv.number} de Rentman` + (rectifica.length ? ` — rectifica ${rectifica.length > 1 ? 'una de las facturas' : 'la factura'} ${rectifica.map(f => f.numero).join(', ')}` : '');

  const vista = {
    rentman: { id: inv.id, numero: inv.number, fecha, tipo: inv.invoicetype, base: r2(inv.price), iva: r2(inv.vat_amount), total: totalRentman, finalizada: !!inv.finalized },
    rectifica,
    cliente: { rentman_id: customerId, nombre: contactoR ? contactoR.name : null, nif, holded_id: contactoH ? contactoH.id : null, holded_nombre: contactoH ? contactoH.name : null, cuenta: contactoH && contactoH.client_record ? contactoH.client_record.num : null },
    lineas: items.map(i => ({ concepto: i.name, cuenta: i._cuenta, base: i.price, iva: i.taxes[0] || null, cuota_iva: r2(i._iva) })),
    totales: { base: baseTotal, iva: ivaTotal, total: totalExacto },
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
      await guardarSync({ rentman_invoice_id: prev.rentman.id, numero: String(prev.rentman.numero), fecha_factura: prev.rentman.fecha, tipo: prev.rentman.tipo, estado: 'bloqueada', error: motivo, payload: null, respuesta: null });
    }
    return { ok: false, motivo: 'Hay errores en la vista previa', vista: prev };
  }
  const fallo = { rentman_invoice_id: prev.rentman.id, numero: String(prev.rentman.numero), fecha_factura: prev.rentman.fecha, tipo: prev.rentman.tipo };
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
    creada = await holded('POST', RUTA_DOC[prev.rentman.tipo], prev.payload);
  } catch (e) {
    await guardarSync({ ...base, estado: 'error', error: e.message, respuesta: e.respuesta || null });
    return { ok: false, motivo: e.message };
  }
  const holdedId = creada && (creada.id || (creada.data && creada.data.id));
  await guardarSync({ ...base, holded_invoice_id: holdedId, estado: 'borrador', respuesta: creada, error: null, total_holded: holdedId ? await totalEnHolded(prev.rentman.tipo, holdedId) : null });
  if (!holdedId) return { ok: false, motivo: 'Holded no devolvió id de factura', respuesta: creada };
  if (aprobar) return aprobarFactura(prev.rentman.id);
  return { ok: true, estado: 'borrador', holded_invoice_id: holdedId, respuesta: creada };
}

// Total que ha calculado Holded para el documento (puede diferir del de
// Rentman por redondeos del IVA). null si no se puede leer.
async function totalEnHolded(tipo, holdedId) {
  try {
    const d = await holded('GET', `${RUTA_DOC[tipo || 'F']}/${holdedId}`);
    const doc = (d && (d.data || d)) || {};
    const t = numHolded(doc.total);
    return isFinite(t) ? Math.abs(r2(t)) : null;
  } catch (e) { console.error('[Holded] leyendo total del documento:', e.message); return null; }
}

async function aprobarFactura(rentmanInvoiceId) {
  const { data: fila } = await supabase.from('holded_sync_facturas').select('*').eq('rentman_invoice_id', rentmanInvoiceId).maybeSingle();
  if (!fila || !fila.holded_invoice_id) return { ok: false, motivo: 'La factura no está creada en Holded' };
  try {
    const resp = await holded('POST', `${RUTA_DOC[fila.tipo || 'F']}/${fila.holded_invoice_id}/approve`);
    const totalHolded = await totalEnHolded(fila.tipo, fila.holded_invoice_id);
    await guardarSync({ ...fila, estado: 'aprobada', respuesta: resp, error: null, total_holded: totalHolded });
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
  const emp = pagos.length ? await resolverEmpresa() : { tesoreriaPorCuenta: {} };
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
      else if (!emp.tesoreriaPorCuenta[t.cuenta]) { estado = 'sin_tesoreria'; motivo = `Falta crear en Holded la tesorería "${t.nombre}" enlazada a la cuenta ${t.cuenta}`; }
      else if (r2(l.importe) === 0) { estado = 'sin_cuenta'; motivo = 'Cobro a 0 €: no se envía'; }
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
  // En una rectificativa los cobros de Rentman/Caja van en negativo (se
  // devuelve o se compensa); en la nota de crédito de Holded, en positivo.
  const tipo = fila.tipo || 'F';
  const signo = tipo === 'C' ? -1 : 1;
  for (const c of cobros.filter(x => x.estado === 'listo' && (!hastaFecha || !x.fecha || x.fecha <= hastaFecha))) {
    const concepto = METODOS_COMPENSACION.includes(c.metodo) ? 'Compensación' : tipo === 'C' ? 'Devolución' : 'Cobro';
    const body = { amount: r2(signo * c.importe), treasury_id: await tesoreriaDeMetodo(c.metodo), date: c.fecha, description: `${concepto} Rentman pago ${c.pago_id}` };
    const base = { pago_id: c.pago_id, split_idx: c.split_idx, rentman_invoice_id: inv.id, numero_factura: String(numero), metodo_pago: c.metodo, importe: c.importe, fecha: c.fecha, actualizado_en: new Date().toISOString() };
    if (body.amount < 0) {
      const motivo = tipo === 'C' ? 'Cobro positivo en una rectificativa: revisar en Rentman/Caja' : 'Cobro negativo en una factura: la devolución debería ir en su rectificativa';
      await supabase.from('holded_sync_cobros').upsert({ ...base, estado: 'error', error: motivo, respuesta: null });
      resultados.push({ ...c, estado: 'error', motivo });
      continue;
    }
    try {
      const resp = await holded('POST', `${RUTA_DOC[tipo]}/${fila.holded_invoice_id}/payments`, body);
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
// Progreso del volcado en curso (o del último), para la barra de /holded.html.
// "Volcar ahora" ya no espera al final: Railway corta las peticiones largas
// (502) aunque el volcado siga en el servidor (19 nov 2026).
let progreso = null;
function estadoVolcado() { return { volcando, progreso }; }

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
  progreso = { origen, usuario, hasta, inicio: new Date().toISOString(), fase: 'preparando', hecho: 0, total: 0, actual: null, resumen, fin: null, ok: null };
  try {
    const facturas = await facturasDesdeCorte(hasta);
    let sync = await filasSync();
    const porHacer = facturas.filter(f => !(sync[String(f.numero)] && sync[String(f.numero)].estado === 'aprobada'));
    Object.assign(progreso, { fase: 'facturas', hecho: 0, total: porHacer.length });
    for (const f of porHacer) {
      const fila = sync[String(f.numero)];
      progreso.actual = String(f.numero);
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
      progreso.hecho++;
    }

    // Cobros de las facturas ya aprobadas en Holded
    Object.assign(progreso, { fase: 'preparando cobros', hecho: 0, total: 0, actual: null });
    sync = await filasSync();
    const aprobadas = Object.values(sync).filter(r => r.estado === 'aprobada').map(r => r.numero);
    const cobros = await clasificarCobros(await pagosDeFacturas(aprobadas));
    const conListos = [...new Set(cobros.filter(c => c.estado === 'listo' && c.fecha && c.fecha <= hasta).map(c => String(c.numero_factura)))];
    Object.assign(progreso, { fase: 'cobros', hecho: 0, total: conListos.length });
    for (const numero of conListos) {
      progreso.actual = numero;
      progreso.hecho++;
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
    Object.assign(progreso, { fase: 'terminado', actual: null, fin: new Date().toISOString(), ok });
    return { ok, hasta, resumen };
  } catch (e) {
    console.error('[Holded] Error en volcado:', e);
    if (ej) await supabase.from('holded_sync_ejecuciones').update({ fin: new Date().toISOString(), ok: false, resumen, error: e.message }).eq('id', ej.id);
    Object.assign(progreso, { fase: 'terminado', actual: null, fin: new Date().toISOString(), ok: false, motivo: e.message });
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
  const descuadres = [];
  facturas.forEach(f => {
    const fila = sync[String(f.numero)];
    if (!fila) {
      if (f.fecha <= hasta) facturasPend.push({ numero: f.numero, fecha: f.fecha, cliente: f.cliente, total: r2(f.importe_con_iva), estado: 'sin_procesar', motivo: 'Aún no procesada (se enviará en el próximo volcado)' });
      return;
    }
    if (fila.estado !== 'aprobada') {
      facturasPend.push({ numero: f.numero, fecha: f.fecha, cliente: f.cliente, total: r2(f.importe_con_iva), estado: fila.estado, motivo: fila.error || (fila.estado === 'borrador' ? 'Creada en borrador, falta aprobar' : '') });
    // (las rectificativas se envían en positivo y en Rentman son negativas)
    } else if (fila.total_enviado != null && Math.abs(Math.abs(r2(fila.total_enviado)) - Math.abs(r2(f.importe_con_iva))) > 0.02) {
      modificadas.push({ numero: f.numero, fecha: f.fecha, cliente: f.cliente, total_enviado: r2(fila.total_enviado), total_rentman: r2(f.importe_con_iva), motivo: 'Cambiada en Rentman después de enviarla a Holded — corregir con rectificativa' });
    }
    // Holded recalcula el IVA: si su total no es el de Rentman (céntimos),
    // los cobros dejan el documento con algo pendiente.
    if (fila && fila.total_holded != null && Math.abs(r2(fila.total_holded) - Math.abs(r2(f.importe_con_iva))) >= 0.01) {
      descuadres.push({ numero: f.numero, fecha: f.fecha, cliente: f.cliente, total_holded: r2(fila.total_holded), total_rentman: Math.abs(r2(f.importe_con_iva)), diferencia: r2(r2(fila.total_holded) - Math.abs(r2(f.importe_con_iva))) });
    }
  });

  const aprobadas = Object.values(sync).filter(r => r.estado === 'aprobada').map(r => r.numero);
  const todosCobros = (await clasificarCobros(await pagosDeFacturas(aprobadas)))
    .map(c => ({ ...c, cliente: (porNumero[String(c.numero_factura)] || {}).cliente || '' }));
  const cobros = todosCobros.filter(c => c.estado !== 'enviado' && !(c.estado === 'listo' && c.fecha > hasta));

  // Compensaciones por cliente: el +X de las facturas y el −X de sus
  // rectificativas tienen que sumar 0 (es el saldo que quedará en la
  // tesorería puente 55500010). Si no, falta su pareja o está mal en Caja.
  const porCliente = {};
  todosCobros.filter(c => METODOS_COMPENSACION.includes(c.metodo)).forEach(c => {
    const k = c.cliente || '(sin cliente)';
    if (!porCliente[k]) porCliente[k] = { cliente: k, neto: 0, lineas: [] };
    porCliente[k].neto = r2(porCliente[k].neto + c.importe);
    porCliente[k].lineas.push({ numero_factura: c.numero_factura, pago_id: c.pago_id, importe: c.importe, estado: c.estado });
  });
  const compensaciones = Object.values(porCliente).filter(x => Math.abs(x.neto) > 0.01);

  const { data: ult } = await supabase.from('holded_sync_ejecuciones').select('*').order('inicio', { ascending: false }).limit(5);
  return { hasta, fecha_corte: FECHA_CORTE, facturas: facturasPend, modificadas, descuadres, cobros, compensaciones, ejecuciones: ult || [], volcando };
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

module.exports = {
  prepararFactura, enviarFactura, aprobarFactura, prepararCobros, enviarCobros, volcarTodo, estadoVolcado, pendientes, programarVolcadoDiario, recuperarVolcadoDeHoy, FECHA_CORTE,
  // utilidades que usa lib/holdedCompras.js
  holded, buscarContactoHolded, contactosCreados, fechaFila, ayerMadrid, TESORERIAS, numHolded,
  resolverEmpresa, tesoreriaDeMetodo, comprobarEmpresa
};
