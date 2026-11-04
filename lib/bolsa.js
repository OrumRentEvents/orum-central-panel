// Bolsa de horas (nov 2026), idea de Leo — sql/bolsa_horas.sql, pantalla en
// public/bolsa.js. Horas, días de festivo, días de descanso y vacaciones de cada
// trabajador. No genera pagos ni pasa por aprobación: es independiente de
// Registrar extras. Positivo = se le debe al trabajador; negativo = debe él.

const ROLES_BOLSA = ['Direccion', 'Contabilidad', 'Logistica'];
const MAX_HORAS = 500;

class ErrorUsuario extends Error {}

const redondea = n => Math.round(n * 100) / 100;

// "1,5" / "1.5" → 1.5 · "1:30" / "1h30" → 1.5 · "2h" → 2. null si no se entiende.
function parsearHoras(texto) {
  const t = String(texto == null ? '' : texto).trim().toLowerCase().replace(/\s+/g, '');
  let horas = null;
  const conMinutos = t.match(/^(\d+)(?::|h)(\d{1,2})m?$/);
  if (conMinutos) {
    const min = Number(conMinutos[2]);
    if (min >= 60) return null;
    horas = Number(conMinutos[1]) + min / 60;
  } else if (/^\d+([.,]\d+)?h?$/.test(t)) {
    horas = Number(t.replace('h', '').replace(',', '.'));
  }
  if (horas === null || !(horas > 0) || horas > MAX_HORAS) return null;
  return redondea(horas);
}

// Días de descanso: enteros o medios días ("1", "0,5", "1.5")
function parsearDias(texto) {
  const t = String(texto == null ? '' : texto).trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const d = Number(t);
  if (!(d > 0) || d > 365 || d * 2 !== Math.floor(d * 2)) return null;
  return d;
}

function fechaValida(f) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f || ''))) return false;
  const d = new Date(f + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === f;
}

// Días naturales, ambos incluidos. null si las fechas no valen.
function diasEntre(inicio, fin) {
  if (!fechaValida(inicio) || !fechaValida(fin) || fin < inicio) return null;
  return Math.round((new Date(fin + 'T00:00:00Z') - new Date(inicio + 'T00:00:00Z')) / 86400000) + 1;
}

// Vacaciones de un año: un periodo que cruza de año se reparte entre los dos
function diasVacacionesEnAnio(v, anio) {
  const desde = v.fecha_inicio > anio + '-01-01' ? v.fecha_inicio : anio + '-01-01';
  const hasta = v.fecha_fin < anio + '-12-31' ? v.fecha_fin : anio + '-12-31';
  return diasEntre(desde, hasta) || 0;
}

// Saldos por trabajador, sin contar lo anulado
function calcularSaldos(movimientos, vacaciones, anio) {
  const saldos = {};
  const s = clave => (saldos[clave] = saldos[clave] || { horas: 0, festivos: 0, descanso: 0, vacaciones: 0 });
  movimientos.filter(m => !m.anulado_en).forEach(m => {
    const x = s(m.clave), n = Number(m.cantidad) || 0;
    if (m.tipo === 'horas') x.horas += n;
    else if (m.tipo === 'descanso') x.descanso += n;
    else if (m.tipo === 'festivo' && !m.disfrutado_fecha) x.festivos += 1;
  });
  vacaciones.filter(v => !v.anulado_en).forEach(v => { s(v.clave).vacaciones += diasVacacionesEnAnio(v, anio); });
  Object.values(saldos).forEach(x => { x.horas = redondea(x.horas); x.descanso = redondea(x.descanso); });
  return saldos;
}

