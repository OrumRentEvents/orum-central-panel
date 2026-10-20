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
  const t = (vid, fecha, hora, km, dest, loc) => ({ vehiculo_id: vid, fecha, inicio: fecha + ' ' + hora + ':00', km, destino: dest, loc_destino: loc, seg_conduccion: 1800, seg_paradas: 120 });
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
  // tiempo parado con el motor en marcha (paradas dentro del trayecto)
  assert.equal(iveco.seg_paradas, 7 * 120); // 4 trayectos el día 7 + 3 el día 8
  assert.equal(wilson.seg_paradas, 2 * 120);
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

// ── Segundo formato: "Detalle de trayectos" (sin matrícula, velocidades ni consumo) ──
const CAB_DETALLE = ['Fecha', 'Vehículo', 'Conductor', 'Hora Inicio', 'Inicio', 'Loc. Inicio', 'Hora Destino', 'Destino', 'Loc. Destino', 'Kilometros', 'En marcha', 'Parado', 'Tipo Parada'];
const DET = [
  ['16-10-2026', 'IVECO DAILY (IVECO)', '', '09:57:54', 'CARRETERA A-355 KM. 20', 'Monda', '11:02:47', 'Calle Padre Mariano', 'Manilva', 60.96, '64 min 53 sec', '2 min 11 sec', 'Parada'],
  ['16-10-2026', 'IVECO DAILY (IVECO)', '', '11:04:58', 'Calle Padre Mariano', 'Manilva', '11:04:58', 'Calle Padre Mariano', 'Manilva', 0, '0 min 0 sec', '30 min 59 sec', 'Estacionam.'],
  ['16-10-2026', 'NISSAN INTERSTAR (NISSAN)', '', '23:40:00', 'Calle X', 'Marbella', '00:20:00', 'CARRETERA A-355 KM. 20', 'Monda', 31.2, '40 min 0 sec', '1 min 5 sec', 'Parada'],
  ['TOTAL:', null, null, '', '', null, '', null, null, 92.16, '104 min 53 sec', '34 min 15 sec', null]
];

test('duracion: "64 min 53 sec" y variantes con horas', () => {
  assert.equal(L.duracion('64 min 53 sec'), 3893);
  assert.equal(L.duracion('0 min 0 sec'), 0);
  assert.equal(L.duracion('1 h 4 min 5 sec'), 3845);
  assert.equal(L.duracion(''), null);
});

test('parsearInforme: reconoce el "Detalle de trayectos"', () => {
  const r = L.parsearInforme(libro(CAB_DETALLE, DET));
  assert.equal(r.formato, 'detalle');
  // la fila de estacionamiento (0 km) y la de TOTAL no son trayectos
  assert.equal(r.trayectos.length, 2);
  const t = r.trayectos[0];
  assert.equal(t.vehiculo_nombre, 'IVECO DAILY (IVECO)');
  assert.equal(t.matricula, null);
  assert.equal(t.inicio, '2026-10-16 09:57:54');
  assert.equal(t.fin, '2026-10-16 11:02:47');
  assert.equal(t.km, 60.96);
  assert.equal(t.seg_conduccion, 3893);
  assert.equal(t.seg_paradas, 131);
  assert.equal(t.destino, 'Calle Padre Mariano');
  assert.equal(t.loc_destino, 'Manilva');
  // pasa de medianoche: el fin es del día siguiente
  assert.equal(r.trayectos[1].fin, '2026-10-17 00:20:00');
  // campos que este informe no trae: se indican para no pisarlos al importar
  assert.ok(!r.campos.includes('vel_max'));
  assert.ok(r.campos.includes('km'));
});

test('parsearInforme: el "Informe detallado" indica su formato y todos sus campos', () => {
  const r = L.parsearInforme(libro(CABECERAS, [FILA1]));
  assert.equal(r.formato, 'informe');
  assert.ok(r.campos.includes('vel_max'));
});

test('combinarFormatos: para cada vehículo y día manda el "Informe detallado"', () => {
  const tr = (vid, fecha, hora, formato) => ({ vehiculo_id: vid, fecha, inicio: fecha + ' ' + hora, _formato: formato });
  const validos = [
    tr(1, '2026-10-16', '09:00:00', 'informe'), tr(1, '2026-10-16', '09:30:00', 'detalle'), // mismo día en los dos: fuera el detalle
    tr(1, '2026-10-17', '09:00:00', 'detalle'),                                             // solo detalle: se guarda
    tr(2, '2026-10-16', '10:00:00', 'detalle')                                              // ya hay informe en la base: fuera
  ];
  const r = L.combinarFormatos(validos, new Set(['2|2026-10-16']));
  assert.deepEqual(r.guardar.map(t => t.vehiculo_id + ' ' + t.inicio), ['1 2026-10-16 09:00:00', '1 2026-10-17 09:00:00']);
  assert.equal(r.descartados, 2);
  // días en los que entra el informe: hay que borrar lo que viniera del detalle
  assert.deepEqual(r.diasInforme, ['1|2026-10-16']);
});

