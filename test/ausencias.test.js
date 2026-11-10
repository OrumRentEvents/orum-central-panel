const test = require('node:test');
const assert = require('node:assert');
const A = require('../lib/ausencias');

test('vacaciones: cada día del periodo dentro del rango', () => {
  const r = A.ausenciasPorDia({ desde: '2026-11-10', hasta: '2026-11-12', vacaciones: [{ clave: 'a', nombre: 'ROMO LARA, RUBEN', fecha_inicio: '2026-11-08', fecha_fin: '2026-11-11' }] });
  assert.deepStrictEqual(Object.keys(r).sort(), ['2026-11-10', '2026-11-11']);
  assert.strictEqual(r['2026-11-10'][0].tipo, 'vacaciones');
});

test('descanso: días seguidos desde la fecha y medio día al final', () => {
  const r = A.ausenciasPorDia({ desde: '2026-11-01', hasta: '2026-11-30', movimientos: [{ clave: 'a', nombre: 'X', tipo: 'descanso', cantidad: -1.5, fecha: '2026-11-14' }] });
  assert.deepStrictEqual(Object.keys(r).sort(), ['2026-11-14', '2026-11-15']);
  assert.strictEqual(r['2026-11-14'][0].medio, false);
  assert.strictEqual(r['2026-11-15'][0].medio, true);
});

test('lo anulado, lo sumado y lo rechazado no cuenta', () => {
  const r = A.ausenciasPorDia({
    desde: '2026-11-01', hasta: '2026-11-30',
    movimientos: [
      { clave: 'a', nombre: 'X', tipo: 'descanso', cantidad: -1, fecha: '2026-11-02', anulado_en: '2026-11-03' },
      { clave: 'a', nombre: 'X', tipo: 'descanso', cantidad: 1, fecha: '2026-11-04' },
      { clave: 'a', nombre: 'X', tipo: 'horas', cantidad: -3, fecha: '2026-11-05' }
    ],
    registros: [{ nombre_libre: 'Y', nombre_trabajador: 'Y', tipo: 'Descanso Disfrutado', fecha: '2026-11-06', estado: 'rechazado' }],
    vacaciones: [{ clave: 'b', nombre: 'Z', fecha_inicio: '2026-11-07', fecha_fin: '2026-11-08', anulado_en: 'x' }]
  });
  assert.deepStrictEqual(r, {});
});

test('vacaciones manda sobre descanso el mismo día', () => {
  const r = A.ausenciasPorDia({
    desde: '2026-11-01', hasta: '2026-11-30',
    movimientos: [{ clave: 'a', nombre: 'X', tipo: 'descanso', cantidad: -0.5, fecha: '2026-11-10' }],
    vacaciones: [{ clave: 'a', nombre: 'X', fecha_inicio: '2026-11-10', fecha_fin: '2026-11-10' }]
  });
  assert.strictEqual(r['2026-11-10'].length, 1);
  assert.strictEqual(r['2026-11-10'][0].tipo, 'vacaciones');
  assert.strictEqual(r['2026-11-10'][0].medio, false);
});

test('registro antiguo de Descanso Disfrutado: un día con su clave de nómina', () => {
  const r = A.ausenciasPorDia({ desde: '2026-11-01', hasta: '2026-11-30', registros: [{ empresa_nif: 'B1', formato_origen: 'f', num_empleado: '7', nombre_trabajador: 'X', tipo: 'Descanso Disfrutado', fecha: '2026-11-03', estado: 'aprobado' }] });
  assert.strictEqual(r['2026-11-03'][0].clave, 'B1|f|7');
});

const BOLSA = ['AGUILERA MARTIN, JESUS', 'CALERO VALERO, JESUS', 'LEONARDO FERREYRA, RAFAEL', 'PEREZ SERRANO, RAFAEL JOSE', 'RUIZ GUERRERO, JOAQUIN LUIS', 'WILSON RUIS, CARLOS PAUL', 'RIOS NAVAS, JUAN FRANCISCO', 'MORALES VILLASANA, JUAN']
  .map((n, i) => ({ clave: 'c' + i, nombre: n }));

test('empareja los choferes de Rutas con la nómina', () => {
  const m = A.emparejarChoferes(['Jesus Aguilera', 'Jesus Calero', 'Leo Ferreyra', 'Rafa Perez', 'Joaquin', 'Wilson', 'Juan Rios', 'Juan Morales'], BOLSA);
  assert.deepStrictEqual(m, { 'Jesus Aguilera': 'c0', 'Jesus Calero': 'c1', 'Leo Ferreyra': 'c2', 'Rafa Perez': 'c3', Joaquin: 'c4', Wilson: 'c5', 'Juan Rios': 'c6', 'Juan Morales': 'c7' });
});

test('si no encaja o encaja con varios, no se empareja; los fijos mandan', () => {
  const m = A.emparejarChoferes(['Leo Haro', 'Carlos Maldonado', 'Jesus', 'Nourdin'], BOLSA, { Nourdin: 'zz' });
  assert.deepStrictEqual(m, { Nourdin: 'zz' });
});

test('ausencias con el nombre de Rutas', () => {
  const porDia = A.ausenciasPorDia({ desde: '2026-11-10', hasta: '2026-11-10', vacaciones: [{ clave: 'c0', nombre: 'AGUILERA MARTIN, JESUS', fecha_inicio: '2026-11-10', fecha_fin: '2026-11-10' }, { clave: 'q', nombre: 'GARCIA, ANA', fecha_inicio: '2026-11-10', fecha_fin: '2026-11-10' }] });
  assert.deepStrictEqual(A.ausenciasDeChoferes(porDia, ['Jesus Aguilera', 'Leo Haro']), { '2026-11-10': [{ chofer: 'Jesus Aguilera', tipo: 'vacaciones', medio: false }] });
});

test('turno: el cambio del día manda sobre el semanal', () => {
  const semana = [{ clave: 'a', dia: 2, entrada: '08:00:00', salida: '16:00:00' }];
  assert.deepStrictEqual(A.turnoDelDia('a', '2026-11-10', semana, []), { entrada: '08:00', salida: '16:00', entrada2: null, salida2: null, libre: false, cambio: false, nota: null });
  const t = A.turnoDelDia('a', '2026-11-10', semana, [{ clave: 'a', fecha: '2026-11-10', entrada: '14:00', salida: '22:00' }]);
  assert.strictEqual(t.entrada, '14:00');
  assert.strictEqual(t.cambio, true);
  assert.strictEqual(A.turnoDelDia('a', '2026-11-11', semana, []), null);
});
