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

test('calcularSaldos: junta bolsa y extras, sin lo anulado ni lo rechazado', () => {
  const s = b.calcularSaldos({
    anio: 2026, mes: 11,
    movimientos: [
      { clave: 'a', tipo: 'horas', cantidad: 6 },
      { clave: 'a', tipo: 'horas', cantidad: -1.5 },
      { clave: 'a', tipo: 'horas', cantidad: 100, anulado_en: '2026-11-04' },
      { clave: 'a', tipo: 'descanso', cantidad: -0.5 }, // ya va dentro de saldosDescanso
      { clave: 'b', tipo: 'horas', cantidad: -4 }
    ],
    vacaciones: [
      { clave: 'a', fecha_inicio: '2026-08-01', fecha_fin: '2026-08-10' },
      { clave: 'a', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-30', anulado_en: '2026-09-01' }
    ],
    saldosDescanso: { x: { clave: 'a', nombre: 'Ana', inicial: 2, generados: 1, disfrutados: 0.5 } },
    registros: [
      { clave: 'a', tipo: 'Domingo', estado: 'aprobado', genera_descanso: true, anio: 2026, mes: 11 },
      { clave: 'a', tipo: 'Festivo', estado: 'pendiente', genera_descanso: true, anio: 2026, mes: 11 },
      { clave: 'a', tipo: 'Domingo', estado: 'rechazado', genera_descanso: true, anio: 2026, mes: 11 },
      { clave: 'a', tipo: 'Domingo', estado: 'pagado', genera_descanso: true, anio: 2026, mes: 10 },
      { clave: 'a', tipo: 'Nocturno', estado: 'pendiente', genera_descanso: true, anio: 2026, mes: 11 },
      { clave: 'a', tipo: 'Plus', estado: 'pendiente', genera_descanso: false, anio: 2026, mes: 11 }
    ]
  });
  assert.equal(s.a.horas, 4.5);
  assert.equal(s.a.descanso, 2.5);
  assert.equal(s.a.vacaciones, 10);
  assert.equal(s.a.domingos_mes, 2);
  assert.equal(s.a.por_aprobar, 3);
  assert.equal(s.a.dias_por_aprobar, 2);
  assert.equal(s.b.horas, -4);
});

test('construirPlantilla: sin bajas ni Dirección salvo con saldo; eventuales con algo pendiente', () => {
  const t = (num, estado, departamento) => ({ empresa_nif: 'N', formato_origen: 'f', num_empleado: num, nombre: 'P' + num, departamento, estado });
  const vacio = { horas: 0, descanso: 0, por_aprobar: 0, vacaciones: 0 };
  const lista = b.construirPlantilla(
    [t(1, 'activo', 'Logística'), t(2, 'baja', 'Office'), t(3, 'baja', 'Office'), t(4, 'activo', 'Dirección'), t(5, 'discontinuo', null)],
    [{ clave: 'libre|ANA', nombre: 'ANA', area: 'Office' }],
    { 'N|f|3': { ...vacio, horas: 2 }, 'libre|LUIS': { ...vacio, descanso: 1, nombre: 'LUIS' }, 'libre|VIEJO': { ...vacio } }
  );
  assert.deepEqual(lista.map(e => e.nombre), ['ANA', 'LUIS', 'P1', 'P3', 'P5']);
  assert.equal(lista.find(e => e.nombre === 'P3').horas, 2);
  assert.equal(lista.find(e => e.nombre === 'P5').area, 'Sin área');
  assert.equal(lista.find(e => e.nombre === 'LUIS').area, 'Eventual');
});

test('tiposApuntables: sin Hora Extra ni descanso, con la tarifa vigente en esa fecha', () => {
  const t = (id, tipo, modo, vigente_desde, activo = true, orden = id) => ({ id, tipo, modo, vigente_desde, activo, orden, genera_descanso: modo === 'fijo' });
  const lista = b.tiposApuntables([
    t(1, 'Hora Extra', 'por_hora', '2025-01-01'), t(2, 'Domingo', 'fijo', '2025-01-01'), t(3, 'Descanso Disfrutado', 'descanso', '2025-01-01'),
    t(4, 'Plus', 'libre', '2025-01-01'), t(5, 'Sábado tarde', 'fijo', '2025-01-01'), t(6, 'Sábado tarde', 'fijo', '2026-06-01', false), t(7, 'Futuro', 'fijo', '2030-01-01')
  ], '2026-11-04', true);
  assert.deepEqual(lista.map(x => x.tipo), ['Domingo', 'Plus']);
  assert.equal(lista[1].libre, true);
});

test('vacaciones pendientes: ajustes menos periodos apuntados, sin lo anulado', () => {
  const s = b.calcularSaldos({
    anio: 2026, mes: 11, registros: [], saldosDescanso: {},
    movimientos: [{ clave: 'a', tipo: 'vacaciones', cantidad: 22 }, { clave: 'a', tipo: 'vacaciones', cantidad: 5, anulado_en: 'x' }],
    vacaciones: [{ clave: 'a', fecha_inicio: '2026-08-01', fecha_fin: '2026-08-10', dias: 10 }, { clave: 'a', fecha_inicio: '2026-09-01', fecha_fin: '2026-09-02', dias: 2, anulado_en: 'x' }]
  });
  assert.equal(s.a.vac_pendientes, 12);
});

test('parsearConSigno: la hoja de ajuste admite cero y negativos', () => {
  assert.equal(b.parsearConSigno('0', b.parsearHoras), 0);
  assert.equal(b.parsearConSigno('-4', b.parsearHoras), -4);
  assert.equal(b.parsearConSigno('−1,5', b.parsearHoras), -1.5);
  assert.equal(b.parsearConSigno('1:30', b.parsearHoras), 1.5);
  assert.equal(b.parsearConSigno('2,5', b.parsearDias), 2.5);
  assert.equal(b.parsearConSigno('abc', b.parsearDias), null);
  assert.equal(b.parsearConSigno('', b.parsearDias), null);
});

test('puedeApuntar: Leo, Jesús, Rafa y Sergio, nadie más', () => {
  for (const usuario of ['leo', 'jesus', 'rafa', 'sergio', 'LEO']) assert.equal(b.puedeApuntar({ usuario }), true, usuario);
  for (const usuario of ['maria', 'ana', 'isabel', 'jose', '']) assert.equal(b.puedeApuntar({ usuario }), false, usuario);
});

test('tiposApuntables: Plus y Descuento solo con importes visibles', () => {
  const tarifas = [{ id: 1, tipo: 'Domingo', modo: 'fijo', vigente_desde: '2025-01-01', activo: true, orden: 1 }, { id: 2, tipo: 'Plus', modo: 'libre', vigente_desde: '2025-01-01', activo: true, orden: 2 }];
  assert.deepEqual(b.tiposApuntables(tarifas, '2026-11-04', false).map(t => t.tipo), ['Domingo']);
  assert.deepEqual(b.tiposApuntables(tarifas, '2026-11-04', true).map(t => t.tipo), ['Domingo', 'Plus']);
});

test('plantilla: quitado no sale y conserva saldo; vuelve aunque nómina diga baja', () => {
  const t = (num, estado, departamento) => ({ empresa_nif: 'N', formato_origen: 'f', num_empleado: num, nombre: 'P' + num, departamento, estado });
  const trabajadores = [t(1, 'activo', 'Logística'), t(2, 'activo', 'Office'), t(3, 'baja', 'Office'), t(4, 'baja', 'Office'), t(5, 'baja', 'Dirección')];
  const anadidos = [
    { clave: 'N|f|2', nombre: 'P2', area: 'Office', fuera_desde: '2026-11-04' },
    { clave: 'N|f|3', nombre: 'P3', area: 'Office', fuera_desde: null },
    { clave: 'libre|ANA', nombre: 'ANA', area: 'Office', fuera_desde: '2026-10-01' }
  ];
  const saldos = { 'N|f|2': { horas: 6, descanso: 1, por_aprobar: 0, vacaciones: 0, vac_pendientes: 3 }, 'libre|ANA': { horas: 2, descanso: 0, por_aprobar: 0, vacaciones: 0 } };
  const lista = b.construirPlantilla(trabajadores, anadidos, saldos);
  assert.deepEqual(lista.map(e => e.nombre), ['P1', 'P3']);
  const fuera = b.fueraDePlantilla(trabajadores, anadidos, saldos, lista);
  assert.deepEqual(fuera.map(e => e.nombre), ['ANA', 'P2', 'P4']);
  assert.equal(fuera.find(e => e.nombre === 'P2').horas, 6);
  assert.equal(fuera.find(e => e.nombre === 'P2').fuera_desde, '2026-11-04');
  assert.equal(fuera.find(e => e.nombre === 'P4').fuera_desde, null);
});

test('trabajadorDeClave: eventual o de nómina', () => {
  assert.deepEqual(b.trabajadorDeClave('libre|ANA LOPEZ'), { nombre_libre: 'ANA LOPEZ' });
  assert.deepEqual(b.trabajadorDeClave('B1|f|7'), { empresa_nif: 'B1', formato_origen: 'f', num_empleado: '7' });
});
