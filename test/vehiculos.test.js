const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../lib/vehiculos');

const HOY = '2026-10-20';
const base = { aviso_dias: 30, aviso_km: 1000 };

test('normalizarMatricula: mayúsculas, sin espacios ni guiones', () => {
  assert.equal(v.normalizarMatricula('6625 myz'), '6625MYZ');
  assert.equal(v.normalizarMatricula('6625-MYZ'), '6625MYZ');
  assert.equal(v.normalizarMatricula('  '), null);
  assert.equal(v.normalizarMatricula(null), null);
});

test('kmActuales: el mayor entre la lectura base y los mantenimientos, nunca baja', () => {
  assert.equal(v.kmActuales({ km_base: 100000 }, [{ km: 99000 }]), 100000);
  assert.equal(v.kmActuales({ km_base: 100000 }, [{ km: 105000 }]), 105000);
  assert.equal(v.kmActuales({ km_base: null }, [{ km: null }]), null);
  assert.equal(v.kmActuales({ km_base: null }, []), null);
});

test('estadoVencimiento por fecha', () => {
  assert.equal(v.estadoVencimiento({ ...base, fecha_limite: '2026-10-19' }, null, HOY).estado, 'vencido');
  const hoy = v.estadoVencimiento({ ...base, fecha_limite: '2026-10-20' }, null, HOY);
  assert.equal(hoy.estado, 'aviso');
  assert.equal(hoy.dias_restantes, 0);
  const treinta = v.estadoVencimiento({ ...base, fecha_limite: '2026-11-19' }, null, HOY);
  assert.equal(treinta.estado, 'aviso');
  assert.equal(treinta.dias_restantes, 30);
  assert.equal(v.estadoVencimiento({ ...base, fecha_limite: '2026-11-20' }, null, HOY).estado, 'ok');
});

test('estadoVencimiento por km', () => {
  const aviso = v.estadoVencimiento({ ...base, km_limite: 120000 }, 119500, HOY);
  assert.equal(aviso.estado, 'aviso');
  assert.equal(aviso.km_restantes, 500);
  assert.equal(v.estadoVencimiento({ ...base, km_limite: 120000 }, 120000, HOY).estado, 'vencido');
  const sinKm = v.estadoVencimiento({ ...base, km_limite: 120000 }, null, HOY);
  assert.equal(sinKm.estado, 'ok');
  assert.equal(sinKm.km_restantes, null);
});

test('estadoVencimiento: con fecha y km gana el peor', () => {
  const r = v.estadoVencimiento({ ...base, fecha_limite: '2027-06-01', km_limite: 120000 }, 121000, HOY);
  assert.equal(r.estado, 'vencido');
});

test('estadoVencimiento: avisos por defecto 30 días / 1000 km si vienen vacíos', () => {
  assert.equal(v.estadoVencimiento({ fecha_limite: '2026-11-10' }, null, HOY).estado, 'aviso');
});

test('peorEstado', () => {
  assert.equal(v.peorEstado(['ok', 'aviso']), 'aviso');
  assert.equal(v.peorEstado(['aviso', 'vencido', 'ok']), 'vencido');
  assert.equal(v.peorEstado([]), 'ok');
});

test('renovarVencimiento', () => {
  assert.deepEqual(
    v.renovarVencimiento({ periodicidad_meses: 12, fecha_limite: '2026-10-01', km_limite: null }, { fecha: '2026-10-15' }),
    { fecha_limite: '2027-10-15', km_limite: null });
  assert.deepEqual(
    v.renovarVencimiento({ periodicidad_km: 30000, fecha_limite: null, km_limite: 100000 }, { fecha: '2026-10-15', km: 110000 }),
    { fecha_limite: null, km_limite: 140000 });
  assert.deepEqual(
    v.renovarVencimiento({ fecha_limite: '2026-10-01', km_limite: 90000 }, { fecha: '2026-10-15', km: 110000 }),
    { fecha_limite: '2026-10-01', km_limite: 90000 });
  // Sin km en el mantenimiento no se puede renovar por km: se deja como estaba
  assert.deepEqual(
    v.renovarVencimiento({ periodicidad_km: 30000, km_limite: 100000 }, { fecha: '2026-10-15' }),
    { fecha_limite: null, km_limite: 100000 });
});

test('renovarVencimiento: fin de mes no se desborda', () => {
  assert.equal(v.renovarVencimiento({ periodicidad_meses: 1 }, { fecha: '2026-01-31' }).fecha_limite, '2026-02-28');
});

test('validarVencimiento', () => {
  assert.ok(v.validarVencimiento({ tipo: 'itv' }));
  assert.ok(v.validarVencimiento({ tipo: 'xyz', fecha_limite: '2026-12-01' }));
  assert.equal(v.validarVencimiento({ tipo: 'itv', fecha_limite: '2026-12-01' }), null);
});

