// Rutas · Mapa (fase 3, nov 2026). Coordenadas de las paradas y recorrido por
// carretera con Google Maps Platform. No cambia nada de Rutas: solo lee
// direcciones y guarda coordenadas en su propia tabla (sql/rutas_geocodigos.sql).
//
// Variables de entorno (Railway):
//   GOOGLE_MAPS_API_KEY      → servidor: Geocoding API + Routes API (no sale al navegador)
//   GOOGLE_MAPS_BROWSER_KEY  → navegador: Maps JavaScript API (restringida por dominio)
//
// Reglas: nunca se inventa una ubicación. Si Google no la encuentra queda
// «no_encontrada»; si solo la sitúa por zona/calle queda «aproximada».
// Distancia y tiempo son la estimación de Google para el orden guardado
// (sin tráfico real): no es la posición ni el recorrido real del vehículo.

const URL_GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json';
const URL_RUTAS = 'https://routes.googleapis.com/directions/v2:computeRoutes';
// Sesgo a la Costa del Sol / Serranía de Ronda (no excluye resultados de fuera)
const LIMITES = '36.20,-5.70|36.95,-4.10';
const MAX_POR_PETICION = 60;
const MAX_PUNTOS_RUTA = 27; // origen + 25 intermedios + destino

// Naves: Marbella según los datos de Rutas; Monda, dada por el usuario (17 nov 2026).
// base: todos los recorridos salen de esa nave y vuelven a ella (pedido del usuario, 19 nov 2026).
const NAVES = [
  { id: 'marbella', nombre: 'Nave Marbella', direccion: 'Mercurio 5, 29603 Marbella, Málaga' },
  { id: 'monda', nombre: 'Nave Monda', direccion: 'Parque Empresarial Monda 13-14, 29110 Monda, Málaga', base: true }
];

// Enlaces de Google Maps que se aceptan para marcar una parada (solo dominios de Google:
// el servidor sigue la redirección de los enlaces cortos y no abre ninguna otra web).
const HOSTS_ENLACE = ['maps.app.goo.gl', 'goo.gl', 'www.google.com', 'google.com', 'maps.google.com', 'www.google.es', 'google.es', 'maps.google.es'];
function hostPermitido(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && HOSTS_ENLACE.includes(u.hostname); } catch (e) { return false; }
}
// Coordenadas dentro de un enlace largo de Google Maps. Por orden de fiabilidad:
//  !3d<lat>!4d<lng>  → el sitio marcado (chincheta)
//  q= / query= / ll= / destination= con «lat,lng»
//  @<lat>,<lng>      → el centro de la vista (último recurso)
function coordenadasDeEnlace(url) {
  const t = decodeURIComponent(String(url || ''));
  const num = '(-?\\d{1,3}\\.\\d+)';
  const ok = (a, b) => { const lat = Number(a), lng = Number(b); return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null; };
  let m = t.match(new RegExp('!3d' + num + '!4d' + num));
  if (m) return ok(m[1], m[2]);
  m = t.match(new RegExp('[?&](?:q|query|ll|destination)=' + num + '\\s*,\\s*' + num));
  if (m) return ok(m[1], m[2]);
  m = t.match(new RegExp('@' + num + ',' + num));
  if (m) return ok(m[1], m[2]);
  return null;
}

// Huella de un recorrido: los puntos (nave, paradas en orden, nave) redondeados a ~1 m.
// Misma huella = mismo recorrido, así que se reutiliza el guardado sin pedirlo a Google.
const crypto = require('crypto');
function huellaRecorrido(puntos) {
  const texto = 'v1|' + puntos.map(p => Number(p.lat).toFixed(5) + ',' + Number(p.lng).toFixed(5)).join(';');
  return crypto.createHash('sha1').update(texto).digest('hex');
}
const DIAS_RECORRIDO = 60; // los recorridos que nadie mira en 60 días se borran

