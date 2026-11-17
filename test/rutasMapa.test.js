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
