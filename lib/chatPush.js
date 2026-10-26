// Avisos push del chat (oct 2026) — /api/chat/push/*. Cada persona los
// activa en su dispositivo desde la pantalla del chat y elige de qué canales
// (decisión del usuario: cada uno decide). Llegan aunque la app esté cerrada;
// en iPhone solo con la app instalada en la pantalla de inicio.
//
// Claves VAPID en las variables de Railway VAPID_PUBLIC_KEY y
// VAPID_PRIVATE_KEY (se generan una vez con `npx web-push generate-vapid-keys`).
// Sin ellas el chat funciona igual y el botón "Activar avisos" no aparece.
// Tabla chat_suscripciones (sql/chat_push.sql).
const webpush = require('web-push');

const CLAVE_PUBLICA = process.env.VAPID_PUBLIC_KEY || '';
const CLAVE_PRIVADA = process.env.VAPID_PRIVATE_KEY || '';
const disponible = !!(CLAVE_PUBLICA && CLAVE_PRIVADA);
if (disponible) webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:dashboardorum@gmail.com', CLAVE_PUBLICA, CLAVE_PRIVADA);

// Texto del aviso: "Nombre: mensaje" (o "📷 Foto"), recortado
function contenidoAviso(m, nombreCanal) {
  const cuerpo = m.texto ? (m.texto.length > 140 ? m.texto.slice(0, 137) + '…' : m.texto) : '📷 Foto';
  return {
    titulo: 'Chat · ' + nombreCanal,
    cuerpo: (m.nombre || m.usuario) + ': ' + cuerpo,
    url: '/chat?canal=' + m.canal,
    tag: 'chat-' + m.canal
  };
}

function registrar(app, { supabase, requiereLogin, CANALES, canalesDe }) {
  const ruta = (etiqueta, fn) => async (req, res) => {
    try {
      res.json({ ok: true, ...(await fn(req, res)) });
    } catch (err) {
      if (err.estado) return res.status(err.estado).json({ error: err.message });
      console.error('Error en ' + etiqueta + ':', err);
      res.status(500).json({ error: err.message });
    }
  };
  const fallo = (estado, msg) => Object.assign(new Error(msg), { estado });
  const endpointValido = e => typeof e === 'string' && /^https:\/\//.test(e) && e.length < 1000;

  // Clave pública y, si se pasa ?endpoint=, los canales activados en ese dispositivo
  app.get('/api/chat/push/estado', requiereLogin, ruta('GET chat/push/estado', async req => {
    const mios = canalesDe(req.session.usuario);
    let canales = null;
    if (disponible && endpointValido(req.query.endpoint)) {
      const { data, error } = await supabase.from('chat_suscripciones').select('canales')
        .eq('endpoint', req.query.endpoint).eq('usuario', req.session.usuario.usuario);
      if (error) throw error;
      if (data[0]) canales = data[0].canales.filter(c => mios.includes(c));
    }
    return { disponible: disponible && mios.length > 0, clave: disponible ? CLAVE_PUBLICA : null, canales };
  }));

  // Activa (o cambia los canales de) la suscripción de este dispositivo
  app.post('/api/chat/push/suscribir', requiereLogin, ruta('POST chat/push/suscribir', async req => {
    if (!disponible) throw fallo(503, 'Los avisos no están configurados en el servidor');
    const u = req.session.usuario, b = req.body || {}, s = b.suscripcion || {};
    const keys = s.keys || {};
    if (!endpointValido(s.endpoint) || !keys.p256dh || !keys.auth) throw fallo(400, 'Suscripción no válida');
    const mios = canalesDe(u);
    const canales = (Array.isArray(b.canales) ? b.canales : mios).filter(c => mios.includes(c));
    if (!canales.length) {
      const { error } = await supabase.from('chat_suscripciones').delete().eq('endpoint', s.endpoint);
      if (error) throw error;
      return { canales: [] };
    }
    const { error } = await supabase.from('chat_suscripciones').upsert({
      endpoint: s.endpoint, usuario: u.usuario, p256dh: String(keys.p256dh), auth: String(keys.auth), canales,
      descripcion: String(req.get('user-agent') || '').slice(0, 200), actualizado_en: new Date().toISOString()
    });
    if (error) throw error;
    return { canales };
  }));

  app.post('/api/chat/push/quitar', requiereLogin, ruta('POST chat/push/quitar', async req => {
    const endpoint = req.body && req.body.endpoint;
    if (!endpointValido(endpoint)) throw fallo(400, 'Falta el dispositivo');
    const { error } = await supabase.from('chat_suscripciones').delete().eq('endpoint', endpoint).eq('usuario', req.session.usuario.usuario);
    if (error) throw error;
    return {};
  }));

  // Manda el aviso de un mensaje nuevo a todos los dispositivos con ese canal
  // activado, menos a quien lo escribe. El rol se mira al enviar: si alguien
  // cambia de rol y pierde el canal, deja de recibir sus avisos.
  async function avisar(m) {
    if (!disponible) return;
    try {
      const { data: subs, error } = await supabase.from('chat_suscripciones').select('*').contains('canales', [m.canal]).neq('usuario', m.usuario);
      if (error) throw error;
      if (!subs.length) return;
      const { data: usuarios, error: e2 } = await supabase.from('usuarios').select('usuario,rol').in('usuario', [...new Set(subs.map(s => s.usuario))]);
      if (e2) throw e2;
      const rolDe = {}; usuarios.forEach(x => { rolDe[x.usuario] = x.rol; });
      const carga = JSON.stringify(contenidoAviso(m, CANALES[m.canal] || m.canal));
      const caducadas = [];
      await Promise.all(subs.filter(s => canalesDe({ rol: rolDe[s.usuario] }).includes(m.canal)).map(s =>
        webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga, { TTL: 6 * 3600, urgency: 'high' })
          .catch(err => {
            if (err.statusCode === 404 || err.statusCode === 410) caducadas.push(s.endpoint);
            else console.error('Aviso push del chat no enviado (' + s.usuario + '):', err.statusCode || err.message);
          })
      ));
      if (caducadas.length) await supabase.from('chat_suscripciones').delete().in('endpoint', caducadas);
    } catch (err) {
      console.error('Error mandando avisos del chat:', err);
    }
  }

  return { avisar };
}

module.exports = { registrar, contenidoAviso };
