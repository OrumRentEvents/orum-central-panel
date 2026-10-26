const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../lib/recuperacion');

test('articuloDeCargo: solo los costes que acaban en NO DEVUELTO', () => {
  assert.equal(r.articuloDeCargo('COPA VIP CATERING 48CL NO DEVUELTO'), 'COPA VIP CATERING 48CL');
  assert.equal(r.articuloDeCargo('Silla verbena blanca apilable no devuelto'), 'SILLA VERBENA BLANCA APILABLE');
  assert.equal(r.articuloDeCargo('MANTEL BLANCO Ø 350CM  NO DEVUELTO '), 'MANTEL BLANCO Ø 350CM');
  assert.equal(r.articuloDeCargo('Transporte'), null);
  assert.equal(r.articuloDeCargo('NO DEVUELTO'), null);
});

const cargos = [
  { cargo_id: 1, proyecto_id: 100, articulo: 'MANTEL BLANCO Ø 350CM', cantidad: 20, creado_en: '2026-10-24T10:13:00Z' },
  { cargo_id: 2, proyecto_id: 200, articulo: 'COPA VIP CATERING 48CL', cantidad: 51, creado_en: '2026-10-20T10:00:00Z' },
  { cargo_id: 3, proyecto_id: 300, articulo: 'COPA VIP CATERING 48CL', cantidad: 10, creado_en: '2026-10-22T10:00:00Z' },
  { cargo_id: 4, proyecto_id: 400, articulo: 'MANTEL BLANCO Ø 350CM', cantidad: 1, creado_en: '2026-10-01T10:00:00Z', existe: false }
];

test('propuesta: un único proyecto posible se propone; varios, no', () => {
  const pend = r.pendientePorCargo(cargos, []);
  const mantel = { articulo: 'mantel blanco ø 350cm', cantidad: 1, fecha: '2026-10-26T11:13:00Z' };
  assert.equal(r.propuesta(mantel, cargos, pend).proyecto_id, 100); // el 400 ya no existe en Rentman
  const copas = { articulo: 'COPA VIP CATERING 48CL', cantidad: 5, fecha: '2026-10-26T11:00:00Z' };
  assert.equal(r.candidatos(copas, cargos, pend).length, 2);
  assert.equal(r.propuesta(copas, cargos, pend), null);
});

test('candidatos: no cuenta cargos posteriores a la recuperación ni ya cubiertos', () => {
  const copas = { articulo: 'COPA VIP CATERING 48CL', cantidad: 5, fecha: '2026-10-21T10:00:00Z' };
  assert.deepEqual(r.candidatos(copas, cargos, r.pendientePorCargo(cargos, [])).map(c => c.cargo_id), [2]);
  const yaConfirmados = [{ cargo_id: 2, cantidad: 51, estado: 'por_quitar' }, { cargo_id: 3, cantidad: 4, estado: 'por_confirmar' }];
  const pend = r.pendientePorCargo(cargos, yaConfirmados);
  assert.equal(pend[2], 0);
  assert.equal(pend[3], 10); // lo que aún no está confirmado no resta
  const tarde = { articulo: 'COPA VIP CATERING 48CL', cantidad: 5, fecha: '2026-10-26T10:00:00Z' };
  assert.equal(r.propuesta(tarde, cargos, pend).proyecto_id, 300);
});

test('motivoCierre: cargo quitado, reducido o pendiente', () => {
  const rec = { cargo_id: 2, cantidad: 10, cargo_cantidad_al_confirmar: 51 };
  assert.equal(r.motivoCierre(rec, null), 'cargo_quitado');
  assert.equal(r.motivoCierre(rec, { cantidad: 51, existe: false }), 'cargo_quitado');
  assert.equal(r.motivoCierre(rec, { cantidad: 41 }), 'cargo_reducido');
  assert.equal(r.motivoCierre(rec, { cantidad: 45 }), null);
  assert.equal(r.motivoCierre(rec, { cantidad: 51 }), null);
  assert.equal(r.motivoCierre({ cargo_id: null, cantidad: 1 }, null), null);
});
