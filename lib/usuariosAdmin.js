// Usuarios de ORUM Central (oct 2026): se gestionan desde el panel (Sistema →
// Usuarios), directo en la tabla usuarios de Supabase. Antes se editaban a
// mano en la pestaña USUARIOS de la hoja de Google (con el hash bcrypt hecho
// aparte) y un aviso del Apps Script + el cron los copiaban a Supabase.
// Solo Sergio puede entrar (decisión del 25 oct 2026).

const ROLES = ['Direccion', 'Contabilidad', 'Comercial', 'Logistica'];
const ADMIN = 'sergio';

function registrar(app, { supabase, bcrypt }) {
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

  function validar(b, nuevo) {
    const fila = {};
    if (nuevo || b.nombre !== undefined) { fila.nombre = limpiar(b.nombre); if (!fila.nombre) throw fallo(400, 'Falta el nombre'); }
    if (nuevo || b.rol !== undefined) { fila.rol = limpiar(b.rol); if (!ROLES.includes(fila.rol)) throw fallo(400, 'Rol no válido'); }
    if (b.comercial_filtro !== undefined || nuevo) fila.comercial_filtro = limpiar(b.comercial_filtro) || null;
    if (b.password !== undefined && b.password !== '') {
      if (String(b.password).length < 6) throw fallo(400, 'La contraseña debe tener al menos 6 caracteres');
      fila.password_hash = bcrypt.hashSync(String(b.password), 10);
    } else if (nuevo) throw fallo(400, 'Falta la contraseña');
    fila.sincronizado_en = new Date().toISOString();
    return fila;
  }

  app.get('/api/usuarios', soloSergio, ruta(async () => {
    const data = comprobar(await supabase.from('usuarios').select('usuario,nombre,rol,comercial_filtro').order('rol').order('nombre'), 'usuarios');
    return { ok: true, roles: ROLES, data: (data || []).filter(u => limpiar(u.usuario)) };
  }));

  app.post('/api/usuarios', soloSergio, ruta(async req => {
    const b = req.body || {};
    const usuario = limpiar(b.usuario).toLowerCase();
    if (!/^[a-z0-9._-]{2,30}$/.test(usuario)) throw fallo(400, 'Usuario no válido (solo letras, números, punto o guion, sin espacios)');
    const ya = comprobar(await supabase.from('usuarios').select('usuario').ilike('usuario', usuario), 'usuarios');
    if (ya && ya.length) throw fallo(409, 'Ya existe un usuario "' + usuario + '"');
    comprobar(await supabase.from('usuarios').insert({ usuario, ...validar(b, true) }), 'crear usuario');
    return { ok: true };
  }));

  app.put('/api/usuarios/:usuario', soloSergio, ruta(async req => {
    const usuario = limpiar(req.params.usuario);
    const cambios = validar(req.body || {}, false);
    if (usuario.toLowerCase() === ADMIN && cambios.rol && cambios.rol !== 'Direccion') throw fallo(400, 'Sergio tiene que seguir siendo Dirección');
    const r = comprobar(await supabase.from('usuarios').update(cambios).eq('usuario', usuario).select('usuario'), 'guardar usuario');
    if (!r || !r.length) throw fallo(404, 'Usuario no encontrado');
    return { ok: true };
  }));

  app.delete('/api/usuarios/:usuario', soloSergio, ruta(async req => {
    const usuario = limpiar(req.params.usuario);
    if (usuario.toLowerCase() === ADMIN) throw fallo(400, 'No puedes borrar tu propio usuario');
    const r = comprobar(await supabase.from('usuarios').delete().eq('usuario', usuario).select('usuario'), 'borrar usuario');
    if (!r || !r.length) throw fallo(404, 'Usuario no encontrado');
    return { ok: true };
  }));
}

module.exports = { registrar, ROLES };
