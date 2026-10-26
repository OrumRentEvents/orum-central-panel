// Usuarios de ORUM Central (oct 2026): se gestionan desde el panel (Sistema →
// Usuarios), directo en la tabla usuarios de Supabase. Antes se editaban a
// mano en la pestaña USUARIOS de la hoja de Google (con el hash bcrypt hecho
// aparte) y un aviso del Apps Script + el cron los copiaban a Supabase.
// Solo Sergio puede entrar (decisión del 25 oct 2026).
//
// Acceso: en el ordenador, usuario + contraseña (/api/login en server.js).
// En el móvil, solo un PIN de 4 cifras (/api/login-pin, aquí), como en Rutas:
// el PIN identifica a la persona, así que cada usuario tiene uno distinto.
// Un PIN de 4 cifras se adivina probando, por eso los fallos se limitan.

const ROLES = ['Direccion', 'Contabilidad', 'Comercial', 'Logistica', 'Lavanderia', 'Office'];
const ADMIN = 'sergio';
// Usuarios de las tablets de Lavandería y Office: solo entran en la app móvil
// y solo ven su zona de Preparación. El resto del panel les está cerrado.
const ROLES_SOLO_MOVIL = ['Lavanderia', 'Office'];
const API_SOLO_MOVIL = ['/api/sesion', '/api/logout', '/api/preparacion', '/api/preparacion/check', '/api/movil/'];
const crypto = require('crypto');
const huella = token => crypto.createHash('sha256').update(String(token)).digest('hex');
const CADUCIDAD_DISPOSITIVO_MS = 180 * 864e5;
const FORMATO_USUARIO = /^[a-z0-9._-]{2,30}$/;
const FORMATO_PIN = /^\d{4}$/;

// Fallos de PIN: 5 seguidos desde la misma conexión la bloquean 15 min; 30 en
// total en 15 min cierran la entrada con PIN para todos (la contraseña sigue).
const VENTANA_MS = 15 * 60 * 1000;
const FALLOS_POR_IP = 5;
const FALLOS_GLOBALES = 30;
const fallosPorIp = new Map();   // ip -> { n, desde }
let fallosGlobales = [];         // marcas de tiempo

