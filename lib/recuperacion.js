// Recuperación de material — lógica pura (sin red ni base de datos).
// Ver sql/recuperacion_material.sql para el flujo completo. La parte que
// habla con Rentman y Supabase está en lib/recuperacionRutas.js.

const SUFIJO = /\s*NO DEVUELTO\s*$/i;

// "Copa VIP  catering 48cl" → "COPA VIP CATERING 48CL" (para comparar nombres)
function normalizarArticulo(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// Un coste adicional de Rentman es un cargo por material perdido si su
// nombre acaba en "NO DEVUELTO". Devuelve el artículo o null.
function articuloDeCargo(nombre) {
  const n = String(nombre || '');
  if (!SUFIJO.test(n)) return null;
  const art = normalizarArticulo(n.replace(SUFIJO, ''));
  return art || null;
}

// Cuánto queda por recuperar de cada cargo: su cantidad menos lo ya
// confirmado contra él (por_quitar o cerrado).
function pendientePorCargo(cargos, recuperados) {
  const usado = {};
  recuperados.forEach(r => {
    if (r.cargo_id && r.estado !== 'por_confirmar') usado[r.cargo_id] = (usado[r.cargo_id] || 0) + Number(r.cantidad || 0);
  });
  const out = {};
  cargos.forEach(c => { out[c.cargo_id] = Math.max(0, Number(c.cantidad || 0) - (usado[c.cargo_id] || 0)); });
  return out;
}

// Proyectos posibles para un material recuperado: cargos que siguen en
// Rentman, del mismo artículo, anteriores a la recuperación y con algo
// pendiente. Los más antiguos primero.
function candidatos(recuperado, cargos, pendientes) {
  const art = normalizarArticulo(recuperado.articulo);
  return cargos
    .filter(c => c.existe !== false && normalizarArticulo(c.articulo) === art && (pendientes[c.cargo_id] || 0) > 0 &&
      (!c.creado_en || !recuperado.fecha || new Date(c.creado_en) <= new Date(recuperado.fecha)))
    .sort((a, b) => String(a.creado_en || '').localeCompare(String(b.creado_en || '')));
}

// Proyecto que se propone: solo si hay un único proyecto posible.
function propuesta(recuperado, cargos, pendientes) {
  const c = candidatos(recuperado, cargos, pendientes);
  const proyectos = [...new Set(c.map(x => x.proyecto_id))];
  return proyectos.length === 1 ? c[0] : null;
}

// ¿Se ha quitado ya el cargo al cliente? Comparando el cargo de ahora en
// Rentman con su cantidad cuando se confirmó la recuperación.
//   - el cargo ya no está → 'cargo_quitado'
//   - ha bajado al menos lo recuperado → 'cargo_reducido'
//   - si no, sigue pendiente → null
function motivoCierre(recuperado, cargoActual) {
  if (!recuperado.cargo_id) return null;
  if (!cargoActual || cargoActual.existe === false) return 'cargo_quitado';
  const antes = Number(recuperado.cargo_cantidad_al_confirmar);
  if (Number.isFinite(antes) && Number(cargoActual.cantidad) <= antes - Number(recuperado.cantidad || 0)) return 'cargo_reducido';
  return null;
}

module.exports = { normalizarArticulo, articuloDeCargo, pendientePorCargo, candidatos, propuesta, motivoCierre };
