const test = require('node:test');
const assert = require('node:assert');
process.env.GOOGLE_CLIENT_ID = 'id-prueba';
const G = require('../lib/calendarioGoogle');

test('el permiso de Google se guarda cifrado y se recupera', () => {
  const c = G.cifrar('1//refresh-token');
  assert.ok(!c.includes('refresh'));
  assert.strictEqual(G.descifrar(c), '1//refresh-token');
});

test('la URL de Google pide solo lectura y permiso permanente', () => {
  const u = new URL(G.urlConsentimiento('https://orum.example/api/calendario/google/vuelta', 'abc'));
  assert.strictEqual(u.hostname, 'accounts.google.com');
  assert.match(u.searchParams.get('scope'), /calendar\.readonly/);
  assert.strictEqual(u.searchParams.get('access_type'), 'offline');
  assert.strictEqual(u.searchParams.get('state'), 'abc');
});

test('reunión o visita: el calendario y el título «Visita…»', () => {
  assert.strictEqual(G.tipoDeEvento({ summary: 'Visita finca Los Olivos' }, 'reunion'), 'visita');
  assert.strictEqual(G.tipoDeEvento({ summary: 'Reunión proveedor' }, 'reunion'), 'reunion');
  assert.strictEqual(G.tipoDeEvento({ summary: 'Cliente X' }, 'visita'), 'visita');
});

test('día entero: el fin pasa a ser el último día; los privados salen como Ocupado', () => {
  const e = G.convertir({ id: '1', summary: 'Feria', start: { date: '2026-11-10' }, end: { date: '2026-11-13' } }, { tipo: 'reunion', usuario: 'lucas', nombre: 'Lucas' });
  assert.deepStrictEqual([e.inicio, e.fin, e.todo_el_dia], ['2026-11-10', '2026-11-12', true]);
  const p = G.convertir({ id: '2', summary: 'Médico', visibility: 'private', location: 'X', start: { dateTime: '2026-11-10T10:00:00+01:00' }, end: { dateTime: '2026-11-10T11:00:00+01:00' } }, { tipo: 'reunion', usuario: 'lucas', nombre: 'Lucas' });
  assert.deepStrictEqual([p.titulo, p.lugar, p.todo_el_dia], ['Ocupado', null, false]);
});

test('email de la cuenta desde el id_token', () => {
  const tok = 'x.' + Buffer.from(JSON.stringify({ email: 'lucas@orumevents.com' })).toString('base64url') + '.y';
  assert.strictEqual(G.emailDeIdToken(tok), 'lucas@orumevents.com');
  assert.strictEqual(G.emailDeIdToken('basura'), null);
});