function registrar(app, { supabase, bcrypt }) {
  // Va antes que cualquier otra ruta /api: una sesión de tablet no pasa de aquí.
  app.use('/api', (req, res, next) => {
    const u = req.session.usuario;
    if (!u || !ROLES_SOLO_MOVIL.includes(u.rol)) return next();
    const pedida = '/api' + req.path;
    if (API_SOLO_MOVIL.some(p => pedida === p || (p.endsWith('/') && pedida.startsWith(p)))) return next();
    res.status(403).json({ error: 'Este usuario solo puede usar Preparación en la app móvil' });
  });

  const soloSergio = (req, res, next) => {
    const u = req.session.usuario;
    if (!u) return res.status(401).json({ error: 'No autenticado' });
    if (String(u.usuario || '').toLowerCase() !== ADMIN) return res.status(403).json({ error: 'Solo Sergio puede gestionar usuarios' });
    next();
  };
  const ruta = fn => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  };
  const fallo = (status, msg) => Object.assign(new Error(msg), { status });
  const comprobar = (r, que) => { if (r.error) throw new Error(que + ': ' + r.error.message); return r.data; };
  const limpiar = s => String(s == null ? '' : s).trim();

  // El PIN no puede repetirse: al entrar solo con él no se sabría quién es.
  async function pinLibre(pin, usuarioPropio) {
    const filas = comprobar(await supabase.from('usuarios').select('usuario,pin_hash').not('pin_hash', 'is', null), 'usuarios');
    const dueno = (filas || []).find(f => f.usuario !== usuarioPropio && f.pin_hash && bcrypt.compareSync(pin, f.pin_hash));
    if (dueno) throw fallo(409, 'Ese PIN ya lo tiene otro usuario; elige otro');
  }

  async function validar(b, nuevo, usuarioPropio) {
    const fila = {};
    if (nuevo || b.nombre !== undefined) { fila.nombre = limpiar(b.nombre); if (!fila.nombre) throw fallo(400, 'Falta el nombre'); }
    if (nuevo || b.rol !== undefined) { fila.rol = limpiar(b.rol); if (!ROLES.includes(fila.rol)) throw fallo(400, 'Rol no válido'); }
    if (b.comercial_filtro !== undefined || nuevo) fila.comercial_filtro = limpiar(b.comercial_filtro) || null;
    if (b.password !== undefined && b.password !== '') {
      if (String(b.password).length < 6) throw fallo(400, 'La contraseña debe tener al menos 6 caracteres');
      fila.password_hash = bcrypt.hashSync(String(b.password), 10);
    } else if (nuevo) throw fallo(400, 'Falta la contraseña');
    if (b.quitar_pin) fila.pin_hash = null;
    else if (b.pin !== undefined && b.pin !== '') {
      const pin = limpiar(b.pin);
      if (!FORMATO_PIN.test(pin)) throw fallo(400, 'El PIN tiene que ser de 4 cifras');
      await pinLibre(pin, usuarioPropio);
      fila.pin_hash = bcrypt.hashSync(pin, 10);
    }
    fila.sincronizado_en = new Date().toISOString();
    return fila;
  }

  app.get('/api/usuarios', soloSergio, ruta(async () => {
    const data = comprobar(await supabase.from('usuarios').select('usuario,nombre,rol,comercial_filtro,pin_hash').order('rol').order('nombre'), 'usuarios');
    return {
      ok: true, roles: ROLES,
      data: (data || []).filter(u => limpiar(u.usuario)).map(({ pin_hash, ...u }) => ({ ...u, tiene_pin: !!pin_hash }))
    };
  }));

  app.post('/api/usuarios', soloSergio, ruta(async req => {
    const b = req.body || {};
    const usuario = limpiar(b.usuario).toLowerCase();
    if (!FORMATO_USUARIO.test(usuario)) throw fallo(400, 'Usuario no válido (solo letras, números, punto o guion, sin espacios)');
    const ya = comprobar(await supabase.from('usuarios').select('usuario').ilike('usuario', usuario), 'usuarios');
    if (ya && ya.length) throw fallo(409, 'Ya existe un usuario "' + usuario + '"');
    comprobar(await supabase.from('usuarios').insert({ usuario, ...(await validar(b, true, usuario)) }), 'crear usuario');
    return { ok: true };
  }));

  app.put('/api/usuarios/:usuario', soloSergio, ruta(async req => {
    const usuario = limpiar(req.params.usuario);
    const b = req.body || {};
    const cambios = await validar(b, false, usuario);
    if (usuario.toLowerCase() === ADMIN && cambios.rol && cambios.rol !== 'Direccion') throw fallo(400, 'Sergio tiene que seguir siendo Dirección');

    // Cambiar el usuario de acceso: es la clave de la tabla y lo usan los
    // registros de extras ("mis registros"), que se renombran con él.
    const nuevo = b.nuevo_usuario === undefined ? usuario : limpiar(b.nuevo_usuario).toLowerCase();
    const renombrar = nuevo !== usuario;
    if (renombrar) {
      if (usuario.toLowerCase() === ADMIN) throw fallo(400, 'El usuario "sergio" no se puede renombrar: es el que administra el panel');
      if (!FORMATO_USUARIO.test(nuevo)) throw fallo(400, 'Usuario no válido (solo letras, números, punto o guion, sin espacios)');
      const ya = comprobar(await supabase.from('usuarios').select('usuario').ilike('usuario', nuevo), 'usuarios');
      if (ya && ya.length) throw fallo(409, 'Ya existe un usuario "' + nuevo + '"');
      cambios.usuario = nuevo;
    }

    const r = comprobar(await supabase.from('usuarios').update(cambios).eq('usuario', usuario).select('usuario'), 'guardar usuario');
    if (!r || !r.length) throw fallo(404, 'Usuario no encontrado');
    // PIN nuevo o quitado: los móviles que lo recordaban tienen que volver a teclearlo.
    // (Al renombrar, la clave foránea con on update cascade ya los mueve al nuevo usuario.)
    if ('pin_hash' in cambios) comprobar(await supabase.from('movil_dispositivos').delete().eq('usuario', nuevo), 'olvidar dispositivos');
    if (renombrar) comprobar(await supabase.from('extras_registros').update({ registrado_por: nuevo }).eq('registrado_por', usuario), 'renombrar en extras');
    return { ok: true, usuario: nuevo };
  }));

  app.delete('/api/usuarios/:usuario', soloSergio, ruta(async req => {
    const usuario = limpiar(req.params.usuario);
    if (usuario.toLowerCase() === ADMIN) throw fallo(400, 'No puedes borrar tu propio usuario');
    const r = comprobar(await supabase.from('usuarios').delete().eq('usuario', usuario).select('usuario'), 'borrar usuario');
    if (!r || !r.length) throw fallo(404, 'Usuario no encontrado');
    return { ok: true };
  }));

  // Entrada con PIN (móvil). Misma sesión que con contraseña.
  app.post('/api/login-pin', ruta(async req => {
    // La última IP de x-forwarded-for la pone el proxy de Railway; las anteriores
    // las puede inventar quien llama (y así saltarse el límite por conexión).
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',').pop().trim();
    const ahora = Date.now();
    fallosGlobales = fallosGlobales.filter(t => ahora - t < VENTANA_MS);
    const deIp = fallosPorIp.get(ip);
    if (deIp && ahora - deIp.desde >= VENTANA_MS) fallosPorIp.delete(ip);
    const bloqueada = fallosPorIp.get(ip);
    if (bloqueada && bloqueada.n >= FALLOS_POR_IP) throw fallo(429, 'Demasiados intentos. Espera unos minutos o entra con tu contraseña.');
    if (fallosGlobales.length >= FALLOS_GLOBALES) throw fallo(429, 'La entrada con PIN está pausada unos minutos por demasiados intentos. Entra con tu contraseña.');

    const pin = limpiar((req.body || {}).pin);
    const filas = FORMATO_PIN.test(pin)
      ? comprobar(await supabase.from('usuarios').select('usuario,nombre,rol,comercial_filtro,pin_hash').not('pin_hash', 'is', null), 'usuarios')
      : [];
    const u = (filas || []).find(f => f.pin_hash && bcrypt.compareSync(pin, f.pin_hash));
    if (!u) {
      const f = fallosPorIp.get(ip) || { n: 0, desde: ahora };
      f.n++; fallosPorIp.set(ip, f);
      fallosGlobales.push(ahora);
      throw fallo(401, 'PIN incorrecto');
    }
    fallosPorIp.delete(ip);
    abrirSesionMovil(req, u);
    // El móvil guarda esta llave para volver a entrar sin PIN (ver sql/movil_dispositivos.sql).
    let dispositivo = null;
    if ((req.body || {}).recordar) {
      dispositivo = crypto.randomBytes(32).toString('hex');
      const descripcion = limpiar(req.headers['user-agent']).slice(0, 200) || null;
      comprobar(await supabase.from('movil_dispositivos').insert({ token_hash: huella(dispositivo), usuario: u.usuario, descripcion, ultimo_uso: new Date().toISOString() }), 'recordar dispositivo');
    }
    return { ok: true, usuario: req.session.usuario, dispositivo };
  }));

  function abrirSesionMovil(req, u) {
    req.session.usuario = { usuario: u.usuario, nombre: u.nombre, rol: u.rol, comercial_filtro: u.comercial_filtro || null };
    req.session.cookie.maxAge = 30 * 864e5;
  }

  // Accesos directos de cada usuario (sql/usuarios_accesos.sql). Solo se
  // guardan ids; qué puede abrir cada rol lo sigue decidiendo cada pantalla.
  const LISTAS_ACCESOS = ['escritorio', 'movil'];
  app.get('/api/mis-accesos', ruta(async req => {
    const u = req.session.usuario;
    if (!u) throw fallo(401, 'No autenticado');
    const filas = comprobar(await supabase.from('usuarios').select('accesos').eq('usuario', u.usuario), 'usuarios');
    return { ok: true, accesos: (filas && filas[0] && filas[0].accesos) || {} };
  }));
  app.put('/api/mis-accesos', ruta(async req => {
    const u = req.session.usuario;
    if (!u) throw fallo(401, 'No autenticado');
    const b = req.body || {};
    const filas = comprobar(await supabase.from('usuarios').select('accesos').eq('usuario', u.usuario), 'usuarios');
    const accesos = Object.assign({}, (filas && filas[0] && filas[0].accesos) || {});
    LISTAS_ACCESOS.forEach(k => {
      if (b[k] === undefined) return;
      if (b[k] === null) { delete accesos[k]; return; }
      if (!Array.isArray(b[k]) || b[k].length > 40 || !b[k].every(id => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id))) throw fallo(400, 'Lista de accesos no válida');
      accesos[k] = [...new Set(b[k])];
    });
    comprobar(await supabase.from('usuarios').update({ accesos }).eq('usuario', u.usuario), 'guardar accesos');
    return { ok: true, accesos };
  }));

  // Volver a entrar con la llave de un dispositivo recordado.
  app.post('/api/movil/dispositivo', ruta(async req => {
    const token = limpiar((req.body || {}).dispositivo);
    if (!/^[0-9a-f]{64}$/.test(token)) throw fallo(401, 'Dispositivo no reconocido');
    const filas = comprobar(await supabase.from('movil_dispositivos').select('usuario,ultimo_uso').eq('token_hash', huella(token)), 'dispositivos');
    const d = filas && filas[0];
    if (!d || Date.now() - new Date(d.ultimo_uso).getTime() > CADUCIDAD_DISPOSITIVO_MS) throw fallo(401, 'Dispositivo no reconocido');
    const us = comprobar(await supabase.from('usuarios').select('usuario,nombre,rol,comercial_filtro,pin_hash').eq('usuario', d.usuario), 'usuarios');
    const u = us && us[0];
    if (!u || !u.pin_hash) throw fallo(401, 'Dispositivo no reconocido');
    abrirSesionMovil(req, u);
    comprobar(await supabase.from('movil_dispositivos').update({ ultimo_uso: new Date().toISOString() }).eq('token_hash', huella(token)), 'dispositivos');
    return { ok: true, usuario: req.session.usuario };
  }));

  // "Salir" en el móvil: olvida ese dispositivo y cierra la sesión.
  app.post('/api/movil/salir', ruta(async req => {
    const token = limpiar((req.body || {}).dispositivo);
    if (token) comprobar(await supabase.from('movil_dispositivos').delete().eq('token_hash', huella(token)), 'olvidar dispositivo');
    await new Promise(ok => req.session.destroy(ok));
    return { ok: true };
  }));
}

module.exports = { registrar, ROLES, ROLES_SOLO_MOVIL };
