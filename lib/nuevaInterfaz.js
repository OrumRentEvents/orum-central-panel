// Nueva interfaz (beta, nov 2026) — página /nueva y su API /api/nueva/*.
// Solo la ve Sergio mientras se construye; el panel de siempre (/) no cambia.
// Diseño: cristal claro sobre foto, menú lateral plegable, Inicio configurable.
// calcularInicio() es lógica pura (test/nuevaInterfaz.test.js).

const path = require('path');

const TZ = 'Europe/Madrid';
const ESTADOS = {
  confirmado: ['Confirmed'],
  pendiente: ['Pending', 'Concept', 'Inquiry'],
  en_marcha: ['En curso', 'Cargado', 'Controlado', 'Marbella', 'On location'],
  cerrado: ['Ejecución realizada', 'Redondeado', 'Returned']
};
const IVA = 1.21;

const esSergio = u => String((u && u.usuario) || '').toLowerCase() === 'sergio';
// Probadores de la interfaz glass (20 nov 2026); la misma lista está en public/glass.js.
const USUARIOS_BETA = ['sergio', 'maria', 'leo', 'jesus', 'rafa'];
// Las fechas de Rentman (entrega_ts, evento_inicio_ts, fecha_emision_ts…) guardan la hora
// LOCAL tal cual, marcada como UTC ("16/11/2026 09:00" → 2026-11-16T09:00:00Z): se leen
// sin convertir de zona, o saldrían con una hora de más.
const dia = ts => (ts ? new Date(ts).toISOString().slice(0, 10) : null);
const redondo = n => Math.round(n * 100) / 100;
const grupoEstado = e => Object.keys(ESTADOS).find(g => ESTADOS[g].includes(e)) || null;

// mesesAtras(hoy, n) → 'YYYY-MM' de hace n meses.
function mesesAtras(hoy, n) {
  const [y, m] = hoy.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return d.toISOString().slice(0, 7);
}

const NOMBRE_MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// datos: { proyectos, facturas, facturasAnioPasado, pendientes, incidenciasAbiertas, recientes, sync }
// hoy: 'YYYY-MM-DD' (Madrid)
function calcularInicio(datos, hoy) {
  const proyectos = (datos.proyectos || []).filter(p => p.estado !== 'Canceled');
  const mesActual = hoy.slice(0, 7);

  const entregasHoy = proyectos.filter(p => dia(p.entrega_ts) === hoy);
  const recogidasHoy = proyectos.filter(p => dia(p.recogida_ts) === hoy);
  const montajesHoy = proyectos.filter(p => dia(p.evento_inicio_ts) === hoy);
  const activos = proyectos.filter(p => {
    const g = grupoEstado(p.estado);
    if (g === 'en_marcha') return true;
    if (g !== 'confirmado') return false;
    const fin = [dia(p.evento_fin_ts), dia(p.recogida_ts), dia(p.evento_inicio_ts)].filter(Boolean).sort().pop();
    return !!fin && fin >= hoy;
  });

  const delMes = proyectos.filter(p => (dia(p.evento_inicio_ts) || '').startsWith(mesActual));
  const estados = Object.keys(ESTADOS).map(g => ({ grupo: g, n: delMes.filter(p => grupoEstado(p.estado) === g).length }));

  const importe = f => (f.importe_sin_iva != null ? Number(f.importe_sin_iva) || 0 : (Number(f.importe_con_iva) || 0) / IVA);
  const porMes = {};
  for (let i = 5; i >= 0; i--) porMes[mesesAtras(hoy, i)] = 0;
  (datos.facturas || []).forEach(f => {
    const mes = (dia(f.fecha_emision_ts) || '').slice(0, 7);
    if (mes in porMes) porMes[mes] += importe(f);
  });
  const facturacionMeses = Object.keys(porMes).map(mes => ({ mes, etiqueta: NOMBRE_MES[Number(mes.slice(5, 7)) - 1] + ' ' + mes.slice(0, 4), total: redondo(porMes[mes]) }));
  const facturacionMes = porMes[mesActual] || 0;
  const anioPasado = (datos.facturasAnioPasado || []).reduce((s, f) => s + importe(f), 0);
  const variacion = anioPasado > 0 ? Math.round((facturacionMes - anioPasado) / anioPasado * 100) : null;

  const cobrosPendientes = (datos.pendientes || []).reduce((s, f) => s + (Number(f.pendiente_cobro) || 0), 0);
  const vencidas = (datos.pendientes || []).filter(f => (Number(f.pendiente_cobro) || 0) > 0.05 && f.fecha_vencimiento_ts && dia(f.fecha_vencimiento_ts) < hoy);

  // Agenda de hoy: entregas, montajes y recogidas con su hora
  const hora = ts => { const h = new Date(ts).toISOString().slice(11, 16); return h === '00:00' ? null : h; }; // 00:00 = sin hora
  const agenda = [];
  const apuntar = (lista, tipo, campo) => lista.forEach(p => agenda.push({ tipo, ts: p[campo], hora: hora(p[campo]), numero: p.numero, nombre: p.nombre, cliente: p.cliente, localizacion: p.localizacion }));
  apuntar(entregasHoy, 'Entrega', 'entrega_ts');
  apuntar(montajesHoy, 'Evento', 'evento_inicio_ts'); // inicio del evento en Rentman (no hay tipo «montaje»)
  apuntar(recogidasHoy, 'Recogida', 'recogida_ts');
  agenda.sort((a, b) => (a.ts < b.ts ? -1 : 1));

  const proximas = proyectos
    .filter(p => p.entrega_ts && dia(p.entrega_ts) >= hoy)
    .sort((a, b) => (a.entrega_ts < b.entrega_ts ? -1 : 1))
    .slice(0, 5)
    .map(p => ({ numero: p.numero, nombre: p.nombre, cliente: p.cliente, localizacion: p.localizacion, estado: p.estado, entrega_ts: p.entrega_ts }));

  const sync = datos.sync || [];
  const ultimaPorTabla = {};
  sync.forEach(r => { if (!ultimaPorTabla[r.tabla]) ultimaPorTabla[r.tabla] = r; });
  const ultima = sync[0] || null;

  return {
    hoy,
    kpis: {
      proyectos_activos: activos.length,
      entregas_hoy: entregasHoy.length,
      recogidas_hoy: recogidasHoy.length,
      facturacion_mes: redondo(facturacionMes),
      facturacion_variacion: variacion,
      cobros_pendientes: redondo(cobrosPendientes),
      cobros_pendientes_facturas: (datos.pendientes || []).filter(f => (Number(f.pendiente_cobro) || 0) > 0.05).length,
      incidencias_abiertas: datos.incidenciasAbiertas || 0,
      facturas_vencidas: vencidas.length,
      importe_vencido: redondo(vencidas.reduce((s, f) => s + (Number(f.pendiente_cobro) || 0), 0))
    },
    agenda_hoy: agenda.map(({ ts, ...resto }) => resto),
    hoy_resumen: { montajes: montajesHoy.length, entregas: entregasHoy.length, recogidas: recogidasHoy.length, incidencias: datos.incidenciasAbiertas || 0 },
    estados_mes: estados,
    facturacion_meses: facturacionMeses,
    proximas_salidas: proximas,
    actividad: (datos.recientes || []).map(p => ({ numero: p.numero, nombre: p.nombre, estado: p.estado, cliente: p.cliente, updated_ts: p.updated_ts })),
    sincronizacion: {
      ultima: ultima ? ultima.terminado_en : null,
      fallo: Object.values(ultimaPorTabla).some(r => r.exito === false)
    }
  };
}