test('calcularUso: vueltas sin apuntar en Rutas no se cuelan en el conductor de otra', () => {
  const vehiculos = [{ id: 1, matricula: '6625MYZ', nombre_rutas: 'IVECO' }];
  const t = (hora, km, dest, loc) => ({ vehiculo_id: 1, fecha: '2026-09-07', inicio: '2026-09-07 ' + hora + ':00', km, destino: dest, loc_destino: loc, seg_conduccion: 600, seg_paradas: 0 });
  const trayectos = [t('08:00', 30, 'X', 'Marbella'), t('11:00', 30, ...MONDA), t('15:00', 20, 'Y', 'Coín'), t('18:00', 20, ...MONDA)];
  // solo está apuntada la vuelta 2
  const u = L.calcularUso(trayectos, [{ fecha: '2026-09-07', vehiculo: 'IVECO', vuelta: 2, conductores: ['Wilson'] }], {}, vehiculos);
  assert.equal(u.porConductor.find(c => c.conductor === 'Wilson').km, 40);
  const dia = u.porVehiculo[0].detalle[0];
  assert.deepEqual(dia.vueltas.map(x => [x.vuelta, x.conductor, x.km, !!x.sin_rutas]), [[1, null, 60, true], [2, 'Wilson', 40, false]]);
  // la vuelta sin apuntar va a "sin conductor", no a "sin determinar"
  assert.equal(u.porConductor.find(c => c.conductor === null), undefined);
  assert.deepEqual(u.sinConductor.map(s => [s.fecha, s.km, s.vuelta]), [['2026-09-07', 60, 1]]);
  // una fila con la lista vacía cuenta como no apuntada
  const u2 = L.calcularUso(trayectos, [{ fecha: '2026-09-07', vehiculo: 'IVECO', vuelta: 1, conductores: [] }, { fecha: '2026-09-07', vehiculo: 'IVECO', vuelta: 2, conductores: ['Wilson'] }], {}, vehiculos);
  assert.equal(u2.sinConductor[0].km, 60);
});

test('calcularUso: horas de corte que no cuadran con las vueltas se ignoran', () => {
  const vehiculos = [{ id: 1, matricula: '6625MYZ', nombre_rutas: 'IVECO' }];
  const t = (hora, km) => ({ vehiculo_id: 1, fecha: '2026-09-08', inicio: '2026-09-08 ' + hora + ':00', km, destino: 'CARRETERA A-355 KM. 20', loc_destino: 'Monda', seg_conduccion: 600, seg_paradas: 0 });
  const trayectos = [t('08:00', 10), t('09:00', 10), t('10:00', 10)];
  const rutas = [1, 2].map(v => ({ fecha: '2026-09-08', vehiculo: 'IVECO', vuelta: v, conductores: ['Wilson'] }));
  // dos cortes para dos vueltas: no vale → sigue a revisar y no se pierden km
  const u = L.calcularUso(trayectos, rutas, { '1_2026-09-08': ['08:30', '09:30'] }, vehiculos);
  assert.equal(u.revisar.length, 1);
  assert.equal(u.revisar[0].cortes_invalidos, true);
});

test('fusionarTramos: dos filas con el mismo inicio se suman en vez de perder una', () => {
  const a = { inicio: '2026-09-26 09:11:23', fin: '2026-09-26 09:12:00', km: 0.22, seg_conduccion: 60, seg_paradas: 10, paradas: 1, litros: 0.1, vel_max: 12 };
  const b = { inicio: '2026-09-26 09:11:23', fin: '2026-09-26 09:13:30', km: 0.24, seg_conduccion: 90, seg_paradas: null, paradas: 0, litros: 0.2, vel_max: 15 };
  const f = L.fusionarTramos(a, b);
  assert.equal(f.km, 0.46);
  assert.equal(f.seg_conduccion, 150);
  assert.equal(f.seg_paradas, 10);
  assert.equal(f.vel_max, 15);
  assert.equal(f.fin, '2026-09-26 09:13:30');
});
