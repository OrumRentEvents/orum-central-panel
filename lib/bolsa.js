// Bolsa de horas (nov 2026), idea de Leo: en una sola pantalla se apunta todo lo
// de cada trabajador. Pantalla en public/bolsa.js (panel) y public/movil.html (app).
//
// - Horas: se guardan aquí, no se pagan: se recuperan con tiempo libre. Positivo =
//   se le deben al trabajador; negativo = las debe él.
// - Cambiar horas por dinero: SOLO Sergio. Baja la bolsa y crea un extra «Hora Extra»
//   ya aprobado, que se abona en Aprobar y pagar. Si se rechaza, las horas vuelven.
// - Domingo, festivo, nocturno, sábado tarde, plus y descuento: se guardan en
//   extras_registros (su importe y +1 día de descanso, según tarifa) y los aprueba
//   Dirección en Aprobar y pagar, como siempre.
// - Días de descanso: el saldo de extras + los movimientos de aquí (medios días).

const ROLES_BOLSA = ['Direccion', 'Contabilidad', 'Logistica'];
const ROLES_VEN_IMPORTES = ['Direccion', 'Contabilidad'];
const ESTADOS_QUE_CUENTAN = ['aprobado', 'pagado'];
const MAX_HORAS = 500;

class ErrorUsuario extends Error {}

const redondea = n => Math.round(n * 100) / 100;
const esSergio = u => String((u && u.usuario) || '').toLowerCase() === 'sergio';

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

// Saldos por trabajador, juntando lo de la bolsa y lo de extras. saldosDescanso ya
// incluye los descansos de la bolsa (calcularSaldosDescanso de server.js).
function calcularSaldos({ movimientos, vacaciones, registros, saldosDescanso, anio, mes }) {
  const saldos = {};
  const s = clave => (saldos[clave] = saldos[clave] || { horas: 0, descanso: 0, dias_por_aprobar: 0, domingos_mes: 0, por_aprobar: 0, vacaciones: 0 });
  movimientos.filter(m => !m.anulado_en && m.tipo === 'horas').forEach(m => { s(m.clave).horas += Number(m.cantidad) || 0; });
  vacaciones.filter(v => !v.anulado_en).forEach(v => { s(v.clave).vacaciones += diasVacacionesEnAnio(v, anio); });
  Object.values(saldosDescanso).forEach(x => {
    const f = s(x.clave);
    f.descanso = (Number(x.inicial) || 0) + (Number(x.generados) || 0) - (Number(x.disfrutados) || 0);
    if (x.nombre) f.nombre = x.nombre;
  });
  registros.filter(r => r.estado !== 'rechazado').forEach(r => {
    const f = s(r.clave);
    if (!f.nombre && r.nombre_trabajador) f.nombre = r.nombre_trabajador;
    if (r.estado === 'pendiente') {
      f.por_aprobar++;
      if (r.genera_descanso) f.dias_por_aprobar++;
      if (/^descanso/i.test(r.tipo)) f.dias_por_aprobar--;
    }
    if (/^(domingo|festivo)/i.test(r.tipo) && Number(r.anio) === anio && Number(r.mes) === mes) f.domingos_mes++;
  });
  Object.values(saldos).forEach(x => { x.horas = redondea(x.horas); x.descanso = redondea(x.descanso); });
  return saldos;
}