// La plantilla: la de nómina (sin bajas ni Dirección) + los añadidos a mano. Quien
// ya tenga algo apuntado sigue saliendo aunque se dé de baja, para no perder su saldo.
function construirPlantilla(trabajadores, anadidos, saldos) {
  const lista = [];
  const conAlgo = clave => {
    const x = saldos[clave];
    return !!x && (x.horas !== 0 || x.festivos !== 0 || x.descanso !== 0 || x.vacaciones !== 0);
  };
  trabajadores.forEach(t => {
    const clave = t.empresa_nif + '|' + t.formato_origen + '|' + t.num_empleado;
    if ((t.estado === 'baja' || t.departamento === 'Dirección') && !conAlgo(clave)) return;
    lista.push({ clave, nombre: t.nombre, area: t.departamento || 'Sin área', estado: t.estado, manual: false });
  });
  anadidos.forEach(e => lista.push({ clave: e.clave, nombre: e.nombre, area: e.area || 'Sin área', estado: 'activo', manual: true }));
  return lista
    .map(e => ({ ...e, horas: 0, festivos: 0, descanso: 0, vacaciones: 0, ...(saldos[e.clave] || {}) }))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

function registrar(app, { supabase, requiereLogin, trabajadoresParaExtras }) {
  const permite = (req, res, next) => {
    if (!ROLES_BOLSA.includes(req.session.usuario.rol)) return res.status(403).json({ error: 'No autorizado para este apartado' });
    next();
  };
  const mw = [requiereLogin, permite];
  const quien = req => req.session.usuario.nombre || req.session.usuario.usuario;
  const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const texto = (v, max) => String(v == null ? '' : v).trim().slice(0, max) || null;
  const ruta = (etiqueta, fn) => async (req, res) => {
    try {
      res.json({ ok: true, ...(await fn(req)) });
    } catch (err) {
      if (err instanceof ErrorUsuario) return res.status(400).json({ error: err.message });
      console.error('Error en ' + etiqueta + ':', err);
      res.status(500).json({ error: err.message });
    }
  };
  async function q(promesa) {
    const { data, error } = await promesa;
    if (error) throw new Error(error.message);
    return data || [];
  }
  // Supabase devuelve como mucho 1000 filas por consulta
  async function todo(tabla) {
    const filas = [];
    for (let desde = 0; ; desde += 1000) {
      const trozo = await q(supabase.from(tabla).select('*').order('id').range(desde, desde + 999));
      filas.push(...trozo);
      if (trozo.length < 1000) return filas;
    }
  }
  const idDe = s => {
    const n = Number(s);
    if (!Number.isInteger(n) || n <= 0) throw new ErrorUsuario('Identificador no válido');
    return n;
  };
  async function plantilla() {
    const [trabajadores, anadidos, movimientos, vacaciones] = await Promise.all([
      trabajadoresParaExtras(), q(supabase.from('bolsa_empleados').select('*')), todo('bolsa_movimientos'), todo('bolsa_vacaciones')
    ]);
    return construirPlantilla(trabajadores, anadidos, calcularSaldos(movimientos, vacaciones, Number(hoy().slice(0, 4))));
  }
  async function empleadoDe(clave) {
    const e = (await plantilla()).find(x => x.clave === clave);
    if (!e) throw new ErrorUsuario('Trabajador no encontrado');
    return e;
  }

  app.get('/api/bolsa', mw, ruta('GET /api/bolsa', async () => ({ anio: Number(hoy().slice(0, 4)), hoy: hoy(), empleados: await plantilla() })));

  // La clave lleva "|", por eso va como parámetro de la consulta
  app.get('/api/bolsa/empleado', mw, ruta('GET /api/bolsa/empleado', async req => {
    const clave = String(req.query.clave || '');
    const [movimientos, vacaciones] = await Promise.all([
      q(supabase.from('bolsa_movimientos').select('*').eq('clave', clave).order('fecha', { ascending: false }).order('id', { ascending: false })),
      q(supabase.from('bolsa_vacaciones').select('*').eq('clave', clave).order('fecha_inicio', { ascending: false }))
    ]);
    return { movimientos, vacaciones };
  }));

  app.post('/api/bolsa/movimientos', mw, ruta('POST /api/bolsa/movimientos', async req => {
    const b = req.body || {};
    if (!['horas', 'festivo', 'descanso'].includes(b.tipo)) throw new ErrorUsuario('Tipo no válido');
    if (!fechaValida(b.fecha)) throw new ErrorUsuario('Indica la fecha');
    const e = await empleadoDe(String(b.clave || ''));
    const signo = b.sentido === 'quitar' ? -1 : 1;
    let cantidad = 1, motivo = null;
    if (b.tipo === 'horas') {
      const h = parsearHoras(b.cantidad);
      if (h === null) throw new ErrorUsuario('No entiendo las horas. Escríbelas como 1,5 · 1:30 · 1h30');
      cantidad = signo * h;
      if (signo < 0) motivo = b.motivo === 'pagadas' ? 'pagadas' : 'compensadas';
    } else if (b.tipo === 'descanso') {
      const d = parsearDias(b.cantidad);
      if (d === null) throw new ErrorUsuario('Indica los días, enteros o medios (1 · 0,5 · 1,5)');
      cantidad = signo * d;
    }
    const [m] = await q(supabase.from('bolsa_movimientos').insert({
      clave: e.clave, nombre: e.nombre, tipo: b.tipo, cantidad, fecha: b.fecha, motivo, nota: texto(b.nota, 500), registrado_por: quien(req)
    }).select());
    return { movimiento: m };
  }));

  // Marcar un festivo como disfrutado, o deshacerlo (fecha vacía)
  app.post('/api/bolsa/movimientos/:id/disfrutado', mw, ruta('POST disfrutado', async req => {
    const fecha = (req.body || {}).fecha || null;
    if (fecha && !fechaValida(fecha)) throw new ErrorUsuario('Fecha no válida');
    const filas = await q(supabase.from('bolsa_movimientos').update({ disfrutado_fecha: fecha }).eq('id', idDe(req.params.id)).eq('tipo', 'festivo').select());
    if (!filas.length) throw new ErrorUsuario('Festivo no encontrado');
    return {};
  }));

  // Anular: deja de contar pero sigue en el historial, con quién lo anuló
  app.delete('/api/bolsa/movimientos/:id', mw, ruta('DELETE movimiento', async req => {
    await q(supabase.from('bolsa_movimientos').update({ anulado_por: quien(req), anulado_en: new Date().toISOString() }).eq('id', idDe(req.params.id)).select());
    return {};
  }));

  app.post('/api/bolsa/vacaciones', mw, ruta('POST /api/bolsa/vacaciones', async req => {
    const b = req.body || {};
    const dias = diasEntre(b.fecha_inicio, b.fecha_fin);
    if (dias === null) throw new ErrorUsuario('Indica la fecha de inicio y la de fin (el fin no puede ser anterior)');
    const e = await empleadoDe(String(b.clave || ''));
    const [v] = await q(supabase.from('bolsa_vacaciones').insert({
      clave: e.clave, nombre: e.nombre, fecha_inicio: b.fecha_inicio, fecha_fin: b.fecha_fin, dias, nota: texto(b.nota, 500), registrado_por: quien(req)
    }).select());
    return { vacaciones: v };
  }));

  app.delete('/api/bolsa/vacaciones/:id', mw, ruta('DELETE vacaciones', async req => {
    await q(supabase.from('bolsa_vacaciones').update({ anulado_por: quien(req), anulado_en: new Date().toISOString() }).eq('id', idDe(req.params.id)).select());
    return {};
  }));

  app.post('/api/bolsa/empleados', mw, ruta('POST /api/bolsa/empleados', async req => {
    const b = req.body || {};
    const nombre = texto(b.nombre, 120);
    if (!nombre) throw new ErrorUsuario('Indica el nombre');
    const clave = 'libre|' + nombre.toUpperCase();
    if ((await plantilla()).some(e => e.clave === clave || String(e.nombre).toUpperCase() === nombre.toUpperCase())) throw new ErrorUsuario('Ya hay un empleado con ese nombre');
    await q(supabase.from('bolsa_empleados').insert({ clave, nombre, area: texto(b.area, 60), registrado_por: quien(req) }).select());
    return { clave };
  }));
}

module.exports = { registrar, parsearHoras, parsearDias, fechaValida, diasEntre, diasVacacionesEnAnio, calcularSaldos, construirPlantilla };