const normalizar = t => String(t || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

// La mejor dirección de una parada: la que va dentro del enlace de Google Maps
// (la que sale de Rentman), y si no hay, el texto de localización.
function direccionDeParada(p) {
  const url = String((p && p.google_maps_url) || '');
  let q = '';
  try { if (url) q = new URL(url).searchParams.get('query') || ''; } catch (e) { q = ''; }
  q = q.replace(/\s+/g, ' ').trim();
  const loc = String((p && p.localizacion) || '').replace(/\s+/g, ' ').trim();
  return q || loc || '';
}

// location_type de Google → precisión que se enseña en pantalla
function precisionDe(r) {
  if (!r || !r.geometry) return 'no_encontrada';
  const t = r.geometry.location_type;
  if (r.partial_match) return 'aproximada';
  return (t === 'ROOFTOP' || t === 'RANGE_INTERPOLATED') ? 'exacta' : 'aproximada';
}

function filaDeRespuesta(consulta, json) {
  const r = json && json.status === 'OK' && json.results && json.results[0];
  if (!r) return { direccion: normalizar(consulta), consulta, lat: null, lng: null, precision: 'no_encontrada', direccion_google: null, place_id: null, tipo_google: json ? json.status : null };
  return {
    direccion: normalizar(consulta), consulta,
    lat: r.geometry.location.lat, lng: r.geometry.location.lng,
    precision: precisionDe(r), direccion_google: r.formatted_address || null,
    place_id: r.place_id || null, tipo_google: r.geometry.location_type || null
  };
}

function cuerpoRuta(puntos) {
  const ll = p => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  return {
    origin: ll(puntos[0]), destination: ll(puntos[puntos.length - 1]),
    intermediates: puntos.slice(1, -1).map(ll),
    travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', languageCode: 'es-ES', units: 'METRIC'
  };
}
const segundos = d => { const n = parseFloat(String(d || '0').replace('s', '')); return isNaN(n) ? 0 : Math.round(n); };

function registrar(app, { supabase, requiereLogin, fetchImpl }) {
  const pedir = fetchImpl || ((...a) => fetch(...a));
  const claveServidor = () => process.env.GOOGLE_MAPS_API_KEY || '';
  const claveNavegador = () => process.env.GOOGLE_MAPS_BROWSER_KEY || '';
  const enCurso = new Map(); // misma dirección pedida a la vez por dos pantallas → una sola consulta
  let ultimaLimpieza = 0;

  async function geocodificarUna(consulta) {
    const clave = normalizar(consulta);
    if (enCurso.has(clave)) return enCurso.get(clave);
    const tarea = (async () => {
      const url = URL_GEOCODE + '?' + new URLSearchParams({ address: consulta, region: 'es', language: 'es', components: 'country:ES', bounds: LIMITES, key: claveServidor() });
      const r = await pedir(url);
      const json = await r.json();
      // Errores de cuenta/clave: no se guardan (se reintentará cuando esté arreglado)
      if (json && ['REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'OVER_DAILY_LIMIT', 'UNKNOWN_ERROR', 'INVALID_REQUEST'].includes(json.status)) {
        throw new Error('Google Geocoding: ' + json.status + (json.error_message ? ' — ' + json.error_message : ''));
      }
      const fila = filaDeRespuesta(consulta, json);
      const { error } = await supabase.from('rutas_geocodigos').upsert({ ...fila, fuente: 'google', verificado: false, actualizado: new Date().toISOString() }, { onConflict: 'direccion' });
      if (error) throw new Error('rutas_geocodigos: ' + error.message);
      return fila;
    })();
    enCurso.set(clave, tarea);
    try { return await tarea; } finally { enCurso.delete(clave); }
  }

  // Estado de la configuración (sin enseñar la clave del servidor)
  app.get('/api/rutas/mapa/config', requiereLogin, (req, res) => {
    res.json({ ok: true, disponible: !!(claveServidor() && claveNavegador()), clave_navegador: claveNavegador() || null, naves: NAVES });
  });

  // Coordenadas de una lista de direcciones: primero la caché; solo lo nuevo va a Google.
  app.post('/api/rutas/mapa/geocodificar', requiereLogin, async (req, res) => {
    try {
      const pedidas = [...new Set((Array.isArray(req.body.direcciones) ? req.body.direcciones : []).map(d => String(d || '').replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, MAX_POR_PETICION);
      if (!pedidas.length) return res.json({ ok: true, resultados: {} });
      const claves = pedidas.map(normalizar);
      const { data, error } = await supabase.from('rutas_geocodigos').select('direccion,consulta,lat,lng,precision,direccion_google,fuente,verificado').in('direccion', claves);
      if (error) throw error;
      const enCache = {};
      (data || []).forEach(f => { enCache[f.direccion] = f; });
      const resultados = {};
      const faltan = pedidas.filter(d => { const f = enCache[normalizar(d)]; if (f) resultados[d] = f; return !f; });
      let aviso = null;
      if (faltan.length && !claveServidor()) aviso = 'Falta configurar GOOGLE_MAPS_API_KEY';
      else {
        for (const d of faltan) {
          try { resultados[d] = await geocodificarUna(d); }
          catch (e) { aviso = e.message; break; }
        }
      }
      res.json({ ok: true, resultados, aviso });
    } catch (err) {
      console.error('Error en /api/rutas/mapa/geocodificar:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Corrección manual de una ubicación (Dirección / Logística): queda verificada.
  app.post('/api/rutas/mapa/ubicacion', requiereLogin, async (req, res) => {
    try {
      const u = req.session.usuario;
      if (!['Direccion', 'Logistica'].includes(u.rol)) return res.status(403).json({ error: 'Solo Logística y Dirección pueden corregir ubicaciones' });
      const consulta = String(req.body.direccion || '').replace(/\s+/g, ' ').trim();
      let lat = Number(req.body.lat), lng = Number(req.body.lng);
      // También se puede pegar el enlace de Google Maps (corto o largo)
      if (req.body.enlace) {
        let url = String(req.body.enlace).trim();
        if (!hostPermitido(url)) return res.status(400).json({ error: 'Pega un enlace de Google Maps (maps.app.goo.gl o google.com/maps)' });
        let c = coordenadasDeEnlace(url);
        if (!c) {
          const r = await pedir(url, { redirect: 'follow' });
          url = r.url || url;
          c = hostPermitido(url) ? coordenadasDeEnlace(url) : null;
        }
        if (!c) return res.status(400).json({ error: 'Ese enlace no trae coordenadas. En Google Maps, pulsa el sitio exacto y comparte ese punto.' });
        lat = c.lat; lng = c.lng;
      }
      if (!consulta || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return res.status(400).json({ error: 'Datos de ubicación no válidos' });
      const fila = { direccion: normalizar(consulta), consulta, lat, lng, precision: 'exacta', fuente: 'manual', verificado: true, usuario: u.nombre || u.usuario, actualizado: new Date().toISOString() };
      const { error } = await supabase.from('rutas_geocodigos').upsert(fila, { onConflict: 'direccion' });
      if (error) throw error;
      res.json({ ok: true, ubicacion: fila });
    } catch (err) {
      console.error('Error en /api/rutas/mapa/ubicacion:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Recorrido por carretera de una vuelta, en el orden guardado.
  app.post('/api/rutas/mapa/recorrido', requiereLogin, async (req, res) => {
    try {
      if (!claveServidor()) return res.json({ ok: false, aviso: 'Falta configurar GOOGLE_MAPS_API_KEY' });
      const puntos = (Array.isArray(req.body.puntos) ? req.body.puntos : [])
        .map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }))
        .filter(p => isFinite(p.lat) && isFinite(p.lng));
      if (puntos.length < 2) return res.json({ ok: false, aviso: 'Hacen falta al menos dos paradas ubicadas' });
      if (puntos.length > MAX_PUNTOS_RUTA) return res.json({ ok: false, aviso: 'Demasiadas paradas para un solo recorrido (máx. ' + MAX_PUNTOS_RUTA + ')' });
      // ¿Ya está calculado? (otra persona, otra pestaña u otro día con la misma vuelta)
      const huella = huellaRecorrido(puntos);
      const guardado = await supabase.from('rutas_recorridos').select('polilinea,metros,segundos,tramos').eq('huella', huella).maybeSingle();
      if (!guardado.error && guardado.data) {
        supabase.from('rutas_recorridos').update({ usado: new Date().toISOString() }).eq('huella', huella).then(() => {}, () => {});
        return res.json({ ok: true, guardado: true, ...guardado.data, tramos: guardado.data.tramos || [] });
      }
      const r = await pedir(URL_RUTAS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': claveServidor(), 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration' },
        body: JSON.stringify(cuerpoRuta(puntos))
      });
      const json = await r.json();
      const ruta = json && json.routes && json.routes[0];
      if (!r.ok || !ruta) return res.json({ ok: false, aviso: 'Google no ha devuelto recorrido' + (json && json.error ? ': ' + json.error.message : '') });
      const resultado = {
        polilinea: ruta.polyline ? ruta.polyline.encodedPolyline : null,
        metros: ruta.distanceMeters || 0, segundos: segundos(ruta.duration),
        tramos: (ruta.legs || []).map(l => ({ metros: l.distanceMeters || 0, segundos: segundos(l.duration) }))
      };
      // Se guarda para los siguientes; si falla el guardado, el recorrido se enseña igual
      const ahora = new Date();
      const ins = await supabase.from('rutas_recorridos').upsert({ huella, ...resultado, creado: ahora.toISOString(), usado: ahora.toISOString() }, { onConflict: 'huella' });
      if (ins.error) console.error('[Rutas mapa] Guardar recorrido:', ins.error.message);
      // Limpieza de los que llevan mucho sin usarse (una vez al día como mucho)
      if (!ultimaLimpieza || ahora - ultimaLimpieza > 86400000) {
        ultimaLimpieza = ahora;
        supabase.from('rutas_recorridos').delete().lt('usado', new Date(ahora - DIAS_RECORRIDO * 86400000).toISOString()).then(() => {}, () => {});
      }
      res.json({ ok: true, guardado: false, ...resultado });
    } catch (err) {
      console.error('Error en /api/rutas/mapa/recorrido:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registrar, huellaRecorrido, coordenadasDeEnlace, hostPermitido, direccionDeParada, normalizar, precisionDe, filaDeRespuesta, cuerpoRuta, segundos, NAVES };
