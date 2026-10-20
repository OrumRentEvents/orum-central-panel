const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/ranking');
const L = require('../lib/localizador');

const vehiculos = { 1: { id: 1, matricula: '6625MYZ', marca: 'Iveco', modelo: 'Daily', tipo: 'furgoneta' }, 2: { id: 2, matricula: '8939LDW', marca: 'Mercedes', modelo: 'Atego', tipo: 'camion' } };
const t = (conductor, vehiculo_id, vel_max, km, extra) => ({ conductor, vehiculo_id, fecha: '2026-10-01', inicio: '2026-10-01 08:00:00', km, vel_max, seg_conduccion: 3600, seg_paradas: 0, litros: 10, litros_optimo: 10, origen: 'A', loc_origen: 'Monda', destino: 'B', loc_destino: 'Marbella', ...extra });

test('clasificarExceso: umbrales por tipo de vehículo', () => {
  const c = R.CONFIG_DEFECTO;
  assert.equal(R.clasificarExceso(115, 'furgoneta', c), 'leve');
  assert.equal(R.clasificarExceso(110, 'furgoneta', c), null);   // "más de 110"
  assert.equal(R.clasificarExceso(121, 'furgoneta', c), 'grave');
  assert.equal(R.clasificarExceso(95, 'camion', c), 'leve');
  assert.equal(R.clasificarExceso(101, 'camion', c), 'grave');
  assert.equal(R.clasificarExceso(135, 'turismo', c), 'leve');
  assert.equal(R.clasificarExceso(null, 'furgoneta', c), null);
  // tipo desconocido: como furgoneta
  assert.equal(R.clasificarExceso(115, 'otro', c), 'leve');
});

test('calcularRanking: métricas, nota y orden de mejor a peor', () => {
  const tray = [
    // Wilson: 400 km sin excesos, consumo óptimo, sin ralentí → 100
    ...Array.from({ length: 4 }, () => t('Wilson', 1, 100, 100)),
    // Juan: 400 km, 2 graves y 2 leves, 30 min de ralentí en 4 h, 20 % más de consumo
    t('Juan', 1, 125, 100, { seg_paradas: 900 }), t('Juan', 1, 130, 100, { seg_paradas: 900, litros: 14 }),
    t('Juan', 1, 115, 100, { litros: 12 }), t('Juan', 1, 112, 100, { litros: 12 }),
    // Ruben: pocos km → fuera del ranking
    t('Ruben', 2, 105, 50)
  ];
  const r = R.calcularRanking(tray, vehiculos, R.CONFIG_DEFECTO);
  assert.deepEqual(r.ranking.map(x => x.conductor), ['Wilson', 'Juan']);
  assert.deepEqual(r.pocosKm.map(x => x.conductor), ['Ruben']);
  const w = r.ranking[0], j = r.ranking[1];
  assert.equal(w.nota, 100);
  assert.equal(j.km, 400);
  assert.equal(j.graves, 2);
  assert.equal(j.leves, 2);
  assert.equal(j.graves_100km, 0.5);
  assert.equal(j.leves_100km, 0.5);
  assert.equal(j.vel_max, 130);
  assert.equal(j.ralenti_min_h, 7.5);        // 30 min parado / 4 h conducción
  assert.equal(j.consumo_exceso_pct, 20);    // 48 L frente a 40 L óptimos
  // penalizaciones (topes 1 / 2 / 20 / 50): graves 0.5/1*40 = 20 · leves 0.5/2*25 = 6.25 · ralentí 7.5/20*20 = 7.5 · consumo 20/50*15 = 6 → 60.25
  assert.equal(j.nota, 60.3);
  // peores trayectos: los de exceso, de más a menos velocidad
  assert.deepEqual(j.peores.map(p => p.vel_max), [130, 125, 115, 112]);
  assert.equal(j.peores[0].exceso, 'grave');
});

test('calcularRanking: sin consumo óptimo no penaliza consumo y los topes limitan cada concepto', () => {
  const tray = Array.from({ length: 4 }, () => t('Malo', 1, 150, 100, { seg_paradas: 3600, litros: null, litros_optimo: null }));
  const r = R.calcularRanking(tray, vehiculos, R.CONFIG_DEFECTO);
  assert.equal(r.ranking[0].consumo_exceso_pct, null);
  // 1 grave/100 km (tope 1) → 40 de 40; ralentí 60 min/h (tope 20) → 20 de 20; consumo sin dato → 0
  assert.equal(r.ranking[0].nota, 40);
});

test('calcularUso devuelve los trayectos de cada conductor determinado', () => {
  const veh = [{ id: 1, matricula: '6625MYZ', nombre_rutas: 'IVECO' }];
  const tr = (hora, km) => ({ vehiculo_id: 1, fecha: '2026-09-07', inicio: '2026-09-07 ' + hora + ':00', km, destino: 'X', loc_destino: 'Marbella', seg_conduccion: 600, seg_paradas: 0, vel_max: 100 });
  const u = L.calcularUso([tr('08:00', 30), tr('09:00', 20)], [{ fecha: '2026-09-07', vehiculo: 'IVECO', vuelta: 1, conductores: ['Wilson'] }], {}, veh);
  assert.deepEqual(u.trayectosConductor.map(x => [x.conductor, x.km]), [['Wilson', 30], ['Wilson', 20]]);
  // con varios sin marcar no se atribuye a nadie
  const u2 = L.calcularUso([tr('08:00', 30)], [{ fecha: '2026-09-07', vehiculo: 'IVECO', vuelta: 1, conductores: ['A', 'B'] }], {}, veh);
  assert.deepEqual(u2.trayectosConductor, []);
});