// La plantilla: la de nómina (sin bajas ni Dirección) + los añadidos a mano + los
// eventuales con algo pendiente. Quien tenga algo apuntado sigue saliendo aunque se
// dé de baja, para no perder su saldo.
function construirPlantilla(trabajadores, anadidos, saldos) {
  const lista = [], vistos = new Set();
  const conAlgo = clave => {
    const x = saldos[clave];
    return !!x && (x.horas !== 0 || x.descanso !== 0 || x.por_aprobar !== 0 || x.vacaciones !== 0);
  };
  trabajadores.forEach(t => {
    const clave = t.empresa_nif + '|' + t.formato_origen + '|' + t.num_empleado;
    if ((t.estado === 'baja' || t.departamento === 'Dirección') && !conAlgo(clave)) return;
    vistos.add(clave);
    lista.push({ clave, nombre: t.nombre, area: t.departamento || 'Sin área', estado: t.estado, manual: false });
  });
  anadidos.forEach(e => { vistos.add(e.clave); lista.push({ clave: e.clave, nombre: e.nombre, area: e.area || 'Sin área', estado: 'activo', manual: true }); });
  Object.keys(saldos).filter(k => k.startsWith('libre|') && !vistos.has(k) && conAlgo(k)).forEach(k => {
    lista.push({ clave: k, nombre: saldos[k].nombre || k.slice(6), area: 'Eventual', estado: 'activo', manual: true });
  });
  return lista
    .map(e => ({ horas: 0, descanso: 0, dias_por_aprobar: 0, domingos_mes: 0, por_aprobar: 0, vacaciones: 0, ...(saldos[e.clave] || {}), ...e }))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
}

// Qué extras se pueden apuntar hoy desde la bolsa: los de la tarifa vigente, menos
// Hora Extra (va a la bolsa) y Descanso Disfrutado (se apunta como descanso).
function tiposApuntables(tarifas, fecha) {
  const vigente = tipo => tarifas.filter(t => t.tipo === tipo && t.vigente_desde <= fecha)
    .sort((a, b) => a.vigente_desde === b.vigente_desde ? b.id - a.id : (a.vigente_desde < b.vigente_desde ? 1 : -1))[0];
  return [...new Set(tarifas.map(t => t.tipo))].map(vigente)
    .filter(t => t && t.activo && !/^hora extra$/i.test(t.tipo) && !/^descanso/i.test(t.tipo))
    .sort((a, b) => a.orden - b.orden)
    .map(t => ({ tipo: t.tipo, libre: t.modo === 'libre', genera_descanso: !!t.genera_descanso }));
}

// "libre|ANA" → eventual; "nif|formato|num" → trabajador de nómina
function trabajadorDeClave(clave) {
  if (clave.startsWith('libre|')) return { nombre_libre: clave.slice(6) };
  const [empresa_nif, formato_origen, num_empleado] = clave.split('|');
  return { empresa_nif, formato_origen, num_empleado };
}