test('validarVehiculo', () => {
  assert.equal(v.validarVehiculo({ tipo: 'furgoneta', propiedad: 'propio' }), null);
  assert.ok(v.validarVehiculo({ tipo: 'nave', propiedad: 'propio' }));
  assert.ok(v.validarVehiculo({ tipo: 'furgoneta', propiedad: 'prestado' }));
});

test('validarMantenimiento', () => {
  assert.equal(v.validarMantenimiento({ fecha: '2026-10-15', tipo: 'revision' }), null);
  assert.ok(v.validarMantenimiento({ tipo: 'revision' }));
  assert.ok(v.validarMantenimiento({ fecha: '2026-10-15', tipo: 'xyz' }));
});

test('validarDocumento', () => {
  assert.ok(v.validarDocumento({ mimetype: 'application/pdf', size: 11 * 1024 * 1024 }));
  assert.ok(v.validarDocumento({ mimetype: 'image/gif', size: 1000 }));
  assert.equal(v.validarDocumento({ mimetype: 'application/pdf', size: 1024 * 1024 }), null);
  assert.equal(v.validarDocumento({ mimetype: 'image/jpeg', size: 1000 }), null);
});

test('nombresRutasSinAsignar ignora lo que no son vehículos', () => {
  assert.deepEqual(
    v.nombresRutasSinAsignar(['IVECO', 'NAVE MONDA', 'ALQUILADO 1', 'ALQUILADO 2', 'NUEVA'], [{ nombre_rutas: 'IVECO', activo: true }]),
    ['NUEVA']);
});

test('validarMantenimiento: km e importe deben ser números', () => {
  assert.ok(v.validarMantenimiento({ fecha: '2026-10-15', tipo: 'revision', importe: 'abc' }));
  assert.ok(v.validarMantenimiento({ fecha: '2026-10-15', tipo: 'revision', km: '12x' }));
  assert.equal(v.validarMantenimiento({ fecha: '2026-10-15', tipo: 'revision', importe: '45.50', km: '' }), null);
});

test('deshacerRenovacion: vuelve al límite anterior solo si nadie lo ha cambiado después', () => {
  const registro = { antes: { fecha_limite: '2026-10-25', km_limite: null }, despues: { fecha_limite: '2027-10-18', km_limite: null } };
  assert.deepEqual(v.deshacerRenovacion({ fecha_limite: '2027-10-18', km_limite: null }, registro), { fecha_limite: '2026-10-25', km_limite: null });
  // Editado a mano después de la renovación: no se pisa
  assert.equal(v.deshacerRenovacion({ fecha_limite: '2028-01-01', km_limite: null }, registro), null);
  // km llegan de Postgres como texto
  const regKm = { antes: { fecha_limite: null, km_limite: 210600 }, despues: { fecha_limite: null, km_limite: 240500 } };
  assert.deepEqual(v.deshacerRenovacion({ fecha_limite: null, km_limite: '240500' }, regKm), { fecha_limite: null, km_limite: 210600 });
  assert.equal(v.deshacerRenovacion({ fecha_limite: '2027-10-18' }, null), null);
});

test('nombresRutasSinAsignar: un vehículo dado de baja también cuenta como asignado', () => {
  assert.deepEqual(
    v.nombresRutasSinAsignar(['IVECO', 'FURGO NDL'], [{ nombre_rutas: 'IVECO', activo: true }, { nombre_rutas: 'FURGO NDL', activo: false }]),
    []);
});

test('kmActuales con el localizador: lectura más reciente + km de los días posteriores', () => {
  const diarios = [{ fecha: '2026-09-05', km: 50 }, { fecha: '2026-09-10', km: 30 }, { fecha: '2026-09-12', km: '40.5' }];
  // lectura base el día 10: no suma el 5 ni el propio día 10
  assert.equal(v.kmActuales({ km_base: 100000, km_base_fecha: '2026-09-10' }, [], diarios), 100040.5);
  // un mantenimiento con más km y posterior pasa a ser la lectura
  assert.equal(v.kmActuales({ km_base: 100000, km_base_fecha: '2026-09-10' }, [{ km: 105000, fecha: '2026-09-11' }], diarios), 105040.5);
  // lectura sin fecha: no se puede saber desde cuándo sumar
  assert.equal(v.kmActuales({ km_base: 100000 }, [], diarios), 100000);
  // sin ninguna lectura no hay cuentakilómetros
  assert.equal(v.kmActuales({ km_base: null }, [], diarios), null);
});

test('kmActuales: con dos lecturas iguales manda la más reciente', () => {
  const diarios = [{ fecha: '2026-09-05', km: 50 }, { fecha: '2026-09-12', km: 40 }];
  assert.equal(v.kmActuales({ km_base: 100000, km_base_fecha: '2026-09-01' }, [{ km: 100000, fecha: '2026-09-10' }], diarios), 100040);
});
