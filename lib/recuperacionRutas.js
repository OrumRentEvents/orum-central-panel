// Recuperación de material — API /api/recuperacion/* y sincronización con
// Rentman. Flujo y tablas en sql/recuperacion_material.sql; la lógica pura
// (emparejar con cargos, saber si se quitó el cargo) en lib/recuperacion.js.
//
// Rentman solo se LEE: los "Material recuperado" (stockmovements de tipo
// equipment_found) y los costes adicionales "<ARTÍCULO> NO DEVUELTO". La API
// de Rentman no dice de qué proyecto es lo recuperado: ORUM Central lo
// propone y Logística lo confirma.
const R = require('./recuperacion');

const ROLES_VER = ['Direccion', 'Logistica', 'Contabilidad'];
const ROLES_CONFIRMAR = ['Direccion', 'Logistica'];
const ROLES_CERRAR = ['Direccion', 'Contabilidad'];
const MOTIVOS_MANUALES = { abono: 'Abono hecho (ya estaba facturado)', se_cobra: 'Se cobra igualmente', otro: 'Otro' };
const CADA_MS = 15 * 60 * 1000;      // sincronización automática
const FRESCO_MS = 3 * 60 * 1000;     // al abrir la pantalla, si hace más de esto, se refresca

function registrar(app, { supabase, requiereLogin, rentman }) {
  const rol = req => req.session.usuario.rol;
  const quien = req => req.session.usuario.nombre || req.session.usuario.usuario;
  const fallo = (estado, msg) => Object.assign(new Error(msg), { estado });
  const permite = roles => (req, res, next) => roles.includes(rol(req)) ? next() : res.status(403).json({ error: 'No autorizado para este apartado' });
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
  async function selectTodo(tabla, columnas, filtro) {
    const todas = [];
    for (let desde = 0; ; desde += 1000) {
      let c = supabase.from(tabla).select(columnas).order(tabla === 'recuperacion_cargos' ? 'cargo_id' : 'id').range(desde, desde + 999);
      if (filtro) c = filtro(c);
      const filas = await q(c);
      todas.push(...filas);
      if (filas.length < 1000) return todas;
    }
  }

  // ── Rentman ──
  // Lista completa paginada (rentman() devuelve solo "data").
  async function listaRentman(ruta, porPagina = 1000) {
    const todas = [];
    for (let offset = 0; ; offset += porPagina) {
      const filas = (await rentman(ruta + (ruta.includes('?') ? '&' : '?') + 'limit=' + porPagina + '&offset=' + offset)) || [];
      todas.push(...filas);
      if (filas.length < porPagina) return todas;
    }
  }
  const idDe = r => Number(String(r || '').split('/').pop()) || null;
  const nombres = new Map();
  async function nombreRentman(ruta, campo) {
    if (!ruta) return null;
    if (!nombres.has(ruta)) {
      const d = await rentman(ruta, { opcional: true });
      nombres.set(ruta, d ? (d[campo] || d.displayname || d.name || null) : null);
    }
    return nombres.get(ruta);
  }

  let sincronizando = null, ultimaSync = null, ultimoError = null;
  function sincronizar() {
    if (!sincronizando) {
      sincronizando = sincronizarAhora()
        .then(() => { ultimaSync = new Date(); ultimoError = null; })
        .catch(err => { ultimoError = err.message; console.error('[Recuperación] Error al sincronizar:', err.message); })
        .finally(() => { sincronizando = null; });
    }
    return sincronizando;
  }
  async function sincronizarAhora() {
    const ahora = new Date().toISOString();
    // 1. Cargos NO DEVUELTO (costes adicionales de todos los proyectos)
    const costes = await listaRentman('/costs?fields=id,name,quantity,sale_price,project,created&sort=%2Bid');
    const cargos = costes.map(c => ({ c, art: R.articuloDeCargo(c.name) })).filter(x => x.art && idDe(x.c.project)).map(({ c, art }) => ({
      cargo_id: c.id, proyecto_id: idDe(c.project), articulo: art, cantidad: Number(c.quantity) || 0,
      precio: Number(c.sale_price) || 0, creado_en: c.created || null, existe: true, visto_en: ahora
    }));
    for (let i = 0; i < cargos.length; i += 500) await q(supabase.from('recuperacion_cargos').upsert(cargos.slice(i, i + 500)));
    // Los que ya no están en Rentman (borrados por Administración) se marcan, no se borran
    const vistos = new Set(cargos.map(c => c.cargo_id));
    const guardados = await selectTodo('recuperacion_cargos', 'cargo_id,existe');
    const desaparecidos = guardados.filter(c => c.existe && !vistos.has(Number(c.cargo_id))).map(c => c.cargo_id);
    for (let i = 0; i < desaparecidos.length; i += 200) await q(supabase.from('recuperacion_cargos').update({ existe: false, visto_en: ahora }).in('cargo_id', desaparecidos.slice(i, i + 200)));

    // 2. Material recuperado nuevo (los más recientes; los ya guardados no se tocan)
    const movs = (await rentman('/stockmovements?type=equipment_found&fields=id,date,amount,equipment,creator&sort=-id&limit=500')) || [];
    const ya = new Set((await selectTodo('material_recuperado', 'id')).map(r => Number(r.id)));
    const nuevos = [];
    for (const m of movs.filter(x => !ya.has(Number(x.id)))) {
      nuevos.push({
        id: m.id, equipo_id: idDe(m.equipment), articulo: R.normalizarArticulo(await nombreRentman(m.equipment, 'name') || ('Equipo ' + idDe(m.equipment))),
        cantidad: Math.abs(Number(m.amount) || 0), fecha: m.date, marcado_por: await nombreRentman(m.creator, 'displayname')
      });
    }
    if (nuevos.length) await q(supabase.from('material_recuperado').insert(nuevos));

    // 3. Cierre automático: el cargo ya no está o ha bajado
    const porQuitar = await selectTodo('material_recuperado', '*', c => c.eq('estado', 'por_quitar'));
    if (porQuitar.length) {
      const porId = {};
      (await selectTodo('recuperacion_cargos', '*', c => c.in('cargo_id', [...new Set(porQuitar.map(r => r.cargo_id).filter(Boolean))]))).forEach(c => { porId[c.cargo_id] = c; });
      for (const r of porQuitar) {
        const motivo = R.motivoCierre(r, porId[r.cargo_id]);
        if (motivo) await q(supabase.from('material_recuperado').update({ estado: 'cerrado', cerrado_motivo: motivo, cerrado_por: 'automático', cerrado_en: ahora }).eq('id', r.id).eq('estado', 'por_quitar'));
      }
    }
  }
  setInterval(() => { if (process.env.RENTMAN_TOKEN) sincronizar(); }, CADA_MS).unref();
  setTimeout(() => { if (process.env.RENTMAN_TOKEN) sincronizar(); }, 20000).unref();

  async function proyectos(ids) {
    const lista = [...new Set(ids.filter(Boolean))];
    if (!lista.length) return {};
    const filas = await q(supabase.from('proyectos').select('id,numero,nombre,cliente,already_invoiced').in('id', lista));
    const out = {};
    filas.forEach(p => { out[p.id] = { id: p.id, numero: p.numero, nombre: p.nombre, cliente: p.cliente, facturado: Number(p.already_invoiced) > 0 }; });
    return out;
  }

  const base = '/api/recuperacion';

  // Contadores para el menú del panel y el botón de la app
  app.get(base + '/resumen', requiereLogin, permite(ROLES_VER), ruta('GET recuperacion/resumen', async () => {
    const cuenta = async estado => {
      const { count, error } = await supabase.from('material_recuperado').select('id', { count: 'exact', head: true }).eq('estado', estado);
      if (error) throw error;
      return count || 0;
    };
    return { por_confirmar: await cuenta('por_confirmar'), por_quitar: await cuenta('por_quitar') };
  }));

  app.get(base, requiereLogin, permite(ROLES_VER), ruta('GET recuperacion', async req => {
    if (!ultimaSync) await sincronizar();
    else if (Date.now() - ultimaSync > FRESCO_MS || req.query.actualizar === '1') await sincronizar();
    const [recs, cargos] = await Promise.all([
      selectTodo('material_recuperado', '*'),
      selectTodo('recuperacion_cargos', '*')
    ]);
    const pend = R.pendientePorCargo(cargos, recs);
    const cargoPorId = {}; cargos.forEach(c => { cargoPorId[c.cargo_id] = c; });
    const porConfirmar = recs.filter(r => r.estado === 'por_confirmar').sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const porQuitar = recs.filter(r => r.estado === 'por_quitar').sort((a, b) => String(b.confirmado_en).localeCompare(String(a.confirmado_en)));
    const cerrados = recs.filter(r => r.estado === 'cerrado').sort((a, b) => String(b.cerrado_en).localeCompare(String(a.cerrado_en))).slice(0, 80);
    const candidatosDe = {};
    porConfirmar.forEach(r => { candidatosDe[r.id] = R.candidatos(r, cargos, pend); });
    const ids = [].concat(...Object.values(candidatosDe).map(l => l.map(c => c.proyecto_id)), porQuitar.map(r => r.proyecto_id), cerrados.map(r => r.proyecto_id));
    const P = await proyectos(ids);
    const conCargo = c => ({ cargo_id: c.cargo_id, proyecto: P[c.proyecto_id] || { id: c.proyecto_id }, pendiente: pend[c.cargo_id], cantidad: Number(c.cantidad), precio: Number(c.precio), creado_en: c.creado_en });
    return {
      sincronizado_en: ultimaSync, error_sync: ultimoError,
      permisos: { confirmar: ROLES_CONFIRMAR.includes(rol(req)), cerrar: ROLES_CERRAR.includes(rol(req)) },
      motivos: MOTIVOS_MANUALES,
      por_confirmar: porConfirmar.map(r => {
        const cand = candidatosDe[r.id].map(conCargo);
        const unico = [...new Set(cand.map(c => c.proyecto.id))].length === 1;
        return { ...r, candidatos: cand, propuesta: unico ? cand[0] : null };
      }),
      por_quitar: porQuitar.map(r => ({ ...r, proyecto: P[r.proyecto_id] || null, cargo: cargoPorId[r.cargo_id] ? conCargo(cargoPorId[r.cargo_id]) : null })),
      cerrados: cerrados.map(r => ({ ...r, proyecto: P[r.proyecto_id] || null }))
    };
  }));

  // Buscar un proyecto por número: sus cargos NO DEVUELTO y lo que queda de cada uno
  app.get(base + '/proyecto/:numero', requiereLogin, permite(ROLES_VER), ruta('GET recuperacion/proyecto', async req => {
    const numero = parseInt(req.params.numero);
    if (!numero) throw fallo(400, 'Número de proyecto no válido');
    const [p] = await q(supabase.from('proyectos').select('id,numero,nombre,cliente,already_invoiced').eq('numero', numero).gt('id', 0));
    if (!p) throw fallo(404, 'No encuentro el proyecto ' + numero);
    const [cargos, recs] = await Promise.all([
      q(supabase.from('recuperacion_cargos').select('*').eq('proyecto_id', p.id).order('cargo_id')),
      selectTodo('material_recuperado', 'id,cargo_id,cantidad,estado')
    ]);
    const pend = R.pendientePorCargo(cargos, recs);
    return {
      proyecto: { id: p.id, numero: p.numero, nombre: p.nombre, cliente: p.cliente, facturado: Number(p.already_invoiced) > 0 },
      cargos: cargos.map(c => ({ cargo_id: c.cargo_id, articulo: c.articulo, cantidad: Number(c.cantidad), pendiente: pend[c.cargo_id], precio: Number(c.precio), existe: c.existe }))
    };
  }));

  // Logística confirma de qué proyecto es cada recuperado (uno o varios a la vez)
  app.post(base + '/confirmar', requiereLogin, permite(ROLES_CONFIRMAR), ruta('POST recuperacion/confirmar', async req => {
    const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
    if (!items.length) throw fallo(400, 'No hay nada que confirmar');
    const ahora = new Date().toISOString();
    const [recs, cargos] = await Promise.all([selectTodo('material_recuperado', '*'), selectTodo('recuperacion_cargos', '*')]);
    const pend = R.pendientePorCargo(cargos, recs);
    const hechos = [];
    for (const it of items) {
      const r = recs.find(x => Number(x.id) === Number(it.id));
      if (!r) throw fallo(404, 'No encuentro ese material recuperado');
      if (r.estado !== 'por_confirmar') throw fallo(400, r.articulo + ' ya estaba confirmado');
      const proyectoId = Number(it.proyecto_id);
      const [p] = proyectoId ? await q(supabase.from('proyectos').select('id,numero').eq('id', proyectoId)) : [];
      if (!p) throw fallo(400, 'Elige el proyecto de ' + r.articulo);
      // El cargo: el indicado o, si no, el de ese artículo en ese proyecto con algo pendiente
      let cargo = it.cargo_id ? cargos.find(c => Number(c.cargo_id) === Number(it.cargo_id) && Number(c.proyecto_id) === p.id) : null;
      if (!cargo) cargo = R.candidatos(r, cargos, pend).find(c => Number(c.proyecto_id) === p.id) || null;
      const cambios = { proyecto_id: p.id, confirmado_por: quien(req), confirmado_en: ahora, notas: String(it.notas || '').trim() || null };
      if (cargo) {
        const cubre = Math.min(Number(r.cantidad), pend[cargo.cargo_id] || 0);
        Object.assign(cambios, { estado: 'por_quitar', cargo_id: cargo.cargo_id, cargo_cantidad_al_confirmar: Number(cargo.cantidad), importe: Math.round(cubre * Number(cargo.precio) * 100) / 100 });
        pend[cargo.cargo_id] = Math.max(0, (pend[cargo.cargo_id] || 0) - Number(r.cantidad));
      } else {
        // Sin cargo pendiente en ese proyecto: no hay nada que quitar al cliente
        Object.assign(cambios, { estado: 'cerrado', cargo_id: null, importe: 0, cerrado_motivo: 'sin_cargo', cerrado_por: quien(req), cerrado_en: ahora });
      }
      await q(supabase.from('material_recuperado').update(cambios).eq('id', r.id).eq('estado', 'por_confirmar'));
      hechos.push({ id: r.id, estado: cambios.estado });
    }
    return { confirmados: hechos };
  }));

  // Logística se equivocó de proyecto: vuelve a "por confirmar" (si aún no se ha quitado el cargo)
  app.post(base + '/:id/deshacer', requiereLogin, permite(ROLES_CONFIRMAR), ruta('POST recuperacion/deshacer', async req => {
    const [r] = await q(supabase.from('material_recuperado').select('*').eq('id', parseInt(req.params.id) || 0));
    if (!r) throw fallo(404, 'No encontrado');
    if (r.estado === 'cerrado' && r.cerrado_motivo !== 'sin_cargo') throw fallo(400, 'Ya está cerrado: el cargo se quitó o lo cerró Administración');
    if (r.estado === 'por_confirmar') return {};
    await q(supabase.from('material_recuperado').update({
      estado: 'por_confirmar', proyecto_id: null, cargo_id: null, cargo_cantidad_al_confirmar: null, importe: null,
      confirmado_por: null, confirmado_en: null, cerrado_por: null, cerrado_en: null, cerrado_motivo: null
    }).eq('id', r.id));
    return {};
  }));

  // Administración cierra a mano (abono si ya estaba facturado, se cobra igualmente...)
  app.post(base + '/:id/cerrar', requiereLogin, permite(ROLES_CERRAR), ruta('POST recuperacion/cerrar', async req => {
    const motivo = String((req.body && req.body.motivo) || '');
    if (!MOTIVOS_MANUALES[motivo]) throw fallo(400, 'Elige el motivo');
    const [r] = await q(supabase.from('material_recuperado').select('id,estado,notas').eq('id', parseInt(req.params.id) || 0));
    if (!r) throw fallo(404, 'No encontrado');
    if (r.estado !== 'por_quitar') throw fallo(400, 'Solo se cierra lo que está pendiente de quitar');
    const nota = String((req.body && req.body.notas) || '').trim();
    await q(supabase.from('material_recuperado').update({
      estado: 'cerrado', cerrado_motivo: motivo, cerrado_por: quien(req), cerrado_en: new Date().toISOString(),
      notas: [r.notas, nota].filter(Boolean).join(' · ') || null
    }).eq('id', r.id));
    return {};
  }));
}

module.exports = { registrar };
