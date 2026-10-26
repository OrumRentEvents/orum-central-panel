// Módulo Vehículos — API /api/vehiculos/* (fase 1: flota, vencimientos,
// mantenimientos y documentos). La lógica pura vive en lib/vehiculos.js.
// Ver docs/superpowers/specs/2026-10-20-modulo-vehiculos-design.md
const multer = require('multer');
const V = require('./vehiculos');
const { crearAvisos } = require('./vehiculosAvisos');
const L = require('./localizador');
const R = require('./ranking');

const ROLES_VEHICULOS = ['Direccion', 'Contabilidad', 'Logistica'];
const BUCKET = 'vehiculos-documentos';
const CAMPOS_VEHICULO = ['matricula', 'marca', 'modelo', 'tipo', 'nombre_rutas', 'nombre_localizador', 'propiedad', 'fecha_alta', 'fecha_baja', 'activo', 'km_base', 'km_base_fecha', 'notas', 'repostaje'];
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

  // Supabase devuelve como mucho 1.000 filas por consulta: se pagina.
  // Siempre con un orden fijo: sin él Postgres puede repetir o saltarse filas entre páginas.
  async function selectTodo(tabla, columnas, filtro, orden = ['id']) {
    const todas = [];
    for (let desde = 0; ; desde += 1000) {
      let consulta = supabase.from(tabla).select(columnas);
      orden.forEach(c => { consulta = consulta.order(c); });
      consulta = consulta.range(desde, desde + 999);
      if (filtro) consulta = filtro(consulta);
      const filas = await q(consulta);
      todas.push(...filas);
      if (filas.length < 1000) return todas;
    }
  }

  // Km por día del localizador, agrupados por vehículo (para el cuentakilómetros).
  async function kmDiariosPorVehiculo(vehiculoId) {
    const filas = await selectTodo('vehiculos_km_diarios', 'vehiculo_id,fecha,km', vehiculoId ? c => c.eq('vehiculo_id', vehiculoId) : null, ['vehiculo_id', 'fecha']);
    const por = {};
    filas.forEach(f => { (por[f.vehiculo_id] = por[f.vehiculo_id] || []).push(f); });
    return por;
  }

  // Carga todo lo necesario para pintar flota y vencimientos.
  async function cargarTodo() {
    const [vehiculos, vencimientos, mantenimientos, rutas, kmDiarios, repostajes] = await Promise.all([
      q(supabase.from('vehiculos').select('*').order('id')),
      q(supabase.from('vehiculos_vencimientos').select('*').eq('activo', true)),
      q(supabase.from('vehiculos_mantenimientos').select('id,vehiculo_id,fecha,km,importe')),
      q(supabase.from('rutas_vehiculos').select('nombre')),
      kmDiariosPorVehiculo(),
      selectTodo('vehiculos_repostajes', 'id,vehiculo_id,fecha,km')
    ]);
    const hoy = hoyMadrid();
    const kmPorVehiculo = {};
    // El km de cada repostaje es una lectura del cuentakilómetros, como la de un mantenimiento
    vehiculos.forEach(v => { kmPorVehiculo[v.id] = V.kmActuales(v, mantenimientos.filter(m => m.vehiculo_id === v.id).concat(repostajes.filter(r => r.vehiculo_id === v.id)), kmDiarios[v.id] || []); });
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

  // ── Localizador GPS: importar el "Informe detallado" (lib/localizador.js) ──
  // Varios archivos a la vez: el "Informe detallado" a veces solo se puede sacar día a día.
  const subirExcel = (req, res, next) => multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 62 } }).array('archivos', 62)(req, res, err => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Algún archivo supera los 20 MB' : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Como mucho 62 archivos a la vez' : err.message });
    next();
  });
  const normNombre = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const claveTrayecto = (vehiculoId, inicio) => vehiculoId + '|' + String(inicio).replace('T', ' ').slice(0, 19);

  // Sin ?confirmar=1 solo devuelve el resumen (vista previa); con él, guarda.
  // Acepta los dos informes del localizador; si un trayecto viene en los dos,
  // gana el "Informe detallado" (trae velocidades y consumo).
  app.post(base + '/localizador', mw, subirExcel, ruta('POST localizador', async req => {
    if (!req.files || !req.files.length) throw new ErrorUsuario('Falta el archivo');
    const archivos = [];
    for (const f of req.files) {
      const nombre = Buffer.from(f.originalname, 'latin1').toString('utf8');
      try {
        const inf = L.parsearInforme(f.buffer);
        archivos.push({ nombre, formato: inf.formato, campos: inf.campos, trayectos: inf.trayectos, desde: inf.desde, hasta: inf.hasta });
      } catch (e) { archivos.push({ nombre, error: e.message, trayectos: [] }); }
    }
    const conError = archivos.filter(a => a.error);
    const todos = archivos.flatMap((a, n) => a.trayectos.map(t => ({ ...t, _formato: a.formato, _campos: a.campos, _archivo: n })));
    if (!todos.length) throw new ErrorUsuario(conError.length ? conError.map(a => a.nombre + ': ' + a.error).join(' · ') : 'Los archivos no tienen trayectos');

    const vehiculos = await q(supabase.from('vehiculos').select('id,matricula,nombre_localizador,activo'));
    const porMatricula = {}, porNombre = {};
    vehiculos.forEach(v => {
      if (v.matricula) porMatricula[V.normalizarMatricula(v.matricula)] = v;
      if (v.nombre_localizador) porNombre[normNombre(v.nombre_localizador)] = v;
    });
    const unicos = new Map(), ignorados = {}, desconocidos = {};
    todos.forEach(t => {
      const v = porMatricula[V.normalizarMatricula(t.matricula)] || porNombre[normNombre(t.vehiculo_nombre)];
      const etiqueta = t.matricula || t.vehiculo_nombre;
      if (!v) { desconocidos[etiqueta] = (desconocidos[etiqueta] || 0) + 1; return; }
      if (v.activo === false) { ignorados[etiqueta] = (ignorados[etiqueta] || 0) + 1; return; }
      const k = claveTrayecto(v.id, t.inicio), previo = unicos.get(k);
      if (!previo || (previo._formato !== 'informe' && t._formato === 'informe')) unicos.set(k, { ...t, vehiculo_id: v.id });
      // mismo inicio dentro del MISMO archivo: dos maniobras registradas a la vez → se suman.
      // (De archivos distintos es el mismo trayecto repetido: se queda uno.)
      else if (previo._archivo === t._archivo && previo._formato === t._formato) unicos.set(k, L.fusionarTramos(previo, t));
    });
    const fechas = [...unicos.values()].map(t => t.fecha).sort();
    const desde = fechas[0], hasta = fechas[fechas.length - 1];
    const enBase = unicos.size ? await selectTodo('vehiculos_trayectos', 'vehiculo_id,fecha,inicio,formato', c => c.gte('fecha', desde).lte('fecha', hasta)) : [];
    // Para cada vehículo y día manda el "Informe detallado" (los dos informes
    // cortan los trayectos distinto y mezclarlos duplicaría km).
    const { guardar: validos, descartados, diasInforme } = L.combinarFormatos([...unicos.values()],
      new Set(enBase.filter(f => f.formato === 'informe').map(f => f.vehiculo_id + '|' + f.fecha)));
    const existentes = new Set(enBase.map(f => claveTrayecto(f.vehiculo_id, f.inicio)));
    const nuevos = validos.filter(t => !existentes.has(claveTrayecto(t.vehiculo_id, t.inicio)));
    const resumen = {
      desde: desde || null, hasta: hasta || null, total: todos.length,
      archivos: archivos.map(a => ({ nombre: a.nombre, formato: a.formato || null, trayectos: a.trayectos.length, desde: a.desde || null, hasta: a.hasta || null, error: a.error || null })),
      validos: validos.length, nuevos: nuevos.length, existentes: validos.length - nuevos.length,
      sin_velocidades: validos.filter(t => t._formato === 'detalle').length,
      descartados_detalle: descartados,
      km_nuevos: Math.round(nuevos.reduce((s, t) => s + (t.km || 0), 0)),
      ignorados: Object.entries(ignorados).map(([nombre, n]) => ({ nombre, trayectos: n, motivo: 'vehículo dado de baja' })),
      desconocidos: Object.entries(desconocidos).map(([nombre, n]) => ({ nombre, trayectos: n }))
    };
    if (req.query.confirmar !== '1') return { resumen, guardado: false };
    if (conError.length) throw new ErrorUsuario('Quita o corrige los archivos con error antes de importar');
    // upsert por formato: cada informe solo escribe las columnas que trae, así
    // un "Detalle de trayectos" no borra las velocidades ya importadas.
    for (const formato of ['detalle', 'informe']) {
      const grupo = validos.filter(t => t._formato === formato);
      if (!grupo.length) continue;
      const campos = grupo[0]._campos;
      const filas = grupo.map(t => {
        const f = { vehiculo_id: t.vehiculo_id, formato, importado_por: quien(req) };
        campos.forEach(c => { f[c] = t[c] === undefined ? null : t[c]; });
        return f;
      });
      for (let i = 0; i < filas.length; i += 500) {
        await q(supabase.from('vehiculos_trayectos').upsert(filas.slice(i, i + 500), { onConflict: 'vehiculo_id,inicio' }));
      }
    }
    // Después de guardar (si algo falla a mitad no se pierde nada): lo que quede
    // del "Detalle" en días que ahora tienen el informe completo, fuera. Los
    // tramos que coincidían ya se han convertido en 'informe' con el upsert.
    for (const d of diasInforme) {
      const [vid, fecha] = d.split('|');
      await q(supabase.from('vehiculos_trayectos').delete().eq('vehiculo_id', vid).eq('fecha', fecha).eq('formato', 'detalle'));
    }
    return { resumen, guardado: true };
  }));

  // ── Uso del mes: por vehículo, por conductor, a revisar y sin conductor ──
  // Uso de un mes (lo comparten la pantalla Uso y el ranking).
  async function cargarUso(mesPedido) {
    const mes = /^\d{4}-\d{2}$/.test(mesPedido || '') ? mesPedido : hoyMadrid().slice(0, 7);
    const desde = mes + '-01';
    const hasta = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).toISOString().slice(0, 10);
    const [trayectos, rutas, cortes, vehiculos, ultimo] = await Promise.all([
      selectTodo('vehiculos_trayectos', 'vehiculo_id,fecha,inicio,km,seg_conduccion,seg_paradas,origen,loc_origen,destino,loc_destino,vel_max,litros,litros_optimo', c => c.gte('fecha', desde).lte('fecha', hasta)),
      selectTodo('rutas_conductores', 'fecha,vehiculo,vuelta,conductores,conductor', c => c.gte('fecha', desde).lte('fecha', hasta)),
      selectTodo('vehiculos_cortes_vuelta', 'vehiculo_id,fecha,cortes', c => c.gte('fecha', desde).lte('fecha', hasta), ['vehiculo_id', 'fecha']),
      q(supabase.from('vehiculos').select('id,matricula,marca,modelo,tipo,nombre_rutas,activo').order('id')),
      q(supabase.from('vehiculos_trayectos').select('fecha').order('fecha', { ascending: false }).limit(1))
    ]);
    const cortesPorClave = {};
    cortes.forEach(c => { cortesPorClave[c.vehiculo_id + '_' + c.fecha] = c.cortes || []; });
    return { mes, ultimo_dia_importado: ultimo[0] ? ultimo[0].fecha : null, vehiculos, cortes: cortesPorClave, uso: L.calcularUso(trayectos, rutas, cortesPorClave, vehiculos) };
  }

  app.get(base + '/uso', mw, ruta('GET uso', async req => {
    const { uso, ...resto } = await cargarUso(req.query.mes);
    const { trayectosConductor, ...sinTrayectos } = uso; // el detalle por trayecto solo lo usa el ranking
    return { ...resto, ...sinTrayectos };
  }));

  // ── Ranking de conductores (lib/ranking.js) ──
  async function configRanking() {
    const [fila] = await q(supabase.from('vehiculos_config').select('valor').eq('clave', 'ranking'));
    return R.mezclarConfig(fila ? fila.valor : null);
  }

  app.get(base + '/ranking', mw, ruta('GET ranking', async req => {
    const [{ uso, mes, ultimo_dia_importado, vehiculos }, config] = await Promise.all([cargarUso(req.query.mes), configRanking()]);
    const porId = {};
    vehiculos.forEach(v => { porId[v.id] = v; });
    const sinDeterminar = uso.porConductor.find(c => c.conductor === null);
    return {
      mes, ultimo_dia_importado, vehiculos, ...R.calcularRanking(uso.trayectosConductor, porId, config),
      km_sin_determinar: sinDeterminar ? sinDeterminar.km : 0,
      km_sin_conductor: Math.round(uso.sinConductor.reduce((s, x) => s + x.km, 0)),
      dias_revisar: uso.revisar.length
    };
  }));

  app.put(base + '/ranking/config', mw, ruta('PUT ranking/config', async req => {
    const b = req.body || {};
    const n = (v, nombre, min, max) => {
      const x = Number(v);
      if (v === '' || v == null || isNaN(x) || x < min || x > max) throw new ErrorUsuario(nombre + ' debe ser un número entre ' + min + ' y ' + max);
      return x;
    };
    const valor = { umbrales: {}, pesos: {}, km_minimo: n(b.km_minimo, 'Km mínimo', 0, 100000) };
    ['furgoneta', 'camion', 'turismo'].forEach(tipo => {
      const u = (b.umbrales || {})[tipo] || {};
      const leve = n(u.leve, 'Exceso leve (' + tipo + ')', 30, 250), grave = n(u.grave, 'Exceso grave (' + tipo + ')', 30, 250);
      if (grave <= leve) throw new ErrorUsuario('En ' + tipo + ' el exceso grave tiene que ser mayor que el leve');
      valor.umbrales[tipo] = { leve, grave };
    });
    ['graves', 'leves', 'ralenti', 'consumo'].forEach(k => { valor.pesos[k] = n((b.pesos || {})[k], 'Peso de ' + k, 0, 100); });
    const suma = Object.values(valor.pesos).reduce((a, x) => a + x, 0);
    if (suma !== 100) throw new ErrorUsuario('Los pesos tienen que sumar 100 (ahora suman ' + suma + ')');
    await q(supabase.from('vehiculos_config').upsert({ clave: 'ranking', valor, actualizado_por: quien(req), actualizado_en: new Date().toISOString() }, { onConflict: 'clave' }));
    return { config: R.mezclarConfig(valor) };
  }));

  // Horas de corte manuales de un día "a revisar" (['HH:MM'], una menos que vueltas). [] = quitar.
  app.put(base + '/uso/cortes', mw, ruta('PUT uso/cortes', async req => {
    const vehiculo_id = idDe(req.body.vehiculo_id), fecha = String(req.body.fecha || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ErrorUsuario('Fecha no válida');
    const cortes = (Array.isArray(req.body.cortes) ? req.body.cortes : []).map(c => String(c).trim()).filter(Boolean);
    if (cortes.some(c => !/^([01]\d|2[0-3]):[0-5]\d$/.test(c))) throw new ErrorUsuario('Las horas de corte deben ser HH:MM');
    if (!cortes.length) await q(supabase.from('vehiculos_cortes_vuelta').delete().eq('vehiculo_id', vehiculo_id).eq('fecha', fecha));
    else await q(supabase.from('vehiculos_cortes_vuelta').upsert({ vehiculo_id, fecha, cortes: cortes.sort(), actualizado_por: quien(req), actualizado_en: new Date().toISOString() }, { onConflict: 'vehiculo_id,fecha' }));
    return {};
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

  // ── Repostajes (oct 2026) ──
  // Desde la app: vehículo, km del cuentakilómetros, litros y quién reposta
  // (lista de choferes de Rutas). Van antes de '/:id' para que no las capture.
  async function choferesRutas() {
    const [fila] = await q(supabase.from('rutas_config').select('valor').eq('clave', 'CHOFERES'));
    return Array.isArray(fila && fila.valor) ? fila.valor : [];
  }
  const nombreVehiculo = v => [v.marca, v.modelo].filter(Boolean).join(' ') || v.nombre_rutas || v.matricula;

  app.get(base + '/repostajes/contexto', mw, ruta('GET repostajes/contexto', async () => {
    const [{ vehiculos, kmPorVehiculo }, choferes, ultimos] = await Promise.all([
      cargarTodo(), choferesRutas(),
      q(supabase.from('vehiculos_repostajes').select('*').order('creado_en', { ascending: false }).limit(15))
    ]);
    const porId = {}; vehiculos.forEach(v => { porId[v.id] = v; });
    return {
      vehiculos: vehiculos.filter(v => v.activo !== false && v.repostaje !== false).map(v => ({ id: v.id, matricula: v.matricula, nombre: nombreVehiculo(v), nombre_rutas: v.nombre_rutas, tipo: v.tipo, km_actuales: kmPorVehiculo[v.id] })),
      choferes,
      ultimos: ultimos.map(r => ({ ...r, vehiculo: porId[r.vehiculo_id] ? nombreVehiculo(porId[r.vehiculo_id]) + ' · ' + porId[r.vehiculo_id].matricula : '' }))
    };
  }));

  app.post(base + '/repostajes', mw, ruta('POST repostajes', async req => {
    const b = req.body || {};
    const vehiculoId = idDe(b.vehiculo_id);
    // "125.430" o "125430" → 125430; litros admite coma decimal
    const km = Math.round(Number(String(b.km || '').replace(/[.\s]/g, '').replace(',', '.')));
    const litros = Math.round(Number(String(b.litros || '').replace(',', '.')) * 100) / 100;
    const persona = String(b.persona || '').trim();
    if (!(km > 0)) throw new ErrorUsuario('Indica los km del cuentakilómetros');
    if (!(litros > 0) || litros > 500) throw new ErrorUsuario('Indica los litros repostados');
    if (!persona) throw new ErrorUsuario('Indica quién ha repostado');
    const { vehiculos, kmPorVehiculo } = await cargarTodo();
    const v = vehiculos.find(x => x.id === vehiculoId && x.activo !== false);
    if (!v) throw new ErrorUsuario('Vehículo no encontrado');
    // Los km no pueden bajar respecto al último repostaje de ese vehículo
    const [ultimo] = await q(supabase.from('vehiculos_repostajes').select('km').eq('vehiculo_id', vehiculoId).order('km', { ascending: false }).limit(1));
    if (ultimo && km < Number(ultimo.km)) throw new ErrorUsuario('Los km (' + km.toLocaleString('es-ES') + ') son menos que en el último repostaje de este vehículo (' + Number(ultimo.km).toLocaleString('es-ES') + '). Revisa el cuentakilómetros.');
    // Muy lejos de lo esperado (¿una cifra de más o de menos?): se pide confirmar
    const esperado = kmPorVehiculo[vehiculoId];
    if (esperado && Math.abs(km - esperado) > 3000 && !b.confirmar) return { confirmar: true, km_esperados: Math.round(esperado) };
    const [r] = await q(supabase.from('vehiculos_repostajes').insert({ vehiculo_id: vehiculoId, fecha: hoyMadrid(), km, litros, persona, registrado_por: quien(req) }).select());
    return { repostaje: { ...r, vehiculo: nombreVehiculo(v) + ' · ' + v.matricula } };
  }));

  // Listado del panel (Vehículos → Repostajes), por mes
  app.get(base + '/repostajes', mw, ruta('GET repostajes', async req => {
    const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : hoyMadrid().slice(0, 7);
    const [a, m] = mes.split('-').map(Number);
    const hasta = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
    const [filas, vehiculos] = await Promise.all([
      selectTodo('vehiculos_repostajes', '*', c => c.gte('fecha', mes + '-01').lte('fecha', hasta), ['fecha', 'id']),
      q(supabase.from('vehiculos').select('id,matricula,marca,modelo,nombre_rutas'))
    ]);
    const porId = {}; vehiculos.forEach(v => { porId[v.id] = v; });
    return { mes, repostajes: filas.reverse().map(r => ({ ...r, vehiculo: porId[r.vehiculo_id] ? nombreVehiculo(porId[r.vehiculo_id]) : '', matricula: porId[r.vehiculo_id] ? porId[r.vehiculo_id].matricula : '' })) };
  }));

  app.delete(base + '/repostajes/:rid', mw, ruta('DELETE repostajes', async req => {
    await q(supabase.from('vehiculos_repostajes').delete().eq('id', idDe(req.params.rid)));
    return {};
  }));

  app.get(base + '/:id', mw, ruta('GET ' + base + '/:id', async req => {
    const id = idDe(req.params.id);
    const [vs, vencimientos, mantenimientos, documentos, repostajes] = await Promise.all([
      q(supabase.from('vehiculos').select('*').eq('id', id)),
      q(supabase.from('vehiculos_vencimientos').select('*').eq('vehiculo_id', id).eq('activo', true).order('id')),
      q(supabase.from('vehiculos_mantenimientos').select('*').eq('vehiculo_id', id).order('fecha', { ascending: false })),
      q(supabase.from('vehiculos_documentos').select('*').eq('vehiculo_id', id).order('subido_en', { ascending: false })),
      q(supabase.from('vehiculos_repostajes').select('*').eq('vehiculo_id', id).order('fecha', { ascending: false }).order('id', { ascending: false }))
    ]);
    if (!vs.length) throw new ErrorUsuario('Vehículo no encontrado');
    const km = V.kmActuales(vs[0], mantenimientos.concat(repostajes), (await kmDiariosPorVehiculo(id))[id] || []), hoy = hoyMadrid();
    return {
      vehiculo: vs[0], km_actuales: km, mantenimientos, documentos, repostajes,
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
