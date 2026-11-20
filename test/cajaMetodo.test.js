// Asignar en Caja la forma de pago de un cobro desde Holded (lib/cajaMetodo.js)
const test = require('node:test');
const assert = require('node:assert');
const { crear, puedeAsignar } = require('../lib/cajaMetodo');

// Supabase en memoria: lo justo para select/eq/limit/maybeSingle/delete/insert.
function falso(tablas) {
  const from = nombre => {
    const st = { filtros: [], op: 'select', lim: null };
    const filas = () => (tablas[nombre] = tablas[nombre] || []).filter(r => st.filtros.every(([c, v]) => String(r[c]) === String(v)));
    const q = {
      select() { return q; }, eq(c, v) { st.filtros.push([c, v]); return q; }, limit(n) { st.lim = n; return q; },
      delete() { st.op = 'delete'; return q; },
      insert(f) { tablas[nombre] = (tablas[nombre] || []).concat(Array.isArray(f) ? f : [f]); return Promise.resolve({ data: null, error: null }); },
      maybeSingle() { return Promise.resolve({ data: filas()[0] || null, error: null }); },
      then(ok, ko) {
        let r;
        if (st.op === 'delete') { const quitar = new Set(filas()); tablas[nombre] = tablas[nombre].filter(x => !quitar.has(x)); r = { data: null, error: null }; }
        else { const d = filas(); r = { data: st.lim ? d.slice(0, st.lim) : d, error: null }; }
        return Promise.resolve(r).then(ok, ko);
      }
    };
    return q;
  };
  return { from, tablas };
}
const base = () => ({
  pagos: [{ pago_id: 5101, factura_id: 2256, numero_factura: 262166, importe: 1210, fecha_pago_raw: '19/11/2026' }],
  facturas: [{ numero: 262166, cliente: 'OLILU MARBELLA' }],
  caja_registros: [], holded_sync_cobros: [], caja_efectivo_recibido: [], caja_historial: []
});
const maria = { usuario: 'maria', nombre: 'Maria Gómez' };

test('solo María y Sergio pueden asignar', () => {
  assert.ok(puedeAsignar(maria)); assert.ok(puedeAsignar({ usuario: 'Sergio' }));
  assert.ok(!puedeAsignar({ usuario: 'ana' }));
});

test('guarda el método en caja_registros como Caja y deja historial', async () => {
  const db = falso(base());
  const r = await crear(db).asignar({ pagoId: 5101, metodo: 'tpv-monda' }, maria);
  assert.equal(r.ok, true);
  const reg = db.tablas.caja_registros;
  assert.equal(reg.length, 1);
  assert.deepEqual({ f: reg[0].factura_id, p: reg[0].pago_id, m: reg[0].metodo_pago, u: reg[0].ubicacion, t: reg[0].tipo, i: reg[0].importe, c: reg[0].cliente, n: reg[0].numero, ab: reg[0].es_abrebotellas, s: reg[0].split_idx },
    { f: '2256', p: 5101, m: 'tpv-monda', u: 'monda', t: 'tpv', i: 1210, c: 'OLILU MARBELLA', n: 262166, ab: false, s: 1 });
  assert.equal(db.tablas.caja_historial[0].datos.origen, 'ORUM Central · Holded');
});

test('cambia el método que ya tenía (sustituye la fila)', async () => {
  const t = base(); t.caja_registros.push({ pago_id: 5101, split_idx: 1, metodo_pago: 'transferencia' });
  const db = falso(t);
  const r = await crear(db).asignar({ pagoId: 5101, metodo: 'efectivo-marbella' }, maria);
  assert.equal(r.anterior, 'transferencia');
  assert.equal(db.tablas.caja_registros.length, 1);
  assert.equal(db.tablas.caja_registros[0].metodo_pago, 'efectivo-marbella');
});

test('no toca pagos partidos, ya enviados a Holded ni efectivo recibido', async () => {
  let t = base(); t.caja_registros.push({ pago_id: 5101, split_idx: 1 }, { pago_id: 5101, split_idx: 2 });
  await assert.rejects(crear(falso(t)).asignar({ pagoId: 5101, metodo: 'transferencia' }, maria), /partido/);
  t = base(); t.holded_sync_cobros.push({ pago_id: 5101, estado: 'enviado' });
  await assert.rejects(crear(falso(t)).asignar({ pagoId: 5101, metodo: 'transferencia' }, maria), /ya está en Holded/);
  t = base(); t.caja_registros.push({ pago_id: 5101, split_idx: 1, metodo_pago: 'efectivo-monda' }); t.caja_efectivo_recibido.push({ clave: '5101', recibido_por: 'Ana' });
  await assert.rejects(crear(falso(t)).asignar({ pagoId: 5101, metodo: 'transferencia' }, maria), /Ana ya marcó/);
});

test('rechaza usuarios sin permiso y métodos inventados', async () => {
  await assert.rejects(crear(falso(base())).asignar({ pagoId: 5101, metodo: 'transferencia' }, { usuario: 'ana' }), /Solo María y Sergio/);
  await assert.rejects(crear(falso(base())).asignar({ pagoId: 5101, metodo: 'bizum' }, maria), /no válida/);
});
