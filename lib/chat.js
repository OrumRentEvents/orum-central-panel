// Chat por departamento (oct 2026) — /api/chat/*. Tres canales fijos:
// Office, Lavandería y Mantenimiento. Cada rol de tablet ve el suyo;
// Logística y Dirección están en los tres. Texto y fotos; los mensajes no se
// borran ni se editan (decisión del usuario). Tablas en sql/chat.sql.
//
// Tiempo real: como Rutas, Server-Sent Events en memoria (una sola instancia
// en Railway). Cada pantalla abierta mantiene GET /api/chat/eventos y recibe
// los mensajes nuevos de sus canales.
const multer = require('multer');

const CANALES = { office: 'Office', lavanderia: 'Lavandería', mantenimiento: 'Mantenimiento' };
const CANALES_POR_ROL = {
  Office: ['office'],
  Lavanderia: ['lavanderia'],
  Mantenimiento: ['mantenimiento'],
  Logistica: Object.keys(CANALES),
  Direccion: Object.keys(CANALES)
};
const BUCKET = 'chat-fotos';
const MAX_TEXTO = 2000;
const POR_PAGINA = 50;

const canalesDe = u => (u && CANALES_POR_ROL[u.rol]) || [];

function registrar(app, { supabase, requiereLogin }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  const subirFoto = (req, res, next) => upload.single('foto')(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'La foto supera los 10 MB' : err.message });
    next();
  });

  async function q(promesa) {
    const { data, error } = await promesa;
    if (error) throw error;
    return data;
  }
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
  function canalPermitido(req) {
    const canal = String(req.params.canal || '');
    if (!CANALES[canal]) throw fallo(404, 'Ese chat no existe');
    if (!canalesDe(req.session.usuario).includes(canal)) throw fallo(403, 'No tienes acceso a este chat');
    return canal;
  }
  // Lo que ve la pantalla de cada mensaje (la foto se pide aparte, con permiso)
  const publico = m => ({ id: m.id, canal: m.canal, usuario: m.usuario, nombre: m.nombre, rol: m.rol, texto: m.texto, foto: !!m.foto_ruta, creado_en: m.creado_en });

  // ── Tiempo real ──
  const clientes = new Set(); // { res, canales }
  function emitir(mensaje) {
    const linea = 'data: ' + JSON.stringify({ tipo: 'mensaje', mensaje: publico(mensaje) }) + '\n\n';
    clientes.forEach(c => { if (c.canales.includes(mensaje.canal)) { try { c.res.write(linea); } catch (e) {} } });
    avisos.avisar(mensaje); // push a los dispositivos con avisos activados (lib/chatPush.js)
  }
  const avisos = require('./chatPush').registrar(app, { supabase, requiereLogin, CANALES, canalesDe });
  setInterval(() => { clientes.forEach(c => { try { c.res.write(': latido\n\n'); } catch (e) {} }); }, 25000).unref();

  app.get('/api/chat/eventos', requiereLogin, (req, res) => {
    const canales = canalesDe(req.session.usuario);
    if (!canales.length) return res.status(403).json({ error: 'Sin chats' });
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    const cliente = { res, canales };
    clientes.add(cliente);
    req.on('close', () => clientes.delete(cliente));
  });

  // Mis canales con los mensajes sin leer y el último mensaje de cada uno
  app.get('/api/chat/canales', requiereLogin, ruta('GET chat/canales', async req => {
    const u = req.session.usuario, mios = canalesDe(u);
    if (!mios.length) return { canales: [] };
    const [lecturas, ultimos] = await Promise.all([
      q(supabase.from('chat_lecturas').select('canal,ultimo_id').eq('usuario', u.usuario)),
      Promise.all(mios.map(c => q(supabase.from('chat_mensajes').select('*').eq('canal', c).order('id', { ascending: false }).limit(1))))
    ]);
    const leido = {}; lecturas.forEach(l => { leido[l.canal] = Number(l.ultimo_id) || 0; });
    const sinLeer = await Promise.all(mios.map(async c => {
      const { count, error } = await supabase.from('chat_mensajes').select('id', { count: 'exact', head: true })
        .eq('canal', c).gt('id', leido[c] || 0).neq('usuario', u.usuario);
      if (error) throw error;
      return count || 0;
    }));
    return { canales: mios.map((c, i) => ({ id: c, nombre: CANALES[c], sin_leer: sinLeer[i], ultimo: ultimos[i][0] ? publico(ultimos[i][0]) : null })) };
  }));

  // Mensajes de un canal: los 50 últimos, o los anteriores a ?antes=id
  app.get('/api/chat/:canal/mensajes', requiereLogin, ruta('GET chat/mensajes', async req => {
    const canal = canalPermitido(req);
    let consulta = supabase.from('chat_mensajes').select('*').eq('canal', canal).order('id', { ascending: false }).limit(POR_PAGINA);
    const antes = parseInt(req.query.antes);
    if (antes > 0) consulta = consulta.lt('id', antes);
    const filas = await q(consulta);
    return { canal, nombre: CANALES[canal], mensajes: filas.reverse().map(publico), hay_mas: filas.length === POR_PAGINA };
  }));

  app.post('/api/chat/:canal/mensajes', requiereLogin, subirFoto, ruta('POST chat/mensajes', async req => {
    const canal = canalPermitido(req);
    const u = req.session.usuario;
    const texto = String((req.body && req.body.texto) || '').trim().slice(0, MAX_TEXTO);
    if (req.file && !/^image\//.test(req.file.mimetype)) throw fallo(400, 'Solo se pueden mandar fotos');
    if (!texto && !req.file) throw fallo(400, 'Escribe algo o manda una foto');
    let foto_ruta = null;
    if (req.file) {
      const ext = req.file.mimetype === 'image/png' ? 'png' : req.file.mimetype === 'image/webp' ? 'webp' : 'jpg';
      foto_ruta = canal + '/' + new Date().toISOString().slice(0, 7) + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const { error } = await supabase.storage.from(BUCKET).upload(foto_ruta, req.file.buffer, { contentType: req.file.mimetype });
      if (error) throw error;
    }
    const [m] = await q(supabase.from('chat_mensajes').insert({ canal, usuario: u.usuario, nombre: u.nombre || u.usuario, rol: u.rol, texto: texto || null, foto_ruta }).select());
    // Quien escribe ya ha leído hasta su propio mensaje
    await q(supabase.from('chat_lecturas').upsert({ usuario: u.usuario, canal, ultimo_id: m.id, actualizado_en: new Date().toISOString() }));
    emitir(m);
    return { mensaje: publico(m) };
  }));

  // Marca como leído hasta el mensaje indicado (nunca hacia atrás)
  app.post('/api/chat/:canal/leido', requiereLogin, ruta('POST chat/leido', async req => {
    const canal = canalPermitido(req);
    const u = req.session.usuario, hasta = parseInt(req.body && req.body.ultimo_id) || 0;
    const [actual] = await q(supabase.from('chat_lecturas').select('ultimo_id').eq('usuario', u.usuario).eq('canal', canal));
    if (!actual || Number(actual.ultimo_id) < hasta) {
      await q(supabase.from('chat_lecturas').upsert({ usuario: u.usuario, canal, ultimo_id: hasta, actualizado_en: new Date().toISOString() }));
    }
    return {};
  }));

  // Foto de un mensaje: enlace temporal de Supabase, solo para quien está en ese chat
  app.get('/api/chat/foto/:id', requiereLogin, async (req, res) => {
    try {
      const [m] = await q(supabase.from('chat_mensajes').select('canal,foto_ruta').eq('id', parseInt(req.params.id) || 0));
      if (!m || !m.foto_ruta) return res.status(404).send('No encontrada');
      if (!canalesDe(req.session.usuario).includes(m.canal)) return res.status(403).send('Sin acceso');
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(m.foto_ruta, 600);
      if (error) throw error;
      res.set('Cache-Control', 'private, max-age=500');
      res.redirect(data.signedUrl);
    } catch (err) {
      console.error('Error en GET chat/foto:', err);
      res.status(500).send('Error');
    }
  });
}

module.exports = { registrar, CANALES, CANALES_POR_ROL, canalesDe };
