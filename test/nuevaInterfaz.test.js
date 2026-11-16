const test = require('node:test');
const assert = require('node:assert');
const N = require('../lib/nuevaInterfaz');

// Horas a las 10:00 de Madrid (09:00 UTC en noviembre).
const ts = d => d + 'T09:00:00Z';

test('esSergio: solo el usuario sergio, sin distinguir mayúsculas', () => {
  assert.equal(N.esSergio({ usuario: 'Sergio' }), true);
  assert.equal(N.esSergio({ usuario: 'leo' }), false);
  assert.equal(N.esSergio(null), false);
});

test('calcularInicio: entregas/recogidas/montajes de hoy, activos, estados del mes y facturación', () => {
  const hoy = '2026-11-16';
  const r = N.calcularInicio({
    proyectos: [
      { numero: 1, estado: 'Confirmed', entrega_ts: ts('2026-11-16'), recogida_ts: ts('2026-11-18'), evento_inicio_ts: ts('2026-11-16') },
      { numero: 2, estado: 'En curso', recogida_ts: ts('2026-11-16'), evento_inicio_ts: ts('2026-11-10') },
      { numero: 3, estado: 'Canceled', entrega_ts: ts('2026-11-16'), evento_inicio_ts: ts('2026-11-16') },
      { numero: 4, estado: 'Confirmed', evento_inicio_ts: ts('2026-10-01'), evento_fin_ts: ts('2026-10-02') },
      { numero: 5, estado: 'Pending', entrega_ts: ts('2026-11-20'), evento_inicio_ts: ts('2026-11-20') }
    ],
    facturas: [
      { importe_sin_iva: 1000, fecha_emision_ts: ts('2026-11-03') },
      { importe_sin_iva: null, importe_con_iva: 121, fecha_emision_ts: ts('2026-11-05') },
      { importe_sin_iva: 500, fecha_emision_ts: ts('2026-06-10') },
      { importe_sin_iva: 999, fecha_emision_ts: ts('2026-05-10') }
    ],
    facturasAnioPasado: [{ importe_sin_iva: 880 }],
    pendientes: [{ pendiente_cobro: 200, fecha_vencimiento_ts: ts('2026-11-01') }, { pendiente_cobro: 0 }, { pendiente_cobro: 50, fecha_vencimiento_ts: ts('2026-12-01') }],
    incidenciasAbiertas: 3,
    sync: [{ tabla: 'proyectos', exito: true, terminado_en: '2026-11-16T08:50:00Z' }, { tabla: 'facturas', exito: false, terminado_en: '2026-11-16T08:40:00Z' }]
  }, hoy);

  assert.equal(r.kpis.entregas_hoy, 1); // el cancelado no cuenta
  assert.equal(r.kpis.recogidas_hoy, 1);
  assert.equal(r.hoy_resumen.montajes, 1);
  assert.equal(r.kpis.proyectos_activos, 2); // 1 (confirmado vigente) + 2 (en curso); el 4 ya terminó
  assert.deepEqual(r.estados_mes.map(e => e.n), [1, 1, 1, 0]);
  assert.equal(r.kpis.facturacion_mes, 1100);
  assert.equal(r.kpis.facturacion_variacion, 25);
  assert.deepEqual(r.facturacion_meses.map(m => m.mes), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  assert.equal(r.facturacion_meses[0].total, 500); // mayo queda fuera
  assert.equal(r.kpis.cobros_pendientes, 250);
  assert.equal(r.kpis.cobros_pendientes_facturas, 2);
  assert.equal(r.kpis.facturas_vencidas, 1);
  assert.equal(r.kpis.importe_vencido, 200);
  // Agenda de hoy ordenada por hora: entrega y montaje del 1 y recogida del 2 (09:00 tal cual)
  assert.deepEqual(r.agenda_hoy.map(a => [a.tipo, a.numero, a.hora]), [['Entrega', 1, '09:00'], ['Evento', 1, '09:00'], ['Recogida', 2, '09:00']]);
  assert.deepEqual(r.proximas_salidas.map(p => p.numero), [1, 5]);
  assert.equal(r.sincronizacion.fallo, true);
  assert.equal(r.sincronizacion.ultima, '2026-11-16T08:50:00Z');
});

test('calcularInicio: horas de Rentman tal cual (hora local guardada como UTC) y 00:00 = sin hora', () => {
  const r = N.calcularInicio({ proyectos: [
    { numero: 7, estado: 'Confirmed', entrega_ts: '2026-11-16T09:00:00Z', evento_inicio_ts: '2026-11-16T00:00:00Z' },
    { numero: 8, estado: 'Confirmed', entrega_ts: '2026-11-15T23:30:00Z' }
  ] }, '2026-11-16');
  assert.deepEqual(r.agenda_hoy.map(a => [a.tipo, a.numero, a.hora]), [['Evento', 7, null], ['Entrega', 7, '09:00']]);
  assert.equal(r.kpis.entregas_hoy, 1); // la de las 23:30 del día 15 no es de hoy
});
