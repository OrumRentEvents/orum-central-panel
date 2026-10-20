// Módulo Vehículos — fase 3: Excel del localizador GPS ("Informe detallado",
// hoja de trayectos) y reparto de cada trayecto en su vuelta y conductor de
// Rutas. Lógica pura, testeada en test/localizador.test.js.
// Ver docs/superpowers/specs/2026-10-20-modulo-vehiculos-design.md §6.2–6.3
const XLSX = require('xlsx');

// Cabecera normalizada (minúsculas, sin tildes ni signos) → campo. Se busca
// por nombre, no por posición: si el proveedor reordena o añade columnas,
// sigue funcionando.
const COLUMNAS = {
  vehiculo: 'vehiculo_nombre', matricula: 'matricula', inicio: 'origen', locinicio: 'loc_origen',
  destino: 'destino', locdest: 'loc_destino', kilometros: 'km', tiempo: 'seg_conduccion',
  horainicio: 'inicio', horadest: 'fin', paradas: 'paradas', tiempoparada: 'seg_paradas',
  tiempomotorenc: 'seg_motor_parado', velmedia: 'vel_media', velmax: 'vel_max', consumo: 'litros',
  costeconsumo: 'coste_litros', consumo100km: 'consumo_100', consuoptimo100km: 'consumo_optimo_100',
  consuoptimo: 'litros_optimo'
};
const OBLIGATORIAS = { vehiculo: 'Vehículo', matricula: 'Matrícula', kilometros: 'Kilometros', horainicio: 'Hora Inicio', horadest: 'Hora Dest.', destino: 'Destino', locdest: 'Loc. Dest.' };
const TIEMPOS = ['seg_conduccion', 'seg_paradas', 'seg_motor_parado'];
const NUMEROS = ['km', 'paradas', 'vel_media', 'vel_max', 'litros', 'coste_litros', 'consumo_100', 'consumo_optimo_100', 'litros_optimo'];

const normalizar = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const texto = v => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());
const numero = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));
const dos = n => String(n).padStart(2, '0');

// "0, 00:42:25" (días, hh:mm:ss) o "00:08:55" → segundos.
function segundos(v) {
  const s = texto(v);
  if (!s) return null;
  const m = s.match(/^(?:(\d+),\s*)?(\d+):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return (Number(m[1] || 0) * 24 + Number(m[2])) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

// "30-09-2026 19:34:29" (hora local) → "2026-09-30 19:34:29". También admite
// una fecha numérica de Excel por si el proveedor cambia el formato.
function fechaHora(v) {
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${dos(d.m)}-${dos(d.d)} ${dos(d.H)}:${dos(d.M)}:${dos(Math.floor(d.S))}` : null;
  }
  const m = (texto(v) || '').match(/^(\d{2})[-/](\d{2})[-/](\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${dos(m[4])}:${m[5]}:${m[6] || '00'}` : null;
}

function parsearInforme(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const cab = (filas[0] || []).map(normalizar);
  const faltan = Object.keys(OBLIGATORIAS).filter(k => !cab.includes(k)).map(k => OBLIGATORIAS[k]);
  if (faltan.length) throw new Error('El archivo no parece el "Informe detallado" del localizador: faltan las columnas ' + faltan.join(', '));
  const indice = {};
  cab.forEach((c, i) => { if (COLUMNAS[c] && indice[COLUMNAS[c]] === undefined) indice[COLUMNAS[c]] = i; });

  const trayectos = [];
  filas.slice(1).forEach(f => {
    if (!f || f.every(c => c === null || c === '')) return;
    const t = {};
    Object.entries(indice).forEach(([campo, i]) => { t[campo] = f[i]; });
    ['vehiculo_nombre', 'matricula', 'origen', 'loc_origen', 'destino', 'loc_destino'].forEach(c => { t[c] = texto(t[c]); });
    TIEMPOS.forEach(c => { t[c] = c in t ? segundos(t[c]) : null; });
    NUMEROS.forEach(c => { t[c] = c in t ? numero(t[c]) : null; });
    t.inicio = fechaHora(t.inicio);
    t.fin = fechaHora(t.fin);
    if (!t.inicio || !t.vehiculo_nombre) return;
    t.fecha = t.inicio.slice(0, 10);
    trayectos.push(t);
  });
  const fechas = trayectos.map(t => t.fecha).sort();
  return { trayectos, desde: fechas[0] || null, hasta: fechas[fechas.length - 1] || null };
}

module.exports = { parsearInforme, segundos };
