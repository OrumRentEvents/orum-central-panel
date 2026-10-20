// Módulo Vehículos — API /api/vehiculos/* (fase 1: flota, vencimientos,
// mantenimientos y documentos). La lógica pura vive en lib/vehiculos.js.
// Ver docs/superpowers/specs/2026-10-20-modulo-vehiculos-design.md
const multer = require('multer');
const V = require('./vehiculos');
const { crearAvisos } = require('./vehiculosAvisos');

const ROLES_VEHICULOS = ['Direccion', 'Contabilidad', 'Logistica'];
const BUCKET = 'vehiculos-documentos';
const CAMPOS_VEHICULO = ['matricula', 'marca', 'modelo', 'tipo', 'nombre_rutas', 'nombre_localizador', 'propiedad', 'fecha_alta', 'fecha_baja', 'activo', 'km_base', 'km_base_fecha', 'notas'];
const CAMPOS_VENCIMIENTO = ['tipo', 'descripcion', 'fecha_limite', 'km_limite', 'aviso_dias', 'aviso_km', 'periodicidad_meses', 'periodicidad_km', 'activo', 'cita_pedida', 'cita_fecha', 'cita_lugar'];
const SIN_CITA = { cita_pedida: false, cita_fecha: null, cita_lugar: null };
const CAMPOS_MANTENIMIENTO = ['fecha', 'tipo', 'descripcion', 'taller', 'km', 'importe', 'vencimiento_id'];

// Fecha de hoy en Madrid, no la del servidor (Railway corre en UTC).
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

// Copia solo los campos permitidos; '' se guarda como null.
function elegir(body, campos) {
  const out = {};
  campos.forEach(c => { if (body[c] !== undefined) out[c] = body[c] === '' ? null : body[c]; });
  return out;
}

class ErrorUsuario extends Error {}

function permiteVehiculos(req, res, next) {
  if (!ROLES_VEHICULOS.includes(req.session.usuario.rol)) return res.status(403).json({ error: 'No autorizado para este apartado' });
  next();
}

