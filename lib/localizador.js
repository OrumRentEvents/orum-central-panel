// Módulo Vehículos — fase 3: Excel del localizador GPS ("Informe detallado"
// o "Detalle de trayectos") y reparto de cada trayecto en su vuelta y conductor de
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

// "64 min 53 sec" / "1 h 4 min 5 sec" (formato del "Detalle de trayectos") → segundos.
function duracion(v) {
  const s = texto(v);
  if (!s) return null;
  const h = s.match(/(\d+)\s*h/), m = s.match(/(\d+)\s*min/), sec = s.match(/(\d+)\s*sec/);
  if (!h && !m && !sec) return null;
  return Number(h ? h[1] : 0) * 3600 + Number(m ? m[1] : 0) * 60 + Number(sec ? sec[1] : 0);
}

// Segundo informe del localizador, "Detalle de trayectos": fecha y horas en
// columnas separadas, sin matrícula ni velocidades/consumo, y con filas de
// estacionamiento (0 km) que no son trayectos.
const COLUMNAS_DETALLE = {
  fecha: 'fecha', vehiculo: 'vehiculo_nombre', horainicio: 'hora_inicio', inicio: 'origen', locinicio: 'loc_origen',
  horadestino: 'hora_fin', destino: 'destino', locdestino: 'loc_destino', kilometros: 'km', enmarcha: 'seg_conduccion', parado: 'seg_paradas'
};
const CAMPOS_DETALLE = ['vehiculo_nombre', 'inicio', 'fin', 'fecha', 'origen', 'loc_origen', 'destino', 'loc_destino', 'km', 'seg_conduccion', 'seg_paradas'];
const CAMPOS_INFORME = ['vehiculo_nombre', 'inicio', 'fin', 'fecha', 'origen', 'loc_origen', 'destino', 'loc_destino', 'km', 'seg_conduccion', 'paradas', 'seg_paradas', 'seg_motor_parado', 'vel_media', 'vel_max', 'litros', 'coste_litros', 'consumo_100', 'consumo_optimo_100', 'litros_optimo'];

const indices = (cab, mapa) => {
  const indice = {};
  cab.forEach((c, i) => { if (mapa[c] && indice[mapa[c]] === undefined) indice[mapa[c]] = i; });
  return indice;
};
const resultado = (trayectos, formato, campos) => {
  const fechas = trayectos.map(t => t.fecha).sort();
  return { formato, campos, trayectos, desde: fechas[0] || null, hasta: fechas[fechas.length - 1] || null };
};
const vacia = f => !f || f.every(c => c === null || c === '');

function parsearDetalle(filas, cab) {
  const indice = indices(cab, COLUMNAS_DETALLE);
  const trayectos = [];
  filas.slice(1).forEach(f => {
    if (vacia(f)) return;
    const t = {};
    Object.entries(indice).forEach(([campo, i]) => { t[campo] = f[i]; });
    const dia = fechaHora(texto(t.fecha) + ' 00:00:00');
    const km = numero(t.km);
    if (!dia || !texto(t.vehiculo_nombre) || !km) return; // TOTAL, cabeceras repetidas y estacionamientos (0 km)
    const fecha = dia.slice(0, 10);
    const horaIni = (texto(t.hora_inicio) || '').padStart(8, '0'), horaFin = (texto(t.hora_fin) || '').padStart(8, '0');
    if (!/^\d{2}:\d{2}:\d{2}$/.test(horaIni)) return;
    let fin = /^\d{2}:\d{2}:\d{2}$/.test(horaFin) ? fecha + ' ' + horaFin : null;
    if (fin && horaFin < horaIni) { // pasa de medianoche
      const sig = new Date(Date.UTC(+fecha.slice(0, 4), +fecha.slice(5, 7) - 1, +fecha.slice(8, 10) + 1)).toISOString().slice(0, 10);
      fin = sig + ' ' + horaFin;
    }
    trayectos.push({
      vehiculo_nombre: texto(t.vehiculo_nombre), matricula: null, inicio: fecha + ' ' + horaIni, fin, fecha,
      origen: texto(t.origen), loc_origen: texto(t.loc_origen), destino: texto(t.destino), loc_destino: texto(t.loc_destino),
      km, seg_conduccion: duracion(t.seg_conduccion), seg_paradas: duracion(t.seg_paradas)
    });
  });
  return resultado(trayectos, 'detalle', CAMPOS_DETALLE);
}

