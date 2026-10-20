const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../lib/vehiculos');
const a = require('../lib/vehiculosAvisos');

test('calcularRenovacion: {antes, despues} o null si no cambia nada', () => {
  assert.deepEqual(
    v.calcularRenovacion({ fecha_limite: '2026-10-25', km_limite: null, periodicidad_meses: 12 }, { fecha: '2026-10-18' }),
    { antes: { fecha_limite: '2026-10-25', km_limite: null }, despues: { fecha_limite: '2027-10-18', km_limite: null } });
  assert.equal(v.calcularRenovacion({ fecha_limite: '2026-10-25', km_limite: null }, { fecha: '2026-10-18' }), null);
  assert.equal(v.calcularRenovacion(null, { fecha: '2026-10-18' }), null);
});

test('limiteCambiado: solo cuando cambia de verdad la fecha o los km', () => {
  const actual = { fecha_limite: '2026-12-01', km_limite: '120000' };
  assert.equal(v.limiteCambiado(actual, { fecha_limite: '2026-12-01', km_limite: '120000' }), false);
  assert.equal(v.limiteCambiado(actual, { fecha_limite: '2026-12-01', km_limite: 120000 }), false);
  assert.equal(v.limiteCambiado(actual, { descripcion: 'x' }), false);
  assert.equal(v.limiteCambiado(actual, { fecha_limite: '2027-01-01' }), true);
  assert.equal(v.limiteCambiado(actual, { km_limite: null }), true);
});

const venc = (id, estado, estado_notificado, extra) => ({ id, estado, estado_notificado: estado_notificado ?? null, tipo: 'itv', dias_restantes: 5, km_restantes: null, vehiculo: { matricula: '6625MYZ', marca: 'Iveco', modelo: 'Daily' }, ...extra });

test('cambiosDeAviso: avisa al pasar a aviso o a vencido, una sola vez', () => {
  const r = a.cambiosDeAviso([
    venc(1, 'aviso', null),        // nuevo aviso -> email
    venc(2, 'vencido', 'aviso'),   // empeora -> email
    venc(3, 'aviso', 'aviso'),     // ya avisado -> nada
    venc(4, 'vencido', 'vencido'), // ya avisado -> nada
    venc(5, 'ok', null)            // ok -> nada
  ]);
  assert.deepEqual(r.enviar.map(x => x.id), [1, 2]);
  assert.deepEqual(r.actualizar, [{ id: 1, estado_notificado: 'aviso' }, { id: 2, estado_notificado: 'vencido' }]);
});

test('cambiosDeAviso: si mejora se actualiza sin email (para volver a avisar en el futuro)', () => {
  const r = a.cambiosDeAviso([venc(1, 'ok', 'vencido'), venc(2, 'aviso', 'vencido')]);
  assert.deepEqual(r.enviar, []);
  assert.deepEqual(r.actualizar, [{ id: 1, estado_notificado: null }, { id: 2, estado_notificado: 'aviso' }]);
});

test('construirEmailAvisos: asunto con recuento y filas escapadas', () => {
  const { asunto, html } = a.construirEmailAvisos([
    venc(1, 'vencido', null, { tipo: 'seguro', dias_restantes: -3 }),
    venc(2, 'aviso', null, { descripcion: '<b>x</b>' }),
    venc(3, 'aviso', null, { tipo: 'revision', dias_restantes: null, km_restantes: 600 })
  ]);
  assert.equal(asunto, 'Vehículos: 1 vencido, 2 próximos');
  assert.match(html, /6625MYZ/);
  assert.match(html, /vencido hace 3 días/);
  assert.match(html, /faltan 600 km/);
  assert.ok(!html.includes('<b>x</b>'));
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.equal(a.construirEmailAvisos([venc(1, 'aviso', null)]).asunto, 'Vehículos: 1 próximo');
});

// Supabase mínimo en memoria para probar crearAvisos().ejecutar()
function supabaseFalso(tablas) {
  return {
    from(t) {
      tablas[t] = tablas[t] || [];
      const filtros = [];
      const q = {
        _op: 'select', _datos: null,
        select() { return q; }, limit() { return q; },
        eq(k, v) { filtros.push(f => String(f[k]) === String(v)); return q; },
        insert(d) {
          if (t === 'vehiculos_avisos_envios' && tablas[t].some(f => f.fecha === d.fecha)) return Promise.resolve({ error: { code: '23505' } });
          tablas[t].push({ ...d }); return Promise.resolve({ error: null });
        },
        update(d) { q._op = 'update'; q._datos = d; return q; },
        delete() { q._op = 'delete'; return q; },
        then(res, rej) {
          const coinciden = tablas[t].filter(f => filtros.every(fn => fn(f)));
          if (q._op === 'update') coinciden.forEach(f => Object.assign(f, q._datos));
          if (q._op === 'delete') tablas[t] = tablas[t].filter(f => !coinciden.includes(f));
          return Promise.resolve({ data: coinciden, error: null }).then(res, rej);
        }
      };
      return q;
    }
  };
}

test('ejecutar: envía una vez, marca como avisado y el cerrojo evita repetir el mismo día', async () => {
  const tablas = { vehiculos_avisos_destinatarios: [{ email: 'a@x.com', activo: true }], vehiculos_vencimientos: [{ id: 1, estado_notificado: null }] };
  const enviados = [];
  const avisos = a.crearAvisos({
    supabase: supabaseFalso(tablas),
    cargarVencimientos: async () => [venc(1, 'aviso', tablas.vehiculos_vencimientos[0].estado_notificado)],
    enviarCorreo: async (para, asunto) => { enviados.push({ para, asunto }); return { ok: true }; }
  });
  await avisos.ejecutar();
  assert.equal(enviados.length, 1);
  assert.deepEqual(enviados[0].para, ['a@x.com']);
  assert.equal(tablas.vehiculos_vencimientos[0].estado_notificado, 'aviso');
  const r2 = await avisos.ejecutar();
  assert.equal(r2.omitido, true);
  assert.equal(enviados.length, 1);
});

test('ejecutar: si el email falla no se marca nada (se reintenta al día siguiente)', async () => {
  const tablas = { vehiculos_avisos_destinatarios: [{ email: 'a@x.com', activo: true }], vehiculos_vencimientos: [{ id: 1, estado_notificado: null }] };
  const avisos = a.crearAvisos({
    supabase: supabaseFalso(tablas),
    cargarVencimientos: async () => [venc(1, 'vencido', null)],
    enviarCorreo: async () => ({ ok: false, motivo: 'sin transporte' })
  });
  const r = await avisos.ejecutar();
  assert.equal(r.envio.ok, false);
  assert.equal(tablas.vehiculos_vencimientos[0].estado_notificado, null);
});
