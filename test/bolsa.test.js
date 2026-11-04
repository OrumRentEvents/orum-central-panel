const test = require('node:test');
const assert = require('node:assert/strict');
const b = require('../lib/bolsa');

test('parsearHoras: admite decimales, 1:30 y 1h30', () => {
  assert.equal(b.parsearHoras('1,5'), 1.5);
  assert.equal(b.parsearHoras('1.5'), 1.5);
  assert.equal(b.parsearHoras('1:30'), 1.5);
  assert.equal(b.parsearHoras('1h30'), 1.5);
  assert.equal(b.parsearHoras(' 1 h 30 '), 1.5);
  assert.equal(b.parsearHoras('2h'), 2);
  assert.equal(b.parsearHoras('0:20'), 0.33);
  assert.equal(b.parsearHoras(4), 4);
});

test('parsearHoras: rechaza lo que no son horas', () => {
  for (const t of ['', 'abc', '0', '-2', '1:75', '1,2,3', '9999', null]) assert.equal(b.parsearHoras(t), null, String(t));
});

test('parsearDias: enteros y medios días, nada más', () => {
  assert.equal(b.parsearDias('1'), 1);
  assert.equal(b.parsearDias('0,5'), 0.5);
  assert.equal(b.parsearDias('1.5'), 1.5);
  for (const t of ['', '0', '0,3', 'x', '-1']) assert.equal(b.parsearDias(t), null, t);
});

test('diasEntre: días naturales con ambos extremos', () => {
  assert.equal(b.diasEntre('2026-08-01', '2026-08-01'), 1);
  assert.equal(b.diasEntre('2026-08-01', '2026-08-15'), 15);
  assert.equal(b.diasEntre('2026-08-15', '2026-08-01'), null);
  assert.equal(b.diasEntre('2026-02-31', '2026-03-01'), null);
});

test('diasVacacionesEnAnio: reparte los periodos que cruzan de año', () => {
  const v = { fecha_inicio: '2026-12-28', fecha_fin: '2027-01-03' };
  assert.equal(b.diasVacacionesEnAnio(v, 2026), 4);
  assert.equal(b.diasVacacionesEnAnio(v, 2027), 3);
  assert.equal(b.diasVacacionesEnAnio(v, 2028), 0);
});

test('calcularSaldos: suma y resta, y no cuenta lo anulado ni lo disfrutado', () => {
  const movimientos = [
    { clave: 'a', tipo: 'horas', cantidad: 6 },
    { clave: 'a', tipo: 'horas', cantidad: -1.5 },
    { clave: 'a', tipo: 'horas', cantidad: 100, anulado_en: '2026-11-04' },
    { clave: 'a', tipo: 'festivo', cantidad: 1 },
    { clave: 'a', tipo: 'festivo', cantidad: 1, disfrutado_fecha: '2026-11-01' },
    { clave: 'a', tipo: 'descanso', cantidad: 2 },
    { clave: 'a', tipo: 'descanso', cantidad: -0.5 },
    { clave: 'b', tipo: 'horas', cantidad: -4 }
  ];
  const vacaciones = [
    { clave: 'a', fecha_inicio: '2026-08-01', fecha_fin: '2026-08-10' },
    { clave: 'a', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-30', anulado_en: '2026-09-01' }
  ];
  const s = b.calcularSaldos(movimientos, vacaciones, 2026);
  assert.deepEqual(s.a, { horas: 4.5, festivos: 1, descanso: 1.5, vacaciones: 10 });
  assert.equal(s.b.horas, -4);
});

test('construirPlantilla: sin bajas ni Dirección, salvo que tengan saldo', () => {
  const t = (num, estado, departamento) => ({ empresa_nif: 'N', formato_origen: 'f', num_empleado: num, nombre: 'P' + num, departamento, estado });
  const lista = b.construirPlantilla(
    [t(1, 'activo', 'Logística'), t(2, 'baja', 'Office'), t(3, 'baja', 'Office'), t(4, 'activo', 'Dirección'), t(5, 'discontinuo', null)],
    [{ clave: 'libre|ANA', nombre: 'ANA', area: 'Office' }],
    { 'N|f|3': { horas: 2, festivos: 0, descanso: 0, vacaciones: 0 } }
  );
  assert.deepEqual(lista.map(e => e.nombre), ['ANA', 'P1', 'P3', 'P5']);
  assert.equal(lista.find(e => e.nombre === 'P3').horas, 2);
  assert.equal(lista.find(e => e.nombre === 'P5').area, 'Sin área');
  assert.equal(lista.find(e => e.nombre === 'ANA').manual, true);
});