// Lee cualquiera de los dos informes del localizador: "Informe detallado"
// (completo: matrícula, velocidades, consumo) o "Detalle de trayectos".
// campos = columnas que trae, para no pisar con null las que no trae al importar.
function parsearInforme(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const cab = (filas[0] || []).map(normalizar);
  const esDetalle = ['fecha', 'vehiculo', 'horainicio', 'horadestino', 'kilometros'].every(k => cab.includes(k)) && !cab.includes('matricula');
  if (esDetalle) return parsearDetalle(filas, cab);
  const faltan = Object.keys(OBLIGATORIAS).filter(k => !cab.includes(k)).map(k => OBLIGATORIAS[k]);
  if (faltan.length) throw new Error('El archivo no parece un informe del localizador ("Informe detallado" o "Detalle de trayectos"): faltan las columnas ' + faltan.join(', '));
  const indice = indices(cab, COLUMNAS);

  const trayectos = [];
  filas.slice(1).forEach(f => {
    if (vacia(f)) return;
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
  return resultado(trayectos, 'informe', CAMPOS_INFORME);
}

// El localizador a veces registra dos maniobras con el mismo segundo de inicio
// (clave única vehículo + inicio): se suman en un solo trayecto.
const SUMABLES = ['km', 'seg_conduccion', 'seg_paradas', 'paradas', 'litros', 'coste_litros', 'litros_optimo', 'seg_motor_parado'];
function fusionarTramos(a, b) {
  const f = { ...a };
  SUMABLES.forEach(c => {
    if (a[c] == null && b[c] == null) return;
    f[c] = Math.round(((Number(a[c]) || 0) + (Number(b[c]) || 0)) * 100) / 100;
  });
  if (b.vel_max != null) f.vel_max = Math.max(Number(a.vel_max) || 0, Number(b.vel_max));
  if (b.fin && (!a.fin || b.fin > a.fin)) f.fin = b.fin;
  return f;
}

// Los dos informes cortan los trayectos distinto (el "Detalle" parte en cada
// parada): mezclar los dos el mismo día contaría los km dos veces. Para cada
// vehículo y día manda el "Informe detallado". diasInformeBD = Set de
// 'vehiculoId|fecha' que ya tienen informe en la base.
// Devuelve qué guardar, cuántos tramos del detalle se descartan y en qué días
// entra informe (para borrar lo que hubiera del detalle).
function combinarFormatos(validos, diasInformeBD) {
  const dia = t => t.vehiculo_id + '|' + t.fecha;
  const diasInforme = [...new Set(validos.filter(t => t._formato === 'informe').map(dia))];
  const conInforme = new Set([...diasInforme, ...(diasInformeBD || [])]);
  const guardar = validos.filter(t => t._formato === 'informe' || !conInforme.has(dia(t)));
  return { guardar, descartados: validos.length - guardar.length, diasInforme };
}

// ── Vueltas y conductor ──

const KM_MANIOBRA = 0.8; // por debajo: movimiento en el patio, no es una salida
// Solo la nave de Monda cierra una vuelta: por la de Marbella (Calle Mercurio)
// se pasa a mitad de ruta (con ella el acierto en sept. 2026 empeoraba).
const terminaEnNave = t => /A-355/i.test(t.destino || '') && /^monda$/i.test((t.loc_destino || '').trim());

// Reparte los trayectos de un vehículo en un día (ordenados por inicio) entre
// sus nVueltas de Rutas. Cada salida desde nave con km >= KM_MANIOBRA abre un
// bloque; el bloque se cierra al volver a Monda. Si hay cortes manuales
// (['HH:MM'], uno menos que vueltas) mandan ellos.
function asignarVueltas(trayectos, nVueltas, cortes) {
  let salidas = 0, fuera = false;
  const bloques = trayectos.map(t => {
    if ((t.km || 0) >= KM_MANIOBRA && !fuera) { salidas++; fuera = true; }
    const bloque = Math.max(salidas, 1);
    if (fuera && terminaEnNave(t)) fuera = false;
    return bloque;
  });
  if (cortes && cortes.length) {
    const ordenados = [...cortes].sort();
    return { vueltas: trayectos.map(t => 1 + ordenados.filter(c => c <= t.inicio.slice(11, 16)).length), revisar: false, salidas };
  }
  if (nVueltas <= 1 || salidas === 0) return { vueltas: trayectos.map(() => 1), revisar: false, salidas };
  if (salidas === nVueltas) return { vueltas: bloques, revisar: false, salidas };
  return { vueltas: trayectos.map(() => null), revisar: true, salidas };
}

// Quién conduce una vuelta de Rutas: el marcado como "Conduce" (si sigue en la
// lista); si solo va uno, ese; si van varios sin marcar, null = sin determinar.
// (Rutas guarda la lista en orden alfabético: "el primero" no sirve.)
function conductorDeVuelta(fila) {
  if (!fila) return null;
  const lista = fila.conductores || [];
  if (fila.conductor && lista.includes(fila.conductor)) return fila.conductor;
  return lista.length === 1 ? lista[0] : null;
}

// Uso de un periodo: por vehículo (con detalle diario), por conductor (null =
// sin determinar), días a revisar y días con movimiento sin nadie en Rutas.
// cortesPorClave: { 'vehiculoId_fecha': ['HH:MM', ...] }.
function calcularUso(trayectos, filasRutas, cortesPorClave, vehiculos) {
  const rutasPor = {};
  (filasRutas || []).forEach(f => { (rutasPor[f.vehiculo + '|' + f.fecha] = rutasPor[f.vehiculo + '|' + f.fecha] || []).push(f); });
  const grupos = {};
  trayectos.forEach(t => { (grupos[t.vehiculo_id + '|' + t.fecha] = grupos[t.vehiculo_id + '|' + t.fecha] || []).push(t); });
  const vehPorId = {};
  (vehiculos || []).forEach(v => { vehPorId[v.id] = v; });

  const porVehiculo = {}, porConductor = new Map(), revisar = [], sinConductor = [];
  const trayectosConductor = []; // para el ranking: solo vueltas con conductor determinado
  const redondo = n => Math.round(n * 100) / 100;
  const sumar = (l, campo) => l.reduce((s, t) => s + (Number(t[campo]) || 0), 0);
  // seg_paradas = paradas dentro del trayecto, es decir, parado con el motor en marcha
  // (el trayecto termina al apagar). "Tiempo Motor enc." del informe viene vacío.
  const acumConductor = (conductor, fecha, km, seg, parado) => {
    if (!porConductor.has(conductor)) porConductor.set(conductor, { conductor, km: 0, seg_conduccion: 0, seg_paradas: 0, dias: new Set(), vueltas: 0 });
    const c = porConductor.get(conductor);
    c.km += km; c.seg_conduccion += seg; c.seg_paradas += parado; c.dias.add(fecha); c.vueltas++;
  };

  Object.keys(grupos).sort().forEach(clave => {
    const lista = grupos[clave].sort((a, b) => (a.inicio < b.inicio ? -1 : 1));
    const { vehiculo_id, fecha } = lista[0];
    const v = vehPorId[vehiculo_id] || {};
    const pv = porVehiculo[vehiculo_id] = porVehiculo[vehiculo_id] || { vehiculo_id, matricula: v.matricula || null, km: 0, seg_conduccion: 0, seg_paradas: 0, trayectos: 0, dias: 0, vel_max: 0, detalle: [] };
    const kmDia = sumar(lista, 'km');
    pv.km += kmDia; pv.seg_conduccion += sumar(lista, 'seg_conduccion'); pv.seg_paradas += sumar(lista, 'seg_paradas'); pv.trayectos += lista.length; pv.dias++;
    pv.vel_max = Math.max(pv.vel_max, ...lista.map(t => Number(t.vel_max) || 0));
    const dia = { fecha, km: redondo(kmDia), trayectos: lista.length, seg_paradas: sumar(lista, 'seg_paradas'), vueltas: [], revisar: false, sin_rutas: false };
    pv.detalle.push(dia);

    // Filas de Rutas de ese día; una vuelta sin nadie apuntado cuenta como no apuntada.
    const filas = (rutasPor[(v.nombre_rutas || '') + '|' + fecha] || []).filter(f => (f.conductores || []).length);
    if (!filas.length) {
      dia.sin_rutas = true;
      sinConductor.push({ vehiculo_id, fecha, km: redondo(kmDia), trayectos: lista.length });
      return;
    }
    // El nº de vueltas es la mayor apuntada (puede faltar alguna intermedia): el
    // bloque k va a la vuelta k, nunca a la de otro conductor.
    const nVueltas = Math.max(...filas.map(f => Number(f.vuelta) || 1));
    const cortesGuardados = cortesPorClave[vehiculo_id + '_' + fecha] || null;
    // Cortes que ya no cuadran (se cambiaron las vueltas en Rutas): se ignoran.
    const cortesInvalidos = !!(cortesGuardados && cortesGuardados.length && cortesGuardados.length !== nVueltas - 1);
    const r = asignarVueltas(lista, nVueltas, cortesInvalidos ? null : cortesGuardados);
    if (r.revisar) {
      dia.revisar = true;
      revisar.push({ vehiculo_id, fecha, vueltas: nVueltas, salidas: r.salidas, km: redondo(kmDia), cortes_invalidos: cortesInvalidos, cortes: cortesGuardados || [], trayectos: lista.map(t => ({ inicio: t.inicio.slice(11, 16), km: t.km, destino: t.destino, loc_destino: t.loc_destino })) });
      return;
    }
    for (let k = 1; k <= nVueltas; k++) {
      const deLaVuelta = lista.filter((t, j) => r.vueltas[j] === k);
      const km = sumar(deLaVuelta, 'km'), seg = sumar(deLaVuelta, 'seg_conduccion');
      const fila = filas.find(f => (Number(f.vuelta) || 1) === k);
      if (!fila) {
        if (!deLaVuelta.length) continue;
        dia.vueltas.push({ vuelta: k, conductor: null, conductores: [], km: redondo(km), trayectos: deLaVuelta.length, sin_rutas: true });
        sinConductor.push({ vehiculo_id, fecha, vuelta: k, km: redondo(km), trayectos: deLaVuelta.length });
        continue;
      }
      const conductor = conductorDeVuelta(fila);
      dia.vueltas.push({ vuelta: k, conductor, conductores: fila.conductores || [], km: redondo(km), trayectos: deLaVuelta.length });
      if (deLaVuelta.length) acumConductor(conductor, fecha, km, seg, sumar(deLaVuelta, 'seg_paradas'));
      if (conductor) deLaVuelta.forEach(t => trayectosConductor.push({ ...t, conductor }));
    }
  });

  return {
    porVehiculo: Object.values(porVehiculo).map(p => ({ ...p, km: redondo(p.km), detalle: p.detalle.sort((a, b) => (a.fecha < b.fecha ? -1 : 1)) })),
    porConductor: [...porConductor.values()].map(c => ({ ...c, km: redondo(c.km), dias: c.dias.size })).sort((a, b) => b.km - a.km),
    revisar, sinConductor, trayectosConductor
  };
}

module.exports = { parsearInforme, segundos, duracion, combinarFormatos, fusionarTramos, asignarVueltas, conductorDeVuelta, calcularUso, terminaEnNave };