function registrar(app, { supabase, requiereLogin }) {
  async function q(consulta) {
    const { data, error } = await consulta;
    if (error) throw error;
    return data;
  }
  async function todas(tabla, columnas, filtro) {
    const filas = [];
    for (let desde = 0; ; desde += 1000) {
      const lote = await q(filtro(supabase.from(tabla).select(columnas)).range(desde, desde + 999));
      filas.push(...lote);
      if (lote.length < 1000) return filas;
    }
  }

  app.get('/nueva', (req, res) => {
    if (!req.session.usuario || !esSergio(req.session.usuario)) return res.redirect('/');
    res.sendFile(path.join(__dirname, '..', 'public', 'nueva.html'));
  });

  // Inicio de la interfaz glass (beta): Sergio y los probadores con Resumen general
  // (Logística y Comercial no lo tienen: trae facturación y cobros).
  app.get('/api/nueva/inicio', requiereLogin, async (req, res) => {
    const u = req.session.usuario;
    const probador = USUARIOS_BETA.includes(String(u.usuario || '').toLowerCase()) && !['Logistica', 'Comercial'].includes(u.rol);
    if (!esSergio(u) && !probador) return res.status(403).json({ error: 'No autorizado' });
    try {
      const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
      const desde = new Date(Date.parse(hoy) - 45 * 864e5).toISOString().slice(0, 10);
      const hasta = new Date(Date.parse(hoy) + 60 * 864e5).toISOString().slice(0, 10);
      const rango = c => `and(${c}.gte.${desde},${c}.lte.${hasta})`;
      const inicioFact = mesesAtras(hoy, 5) + '-01';
      const [y, m, d] = hoy.split('-').map(Number);
      const mesAnioPasado = `${y - 1}-${String(m).padStart(2, '0')}`;
      const finAnioPasado = new Date(Date.UTC(y - 1, m - 1, d + 1)).toISOString().slice(0, 10);

      const [proyectos, facturas, facturasAnioPasado, pendientes, incidencias, recientes, sync] = await Promise.all([
        todas('proyectos', 'numero,nombre,cliente,estado,localizacion,entrega_ts,recogida_ts,evento_inicio_ts,evento_fin_ts',
          c => c.or([rango('evento_inicio_ts'), rango('entrega_ts'), rango('recogida_ts')].join(','))),
        todas('facturas', 'importe_sin_iva,importe_con_iva,fecha_emision_ts', c => c.gte('fecha_emision_ts', inicioFact)),
        todas('facturas', 'importe_sin_iva,importe_con_iva', c => c.gte('fecha_emision_ts', mesAnioPasado + '-01').lt('fecha_emision_ts', finAnioPasado)),
        todas('facturas', 'pendiente_cobro,fecha_vencimiento_ts', c => c.eq('esta_pagada', false)),
        q(supabase.from('incidencias').select('id', { count: 'exact', head: false }).in('estado', ['abierta', 'en_curso'])),
        q(supabase.from('proyectos').select('numero,nombre,cliente,estado,updated_ts').not('updated_ts', 'is', null).order('updated_ts', { ascending: false }).limit(6)),
        q(supabase.from('sync_log').select('tabla,exito,terminado_en').order('terminado_en', { ascending: false }).limit(80))
      ]);

      res.json({ ok: true, usuario: req.session.usuario, ...calcularInicio({
        proyectos, facturas, facturasAnioPasado, pendientes, incidenciasAbiertas: incidencias.length, recientes, sync
      }, hoy) });
    } catch (err) {
      console.error('Error en /api/nueva/inicio:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registrar, calcularInicio, esSergio, ESTADOS };
