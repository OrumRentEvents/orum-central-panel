// Módulo Vehículos — lógica pura (sin Supabase ni Express), testeada en
// test/vehiculos.test.js. Ver docs/superpowers/specs/2026-10-20-modulo-vehiculos-design.md
// Fechas siempre como texto 'YYYY-MM-DD' y aritmética en UTC, para que un
// vencimiento no salte de día por la zona horaria del servidor.

const TIPOS_VEHICULO = ['furgoneta', 'camion', 'turismo', 'otro'];
const PROPIEDADES = ['propio', 'renting', 'leasing', 'alquilado'];
const TIPOS_VENCIMIENTO = ['itv', 'seguro', 'ivtm', 'revision', 'tacografo', 'fin_renting', 'otro'];
const TIPOS_MANTENIMIENTO = ['mantenimiento', 'revision', 'itv', 'reparacion', 'neumaticos', 'averia', 'limpieza', 'otro'];
const TIPOS_DOCUMENTO = ['permiso_circulacion', 'ficha_tecnica', 'poliza', 'itv', 'contrato_renting', 'otro'];
const MIME_DOCUMENTO = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_DOCUMENTO = 10 * 1024 * 1024;
// Entradas de la lista de Rutas que no son vehículos: quedan fuera del módulo.
const RUTAS_NO_VEHICULO = ['NAVE MONDA', 'ALQUILADO 1', 'ALQUILADO 2'];

const ORDEN_ESTADO = { ok: 0, aviso: 1, vencido: 2 };
const DIA_MS = 24 * 60 * 60 * 1000;

const esFecha = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const aUTC = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const aTexto = ms => new Date(ms).toISOString().slice(0, 10);
const num = x => (x === null || x === undefined || x === '' || isNaN(Number(x)) ? null : Number(x));

function normalizarMatricula(s) {
  if (s === null || s === undefined) return null;
  const limpia = String(s).toUpperCase().replace(/[\s-]+/g, '');
  return limpia || null;
}

// Cuentakilómetros conocido: la mayor lectura entre la base y los
// mantenimientos (una lectura antigua o mal tecleada nunca lo hace bajar).
// En fase 3 se le sumarán los km del localizador.
function kmActuales(vehiculo, mantenimientos) {
  const lecturas = [num(vehiculo && vehiculo.km_base), ...(mantenimientos || []).map(m => num(m.km))].filter(k => k !== null);
  return lecturas.length ? Math.max(...lecturas) : null;
}

function estadoVencimiento(venc, km, hoy) {
  const avisoDias = num(venc.aviso_dias) ?? 30;
  const avisoKm = num(venc.aviso_km) ?? 1000;
  const estados = [];
  let dias_restantes = null, km_restantes = null;
  if (esFecha(venc.fecha_limite)) {
    dias_restantes = Math.round((aUTC(venc.fecha_limite) - aUTC(hoy)) / DIA_MS);
    estados.push(dias_restantes < 0 ? 'vencido' : dias_restantes <= avisoDias ? 'aviso' : 'ok');
  }
  const kmLimite = num(venc.km_limite);
  if (kmLimite !== null && num(km) !== null) {
    km_restantes = kmLimite - num(km);
    estados.push(km_restantes <= 0 ? 'vencido' : km_restantes <= avisoKm ? 'aviso' : 'ok');
  }
  return { estado: peorEstado(estados), dias_restantes, km_restantes };
}

function peorEstado(estados) {
  return (estados || []).reduce((peor, e) => (ORDEN_ESTADO[e] > ORDEN_ESTADO[peor] ? e : peor), 'ok');
}

function sumarMeses(fecha, meses) {
  const y = +fecha.slice(0, 4), m = +fecha.slice(5, 7) - 1, d = +fecha.slice(8, 10);
  const ultimoDia = new Date(Date.UTC(y, m + meses + 1, 0)).getUTCDate();
  return aTexto(Date.UTC(y, m + meses, Math.min(d, ultimoDia)));
}

// Nuevo límite de un vencimiento tras registrar el mantenimiento que lo
// cumple (pasar la ITV, renovar el seguro, hacer la revisión). Lo que no
// tiene periodicidad, o no tiene dato en el mantenimiento, se deja igual.
function renovarVencimiento(venc, mant) {
  let fecha_limite = venc.fecha_limite ?? null, km_limite = num(venc.km_limite);
  const meses = num(venc.periodicidad_meses), cadaKm = num(venc.periodicidad_km);
  if (meses && esFecha(mant.fecha)) fecha_limite = sumarMeses(mant.fecha, meses);
  if (cadaKm && num(mant.km) !== null) km_limite = num(mant.km) + cadaKm;
  return { fecha_limite, km_limite };
}

