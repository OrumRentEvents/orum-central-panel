// Conexión con Google Calendar (nov 2026), solo lectura. Cada usuario pulsa una
// vez «Conectar con Google» en el Calendario; ORUM guarda su permiso (cifrado) y
// desde entonces lee sus eventos. Las reuniones y visitas se siguen creando en
// Google (decisión del usuario): ORUM no escribe nada allí.
//
// Necesita en Railway GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET (cliente OAuth
// «Aplicación web» con la API de Google Calendar activada y como URI de
// redirección https://<dominio>/api/calendario/google/vuelta). Sin ellas el botón
// no aparece. Sin dependencias: llamadas HTTP directas a Google.
const crypto = require('crypto');

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly'];
const disponible = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

// El permiso de Google (refresh token) se guarda cifrado con AES-256-GCM
const llave = () => crypto.createHash('sha256').update('orum-calendario|' + (process.env.CALENDARIO_CLAVE || process.env.SUPABASE_SERVICE_KEY || 'solo-desarrollo-local')).digest();
function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', llave(), iv);
  const datos = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), datos].map(b => b.toString('base64')).join('.');
}
function descifrar(guardado) {
  const [iv, tag, datos] = String(guardado || '').split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', llave(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(datos), d.final()]).toString('utf8');
}

function urlConsentimiento(redirectUri, state) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
}

async function pedirToken(campos) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...campos })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(d.error_description || d.error || ('Google respondió ' + r.status));
    e.revocado = d.error === 'invalid_grant';
    throw e;
  }
  return d;
}
const canjearCodigo = (code, redirectUri) => pedirToken({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });

// Email de la cuenta, sacado del id_token que devuelve Google (no hace falta verificar
// la firma: viene directamente de Google por HTTPS en el canje del código)
function emailDeIdToken(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).email || null; } catch (e) { return null; }
}

// Token de acceso a partir del permiso guardado, reutilizado mientras dure
const accesos = new Map(); // usuario → { token, caduca }
async function tokenAcceso(usuario, refreshCifrado) {
  const ya = accesos.get(usuario);
  if (ya && ya.caduca > Date.now() + 60000) return ya.token;
  const d = await pedirToken({ refresh_token: descifrar(refreshCifrado), grant_type: 'refresh_token' });
  accesos.set(usuario, { token: d.access_token, caduca: Date.now() + (Number(d.expires_in) || 3000) * 1000 });
  return d.access_token;
}
const olvidarAcceso = usuario => accesos.delete(usuario);

async function api(token, ruta) {
  const r = await fetch('https://www.googleapis.com/calendar/v3' + ruta, { headers: { Authorization: 'Bearer ' + token } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d.error && d.error.message) || ('Google respondió ' + r.status));
  return d;
}

async function listaCalendarios(token) {
  const d = await api(token, '/users/me/calendarList?minAccessRole=reader&maxResults=250');
  return (d.items || []).map(c => ({ id: c.id, nombre: c.summaryOverride || c.summary || c.id, principal: !!c.primary, color: c.backgroundColor || null }));
}

// Eventos de un calendario entre dos instantes (ISO), con las repeticiones ya desplegadas
async function eventos(token, calendarioId, desdeISO, hastaISO) {
  const out = [];
  let pagina = '';
  for (let i = 0; i < 10; i++) {
    const p = new URLSearchParams({ timeMin: desdeISO, timeMax: hastaISO, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    if (pagina) p.set('pageToken', pagina);
    const d = await api(token, '/calendars/' + encodeURIComponent(calendarioId) + '/events?' + p);
    (d.items || []).filter(e => e.status !== 'cancelled').forEach(e => out.push(e));
    if (!d.nextPageToken) break;
    pagina = d.nextPageToken;
  }
  return out;
}

// Reunión o visita comercial: lo marca el calendario (cada usuario elige el tipo
// de cada uno) y, en cualquier calendario, un título que empiece por «Visita».
function tipoDeEvento(evento, tipoCalendario) {
  if (/^\s*visita\b/i.test(evento.summary || '')) return 'visita';
  return tipoCalendario === 'visita' ? 'visita' : 'reunion';
}

function diaAnterior(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
// Evento de Google → evento del calendario de ORUM. Los privados salen como «Ocupado».
function convertir(e, { tipo, usuario, nombre, calendario }) {
  const todoElDia = !!(e.start && e.start.date);
  const privado = e.visibility === 'private' || e.visibility === 'confidential';
  return {
    id: 'g:' + usuario + ':' + e.id, tipo, persona: nombre, usuario,
    titulo: privado ? 'Ocupado' : (e.summary || '(sin título)'),
    inicio: todoElDia ? e.start.date : e.start.dateTime,
    // En Google el fin de un evento de día entero es el día siguiente (exclusivo);
    // en ORUM, el último día (incluido), como las vacaciones
    fin: todoElDia ? diaAnterior(e.end.date) : e.end.dateTime,
    todo_el_dia: todoElDia,
    lugar: privado ? null : (e.location || null),
    detalle: privado ? null : (String(e.description || '').replace(/<[^>]+>/g, ' ').trim().slice(0, 400) || null),
    enlace: privado ? null : (e.htmlLink || null),
    calendario
  };
}

module.exports = { disponible, cifrar, descifrar, urlConsentimiento, canjearCodigo, emailDeIdToken, tokenAcceso, olvidarAcceso, listaCalendarios, eventos, tipoDeEvento, convertir };
