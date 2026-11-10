// Ausencias del personal (nov 2026): quién está de vacaciones o de descanso cada
// día, sacado de la Bolsa de horas. Lo usan el Calendario y Rutas (para que
// Logística no planifique a quien no está). Lógica pura, sin Supabase: test en
// test/ausencias.test.js.
//
// Fuentes:
// - bolsa_vacaciones: periodo fecha_inicio..fecha_fin (ambos incluidos).
// - bolsa_movimientos tipo 'descanso' con cantidad negativa (= lo disfruta): desde
//   su fecha, tantos días seguidos como la cantidad; ",5" = medio día el último.
// - extras_registros «Descanso Disfrutado…» (registros antiguos): un día.
// Lo anulado y lo rechazado no cuenta. Si coinciden, manda vacaciones.

const MAX_DIAS = 400; // por si un rango viene mal, no generar años de días

function sumarDias(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function diasDelRango(desde, hasta) {
  const out = [];
  for (let f = desde, i = 0; f <= hasta && i < MAX_DIAS; f = sumarDias(f, 1), i++) out.push(f);
  return out;
}
const claveDeRegistro = r => r.nombre_libre ? 'libre|' + r.nombre_libre : [r.empresa_nif, r.formato_origen, r.num_empleado].join('|');

// { 'YYYY-MM-DD': [{ clave, nombre, tipo: 'vacaciones'|'descanso', medio, nota }] }
function ausenciasPorDia({ desde, hasta, vacaciones = [], movimientos = [], registros = [] }) {
  const porDia = {};
  const poner = (fecha, a) => {
    if (fecha < desde || fecha > hasta) return;
    const lista = porDia[fecha] = porDia[fecha] || [];
    const ya = lista.find(x => x.clave === a.clave);
    if (!ya) return lista.push(a);
    // Vacaciones manda sobre descanso; un día entero sobre medio día
    if (ya.tipo === 'descanso' && a.tipo === 'vacaciones') Object.assign(ya, a);
    else if (ya.tipo === a.tipo && ya.medio && !a.medio) ya.medio = false;
  };
  vacaciones.filter(v => !v.anulado_en && v.fecha_inicio && v.fecha_fin).forEach(v => {
    const ini = v.fecha_inicio > desde ? v.fecha_inicio : desde, fin = v.fecha_fin < hasta ? v.fecha_fin : hasta;
    diasDelRango(ini, fin).forEach(f => poner(f, { clave: v.clave, nombre: v.nombre, tipo: 'vacaciones', medio: false, nota: v.nota || null }));
  });
  movimientos.filter(m => !m.anulado_en && m.tipo === 'descanso' && Number(m.cantidad) < 0 && m.fecha).forEach(m => {
    const total = Math.min(Math.abs(Number(m.cantidad)), MAX_DIAS);
    const enteros = Math.floor(total), medio = total - enteros >= 0.5;
    const n = enteros + (medio ? 1 : 0);
    for (let i = 0; i < n; i++) {
      poner(sumarDias(m.fecha, i), { clave: m.clave, nombre: m.nombre, tipo: 'descanso', medio: medio && i === n - 1, nota: m.nota || null });
    }
  });
  registros.filter(r => r.estado !== 'rechazado' && /^descanso/i.test(r.tipo || '') && r.fecha).forEach(r => {
    poner(r.fecha, { clave: claveDeRegistro(r), nombre: r.nombre_trabajador || r.nombre_libre || '', tipo: 'descanso', medio: false, nota: r.notas || null });
  });
  Object.values(porDia).forEach(l => l.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es')));
  return porDia;
}

// ── Nombres de Rutas ↔ nombres de la Bolsa ──
// Rutas usa «Jesus Aguilera» y la nómina «AGUILERA MARTIN, JESUS». Una persona de
// la Bolsa corresponde a un chofer si cada palabra del chofer es el comienzo de una
// palabra suya («Leo» → «LEONARDO», «Rafa» → «RAFAEL») y no hay otra que también
// encaje. `fijos` = { 'Nombre en Rutas': clave } para corregir a mano los dudosos.
const palabras = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9ñ]+/).filter(Boolean);

function emparejarChoferes(choferes, personas, fijos = {}) {
  const lista = personas.map(p => ({ clave: p.clave, palabras: palabras(p.nombre) }));
  const out = {};
  (choferes || []).forEach(chofer => {
    if (fijos[chofer]) { out[chofer] = fijos[chofer]; return; }
    const pc = palabras(chofer);
    if (!pc.length) return;
    const encajan = lista.filter(p => pc.every(w => p.palabras.some(x => x.startsWith(w))));
    const claves = [...new Set(encajan.map(p => p.clave))];
    if (claves.length === 1) out[chofer] = claves[0];
  });
  return out;
}

// Para Rutas: { fecha: [{ chofer, tipo, medio }] } con los nombres de la lista de choferes
function ausenciasDeChoferes(porDia, choferes, fijos) {
  const personas = [];
  const vistas = new Set();
  Object.values(porDia).forEach(l => l.forEach(a => { if (!vistas.has(a.clave)) { vistas.add(a.clave); personas.push({ clave: a.clave, nombre: a.nombre }); } }));
  const mapa = emparejarChoferes(choferes, personas, fijos);
  const choferDe = {};
  Object.entries(mapa).forEach(([chofer, clave]) => { choferDe[clave] = chofer; });
  const out = {};
  Object.entries(porDia).forEach(([fecha, lista]) => {
    const l = lista.filter(a => choferDe[a.clave]).map(a => ({ chofer: choferDe[a.clave], tipo: a.tipo, medio: a.medio }));
    if (l.length) out[fecha] = l;
  });
  return out;
}

// ── Turnos ──
// Cada trabajador tiene un horario semanal (turnos_semana, dia 1 = lunes … 7 =
// domingo) y cambios para un día concreto (turnos_dia), que mandan sobre el semanal.
// Devuelve { entrada, salida, libre, cambio } o null si no tiene nada ese día.
function diaSemana(iso) {
  const d = new Date(iso + 'T00:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
}
const hora = h => h ? String(h).slice(0, 5) : null;
function turnoDelDia(clave, fecha, semana = [], dias = []) {
  const cambio = dias.find(d => d.clave === clave && d.fecha === fecha && !d.anulado_en);
  if (cambio) return { entrada: hora(cambio.entrada), salida: hora(cambio.salida), entrada2: hora(cambio.entrada2), salida2: hora(cambio.salida2), libre: !!cambio.libre, cambio: true, nota: cambio.nota || null };
  const fijo = semana.find(s => s.clave === clave && Number(s.dia) === diaSemana(fecha));
  if (!fijo) return null;
  return { entrada: hora(fijo.entrada), salida: hora(fijo.salida), entrada2: hora(fijo.entrada2), salida2: hora(fijo.salida2), libre: !!fijo.libre, cambio: false, nota: null };
}

module.exports = { sumarDias, diasDelRango, ausenciasPorDia, emparejarChoferes, ausenciasDeChoferes, diaSemana, turnoDelDia, palabras };
