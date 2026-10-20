const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const L = require('../lib/localizador');

const CABECERAS = ['Vehículo', 'Tipo Vehíc.', 'Matrícula', 'Conductor', 'Inicio', 'Loc. Inicio', 'Destino', 'Loc. Dest.', 'Kilometros', 'Tiempo', 'Hora Inicio', 'Hora Dest.', 'Paradas', 'Tiempo Parada', 'Tiempo Parada Ult. Trayecto.', 'Med. Parada', 'Tiempo Motor enc.', 'Vel. Media.', 'Vel. Max', 'Consumo', 'Coste Consumo', 'Consumo (100KM)', 'Consu. Optimo (100KM)', 'Consu. Optimo', 'Coste C. Opt.'];
const FILA1 = ['RENAULT  (RENAULT)', 'big_van', '7594MPZ', 'sergiorosillo', 'Avenida del Naviero', 'Marbella', 'CARRETERA A-355 KM. 20', 'Monda', 32.35, '0, 00:42:25', '30-09-2026 19:34:29', '30-09-2026 20:16:54', 2, '00:08:55', '0, 00:37:47', '00:04:27', '00:03:10', 58, 113, 6.57, 12.35, 20.31, 12, 3.88, 7.29];
const FILA2 = ['MERCEDES  (MERCEDES COMERCIAL)', 'big_van', '', '', 'CARRETERA A-355 KM. 20', 'Monda', 'Calle Mercurio', 'Marbella', 30.1, '1, 01:00:38', '01-09-2026 07:04:12', '01-09-2026 07:31:42', 0, '00:00:00', '0, 12:06:01', '00:00:00', null, 52, 107, 2.55, 4.19, 11.44, 7, 1.56, 2.56];

function libro(cabeceras, filas) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([cabeceras, ...filas]), 'Trayectos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('segundos', () => {
  assert.equal(L.segundos('0, 00:42:25'), 2545);
  assert.equal(L.segundos('1, 01:00:38'), 90038);
  assert.equal(L.segundos('00:08:55'), 535);
  assert.equal(L.segundos(null), null);
  assert.equal(L.segundos(''), null);
});

test('parsearInforme: lee las filas por nombre de cabecera', () => {
  const r = L.parsearInforme(libro(CABECERAS, [FILA1, FILA2]));
  assert.equal(r.trayectos.length, 2);
  assert.equal(r.desde, '2026-09-01');
  assert.equal(r.hasta, '2026-09-30');
  const t = r.trayectos[0];
  assert.equal(t.vehiculo_nombre, 'RENAULT  (RENAULT)');
  assert.equal(t.matricula, '7594MPZ');
  assert.equal(t.inicio, '2026-09-30 19:34:29');
  assert.equal(t.fin, '2026-09-30 20:16:54');
  assert.equal(t.fecha, '2026-09-30');
  assert.equal(t.destino, 'CARRETERA A-355 KM. 20');
  assert.equal(t.loc_destino, 'Monda');
  assert.equal(t.km, 32.35);
  assert.equal(t.seg_conduccion, 2545);
  assert.equal(t.paradas, 2);
  assert.equal(t.seg_paradas, 535);
  assert.equal(t.seg_motor_parado, 190);
  assert.equal(t.vel_max, 113);
  assert.equal(t.litros, 6.57);
  assert.equal(t.consumo_optimo_100, 12);
  assert.equal(r.trayectos[1].matricula, null);
  assert.equal(r.trayectos[1].seg_motor_parado, null);
});

test('parsearInforme: columnas en otro orden y alguna de más', () => {
  const orden = [...CABECERAS.keys()].reverse();
  const cab = [...orden.map(i => CABECERAS[i]), 'Columna nueva'];
  const fila = [...orden.map(i => FILA1[i]), 'x'];
  const r = L.parsearInforme(libro(cab, [fila]));
  assert.equal(r.trayectos[0].km, 32.35);
  assert.equal(r.trayectos[0].matricula, '7594MPZ');
});

test('parsearInforme: otro informe (sin Kilometros) da error claro', () => {
  const cab = CABECERAS.filter(c => c !== 'Kilometros');
  assert.throws(() => L.parsearInforme(libro(cab, [FILA1.slice(1)])), /Kilometros/);
});

test('parsearInforme: ignora filas vacías', () => {
  const r = L.parsearInforme(libro(CABECERAS, [FILA1, [], FILA2]));
  assert.equal(r.trayectos.length, 2);
});