function registrar(app, { supabase, requiereLogin, datosExtras, crearExtras }) {
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
  async function cargar() {
    const [extras, anadidos, movimientos, vacaciones] = await Promise.all([
      datosExtras(), q(supabase.from('bolsa_empleados').select('*')), todo('bolsa_movimientos'), todo('bolsa_vacaciones')
    ]);
    const h = hoy(), anio = Number(h.slice(0, 4)), mes = Number(h.slice(5, 7));
    const saldos = calcularSaldos({ movimientos, vacaciones, registros: extras.registros, saldosDescanso: extras.saldosDescanso, anio, mes });
    return { hoy: h, anio, mes, extras, movimientos, empleados: construirPlantilla(extras.trabajadores, anadidos, saldos) };
  }
  function empleadosDe(empleados, claves) {
    if (!Array.isArray(claves) || !claves.length) throw new ErrorUsuario('Elige al menos un trabajador');
    return claves.map(c => {
      const e = empleados.find(x => x.clave === c);
      if (!e) throw new ErrorUsuario('Trabajador no encontrado');
      return e;
    });
  }

  app.get('/api/bolsa', mw, ruta('GET /api/bolsa', async req => {
    const { hoy: h, anio, mes, extras, movimientos, empleados } = await cargar();
    const nombreDe = {}; empleados.forEach(e => { nombreDe[e.clave] = e.nombre; });
    // Los últimos apuntes, para la pantalla de la app
    const ultimos = movimientos.filter(m => !m.anulado_en && !m.extra_registro_id).map(m => ({ nombre: m.nombre, tipo: m.tipo, cantidad: Number(m.cantidad), fecha: m.fecha, en: m.creado_en }))
      .concat(extras.registros.filter(r => r.origen === 'panel').map(r => ({ nombre: r.nombre_trabajador, tipo: r.tipo, estado: r.estado, fecha: r.fecha, en: r.created_at })))
      .sort((a, b) => String(b.en || '').localeCompare(String(a.en || ''))).slice(0, 15);
    return { hoy: h, anio, mes, puede_pagar: esSergio(req.session.usuario), tipos: tiposApuntables(extras.tarifas, h), empleados, ultimos };
  }));

  // Historial de una persona. Logística no ve importes. La clave lleva "|": va en la consulta.
  app.get('/api/bolsa/empleado', mw, ruta('GET /api/bolsa/empleado', async req => {
    const clave = String(req.query.clave || '');
    const t = trabajadorDeClave(clave);
    let consulta = supabase.from('extras_registros').select('*');
    consulta = t.nombre_libre ? consulta.eq('nombre_libre', t.nombre_libre) : consulta.eq('empresa_nif', t.empresa_nif).eq('formato_origen', t.formato_origen).eq('num_empleado', t.num_empleado);
    const [movimientos, vacaciones, extras] = await Promise.all([
      q(supabase.from('bolsa_movimientos').select('*').eq('clave', clave).order('fecha', { ascending: false }).order('id', { ascending: false })),
      q(supabase.from('bolsa_vacaciones').select('*').eq('clave', clave).order('fecha_inicio', { ascending: false })),
      q(consulta.order('fecha', { ascending: false }).order('id', { ascending: false }).limit(200))
    ]);
    const conImportes = ROLES_VEN_IMPORTES.includes(req.session.usuario.rol);
    return {
      movimientos, vacaciones,
      extras: extras.map(r => ({ id: r.id, fecha: r.fecha, tipo: r.tipo, horas: r.horas, estado: r.estado, proyecto: r.proyecto, notas: r.notas, registrado_por: r.registrado_por_nombre || r.registrado_por, motivo_rechazo: r.motivo_rechazo, ...(conImportes ? { importe: r.importe } : {}) }))
    };
  }));

  // Apuntar a uno o varios. que = horas-sumar | horas-quitar | descanso-sumar |
  // descanso-quitar | el nombre de un tipo de extra (Domingo, Festivo, Plus…).
  app.post('/api/bolsa/apuntes', mw, ruta('POST /api/bolsa/apuntes', async req => {
    const b = req.body || {}, que = String(b.que || '');
    if (!fechaValida(b.fecha)) throw new ErrorUsuario('Indica la fecha');
    if (b.fecha > hoy()) throw new ErrorUsuario('La fecha no puede ser futura');
    const { empleados, extras } = await cargar();
    const lista = empleadosDe(empleados, b.claves);
    const mov = que.match(/^(horas|descanso)-(sumar|quitar)$/);
    if (mov) {
      const cantidad = mov[1] === 'horas' ? parsearHoras(b.cantidad) : parsearDias(b.cantidad);
      if (cantidad === null) throw new ErrorUsuario(mov[1] === 'horas' ? 'No entiendo las horas. Escríbelas como 1,5 · 1:30 · 1h30' : 'Indica los días, enteros o medios (1 · 0,5 · 1,5)');
      const signo = mov[2] === 'quitar' ? -1 : 1;
      await q(supabase.from('bolsa_movimientos').insert(lista.map(e => ({
        clave: e.clave, nombre: e.nombre, tipo: mov[1], cantidad: signo * cantidad, fecha: b.fecha,
        motivo: mov[1] === 'horas' && signo < 0 ? 'compensadas' : null, nota: texto(b.nota, 500), registrado_por: quien(req)
      }))).select());
      return { apuntes: lista.length, aprobar: false };
    }
    if (!tiposApuntables(extras.tarifas, b.fecha).some(t => t.tipo === que)) throw new ErrorUsuario('Tipo no válido');
    const creados = await crearExtras(req.session.usuario, {
      fecha: b.fecha, tipo: que, importe: b.importe, proyecto: b.proyecto, notas: b.nota, trabajadores: lista.map(e => trabajadorDeClave(e.clave))
    });
    return { apuntes: creados.length, aprobar: true };
  }));

  // Cambiar horas por dinero: solo Sergio. Queda aprobado para abonarlo en nómina.
  app.post('/api/bolsa/pagar-horas', mw, ruta('POST /api/bolsa/pagar-horas', async req => {
    const u = req.session.usuario, b = req.body || {};
    if (!esSergio(u)) throw new ErrorUsuario('Solo Sergio puede cambiar horas por dinero');
    if (!fechaValida(b.fecha)) throw new ErrorUsuario('Indica la fecha');
    const horas = parsearHoras(b.cantidad);
    if (horas === null) throw new ErrorUsuario('No entiendo las horas. Escríbelas como 1,5 · 1:30 · 1h30');
    const { empleados } = await cargar();
    const [e] = empleadosDe(empleados, [String(b.clave || '')]);
    if (horas > e.horas) throw new ErrorUsuario('Solo se le deben ' + String(e.horas).replace('.', ',') + ' h');
    const nota = texto(b.nota, 500);
    const [registro] = await crearExtras(u, { fecha: b.fecha, tipo: 'Hora Extra', horas, notas: nota || 'Horas de la bolsa cambiadas por dinero', trabajadores: [trabajadorDeClave(e.clave)] }, 'aprobado');
    try {
      await q(supabase.from('bolsa_movimientos').insert({
        clave: e.clave, nombre: e.nombre, tipo: 'horas', cantidad: -horas, fecha: b.fecha, motivo: 'pagadas', nota, registrado_por: quien(req), extra_registro_id: registro.id
      }).select());
    } catch (err) {
      await q(supabase.from('extras_registros').delete().eq('id', registro.id));
      throw err;
    }
    return { registro_id: registro.id };
  }));

  // Anular: deja de contar pero sigue en el historial, con quién lo anuló. Si era un
  // pago de horas se rechaza también el pago, salvo que ya esté abonado.
  app.delete('/api/bolsa/movimientos/:id', mw, ruta('DELETE movimiento', async req => {
    const id = idDe(req.params.id);
    const [m] = await q(supabase.from('bolsa_movimientos').select('*').eq('id', id));
    if (!m) throw new ErrorUsuario('Apunte no encontrado');
    if (m.extra_registro_id) {
      if (!esSergio(req.session.usuario)) throw new ErrorUsuario('Es un pago de horas: solo Sergio puede anularlo');
      const [r] = await q(supabase.from('extras_registros').select('estado').eq('id', m.extra_registro_id));
      if (r && r.estado === 'pagado') throw new ErrorUsuario('Ya está pagado: deshaz el pago en Aprobar y pagar extras');
      if (r) await q(supabase.from('extras_registros').update({ estado: 'rechazado', revisado_por: quien(req), revisado_en: new Date().toISOString(), motivo_rechazo: 'Anulado en la Bolsa de horas' }).eq('id', m.extra_registro_id).select());
    }
    await q(supabase.from('bolsa_movimientos').update({ anulado_por: quien(req), anulado_en: new Date().toISOString() }).eq('id', id).select());
    return {};
  }));

  app.post('/api/bolsa/vacaciones', mw, ruta('POST /api/bolsa/vacaciones', async req => {
    const b = req.body || {};
    const dias = diasEntre(b.fecha_inicio, b.fecha_fin);
    if (dias === null) throw new ErrorUsuario('Indica la fecha de inicio y la de fin (el fin no puede ser anterior)');
    const { empleados } = await cargar();
    const [e] = empleadosDe(empleados, [String(b.clave || '')]);
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
    const { empleados } = await cargar();
    if (empleados.some(e => e.clave === clave || String(e.nombre).toUpperCase() === nombre.toUpperCase())) throw new ErrorUsuario('Ya hay un empleado con ese nombre');
    await q(supabase.from('bolsa_empleados').insert({ clave, nombre: nombre.toUpperCase(), area: texto(b.area, 60), registrado_por: quien(req) }).select());
    return { clave };
  }));
}

module.exports = { registrar, parsearHoras, parsearDias, fechaValida, diasEntre, diasVacacionesEnAnio, calcularSaldos, construirPlantilla, tiposApuntables, trabajadorDeClave };
