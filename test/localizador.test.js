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

// ── Vueltas y conductor ──
const tr = (hora, km, destino, loc, extra) => ({ inicio: '2026-09-07 ' + hora + ':00', fecha: '2026-09-07', km, destino, loc_destino: loc, seg_conduccion: 600, ...extra });
const MONDA = ['CARRETERA A-355 KM. 20', 'Monda'];

test('asignarVueltas: una vuelta = todo a la 1', () => {
  const r = L.asignarVueltas([tr('08:00', 30, 'Calle X', 'Marbella'), tr('12:00', 30, ...MONDA)], 1, null);
  assert.deepEqual(r, { vueltas: [1, 1], revisar: false, salidas: 1 });
});

test('asignarVueltas: dos vueltas con dos salidas desde Monda', () => {
  const r = L.asignarVueltas([
    tr('07:00', 0.3, ...MONDA),             // maniobra en el patio
    tr('08:00', 30, 'Calle X', 'Marbella'),
    tr('11:00', 30, ...MONDA),              // fin vuelta 1
    tr('11:10', 0.2, ...MONDA),             // maniobra
    tr('15:00', 40, 'Calle Mercurio', 'Marbella'), // pasa por la nave de Marbella: no corta
    tr('16:00', 5, 'Calle Y', 'Marbella'),
    tr('18:00', 40, ...MONDA)
  ], 2, null);
  assert.deepEqual(r.vueltas, [1, 1, 1, 1, 2, 2, 2]);
  assert.equal(r.revisar, false);
});

test('asignarVueltas: salidas que no cuadran → revisar', () => {
  const r = L.asignarVueltas([tr('08:00', 30, ...MONDA), tr('10:00', 30, ...MONDA), tr('12:00', 30, ...MONDA)], 2, null);
  assert.equal(r.revisar, true);
  assert.equal(r.salidas, 3);
});

test('asignarVueltas: cortes manuales mandan sobre todo lo demás', () => {
  const r = L.asignarVueltas([tr('08:00', 30, ...MONDA), tr('10:00', 30, ...MONDA), tr('12:00', 30, ...MONDA)], 2, ['11:00']);
  assert.deepEqual(r, { vueltas: [1, 1, 2], revisar: false, salidas: 3 });
});

test('conductorDeVuelta', () => {
  assert.equal(L.conductorDeVuelta(null), null);
  assert.equal(L.conductorDeVuelta({ conductores: ['Wilson'] }), 'Wilson');
  assert.equal(L.conductorDeVuelta({ conductores: ['Joaquin', 'Juan Rios'] }), null);
  assert.equal(L.conductorDeVuelta({ conductores: ['Joaquin', 'Juan Rios'], conductor: 'Juan Rios' }), 'Juan Rios');
  // marcado alguien que ya no está entre los que van → sin determinar
  assert.equal(L.conductorDeVuelta({ conductores: ['Joaquin', 'Juan Rios'], conductor: 'Wilson' }), null);
  assert.equal(L.conductorDeVuelta({ conductores: [] }), null);
});

test('calcularUso: reparte km por vuelta y conductor, separa revisar y sin conductor', () => {
  const vehiculos = [{ id: 1, matricula: '6625MYZ', nombre_rutas: 'IVECO' }, { id: 2, matricula: '7594MPZ', nombre_rutas: 'RENAULT' }];
  const t = (vid, fecha, hora, km, dest, loc) => ({ vehiculo_id: vid, fecha, inicio: fecha + ' ' + hora + ':00', km, destino: dest, loc_destino: loc, seg_conduccion: 1800 });
  const trayectos = [
    t(1, '2026-09-07', '08:00', 30, 'X', 'Marbella'), t(1, '2026-09-07', '11:00', 30, ...MONDA),
    t(1, '2026-09-07', '15:00', 20, 'Y', 'Coín'), t(1, '2026-09-07', '18:00', 20, ...MONDA),
    t(2, '2026-09-07', '09:00', 50, 'Z', 'Málaga'),                       // sin Rutas ese día
    t(1, '2026-09-08', '08:00', 10, ...MONDA), t(1, '2026-09-08', '09:00', 10, ...MONDA), t(1, '2026-09-08', '10:00', 10, ...MONDA)
  ];
  const rutas = [
    { fecha: '2026-09-07', vehiculo: 'IVECO', vuelta: 1, conductores: ['Wilson'] },
    { fecha: '2026-09-07', vehiculo: 'IVECO', vuelta: 2, conductores: ['Joaquin', 'Juan Rios'] },
    { fecha: '2026-09-08', vehiculo: 'IVECO', vuelta: 1, conductores: ['Wilson'] },
    { fecha: '2026-09-08', vehiculo: 'IVECO', vuelta: 2, conductores: ['Wilson'] },
    { fecha: '2026-09-09', vehiculo: 'IVECO', vuelta: 1, conductores: ['Wilson'] }   // sin trayectos: no se revisa
  ];
  const u = L.calcularUso(trayectos, rutas, {}, vehiculos);
  const iveco = u.porVehiculo.find(v => v.vehiculo_id === 1);
  assert.equal(iveco.km, 130);
  assert.equal(iveco.dias, 2);
  const wilson = u.porConductor.find(c => c.conductor === 'Wilson');
  assert.equal(wilson.km, 60);
  assert.equal(wilson.dias, 1);
  const sinDet = u.porConductor.find(c => c.conductor === null);
  assert.equal(sinDet.km, 40);
  assert.deepEqual(u.revisar.map(r => [r.vehiculo_id, r.fecha, r.vueltas, r.salidas]), [[1, '2026-09-08', 2, 3]]);
  assert.deepEqual(u.sinConductor.map(s => [s.vehiculo_id, s.fecha, s.km]), [[2, '2026-09-07', 50]]);
  const dia = iveco.detalle.find(d => d.fecha === '2026-09-07');
  assert.deepEqual(dia.vueltas.map(x => [x.vuelta, x.conductor, x.km]), [[1, 'Wilson', 60], [2, null, 40]]);
  // con corte manual el día 8 se reparte
  const u2 = L.calcularUso(trayectos, rutas, { '1_2026-09-08': ['08:30'] }, vehiculos);
  assert.equal(u2.revisar.length, 0);
  assert.equal(u2.porConductor.find(c => c.conductor === 'Wilson').km, 90);
});
