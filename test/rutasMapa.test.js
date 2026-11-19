const test = require('node:test');
const assert = require('node:assert');
const M = require('../lib/rutasMapa');

test('direccionDeParada: usa la dirección del enlace de Google Maps', () => {
  const p = { google_maps_url: 'https://www.google.com/maps/search/?api=1&query=Calle%20Goya%209%2029602%20Marbella%20Andaluc%C3%ADa', localizacion: 'VILLA EL RINCON' };
  assert.equal(M.direccionDeParada(p), 'Calle Goya 9 29602 Marbella Andalucía');
});

test('direccionDeParada: sin enlace, la localización; sin nada, vacío', () => {
  assert.equal(M.direccionDeParada({ google_maps_url: '', localizacion: '  BAR   ISABELLA ' }), 'BAR ISABELLA');
  assert.equal(M.direccionDeParada({ google_maps_url: null, localizacion: null }), '');
  assert.equal(M.direccionDeParada({ google_maps_url: 'no es una url', localizacion: 'X' }), 'X');
});

test('normalizar: minúsculas y espacios simples', () => {
  assert.equal(M.normalizar('  Calle   GOYA 9 '), 'calle goya 9');
});

test('precisionDe: exacta solo con ROOFTOP/RANGE_INTERPOLATED y sin coincidencia parcial', () => {
  assert.equal(M.precisionDe({ geometry: { location_type: 'ROOFTOP' } }), 'exacta');
  assert.equal(M.precisionDe({ geometry: { location_type: 'RANGE_INTERPOLATED' } }), 'exacta');
  assert.equal(M.precisionDe({ geometry: { location_type: 'APPROXIMATE' } }), 'aproximada');
  assert.equal(M.precisionDe({ geometry: { location_type: 'ROOFTOP' }, partial_match: true }), 'aproximada');
  assert.equal(M.precisionDe(null), 'no_encontrada');
});

test('filaDeRespuesta: sin resultados no inventa coordenadas', () => {
  const f = M.filaDeRespuesta('BAR ISABELLA', { status: 'ZERO_RESULTS', results: [] });
  assert.equal(f.lat, null); assert.equal(f.lng, null); assert.equal(f.precision, 'no_encontrada');
});

test('filaDeRespuesta: guarda coordenadas y dirección de Google', () => {
  const f = M.filaDeRespuesta('Calle Goya 9 Marbella', { status: 'OK', results: [{ formatted_address: 'C. Goya, 9, 29602 Marbella', place_id: 'abc', geometry: { location: { lat: 36.5, lng: -4.9 }, location_type: 'ROOFTOP' } }] });
  assert.deepEqual([f.lat, f.lng, f.precision, f.place_id, f.direccion], [36.5, -4.9, 'exacta', 'abc', 'calle goya 9 marbella']);
});

test('cuerpoRuta: origen, intermedios y destino en el orden recibido', () => {
  const b = M.cuerpoRuta([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }, { lat: 5, lng: 6 }]);
  assert.equal(b.origin.location.latLng.latitude, 1);
  assert.equal(b.intermediates.length, 1);
  assert.equal(b.destination.location.latLng.longitude, 6);
  assert.equal(b.routingPreference, 'TRAFFIC_UNAWARE');
});

test('segundos: convierte "1234s"', () => {
  assert.equal(M.segundos('1234s'), 1234);
  assert.equal(M.segundos(undefined), 0);
});

test('coordenadasDeEnlace: la chincheta (!3d!4d) antes que el centro de la vista (@)', () => {
  const url = 'https://www.google.com/maps/place/Central+Log%C3%ADstica+ORUM/@36.6347788,-4.8071633,872m/data=!3m2!1e3!4b1!4m6!3m5!1s0x1:0x2!8m2!3d36.6347001!4d-4.8071002!16s';
  assert.deepEqual(M.coordenadasDeEnlace(url), { lat: 36.6347001, lng: -4.8071002 });
});

test('coordenadasDeEnlace: q=lat,lng y @lat,lng; sin coordenadas, null', () => {
  assert.deepEqual(M.coordenadasDeEnlace('https://maps.google.com/?q=36.51,-4.88'), { lat: 36.51, lng: -4.88 });
  assert.deepEqual(M.coordenadasDeEnlace('https://www.google.com/maps/@36.5,-4.9,15z'), { lat: 36.5, lng: -4.9 });
  assert.equal(M.coordenadasDeEnlace('https://maps.app.goo.gl/xaMzoaZTeYR8CeNV8'), null);
});

test('hostPermitido: solo enlaces https de Google Maps', () => {
  assert.equal(M.hostPermitido('https://maps.app.goo.gl/abc'), true);
  assert.equal(M.hostPermitido('https://www.google.com/maps/place/x'), true);
  assert.equal(M.hostPermitido('http://maps.app.goo.gl/abc'), false);
  assert.equal(M.hostPermitido('https://ejemplo.com/maps'), false);
  assert.equal(M.hostPermitido('no es url'), false);
});

test('huellaRecorrido: igual para los mismos puntos en el mismo orden, distinta si cambia el orden', () => {
  const a = [{ lat: 36.6347788, lng: -4.8071633 }, { lat: 36.51, lng: -4.87 }, { lat: 36.6347788, lng: -4.8071633 }];
  const b = [{ lat: 36.63478, lng: -4.80716 }, { lat: 36.51, lng: -4.87 }, { lat: 36.63478, lng: -4.80716 }];
  assert.equal(M.huellaRecorrido(a), M.huellaRecorrido(b)); // diferencias de menos de 1 m
  const c = [a[0], { lat: 36.52, lng: -4.87 }, a[2]];
  assert.notEqual(M.huellaRecorrido(a), M.huellaRecorrido(c));
});

test('recorrido: el segundo que pide la misma vuelta no llama a Google', async () => {
  const filas = {};
  let llamadasGoogle = 0;
  const tabla = nombre => {
    const q = { _f: {}, select() { return q; }, eq(k, v) { q._f[k] = v; return q; },
      maybeSingle: async () => ({ data: filas[q._f.huella] || null, error: null }),
      update() { return { eq: () => Promise.resolve({}) }; },
      upsert: async fila => { filas[fila.huella] = fila; return { error: null }; },
      delete() { return { lt: () => Promise.resolve({}) }; } };
    return q;
  };
  const rutas = {};
  const app = { get() {}, post(ruta, _, f) { rutas[ruta] = f; } };
  process.env.GOOGLE_MAPS_API_KEY = 'x';
  M.registrar(app, { supabase: { from: tabla }, requiereLogin: () => {}, fetchImpl: async () => { llamadasGoogle++; return { ok: true, json: async () => ({ routes: [{ distanceMeters: 1000, duration: '600s', polyline: { encodedPolyline: 'abc' }, legs: [] }] }) }; } });
  const pedir = () => new Promise(ok => rutas['/api/rutas/mapa/recorrido']({ body: { puntos: [{ lat: 36.6, lng: -4.8 }, { lat: 36.5, lng: -4.9 }, { lat: 36.6, lng: -4.8 }] } }, { json: ok, status: () => ({ json: ok }) }));
  const r1 = await pedir();
  const r2 = await pedir();
  assert.equal(llamadasGoogle, 1);
  assert.equal(r1.guardado, false);
  assert.equal(r2.guardado, true);
  assert.equal(r2.metros, 1000);
  delete process.env.GOOGLE_MAPS_API_KEY;
});
