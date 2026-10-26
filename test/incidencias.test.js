const test = require('node:test');
const assert = require('node:assert/strict');
const i = require('../lib/incidencias');

const dir = { usuario: 'sergio', rol: 'Direccion' };
const leo = { usuario: 'leo', rol: 'Logistica' };
const ana = { usuario: 'ana', rol: 'Contabilidad' };
const tablet = { usuario: 'office', rol: 'Office' };
const inc = { creado_por: 'ana', responsable: 'leo', estado: 'abierta' };

test('puedeUsar: los cuatro roles, sin tablets', () => {
  assert.ok(i.puedeUsar(dir) && i.puedeUsar(leo) && i.puedeUsar({ rol: 'Comercial' }));
  assert.ok(!i.puedeUsar(tablet));
  assert.ok(!i.puedeUsar(null));
});

test('puedeVer: creador, responsable y Dirección', () => {
  assert.ok(i.puedeVer(inc, ana));
  assert.ok(i.puedeVer(inc, leo));
  assert.ok(i.puedeVer(inc, dir));
  assert.ok(!i.puedeVer(inc, { usuario: 'maria', rol: 'Contabilidad' }));
  assert.ok(!i.puedeVer({ creado_por: 'x', responsable: null }, { usuario: null, rol: 'Logistica' }));
});

test('puedeCambiarEstado: responsable o Dirección, el creador no', () => {
  assert.ok(i.puedeCambiarEstado(inc, leo));
  assert.ok(i.puedeCambiarEstado(inc, dir));
  assert.ok(!i.puedeCambiarEstado(inc, ana));
  assert.ok(!i.puedeCambiarEstado({ ...inc, responsable: null }, ana));
});

test('puedeReasignar: quien la ve, mientras no esté resuelta', () => {
  assert.ok(i.puedeReasignar(inc, ana));
  assert.ok(!i.puedeReasignar({ ...inc, estado: 'resuelta' }, dir));
});

test('cambioEstado: resolver pide solución; reabrir la borra', () => {
  assert.match(i.cambioEstado(inc, 'resuelta', '  ', 'leo').error, /resuelto/);
  assert.match(i.cambioEstado(inc, 'abierta').error, /Ya está/);
  assert.ok(i.cambioEstado(inc, 'cerrada').error);
  const r = i.cambioEstado(inc, 'resuelta', 'Cambiada la rueda', 'leo').cambios;
  assert.equal(r.estado, 'resuelta');
  assert.equal(r.solucion, 'Cambiada la rueda');
  assert.equal(r.resuelta_por, 'leo');
  const re = i.cambioEstado({ ...inc, estado: 'resuelta' }, 'abierta').cambios;
  assert.equal(re.solucion, null);
  assert.equal(re.resuelta_en, null);
  assert.equal(i.cambioEstado(inc, 'en_curso').cambios.solucion, undefined);
});