// Renovación que produce un mantenimiento sobre su vencimiento, guardada en
// el mantenimiento (columna renovacion) para poder deshacerla. null si el
// límite no cambia (sin periodicidad o sin dato).
function calcularRenovacion(venc, mant) {
  if (!venc) return null;
  const antes = { fecha_limite: venc.fecha_limite ?? null, km_limite: num(venc.km_limite) };
  const despues = renovarVencimiento(venc, mant);
  return despues.fecha_limite !== antes.fecha_limite || despues.km_limite !== antes.km_limite ? { antes, despues } : null;
}

// ¿La edición de un vencimiento cambia de verdad su fecha o sus km límite?
// (el formulario siempre los manda; solo un cambio real reinicia el aviso).
function limiteCambiado(actual, cambios) {
  if ('fecha_limite' in cambios && (cambios.fecha_limite ?? null) !== (actual.fecha_limite ?? null)) return true;
  if ('km_limite' in cambios && num(cambios.km_limite) !== num(actual.km_limite)) return true;
  return false;
}

// Al borrar un mantenimiento que renovó un vencimiento, el vencimiento vuelve
// a su límite anterior ({antes, despues} guardado en el mantenimiento). Si
// alguien lo cambió después de la renovación, no se toca (devuelve null).
function deshacerRenovacion(vencActual, registro) {
  if (!registro || !registro.antes || !registro.despues || !vencActual) return null;
  const igual = (a, b) => (a ?? null) === (b ?? null);
  const sinCambios = igual(vencActual.fecha_limite, registro.despues.fecha_limite) && igual(num(vencActual.km_limite), num(registro.despues.km_limite));
  return sinCambios ? { fecha_limite: registro.antes.fecha_limite ?? null, km_limite: num(registro.antes.km_limite) } : null;
}

function validarVehiculo(d) {
  if (d.tipo !== undefined && !TIPOS_VEHICULO.includes(d.tipo)) return 'Tipo de vehículo no válido: ' + d.tipo;
  if (d.propiedad !== undefined && !PROPIEDADES.includes(d.propiedad)) return 'Propiedad no válida: ' + d.propiedad;
  if (d.km_base !== undefined && d.km_base !== null && d.km_base !== '' && num(d.km_base) === null) return 'Los km deben ser un número';
  return null;
}

function validarVencimiento(d) {
  if (!TIPOS_VENCIMIENTO.includes(d.tipo)) return 'Tipo de vencimiento no válido: ' + d.tipo;
  if (!esFecha(d.fecha_limite) && num(d.km_limite) === null) return 'Indica una fecha límite o unos km límite';
  if (d.cita_pedida === true && !esFecha(d.cita_fecha)) return 'Indica la fecha de la cita';
  return null;
}

// Cita pedida en taller/ITV para un vencimiento: 'pendiente' hasta el día de
// la cita (incluido), 'pasada' después si el vencimiento sigue sin renovarse.
function estadoCita(venc, hoy) {
  if (!venc.cita_pedida || !esFecha(venc.cita_fecha)) return null;
  return venc.cita_fecha < hoy ? 'pasada' : 'pendiente';
}

function validarMantenimiento(d) {
  if (!esFecha(d.fecha)) return 'La fecha del mantenimiento es obligatoria';
  if (!TIPOS_MANTENIMIENTO.includes(d.tipo)) return 'Tipo de mantenimiento no válido: ' + d.tipo;
  for (const c of ['km', 'importe']) {
    if (d[c] !== undefined && d[c] !== null && d[c] !== '' && num(d[c]) === null) return (c === 'km' ? 'Los km' : 'El importe') + ' debe ser un número';
  }
  return null;
}

function validarDocumento({ mimetype, size }) {
  if (!MIME_DOCUMENTO.includes(mimetype)) return 'Solo se admiten PDF, JPG o PNG';
  if (size > MAX_DOCUMENTO) return 'El archivo supera los 10 MB';
  return null;
}

function nombresRutasSinAsignar(nombresRutas, vehiculos) {
  // También los dados de baja: su nombre de Rutas ya es conocido (p. ej. FURGO NDL, de otra empresa del grupo).
  const asignados = new Set((vehiculos || []).filter(v => v.nombre_rutas).map(v => v.nombre_rutas));
  return (nombresRutas || []).filter(n => n && !RUTAS_NO_VEHICULO.includes(n) && !asignados.has(n));
}

module.exports = {
  normalizarMatricula, kmActuales, estadoVencimiento, peorEstado, renovarVencimiento, deshacerRenovacion, calcularRenovacion, limiteCambiado, estadoCita,
  validarVehiculo, validarVencimiento, validarMantenimiento, validarDocumento, nombresRutasSinAsignar,
  TIPOS_VEHICULO, PROPIEDADES, TIPOS_VENCIMIENTO, TIPOS_MANTENIMIENTO, TIPOS_DOCUMENTO, MIME_DOCUMENTO,
  MAX_DOCUMENTO, RUTAS_NO_VEHICULO
};
