// Módulo Vehículos — fase 5: ranking de conductores. Lógica pura, testeada en
// test/ranking.test.js. Los trayectos llegan ya atribuidos a su conductor
// (lib/localizador.js calcularUso → trayectosConductor: solo conductores
// determinados en Rutas). Ver docs/superpowers/specs/2026-10-20-modulo-vehiculos-design.md §6.5
//
// El localizador solo da la velocidad MÁXIMA de cada trayecto: un exceso es
// "un trayecto en el que se superó el umbral", no tiempo por encima.

// Valores aprobados por el usuario el 2026-10-20; editables desde el panel
// (tabla vehiculos_config, clave 'ranking').
const CONFIG_DEFECTO = {
  umbrales: {
    furgoneta: { leve: 110, grave: 120 },
    camion: { leve: 90, grave: 100 },
    turismo: { leve: 130, grave: 140 }
  },
  pesos: { graves: 40, leves: 25, ralenti: 20, consumo: 15 },
  // A partir de estos valores se pierde todo el peso del concepto.
  // Calibrado con sept-oct 2026: la furgoneta con más excesos graves rondaba 0,6/100 km
  // y el ralentí normal (semáforos, tráfico) ~10 min por hora de conducción.
  topes: { graves_100km: 1, leves_100km: 2, ralenti_min_h: 20, consumo_exceso_pct: 50 },
  km_minimo: 300
};

const redondo = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// Une la config guardada con la de por defecto (lo que falte, por defecto).
function mezclarConfig(guardada) {
  const g = guardada || {};
  return {
    umbrales: { ...CONFIG_DEFECTO.umbrales, ...(g.umbrales || {}) },
    pesos: { ...CONFIG_DEFECTO.pesos, ...(g.pesos || {}) },
    topes: { ...CONFIG_DEFECTO.topes, ...(g.topes || {}) },
    km_minimo: g.km_minimo != null ? Number(g.km_minimo) : CONFIG_DEFECTO.km_minimo
  };
}

// 'grave' / 'leve' / null según el tipo de vehículo ("más de" el umbral).
function clasificarExceso(velMax, tipo, config) {
  const v = Number(velMax);
  if (!velMax || isNaN(v)) return null;
  const u = config.umbrales[tipo] || config.umbrales.furgoneta;
  if (v > u.grave) return 'grave';
  if (v > u.leve) return 'leve';
  return null;
}

function calcularRanking(trayectos, vehiculosPorId, config) {
  const cfg = mezclarConfig(config);
  const por = new Map();
  trayectos.forEach(t => {
    if (!t.conductor) return;
    if (!por.has(t.conductor)) por.set(t.conductor, { conductor: t.conductor, km: 0, seg_conduccion: 0, seg_paradas: 0, trayectos: 0, leves: 0, graves: 0, vel_max: 0, litros: 0, litros_optimo: 0, con_consumo: 0, vehiculos: new Set(), dias: new Set(), excesos: [] });
    const c = por.get(t.conductor);
    const v = vehiculosPorId[t.vehiculo_id] || {};
    c.km += Number(t.km) || 0;
    c.seg_conduccion += Number(t.seg_conduccion) || 0;
    c.seg_paradas += Number(t.seg_paradas) || 0;
    c.trayectos++;
    c.vel_max = Math.max(c.vel_max, Number(t.vel_max) || 0);
    if (t.litros != null && t.litros_optimo) { c.litros += Number(t.litros); c.litros_optimo += Number(t.litros_optimo); c.con_consumo++; }
    c.vehiculos.add(t.vehiculo_id);
    c.dias.add(t.fecha);
    const exceso = clasificarExceso(t.vel_max, v.tipo, cfg);
    if (exceso === 'grave') c.graves++;
    if (exceso === 'leve') c.leves++;
    if (exceso) c.excesos.push({ exceso, vel_max: Number(t.vel_max), fecha: t.fecha, inicio: t.inicio, vehiculo_id: t.vehiculo_id, km: t.km, origen: t.origen, loc_origen: t.loc_origen, destino: t.destino, loc_destino: t.loc_destino });
  });

  const filas = [...por.values()].map(c => {
    const horas = c.seg_conduccion / 3600;
    const m = {
      graves_100km: c.km ? redondo(c.graves / c.km * 100) : 0,
      leves_100km: c.km ? redondo(c.leves / c.km * 100) : 0,
      ralenti_min_h: horas ? redondo(c.seg_paradas / 60 / horas, 1) : 0,
      consumo_exceso_pct: c.con_consumo && c.litros_optimo ? redondo((c.litros / c.litros_optimo - 1) * 100, 1) : null
    };
    const pen = (valor, tope) => Math.min(Math.max(Number(valor) || 0, 0) / tope, 1);
    const p = cfg.pesos, tp = cfg.topes;
    const penalizaciones = {
      graves: redondo(p.graves * pen(m.graves_100km, tp.graves_100km)),
      leves: redondo(p.leves * pen(m.leves_100km, tp.leves_100km)),
      ralenti: redondo(p.ralenti * pen(m.ralenti_min_h, tp.ralenti_min_h)),
      consumo: redondo(p.consumo * pen(m.consumo_exceso_pct, tp.consumo_exceso_pct))
    };
    const total = Object.values(penalizaciones).reduce((s, x) => s + x, 0);
    return {
      conductor: c.conductor, km: redondo(c.km, 1), seg_conduccion: c.seg_conduccion, seg_paradas: c.seg_paradas,
      trayectos: c.trayectos, dias: c.dias.size, vehiculos: [...c.vehiculos], leves: c.leves, graves: c.graves, vel_max: c.vel_max,
      ...m, penalizaciones, nota: redondo(Math.max(0, 100 - total), 1),
      peores: c.excesos.sort((a, b) => b.vel_max - a.vel_max).slice(0, 10)
    };
  });
  const orden = (a, b) => b.nota - a.nota || b.km - a.km;
  return {
    config: cfg,
    ranking: filas.filter(f => f.km >= cfg.km_minimo).sort(orden),
    pocosKm: filas.filter(f => f.km < cfg.km_minimo).sort(orden)
  };
}

module.exports = { CONFIG_DEFECTO, mezclarConfig, clasificarExceso, calcularRanking };
