const test = require('node:test');
const assert = require('node:assert/strict');
const { _test: { comparar, normNum } } = require('../lib/pruebaModelo');

test('pruebaModelo.comparar: aciertos con tolerancias de céntimos y formato', () => {
  const verdad = { nif: 'B93275394', numero: '406117-4342', fecha: '2026-07-28', base: 108.79, iva: 22.85, total: 131.64, matricula: '6625MYZ', gasto_vehiculo: 'combustible' };
  const ex = { emisor_nif: 'ES-B93275394', numero: '4061I7 4342', fecha: '2026-07-28', lineas_iva: [{ tipo: 21, base: 108.8, cuota: 22.85 }], total: 131.64, matricula: '6625 MYZ', gasto_vehiculo: 'combustible' };
  assert.deepEqual(comparar(ex, verdad), { nif: true, numero: true, fecha: true, base: true, iva: true, total: true, matricula: true, tipo_gasto: true });
  const mal = comparar({ ...ex, total: 130, fecha: '2026-07-27' }, verdad);
  assert.equal(mal.total, false); assert.equal(mal.fecha, false);
  assert.equal(normNum('01FCO/47104'), '1FC047104'); // sin ceros delante, como claveFacturaProveedor
});