module.exports = function montarVehiculos(app, { supabase, requiereLogin, enviarCorreo }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: V.MAX_DOCUMENTO } });
  const quien = req => req.session.usuario.nombre || req.session.usuario.usuario;

  async function q(promesa) {
    const { data, error } = await promesa;
    if (error) {
      if (error.code === '23505') throw new ErrorUsuario('Ya existe un vehículo con esa matrícula o nombre en Rutas');
      if (error.code === '23514') throw new ErrorUsuario('Algún dato no es válido (' + error.message + ')');
      throw error;
    }
    return data;
  }

  // Envuelve un handler: 400 para errores de validación, 500 para el resto.
  const ruta = (etiqueta, fn) => async (req, res) => {
    try {
      res.json({ ok: true, ...(await fn(req, res)) });
    } catch (err) {
      if (err instanceof ErrorUsuario) return res.status(400).json({ error: err.message });
      console.error('Error en ' + etiqueta + ':', err);
      res.status(500).json({ error: err.message });
    }
  };
  const validar = msg => { if (msg) throw new ErrorUsuario(msg); };
  const idDe = s => { const n = Number(s); if (!Number.isInteger(n) || n <= 0) throw new ErrorUsuario('Identificador no válido'); return n; };

  // Carga todo lo necesario para pintar flota y vencimientos en 4 consultas.
  async function cargarTodo() {
    const [vehiculos, vencimientos, mantenimientos, rutas] = await Promise.all([
      q(supabase.from('vehiculos').select('*').order('id')),
      q(supabase.from('vehiculos_vencimientos').select('*').eq('activo', true)),
      q(supabase.from('vehiculos_mantenimientos').select('id,vehiculo_id,fecha,km,importe')),
      q(supabase.from('rutas_vehiculos').select('nombre'))
    ]);
    const hoy = hoyMadrid();
    const kmPorVehiculo = {};
    vehiculos.forEach(v => { kmPorVehiculo[v.id] = V.kmActuales(v, mantenimientos.filter(m => m.vehiculo_id === v.id)); });
    const vencConEstado = vencimientos.map(x => ({ ...x, ...V.estadoVencimiento(x, kmPorVehiculo[x.vehiculo_id], hoy), estado_cita: V.estadoCita(x, hoy) }));
    return { vehiculos, vencConEstado, mantenimientos, kmPorVehiculo, rutas: rutas.map(r => r.nombre), hoy };
  }

  const ORDEN = { vencido: 0, aviso: 1, ok: 2 };
  const porUrgencia = (a, b) => (ORDEN[a.estado] - ORDEN[b.estado]) ||
    ((a.dias_restantes ?? 99999) - (b.dias_restantes ?? 99999)) || ((a.km_restantes ?? 1e9) - (b.km_restantes ?? 1e9));

  const base = '/api/vehiculos';
  const mw = [requiereLogin, permiteVehiculos];

  app.get(base, mw, ruta('GET ' + base, async req => {
    const { vehiculos, vencConEstado, mantenimientos, kmPorVehiculo, rutas, hoy } = await cargarTodo();
    const verInactivos = req.query.inactivos === '1';
    const lista = vehiculos.filter(v => verInactivos ? v.activo === false : v.activo !== false).map(v => {
      const propios = vencConEstado.filter(x => x.vehiculo_id === v.id).sort(porUrgencia);
      const p = propios[0];
      return {
        ...v, km_actuales: kmPorVehiculo[v.id],
        estado: V.peorEstado(propios.map(x => x.estado)),
        avisos: propios.filter(x => x.estado !== 'ok').length,
        proximo: p ? { tipo: p.tipo, descripcion: p.descripcion, estado: p.estado, dias_restantes: p.dias_restantes, km_restantes: p.km_restantes } : null
      };
    });
    const activos = new Set(vehiculos.filter(v => v.activo !== false).map(v => v.id));
    const vencActivos = vencConEstado.filter(x => activos.has(x.vehiculo_id));
    const mesActual = hoy.slice(0, 7);
    const delMes = mantenimientos.filter(m => String(m.fecha).slice(0, 7) === mesActual);
    return {
      vehiculos: lista,
      kpis: {
        activos: activos.size,
        vencidos: vencActivos.filter(x => x.estado === 'vencido').length,
        en_aviso: vencActivos.filter(x => x.estado === 'aviso').length,
        mant_mes_n: delMes.length,
        mant_mes_importe: Math.round(delMes.reduce((s, m) => s + (Number(m.importe) || 0), 0) * 100) / 100
      },
      rutas_sin_asignar: V.nombresRutasSinAsignar(rutas, vehiculos)
    };
  }));

  app.get(base + '/lista', mw, ruta('GET ' + base + '/lista', async () => {
    const data = await q(supabase.from('vehiculos').select('id,matricula,marca,modelo,propiedad').eq('activo', true).not('matricula', 'is', null).order('id'));
    return {
      vehiculos: data.map(v => ({
        id: v.id, matricula: v.matricula,
        label: v.matricula + ' · ' + [v.marca, v.modelo].filter(Boolean).join(' ') + (v.propiedad === 'renting' ? ' (renting)' : '')
      }))
    };
  }));

  app.get(base + '/vencimientos', mw, ruta('GET ' + base + '/vencimientos', async () => {
    const { vehiculos, vencConEstado } = await cargarTodo();
    const porId = {};
    vehiculos.filter(v => v.activo !== false).forEach(v => { porId[v.id] = { id: v.id, matricula: v.matricula, marca: v.marca, modelo: v.modelo }; });
    const lista = vencConEstado.filter(x => porId[x.vehiculo_id]).map(x => ({ ...x, vehiculo: porId[x.vehiculo_id] })).sort(porUrgencia);
    return { vencimientos: lista, contador: lista.filter(x => x.estado !== 'ok').length };
  }));

  // ── Avisos por email (lib/vehiculosAvisos.js) ──
  async function vencimientosParaAvisos() {
    const { vehiculos, vencConEstado } = await cargarTodo();
    const porId = {};
    vehiculos.filter(v => v.activo !== false).forEach(v => { porId[v.id] = { id: v.id, matricula: v.matricula, marca: v.marca, modelo: v.modelo }; });
    return vencConEstado.filter(x => porId[x.vehiculo_id]).map(x => ({ ...x, vehiculo: porId[x.vehiculo_id] }));
  }
  const avisos = crearAvisos({ supabase, cargarVencimientos: vencimientosParaAvisos, enviarCorreo });

  app.get(base + '/avisos/destinatarios', mw, ruta('GET avisos/destinatarios', async () => ({ destinatarios: await avisos.destinatarios() })));

  // Envía la situación actual SOLO a la dirección indicada (no marca nada como avisado).
  app.post(base + '/avisos/prueba', mw, ruta('POST avisos/prueba', async req => {
    const para = String((req.body && req.body.para) || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) throw new ErrorUsuario('Indica un email válido');
    const r = await avisos.enviarPrueba(para);
    if (!r.ok) throw new ErrorUsuario('No se ha enviado: ' + (r.motivo || 'error desconocido'));
    return { enviado_a: para };
  }));

  app.get(base + '/:id', mw, ruta('GET ' + base + '/:id', async req => {
    const id = idDe(req.params.id);
    const [vs, vencimientos, mantenimientos, documentos] = await Promise.all([
      q(supabase.from('vehiculos').select('*').eq('id', id)),
      q(supabase.from('vehiculos_vencimientos').select('*').eq('vehiculo_id', id).eq('activo', true).order('id')),
      q(supabase.from('vehiculos_mantenimientos').select('*').eq('vehiculo_id', id).order('fecha', { ascending: false })),
      q(supabase.from('vehiculos_documentos').select('*').eq('vehiculo_id', id).order('subido_en', { ascending: false }))
    ]);
    if (!vs.length) throw new ErrorUsuario('Vehículo no encontrado');
    const km = V.kmActuales(vs[0], mantenimientos), hoy = hoyMadrid();
    return {
      vehiculo: vs[0], km_actuales: km, mantenimientos, documentos,
      vencimientos: vencimientos.map(x => ({ ...x, ...V.estadoVencimiento(x, km, hoy), estado_cita: V.estadoCita(x, hoy) })).sort(porUrgencia)
    };
  }));

  function datosVehiculo(body) {
    const d = elegir(body, CAMPOS_VEHICULO);
    validar(V.validarVehiculo(d));
    if (d.matricula !== undefined) d.matricula = V.normalizarMatricula(d.matricula);
    ['nombre_rutas', 'nombre_localizador'].forEach(c => { if (typeof d[c] === 'string') d[c] = d[c].trim() || null; });
    return d;
  }

  app.post(base, mw, ruta('POST ' + base, async req => {
    const d = datosVehiculo(req.body);
    const [v] = await q(supabase.from('vehiculos').insert({ ...d, creado_por: quien(req), actualizado_por: quien(req) }).select());
    return { vehiculo: v };
  }));

  app.put(base + '/:id', mw, ruta('PUT ' + base + '/:id', async req => {
    const d = datosVehiculo(req.body);
    // Dar de baja: nunca se borra un vehículo con histórico.
    if (d.activo === false && !d.fecha_baja) d.fecha_baja = hoyMadrid();
    if (d.activo === true) d.fecha_baja = null;
    const [v] = await q(supabase.from('vehiculos').update({ ...d, actualizado_por: quien(req), actualizado_en: new Date().toISOString() }).eq('id', idDe(req.params.id)).select());
    if (!v) throw new ErrorUsuario('Vehículo no encontrado');
    return { vehiculo: v };
  }));

  // ── Vencimientos ──
  // Sin cita pedida no se guardan fecha ni lugar de cita.
  const normalizarCita = d => { if (d.cita_pedida === false) Object.assign(d, SIN_CITA); return d; };

  app.post(base + '/:id/vencimientos', mw, ruta('POST vencimientos', async req => {
    const d = normalizarCita(elegir(req.body, CAMPOS_VENCIMIENTO));
    validar(V.validarVencimiento(d));
    const [x] = await q(supabase.from('vehiculos_vencimientos').insert({ ...d, vehiculo_id: idDe(req.params.id) }).select());
    return { vencimiento: x };
  }));

  app.put(base + '/:id/vencimientos/:vid', mw, ruta('PUT vencimientos', async req => {
    const d = normalizarCita(elegir(req.body, CAMPOS_VENCIMIENTO));
    const [actual] = await q(supabase.from('vehiculos_vencimientos').select('*').eq('id', idDe(req.params.vid)).eq('vehiculo_id', idDe(req.params.id)));
    if (!actual) throw new ErrorUsuario('Vencimiento no encontrado');
    validar(V.validarVencimiento({ ...actual, ...d }));
    // Un límite nuevo de verdad vuelve a habilitar el aviso por email.
    if (V.limiteCambiado(actual, d)) d.estado_notificado = null;
    const [x] = await q(supabase.from('vehiculos_vencimientos').update(d).eq('id', actual.id).select());
    return { vencimiento: x };
  }));

  app.delete(base + '/:id/vencimientos/:vid', mw, ruta('DELETE vencimientos', async req => {
    await q(supabase.from('vehiculos_vencimientos').delete().eq('id', idDe(req.params.vid)).eq('vehiculo_id', idDe(req.params.id)));
    return {};
  }));

  // ── Mantenimientos ──
  // Si el mantenimiento cumple un vencimiento (ITV pasada, revisión hecha),
  // se renueva su límite según la periodicidad. El mantenimiento guarda el
  // límite de antes y el de después (renovacion = {antes, despues}) para
  // poder deshacerlo si se borra (p. ej. se eligió el vencimiento equivocado).
  // La renovación cierra la cita pedida (ya está hecha); se guarda la de
  // antes en renovacion.cita para devolverla si se deshace.
  const conCita = (venc, renovacion) => (renovacion && venc && venc.cita_pedida
    ? { ...renovacion, cita: { cita_pedida: true, cita_fecha: venc.cita_fecha, cita_lugar: venc.cita_lugar } } : renovacion);

  async function vencimientoDe(vehiculoId, vencimientoId) {
    const [venc] = await q(supabase.from('vehiculos_vencimientos').select('*').eq('id', idDe(vencimientoId)).eq('vehiculo_id', vehiculoId));
    if (!venc) throw new ErrorUsuario('El vencimiento indicado no es de este vehículo');
    return venc;
  }

  app.post(base + '/:id/mantenimientos', mw, ruta('POST mantenimientos', async req => {
    const vehiculoId = idDe(req.params.id);
    const d = elegir(req.body, CAMPOS_MANTENIMIENTO);
    validar(V.validarMantenimiento(d));
    const venc = d.vencimiento_id ? await vencimientoDe(vehiculoId, d.vencimiento_id) : null;
    const renovacion = conCita(venc, V.calcularRenovacion(venc, d));
    // Primero el mantenimiento: si falla, el vencimiento no se ha tocado.
    const [m] = await q(supabase.from('vehiculos_mantenimientos').insert({ ...d, renovacion, vehiculo_id: vehiculoId, creado_por: quien(req) }).select());
    if (renovacion) await q(supabase.from('vehiculos_vencimientos').update({ ...renovacion.despues, ...SIN_CITA, estado_notificado: null }).eq('id', venc.id));
    return { mantenimiento: m };
  }));

  // Deshace la renovación que hizo un mantenimiento (si nadie ha cambiado el
  // vencimiento después). Devuelve true si la deshizo.
  async function deshacerRenovacionDe(vehiculoId, m) {
    if (!m.vencimiento_id || !m.renovacion) return false;
    const [venc] = await q(supabase.from('vehiculos_vencimientos').select('*').eq('id', m.vencimiento_id).eq('vehiculo_id', vehiculoId));
    const previo = V.deshacerRenovacion(venc, m.renovacion);
    if (!previo) return false;
    // La cita que tenía antes de la renovación vuelve con ella.
    await q(supabase.from('vehiculos_vencimientos').update({ ...previo, ...(m.renovacion.cita || {}), estado_notificado: null }).eq('id', venc.id));
    return true;
  }

  // Editar: si cambia la fecha, los km o el vencimiento que renueva, se
  // deshace la renovación anterior y se aplica la nueva (p. ej. se eligió
  // "Seguro" por error en vez de "ITV").
  app.put(base + '/:id/mantenimientos/:mid', mw, ruta('PUT mantenimientos', async req => {
    const vehiculoId = idDe(req.params.id);
    const d = elegir(req.body, CAMPOS_MANTENIMIENTO);
    const [actual] = await q(supabase.from('vehiculos_mantenimientos').select('*').eq('id', idDe(req.params.mid)).eq('vehiculo_id', vehiculoId));
    if (!actual) throw new ErrorUsuario('Mantenimiento no encontrado');
    const nuevo = { ...actual, ...d };
    validar(V.validarMantenimiento(nuevo));
    const vencNuevo = nuevo.vencimiento_id ? await vencimientoDe(vehiculoId, nuevo.vencimiento_id) : null;
    const afectaRenovacion = String(nuevo.vencimiento_id ?? '') !== String(actual.vencimiento_id ?? '') ||
      nuevo.fecha !== actual.fecha || String(nuevo.km ?? '') !== String(actual.km ?? '');
    if (afectaRenovacion) {
      await deshacerRenovacionDe(vehiculoId, actual);
      // Se relee el vencimiento: si era el mismo, acaba de volver a su límite anterior.
      const venc = vencNuevo ? await vencimientoDe(vehiculoId, vencNuevo.id) : null;
      d.renovacion = conCita(venc, V.calcularRenovacion(venc, nuevo));
      const [m] = await q(supabase.from('vehiculos_mantenimientos').update(d).eq('id', actual.id).select());
      if (d.renovacion) await q(supabase.from('vehiculos_vencimientos').update({ ...d.renovacion.despues, ...SIN_CITA, estado_notificado: null }).eq('id', venc.id));
      return { mantenimiento: m };
    }
    const [m] = await q(supabase.from('vehiculos_mantenimientos').update(d).eq('id', actual.id).select());
    return { mantenimiento: m };
  }));

  app.delete(base + '/:id/mantenimientos/:mid', mw, ruta('DELETE mantenimientos', async req => {
    const vehiculoId = idDe(req.params.id);
    const [m] = await q(supabase.from('vehiculos_mantenimientos').select('*').eq('id', idDe(req.params.mid)).eq('vehiculo_id', vehiculoId));
    if (!m) throw new ErrorUsuario('Mantenimiento no encontrado');
    const vencimiento_restaurado = await deshacerRenovacionDe(vehiculoId, m);
    await q(supabase.from('vehiculos_mantenimientos').delete().eq('id', m.id));
    return { vencimiento_restaurado };
  }));

  // ── Documentos (bucket privado, descarga por URL firmada de 60 s) ──
  const subir = (req, res, next) => upload.single('archivo')(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'El archivo supera los 10 MB' : err.message });
    next();
  });

  app.post(base + '/:id/documentos', mw, subir, ruta('POST documentos', async req => {
    const vehiculoId = idDe(req.params.id);
    if (!req.file) throw new ErrorUsuario('Falta el archivo');
    validar(V.validarDocumento(req.file));
    const tipo = V.TIPOS_DOCUMENTO.includes(req.body.tipo) ? req.body.tipo : 'otro';
    // multer entrega el nombre en latin1: se recupera la UTF-8 original (tildes, ñ).
    const recodificado = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const nombre = recodificado.includes('�') ? req.file.originalname : recodificado;
    const ruta_storage = vehiculoId + '/' + Date.now() + '-' + nombre.replace(/[^\w.-]+/g, '_');
    const { error } = await supabase.storage.from(BUCKET).upload(ruta_storage, req.file.buffer, { contentType: req.file.mimetype });
    if (error) throw error;
    const [doc] = await q(supabase.from('vehiculos_documentos').insert({
      vehiculo_id: vehiculoId, tipo, nombre_archivo: nombre, ruta_storage,
      fecha_caducidad: req.body.fecha_caducidad || null, subido_por: quien(req)
    }).select());
    return { documento: doc };
  }));

  async function documento(req) {
    const [doc] = await q(supabase.from('vehiculos_documentos').select('*').eq('id', idDe(req.params.did)).eq('vehiculo_id', idDe(req.params.id)));
    if (!doc) throw new ErrorUsuario('Documento no encontrado');
    return doc;
  }

  app.put(base + '/:id/documentos/:did', mw, ruta('PUT documentos', async req => {
    const doc = await documento(req);
    const d = elegir(req.body, ['tipo', 'fecha_caducidad']);
    if (d.tipo !== undefined && !V.TIPOS_DOCUMENTO.includes(d.tipo)) throw new ErrorUsuario('Tipo de documento no válido');
    const [x] = await q(supabase.from('vehiculos_documentos').update(d).eq('id', doc.id).select());
    return { documento: x };
  }));

  app.get(base + '/:id/documentos/:did', mw, ruta('GET documentos', async req => {
    const doc = await documento(req);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.ruta_storage, 60, { download: doc.nombre_archivo });
    if (error) throw error;
    return { url: data.signedUrl };
  }));

  app.delete(base + '/:id/documentos/:did', mw, ruta('DELETE documentos', async req => {
    const doc = await documento(req);
    const { error } = await supabase.storage.from(BUCKET).remove([doc.ruta_storage]);
    if (error) throw error;
    await q(supabase.from('vehiculos_documentos').delete().eq('id', doc.id));
    return {};
  }));

  return { avisos };
};
