/* ================================================================
   ORUM Central · Logística → Rutas · Planificación (interfaz Liquid Glass)
   Fase 2 (nov 2026). Solo la abre la interfaz glass (public/glass.js).
   NO tiene datos propios: lee y guarda con los mismos endpoints que
   public/rutas.html (/api/rutas, /api/rutas/manual, /api/rutas/conductores…),
   con la sesión de ORUM (sin token público). Los cambios llegan a la app
   antigua por el mismo canal SSE (/api/rutas/eventos) y al revés.
   ================================================================ */
(function () {
  const TZ = 'Europe/Madrid';
  const ROLES_EDICION = ['Direccion', 'Logistica'];
  const CID = 'plan_' + Math.random().toString(36).slice(2, 10); // para no recargar con nuestros propios avisos
  const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  const S = {
    pestana: 'plan', modo: 'hoy', dia: null, desde: null, hasta: null,
    kpi: 'total', vistaBandeja: 'compacta', buscar: '', fTipo: '', fPrep: '', fZona: '',
    seleccion: new Set(), guardando: new Set(), plegados: new Set(), abiertos: new Set(),
    sel: null, // { veh, vu } seleccionado para el panel de recorrido
    mapaGrande: false,
    d: null, // datos cargados
    cargando: false, ocupado: 0, recargaPendiente: false, fuente: null, temporizador: null
  };

  // ── Utilidades ──
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hoyISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const fechaUTC = iso => new Date(iso + 'T12:00:00Z');
  const sumar = (iso, n) => { const d = fechaUTC(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const lunesDe = iso => sumar(iso, -((fechaUTC(iso).getUTCDay() + 6) % 7));
  const diaSemana = iso => fechaUTC(iso).getUTCDay();
  const numDia = iso => Number(iso.slice(8, 10));
  const fechaLarga = iso => { const d = fechaUTC(iso); const t = DIAS_LARGOS[d.getUTCDay()]; return t[0].toUpperCase() + t.slice(1) + ', ' + d.getUTCDate() + ' de ' + MESES[d.getUTCMonth()] + ' de ' + d.getUTCFullYear(); };
  const puedeEditar = () => !!(window.usuarioActual && ROLES_EDICION.includes(usuarioActual.rol));
  const normal = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  // Mismo criterio que rutas.html (getVehsParada / vehsAString / claveTranspale)
  function vehsDe(p) {
    if (!p.vehiculo) return [];
    if (Array.isArray(p.vehiculo)) return p.vehiculo.filter(Boolean);
    const t = String(p.vehiculo);
    if (t.indexOf('[L') === 0) return [];
    return t.split(',').map(v => v.trim()).filter(Boolean);
  }
  const vueltaDe = p => parseInt(p.vuelta) || 1;
  const claveTranspale = p => (p.proyecto_id && (p.tipo === 'ENTREGA' || p.tipo === 'RECOGIDA')) ? p.proyecto_id + '_' + p.tipo : p.clave;
  const fechaDe = p => String(p.fecha || '').slice(0, 10);
  const horaOrden = p => (p.hora && /^\d{1,2}:\d{2}/.test(p.hora)) ? p.hora.padStart(5, '0') : '99:99';
  const conductoresDe = (fecha, veh, vu) => ((S.d.cond[fecha + '_' + veh + '_' + vu] || {}).conductores) || [];

  function toast(txt, error) {
    let t = $('rp-toast');
    if (!t) { t = document.createElement('div'); t.id = 'rp-toast'; document.body.appendChild(t); }
    t.textContent = txt; t.className = 'rp-toast visible' + (error ? ' error' : '');
    clearTimeout(t._h); t._h = setTimeout(() => { t.className = 'rp-toast'; }, error ? 5000 : 2200);
  }

  // ── Periodo ──
  function fijarPeriodo(modo, valor) {
    const hoy = hoyISO();
    S.modo = modo;
    if (modo === 'hoy') { S.dia = hoy; semanaDe(hoy); }
    else if (modo === 'manana') { S.dia = sumar(hoy, 1); semanaDe(S.dia); }
    else if (modo === 'semana') { S.dia = hoy; semanaDe(hoy); }
    else if (modo === 'semprox') { const l = sumar(lunesDe(hoy), 7); S.dia = l; semanaDe(l); }
    else if (modo === 'fecha') { S.dia = valor || hoy; semanaDe(S.dia); }
    else if (modo === 'mes') {
      const m = valor || hoy.slice(0, 7);
      S.desde = m + '-01';
      const sig = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1));
      S.hasta = sumar(sig.toISOString().slice(0, 10), -1);
      S.dia = (hoy >= S.desde && hoy <= S.hasta) ? hoy : S.desde;
    }
  }
  function semanaDe(iso) { S.desde = lunesDe(iso); S.hasta = sumar(S.desde, 6); }
  function desplazar(dir) {
    if (S.modo === 'mes') {
      const d = fechaUTC(S.desde); d.setUTCMonth(d.getUTCMonth() + dir);
      fijarPeriodo('mes', d.toISOString().slice(0, 7));
    } else {
      S.modo = 'fecha'; S.dia = sumar(S.dia, 7 * dir); semanaDe(S.dia);
    }
    S.seleccion.clear(); cargar();
  }
  function textoRango() {
    if (S.modo === 'mes') { const d = fechaUTC(S.desde); return MESES[d.getUTCMonth()][0].toUpperCase() + MESES[d.getUTCMonth()].slice(1) + ' de ' + d.getUTCFullYear(); }
    const a = fechaUTC(S.desde), b = fechaUTC(S.hasta);
    return 'Semana del ' + a.getUTCDate() + (a.getUTCMonth() !== b.getUTCMonth() ? ' de ' + MESES[a.getUTCMonth()] : '') + ' al ' + b.getUTCDate() + ' de ' + MESES[b.getUTCMonth()] + ' de ' + b.getUTCFullYear();
  }

  // ── Carga de datos (mismos endpoints que rutas.html) ──
  async function pedir(url) { const r = await fetch(url, { credentials: 'same-origin' }); const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status)); return j; }
  async function cargar(silencioso) {
    if (!silencioso) { S.cargando = true; pintar(); }
    const q = '?desde=' + S.desde + '&hasta=' + S.hasta + '&t=' + Date.now();
    try {
      const [rutas, cond, estVeh, estPar, pago, transp] = await Promise.all([
        pedir('/api/rutas' + q),
        pedir('/api/rutas/conductores' + q).catch(() => ({})),
        pedir('/api/rutas/estado-vehiculos' + q).catch(() => ({})),
        pedir('/api/rutas/estados-parada?t=' + Date.now()).catch(() => ({})),
        pedir('/api/rutas/estado-pago?t=' + Date.now()).catch(() => ({})),
        pedir('/api/rutas/transpale?t=' + Date.now()).catch(() => ({}))
      ]);
      // Recarga silenciosa que llega mientras el usuario está guardando o arrastrando: se descarta y se repite luego
      if (silencioso && (S.ocupado > 0 || S.guardando.size || document.querySelector('.rp-modal-velo'))) { S.recargaPendiente = true; return; }
      const previo = S.d || {};
      const condMapa = {};
      (cond.asignaciones || []).forEach(a => { condMapa[a.fecha + '_' + a.vehiculo + '_' + a.vuelta] = a; });
      const estVehMapa = {};
      (estVeh.estados || []).forEach(e => { estVehMapa[e.fecha + '_' + e.vehiculo + '_' + e.vuelta] = e.estado || ''; });
      const estParMapa = {};
      (estPar.estados || []).forEach(e => { estParMapa[e.clave] = e; });
      const transpMapa = {};
      (transp.transpale || []).forEach(t => { transpMapa[t.clave] = t; });
      S.d = {
        paradas: rutas.paradas || [],
        vehiculos: (rutas.vehiculos && rutas.vehiculos.length) ? rutas.vehiculos : (previo.vehiculos || []),
        cond: cond.asignaciones ? condMapa : (previo.cond || {}),
        choferes: (cond.choferes && cond.choferes.length) ? cond.choferes : (previo.choferes || []),
        ausencias: cond.ausencias || previo.ausencias || {},
        estVeh: estVeh.estados ? estVehMapa : (previo.estVeh || {}),
        estPar: estPar.estados ? estParMapa : (previo.estPar || {}),
        pago: pago.estado_pago || previo.pago || {},
        transpale: transp.transpale ? transpMapa : (previo.transpale || {})
      };
      S.error = null;
    } catch (e) {
      if (!silencioso) S.error = e.message;
      else S.recargaPendiente = true;
    }
    S.cargando = false;
    pintar();
  }

  // ── Tiempo real: mismo canal que la app antigua ──
  function conectarEventos() {
    if (S.fuente || !window.EventSource) return;
    let antes = false;
    S.fuente = new EventSource('/api/rutas/eventos');
    S.fuente.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m || m.cid === CID) return;
      programarRecarga();
    };
    S.fuente.onopen = () => { if (antes) programarRecarga(); antes = true; };
    S.temporizador = setInterval(() => {
      if (!$('rp-root')) { desconectar(); return; }
      if (S.recargaPendiente && !S.ocupado && !S.guardando.size && !document.querySelector('.rp-modal-velo')) { S.recargaPendiente = false; cargar(true); }
    }, 1500);
  }
  function desconectar() {
    if (S.fuente) { S.fuente.close(); S.fuente = null; }
    if (S.temporizador) { clearInterval(S.temporizador); S.temporizador = null; }
  }
  let reloj = null;
  function programarRecarga() { clearTimeout(reloj); reloj = setTimeout(() => { S.recargaPendiente = true; }, 600); }

  // ── Cálculos del día ──
  function paradasDia(dia) { return S.d ? S.d.paradas.filter(p => fechaDe(p) === dia) : []; }
  function resumenDia(dia) {
    const P = paradasDia(dia);
    const vueltas = new Set(), vehs = new Set();
    let sin = 0, inc = 0, ent = 0, rec = 0;
    P.forEach(p => {
      const v = vehsDe(p);
      if (!v.length) sin++;
      v.forEach(x => { vehs.add(x); vueltas.add(x + '_' + vueltaDe(p)); });
      if ((S.d.estPar[p.clave] || {}).incidencia) inc++;
      if (p.tipo === 'ENTREGA') ent++; else if (p.tipo === 'RECOGIDA') rec++;
    });
    const sinCond = [...vueltas].filter(k => { const i = k.lastIndexOf('_'); return !conductoresDe(dia, k.slice(0, i), k.slice(i + 1)).length; });
    return { total: P.length, sin, asignadas: P.length - sin, vehiculos: vehs.size, sinConductor: sinCond.length, sinCondClaves: new Set(sinCond), incidencias: inc, entregas: ent, recogidas: rec };
  }
  // Vehículo → vuelta → paradas ordenadas (una parada compartida sale en cada vehículo, igual que en la app antigua)
  function gruposDia(dia) {
    const g = {};
    paradasDia(dia).forEach(p => vehsDe(p).forEach(v => {
      const vu = vueltaDe(p);
      ((g[v] = g[v] || {})[vu] = g[v][vu] || []).push(p);
    }));
    Object.values(g).forEach(vs => Object.values(vs).forEach(l => l.sort((a, b) => (a.orden || 0) - (b.orden || 0) || horaOrden(a).localeCompare(horaOrden(b)))));
    return g;
  }
  function listaVehiculos(g) {
    const lista = [...S.d.vehiculos];
    Object.keys(g).forEach(v => { if (!lista.includes(v)) lista.push(v); });
    return lista;
  }

  // ── Pintado ──
  function pintar() {
    const body = $('content-body');
    if (!body) return;
    let root = $('rp-root');
    if (!root) { body.innerHTML = '<div class="rp" id="rp-root"></div>'; root = $('rp-root'); }
    const scrolls = [...root.querySelectorAll('[data-scroll]')].map(el => [el.dataset.scroll, el.scrollTop]);
    root.innerHTML = htmlPestanas() + (S.pestana === 'plan' ? htmlPlanificacion() : htmlOtraPestana());
    scrolls.forEach(([k, t]) => { const el = root.querySelector('[data-scroll="' + k + '"]'); if (el) el.scrollTop = t; });
    enlazar(root);
  }

  const ICO = {
    plan: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    mapa: '<svg viewBox="0 0 24 24"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/></svg>',
    seg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    est: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    hist: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
    camion: '<svg viewBox="0 0 24 24"><path d="M2 7h11v9H2zM13 10h4l4 3v3h-8"/><circle cx="6" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>',
    asignar: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
    persona: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/></svg>',
    capas: '<svg viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
    alerta: '<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>',
    abajo: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>',
    izq: '<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>',
    der: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
    lupa: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    asa: '<svg viewBox="0 0 24 24"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>',
    ampliar: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>'
  };

  function htmlPestanas() {
    const t = [['plan', 'Planificación', ICO.plan], ['mapa', 'Mapa', ICO.mapa], ['seg', 'Seguimiento', ICO.seg], ['est', 'Estadísticas', ICO.est], ['hist', 'Histórico', ICO.hist]];
    return `<div class="rp-pestanas g-vidrio">${t.map(([id, n, i]) => `<button type="button" class="rp-pestana${S.pestana === id ? ' activa' : ''}" data-pestana="${id}">${i}<span>${n}</span></button>`).join('')}
      <a class="rp-app-antigua" href="/rutas.html" target="_blank" rel="noopener" title="La app de siempre sigue funcionando con los mismos datos">App de Rutas ↗</a></div>`;
  }
  function htmlOtraPestana() {
    const info = {
      mapa: ['Mapa', 'Fase 3. Las paradas todavía no tienen coordenadas guardadas: antes de dibujar el mapa hay que preparar la geocodificación de las direcciones, sin inventar ubicaciones. Mientras tanto, en Planificación cada vehículo tiene su recorrido en Google Maps.'],
      seg: ['Seguimiento', 'Fase 4. Tabla de supervisión con los estados que ya se registran (preparado, cargado, incidencia, estado del vehículo y pago).'],
      est: ['Estadísticas', 'Fase 4. Integrará las estadísticas actuales de entregas y recogidas y la evolución mensual, sin cálculos nuevos.'],
      hist: ['Histórico', 'Fase 5. Antes hay que comprobar qué conservan las tablas de Rutas y el historial de cambios, para no presentar el estado actual como si fuera el de días pasados. Las fechas anteriores ya se pueden consultar en Planificación con «Elegir fecha».']
    }[S.pestana];
    const botonEst = S.pestana === 'est' && puedeEditar() && typeof window.cargarEstadisticasRutas === 'function'
      ? '<button type="button" class="rp-btn" id="rp-abrir-est">Abrir las estadísticas actuales</button>' : '';
    return `<div class="rp-proximo g-vidrio"><h3>${info[0]}</h3><p>${esc(info[1])}</p>${botonEst}</div>`;
  }

  function htmlPlanificacion() {
    if (!S.d && S.cargando) return '<div class="rp-cargando g-vidrio">Cargando rutas…</div>';
    if (!S.d && S.error) return `<div class="rp-cargando g-vidrio">No se han podido cargar las rutas: ${esc(S.error)} <button type="button" class="rp-btn" id="rp-reintentar">Reintentar</button></div>`;
    if (!S.d) return '';
    return htmlPeriodo() + htmlDias() + htmlKpis() + `<div class="rp-rejilla${S.mapaGrande ? ' mapa-grande' : ''}">${htmlBandeja()}${htmlVehiculos()}${htmlRecorrido()}</div>` + htmlBarraSeleccion();
  }

  function htmlPeriodo() {
    const b = (m, n) => `<button type="button" class="rp-chip${S.modo === m ? ' activo' : ''}" data-modo="${m}">${n}</button>`;
    return `<div class="rp-periodo">
      <div class="rp-chips">${b('hoy', 'Hoy')}${b('manana', 'Mañana')}${b('semana', 'Semana actual')}${b('semprox', 'Semana próxima')}
        <label class="rp-chip${S.modo === 'fecha' ? ' activo' : ''}">Elegir fecha <input type="date" id="rp-fecha" value="${S.dia}"></label>
        <label class="rp-chip${S.modo === 'mes' ? ' activo' : ''}">Mes <input type="month" id="rp-mes" value="${S.desde.slice(0, 7)}"></label>
        ${S.cargando ? '<span class="rp-sutil">Actualizando…</span>' : ''}</div>
      <div class="rp-rango g-vidrio"><button type="button" class="rp-flecha" data-desplazar="-1" aria-label="Anterior">${ICO.izq}</button><span>${textoRango()}</span><button type="button" class="rp-flecha" data-desplazar="1" aria-label="Siguiente">${ICO.der}</button></div>
    </div>`;
  }

  function htmlDias() {
    const dias = [];
    for (let d = S.desde; d <= S.hasta; d = sumar(d, 1)) dias.push(d);
    let tot = 0, sin = 0, inc = 0; const vehs = new Set();
    const hoy = hoyISO();
    const tarjetas = dias.map(d => {
      const r = resumenDia(d);
      tot += r.total; sin += r.sin; inc += r.incidencias;
      paradasDia(d).forEach(p => vehsDe(p).forEach(v => vehs.add(v)));
      const icono = !r.total ? '' : r.sin ? `<span class="rp-dia-ico pend">${ICO.persona}</span>` : `<span class="rp-dia-ico ok">${ICO.check}</span>`;
      return `<button type="button" class="rp-dia g-vidrio${d === S.dia ? ' activo' : ''}${d === hoy ? ' hoy' : ''}${d < hoy ? ' pasado' : ''}" data-dia="${d}">
        <b>${DIAS[diaSemana(d)]} ${numDia(d)}</b>
        <span class="rp-dia-cifras">${icono}<span>${r.total} ${r.total === 1 ? 'parada' : 'paradas'}<br><em class="${r.sin ? 'rojo' : ''}">${r.sin} sin asignar</em></span></span>
        <small>${r.entregas} ent · ${r.recogidas} rec${r.sinConductor ? ' · ' + r.sinConductor + ' sin cond.' : ''}${r.incidencias ? ' · ⚠ ' + r.incidencias : ''}</small>
      </button>`;
    }).join('');
    const resumen = `<div class="rp-dia rp-resumen-sem g-vidrio"><b>${S.modo === 'mes' ? 'Resumen del mes' : 'Resumen de la semana'}</b>
      <div class="rp-res-cifras"><span><strong>${tot}</strong>Paradas</span><span class="${sin ? 'rojo' : ''}"><strong>${sin}</strong>Sin asignar</span><span><strong>${vehs.size}</strong>Vehículos</span><span><strong>${inc}</strong>Incidencias</span></div></div>`;
    return `<div class="rp-dias${S.modo === 'mes' ? ' mes' : ''}" data-scroll="dias">${tarjetas}${resumen}</div>`;
  }

  function htmlKpis() {
    const r = resumenDia(S.dia);
    const k = (id, n, v, ico, cls) => `<button type="button" class="rp-kpi g-vidrio${S.kpi === id ? ' activo' : ''}${cls ? ' ' + cls : ''}" data-kpi="${id}" aria-pressed="${S.kpi === id}"><span class="rp-kpi-ico">${ico}</span><span><small>${n}</small><strong>${v}</strong></span></button>`;
    return `<div class="rp-kpis">
      <div class="rp-fecha g-vidrio">${ICO.plan}<span>${fechaLarga(S.dia)}</span></div>
      ${k('total', 'Total paradas', r.total, ICO.pin)}
      ${k('sin', 'Sin asignar', r.sin, ICO.capas, r.sin ? 'alerta' : '')}
      ${k('asignadas', 'Asignadas', r.asignadas, ICO.check, 'ok')}
      ${k('vehiculos', 'Vehículos', r.vehiculos, ICO.camion)}
      ${k('sincond', 'Sin conductor', r.sinConductor, ICO.persona, r.sinConductor ? 'alerta' : '')}
    </div>`;
  }

  // Chips de estado de una parada (solo datos registrados)
  function chips(p, detallado) {
    const e = S.d.estPar[p.clave] || {}, pg = S.d.pago[String(p.proyecto_id)] || {};
    const c = [];
    c.push(`<span class="rp-c ${e.preparado ? 'ok' : 'no'}" title="Preparado (Almacén)">Prep.${e.preparado ? ' ✓' : ''}</span>`);
    c.push(`<span class="rp-c ${e.cargado ? 'ok' : 'no'}" title="Cargado">Carga${e.cargado ? ' ✓' : ''}</span>`);
    if (pg.tiene_lavanderia) c.push(`<span class="rp-c ${pg.prep_lavanderia ? 'ok' : 'aviso'}" title="Lavandería ${pg.prep_lavanderia ? 'preparada' : 'sin terminar'}">Lav.${pg.prep_lavanderia ? ' ✓' : ' !'}</span>`);
    if (pg.tiene_office) c.push(`<span class="rp-c ${pg.prep_office ? 'ok' : 'aviso'}" title="Office ${pg.prep_office ? 'preparado' : 'sin terminar'}">Office${pg.prep_office ? ' ✓' : ' !'}</span>`);
    if (pg.estado_pago) c.push(`<span class="rp-pago ${pg.estado_pago}" title="${esc(tituloPago(pg))}"></span>`);
    if ((S.d.transpale[claveTranspale(p)] || {}).transpale) c.push('<span class="rp-c info" title="Necesita transpalé">Transpalé</span>');
    if (e.incidencia) c.push(`<span class="rp-c error" title="${esc(e.incidencia_texto || 'Incidencia')}">⚠ Incidencia</span>`);
    if (detallado && pg.servicios_extra && pg.servicios_extra.length) c.push(`<span class="rp-c info" title="${esc(pg.servicios_extra.map(s => s.servicio).join(', '))}">${pg.servicios_extra.length} extra</span>`);
    return c.join('');
  }
  function tituloPago(pg) {
    const d = pg.detalle_pago || {};
    if (pg.estado_pago === 'azul') return d.motivo || 'Cliente con pago a 30 días';
    if (d.es_pnc) return 'Pago al contado · confirmado en caja ' + (d.confirmado_en_caja || 0) + ' € de ' + (d.valor_esperado || 0) + ' €';
    if (pg.estado_pago === 'rojo') return 'Sin factura';
    if (pg.estado_pago === 'amarillo') return 'Pendiente de cobro: ' + (d.pendiente_cobro || 0) + ' €';
    return 'Cobrado';
  }
  const tipoCorto = t => t === 'ENTREGA' ? 'Entrega' : t === 'RECOGIDA' ? 'Recogida' : (t ? t[0] + t.slice(1).toLowerCase() : 'Otro');
  const tipoClase = t => t === 'ENTREGA' ? 'ent' : t === 'RECOGIDA' ? 'rec' : 'otro';
  const titulo = p => (p.numero ? '#' + p.numero + ' · ' : '') + (p.cliente || 'Sin cliente');

  // ── Bandeja «Sin asignar» ──
  function pasaFiltros(p) {
    if (S.fTipo === 'ENTREGA' || S.fTipo === 'RECOGIDA') { if (p.tipo !== S.fTipo) return false; }
    else if (S.fTipo === 'OTRO' && (p.tipo === 'ENTREGA' || p.tipo === 'RECOGIDA')) return false;
    const e = S.d.estPar[p.clave] || {};
    if (S.fPrep === 'si' && !e.preparado) return false;
    if (S.fPrep === 'no' && e.preparado) return false;
    if (S.fPrep === 'inc' && !e.incidencia) return false;
    if (S.fZona && (p.zona_codigo || '') !== S.fZona) return false;
    if (S.buscar) {
      const q = normal(S.buscar);
      const txt = normal([p.cliente, p.numero, p.localizacion, p.zona_codigo, p.zona_nombre, p.notas].join(' '));
      if (txt.indexOf(q) === -1) return false;
    }
    return true;
  }
  function htmlBandeja() {
    const todas = paradasDia(S.dia).filter(p => !vehsDe(p).length);
    const lista = todas.filter(pasaFiltros).sort((a, b) => horaOrden(a).localeCompare(horaOrden(b)) || String(a.cliente).localeCompare(String(b.cliente)));
    const zonas = [...new Set(paradasDia(S.dia).map(p => p.zona_codigo).filter(Boolean))].sort();
    const oculta = S.kpi === 'asignadas' || S.kpi === 'vehiculos' || S.kpi === 'sincond';
    const ed = puedeEditar();
    const sel = (id, val, ops) => `<select id="${id}">${ops.map(([v, n]) => `<option value="${v}"${val === v ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
    return `<section class="rp-panel rp-bandeja g-vidrio${oculta ? ' atenuado' : ''}" data-soltar-bandeja="1">
      <header><div><h3>${ICO.capas} Paradas sin asignar (${todas.length})</h3><p>Pendientes de vehículo · ${fechaLarga(S.dia)}</p></div>
        <div class="rp-vista"><button type="button" class="${S.vistaBandeja === 'compacta' ? 'activo' : ''}" data-vista="compacta">Compacta</button><button type="button" class="${S.vistaBandeja === 'detallada' ? 'activo' : ''}" data-vista="detallada">Detallada</button></div></header>
      <div class="rp-buscar">${ICO.lupa}<input type="search" id="rp-buscar" placeholder="Buscar cliente, proyecto, dirección o zona…" value="${esc(S.buscar)}"></div>
      <div class="rp-filtros">
        ${sel('rp-ftipo', S.fTipo, [['', 'Tipo: todos'], ['ENTREGA', 'Entregas'], ['RECOGIDA', 'Recogidas'], ['OTRO', 'Otros']])}
        ${sel('rp-fprep', S.fPrep, [['', 'Estado: todos'], ['si', 'Preparadas'], ['no', 'Sin preparar'], ['inc', 'Con incidencia']])}
        ${sel('rp-fzona', S.fZona, [['', 'Zona: todas'], ...zonas.map(z => [z, z])])}
      </div>
      ${ed && lista.length ? `<label class="rp-todas"><input type="checkbox" id="rp-sel-todas"${lista.every(p => S.seleccion.has(p.clave)) ? ' checked' : ''}> Seleccionar las ${lista.length} visibles</label>` : ''}
      <div class="rp-lista" data-scroll="bandeja">${oculta ? '<p class="rp-vacio">Filtro activo: «' + nombreKpi() + '». Pulsa «Total paradas» para volver a verlas.</p>'
        : lista.length ? lista.map(p => htmlTarjetaBandeja(p, ed)).join('') : `<p class="rp-vacio">${todas.length ? 'Ninguna parada coincide con los filtros.' : 'No hay paradas sin asignar este día.'}</p>`}</div>
    </section>`;
  }
  function nombreKpi() { return { total: 'Total', sin: 'Sin asignar', asignadas: 'Asignadas', vehiculos: 'Vehículos', sincond: 'Sin conductor' }[S.kpi]; }
  function htmlTarjetaBandeja(p, ed) {
    const det = S.vistaBandeja === 'detallada';
    const g = S.guardando.has(p.clave);
    return `<article class="rp-tarjeta${det ? ' detallada' : ''}${g ? ' guardando' : ''}${S.seleccion.has(p.clave) ? ' seleccionada' : ''}" ${ed && !g ? 'draggable="true"' : ''} data-clave="${esc(p.clave)}">
      ${ed ? `<span class="rp-asa" aria-hidden="true">${ICO.asa}</span><input type="checkbox" class="rp-check" data-sel="${esc(p.clave)}"${S.seleccion.has(p.clave) ? ' checked' : ''} aria-label="Seleccionar">` : ''}
      <div class="rp-hora"><b>${esc(p.hora || '—')}</b><span class="rp-tipo ${tipoClase(p.tipo)}">${tipoCorto(p.tipo)}</span></div>
      <div class="rp-cuerpo" data-detalle="${esc(p.clave)}">
        <b>${esc(titulo(p))}</b>
        <span class="rp-lugar">${ICO.pin}${esc(det ? (p.localizacion || 'Sin dirección') : (p.zona_codigo ? p.zona_codigo + ' · ' + (p.zona_nombre || '') : (p.localizacion || 'Sin dirección')))}</span>
        <span class="rp-chips-estado">${chips(p, det)}</span>
        ${det && p.notas ? `<span class="rp-notas">${esc(p.notas)}</span>` : ''}
        ${g ? '<span class="rp-guardando">Guardando…</span>' : ''}
      </div>
      ${ed ? `<button type="button" class="rp-btn-asignar" data-asignar="${esc(p.clave)}" title="Asignar a un vehículo">${ICO.asignar}<span>Asignar</span></button>` : ''}
    </article>`;
  }

  // ── Vehículos y vueltas ──
  function htmlVehiculos() {
    const g = gruposDia(S.dia);
    const r = resumenDia(S.dia);
    const ed = puedeEditar();
    let vehs = listaVehiculos(g);
    const conParadas = vehs.filter(v => g[v]);
    const sinParadas = vehs.filter(v => !g[v]);
    if (S.kpi === 'vehiculos' || S.kpi === 'sincond') vehs = conParadas; else vehs = conParadas.concat(sinParadas);
    if (S.kpi === 'sincond') vehs = vehs.filter(v => Object.keys(g[v]).some(vu => r.sinCondClaves.has(v + '_' + vu)));
    const oculto = S.kpi === 'sin';
    return `<section class="rp-panel rp-vehiculos g-vidrio${oculto ? ' atenuado' : ''}">
      <header><div><h3>${ICO.camion} Vehículos y vueltas (${conParadas.length})</h3><p>${ed ? 'Arrastra paradas o usa «Asignar». El orden se guarda al soltar.' : 'Consulta de la planificación del día.'}</p></div></header>
      <div class="rp-lista" data-scroll="vehiculos">${oculto ? '<p class="rp-vacio">Filtro activo: «Sin asignar». Pulsa «Total paradas» para ver los vehículos.</p>'
        : vehs.length ? vehs.map(v => htmlVehiculo(v, g[v] || {}, r, ed)).join('') : '<p class="rp-vacio">Ningún vehículo coincide con el filtro.</p>'}</div>
    </section>`;
  }
  function htmlVehiculo(v, vueltas, r, ed) {
    const nums = Object.keys(vueltas).map(Number).sort((a, b) => a - b);
    const todas = nums.flatMap(n => vueltas[n]);
    const unicas = [...new Map(todas.map(p => [p.clave, p])).values()];
    const prep = unicas.filter(p => (S.d.estPar[p.clave] || {}).preparado).length;
    const carga = unicas.filter(p => (S.d.estPar[p.clave] || {}).cargado).length;
    const inc = unicas.filter(p => (S.d.estPar[p.clave] || {}).incidencia).length;
    const clave = S.dia + '_' + v;
    const abierto = unicas.length ? !S.plegados.has(clave) : S.abiertos.has(clave);
    const condTxt = nums.map(n => { const c = conductoresDe(S.dia, v, n); return c.length ? c.join(', ') : null; });
    const faltan = nums.filter(n => !conductoresDe(S.dia, v, n).length).length;
    const estados = [...new Set(nums.map(n => S.d.estVeh[S.dia + '_' + v + '_' + n]).filter(Boolean))];
    const sel = S.sel && S.sel.veh === v;
    const listaVu = nums.length ? nums : [1];
    return `<article class="rp-veh${abierto ? ' abierto' : ''}${sel ? ' seleccionado' : ''}${unicas.length ? '' : ' vacio'}">
      <button type="button" class="rp-veh-cab" data-plegar="${esc(clave)}" data-tiene="${unicas.length ? 1 : 0}">
        <span class="rp-veh-ico">${ICO.camion}</span>
        <span class="rp-veh-nombre"><b>${esc(v)}</b><small>${unicas.length ? (condTxt.some(Boolean) ? esc(condTxt.filter(Boolean).join(' · ')) : '') + (faltan ? `<em class="rojo">${faltan === nums.length ? 'Sin conductor' : faltan + ' vuelta(s) sin conductor'}</em>` : '') : 'Sin paradas este día'}</small></span>
        ${unicas.length ? `<span class="rp-p">${unicas.length} ${unicas.length === 1 ? 'parada' : 'paradas'}</span>
        <span class="rp-p ${prep === unicas.length ? 'ok' : 'aviso'}">Prep. ${prep}/${unicas.length}</span>
        <span class="rp-p ${carga === unicas.length ? 'ok' : 'aviso'}">Carga ${carga}/${unicas.length}</span>
        ${inc ? `<span class="rp-p error">⚠ ${inc}</span>` : ''}${estados.map(e => `<span class="rp-p info">${esc(e)}</span>`).join('')}` : ''}
        <span class="rp-girar">${ICO.abajo}</span>
      </button>
      ${abierto ? `<div class="rp-vueltas">${listaVu.map(n => htmlVuelta(v, n, vueltas[n] || [], r, ed)).join('')}
        ${ed ? `<div class="rp-vuelta rp-nueva" data-soltar="${esc(v)}" data-vu="${(nums.length ? Math.max(...nums) : 0) + 1}"><span>+ Nueva vuelta</span><small>Suelta aquí una parada</small></div>` : ''}</div>` : ''}
    </article>`;
  }
  function htmlVuelta(v, n, lista, r, ed) {
    const cond = conductoresDe(S.dia, v, n);
    const sinCond = lista.length && !cond.length;
    const sel = S.sel && S.sel.veh === v && S.sel.vu === n;
    const resaltar = S.kpi === 'sincond' && r.sinCondClaves.has(v + '_' + n);
    const horas = lista.map(p => p.hora).filter(h => h && /^\d/.test(h)).sort();
    return `<div class="rp-vuelta${sel ? ' seleccionada' : ''}${resaltar ? ' resaltada' : ''}" data-soltar="${esc(v)}" data-vu="${n}">
      <div class="rp-vuelta-cab">
        <button type="button" class="rp-vuelta-tit" data-ver-ruta="${esc(v)}" data-vu-ruta="${n}" title="Ver el recorrido de esta vuelta">Vuelta ${n}${horas.length ? ` <small>${esc(horas[0])}${horas.length > 1 ? ' – ' + esc(horas[horas.length - 1]) : ''}</small>` : ''}</button>
        <button type="button" class="rp-cond${sinCond ? ' falta' : ''}" ${ed ? `data-conductor="${esc(v)}" data-vu-cond="${n}"` : 'disabled'}>${ICO.persona} ${cond.length ? esc(cond.join(', ')) : (lista.length ? 'Sin conductor' : 'Conductor')}</button>
      </div>
      <ol class="rp-paradas">${lista.length ? lista.map((p, i) => htmlParadaVuelta(p, i, lista.length, v, n, ed)).join('') : '<li class="rp-hueco">Sin paradas. Suelta aquí o usa «Asignar».</li>'}</ol>
    </div>`;
  }
  function htmlParadaVuelta(p, i, total, v, n, ed) {
    const e = S.d.estPar[p.clave] || {};
    const g = S.guardando.has(p.clave);
    const compartida = vehsDe(p).length > 1;
    return `<li class="rp-parada${g ? ' guardando' : ''}" ${ed && !g ? 'draggable="true"' : ''} data-clave="${esc(p.clave)}" data-origen="${esc(v)}">
      ${ed ? `<span class="rp-asa" aria-hidden="true">${ICO.asa}</span>` : ''}<span class="rp-num">${i + 1}</span>
      <span class="rp-parada-txt" data-detalle="${esc(p.clave)}"><b>${esc(p.hora || '—')}</b> ${esc(titulo(p))}${compartida ? ' <span class="rp-c info" title="' + esc(vehsDe(p).join(', ')) + '">Compartida</span>' : ''}${g ? ' <span class="rp-guardando">Guardando…</span>' : ''}</span>
      <span class="rp-tipo ${tipoClase(p.tipo)}">${tipoCorto(p.tipo)}</span>
      <span class="rp-estado-mini" title="${e.cargado ? 'Cargado' : e.preparado ? 'Preparado' : 'Sin preparar'}${e.incidencia ? ' · incidencia' : ''}">${e.incidencia ? '<span class="rp-punto error"></span>' : e.cargado ? '<span class="rp-punto ok"></span>' : e.preparado ? '<span class="rp-punto medio"></span>' : '<span class="rp-punto"></span>'}</span>
      ${ed && !g ? `<span class="rp-acciones">
        <button type="button" data-subir="${esc(p.clave)}" data-veh="${esc(v)}" data-vu="${n}" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button>
        <button type="button" data-bajar="${esc(p.clave)}" data-veh="${esc(v)}" data-vu="${n}" ${i === total - 1 ? 'disabled' : ''} aria-label="Bajar">▼</button>
        <button type="button" data-asignar="${esc(p.clave)}" aria-label="Mover">${ICO.asignar}</button>
        <button type="button" data-quitar="${esc(p.clave)}" title="Devolver a Sin asignar" aria-label="Devolver a Sin asignar">↩</button></span>` : ''}
    </li>`;
  }

  // ── Recorrido del vehículo seleccionado (el mapa interactivo llega en la fase 3) ──
  function htmlRecorrido() {
    const g = gruposDia(S.dia);
    let sel = S.sel && g[S.sel.veh] ? S.sel : null;
    if (!sel) { const v = Object.keys(g)[0]; if (v) sel = { veh: v, vu: Math.min(...Object.keys(g[v]).map(Number)) }; }
    let cuerpo;
    if (!sel) cuerpo = '<p class="rp-vacio">Sin vehículos con paradas este día.</p>';
    else {
      const lista = (g[sel.veh][sel.vu] || []);
      const dirs = lista.map(p => p.localizacion).filter(Boolean);
      const urlRuta = dirs.length >= 2 ? 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + encodeURIComponent(dirs[0]) + '&destination=' + encodeURIComponent(dirs[dirs.length - 1]) + (dirs.length > 2 ? '&waypoints=' + encodeURIComponent(dirs.slice(1, -1).join('|')) : '') : '';
      const vueltas = Object.keys(g[sel.veh]).map(Number).sort((a, b) => a - b);
      cuerpo = `<div class="rp-rec-cab"><b>${esc(sel.veh)} — Vuelta ${sel.vu}</b>
          ${vueltas.length > 1 ? `<span class="rp-rec-vueltas">${vueltas.map(n => `<button type="button" class="${n === sel.vu ? 'activo' : ''}" data-ver-ruta="${esc(sel.veh)}" data-vu-ruta="${n}">V${n}</button>`).join('')}</span>` : ''}</div>
        <ol class="rp-rec-lista">${lista.map((p, i) => `<li><span class="rp-num ${tipoClase(p.tipo)}">${i + 1}</span><span data-detalle="${esc(p.clave)}"><b>${esc(p.hora || '—')} · ${esc(titulo(p))}</b><small>${esc(p.localizacion || 'Sin dirección')}</small></span>${p.google_maps_url ? `<a href="${esc(p.google_maps_url)}" target="_blank" rel="noopener" title="Abrir en Google Maps">${ICO.pin}</a>` : ''}</li>`).join('')}</ol>
        ${urlRuta ? `<a class="rp-btn ancho" href="${esc(urlRuta)}" target="_blank" rel="noopener">${ICO.mapa} Ver recorrido en Google Maps</a>` : ''}
        <p class="rp-nota">Recorrido previsto según el orden de las paradas. Distancias y tiempos los calcula Google Maps; no es la posición real del vehículo.</p>`;
    }
    return `<section class="rp-panel rp-recorrido g-vidrio">
      <header><div><h3>${ICO.mapa} Recorrido</h3><p>Vuelta seleccionada · mapa interactivo en la fase 3</p></div>
        <button type="button" class="rp-icono" id="rp-ampliar" title="${S.mapaGrande ? 'Reducir' : 'Ampliar'}">${ICO.ampliar}</button></header>
      <div class="rp-lista" data-scroll="recorrido">${cuerpo}</div>
    </section>`;
  }

  function htmlBarraSeleccion() {
    if (!S.seleccion.size || !puedeEditar()) return '';
    return `<div class="rp-barra-sel g-vidrio"><b>${S.seleccion.size} seleccionada${S.seleccion.size === 1 ? '' : 's'}</b>
      <button type="button" class="rp-btn" id="rp-asignar-sel">${ICO.asignar} Asignar a vehículo</button>
      <button type="button" class="rp-btn suave" id="rp-limpiar-sel">Quitar selección</button></div>`;
  }

  // ── Eventos ──
  function enlazar(root) {
    root.querySelectorAll('[data-pestana]').forEach(b => b.onclick = () => { S.pestana = b.dataset.pestana; pintar(); });
    const est = $('rp-abrir-est'); if (est) est.onclick = () => window.cargarEstadisticasRutas();
    const rein = $('rp-reintentar'); if (rein) rein.onclick = () => cargar();
    root.querySelectorAll('[data-modo]').forEach(b => b.onclick = () => { fijarPeriodo(b.dataset.modo); S.seleccion.clear(); cargar(); });
    const f = $('rp-fecha'); if (f) f.onchange = () => { if (f.value) { fijarPeriodo('fecha', f.value); S.seleccion.clear(); cargar(); } };
    const m = $('rp-mes'); if (m) m.onchange = () => { if (m.value) { fijarPeriodo('mes', m.value); S.seleccion.clear(); cargar(); } };
    root.querySelectorAll('[data-desplazar]').forEach(b => b.onclick = () => desplazar(Number(b.dataset.desplazar)));
    root.querySelectorAll('[data-dia]').forEach(b => b.onclick = () => { S.dia = b.dataset.dia; S.seleccion.clear(); S.sel = null; pintar(); });
    root.querySelectorAll('[data-kpi]').forEach(b => b.onclick = () => { S.kpi = (S.kpi === b.dataset.kpi && b.dataset.kpi !== 'total') ? 'total' : b.dataset.kpi; pintar(); });
    root.querySelectorAll('[data-vista]').forEach(b => b.onclick = () => { S.vistaBandeja = b.dataset.vista; pintar(); });
    const bus = $('rp-buscar');
    if (bus) bus.oninput = () => { S.buscar = bus.value; const pos = bus.selectionStart; pintar(); const n = $('rp-buscar'); n.focus(); n.setSelectionRange(pos, pos); };
    [['rp-ftipo', 'fTipo'], ['rp-fprep', 'fPrep'], ['rp-fzona', 'fZona']].forEach(([id, k]) => { const s = $(id); if (s) s.onchange = () => { S[k] = s.value; pintar(); }; });
    root.querySelectorAll('[data-sel]').forEach(c => c.onchange = () => { c.checked ? S.seleccion.add(c.dataset.sel) : S.seleccion.delete(c.dataset.sel); pintar(); });
    const todas = $('rp-sel-todas');
    if (todas) todas.onchange = () => {
      const visibles = paradasDia(S.dia).filter(p => !vehsDe(p).length && pasaFiltros(p)).map(p => p.clave);
      visibles.forEach(c => todas.checked ? S.seleccion.add(c) : S.seleccion.delete(c)); pintar();
    };
    const as = $('rp-asignar-sel'); if (as) as.onclick = () => abrirAsignar([...S.seleccion]);
    const ls = $('rp-limpiar-sel'); if (ls) ls.onclick = () => { S.seleccion.clear(); pintar(); };
    root.querySelectorAll('[data-asignar]').forEach(b => b.onclick = e => { e.stopPropagation(); abrirAsignar([b.dataset.asignar]); });
    root.querySelectorAll('[data-quitar]').forEach(b => b.onclick = e => { e.stopPropagation(); desasignar([b.dataset.quitar]); });
    root.querySelectorAll('[data-subir],[data-bajar]').forEach(b => b.onclick = e => {
      e.stopPropagation();
      const clave = b.dataset.subir || b.dataset.bajar, veh = b.dataset.veh, vu = Number(b.dataset.vu);
      const lista = (gruposDia(S.dia)[veh] || {})[vu] || [];
      const i = lista.findIndex(p => p.clave === clave);
      asignar([clave], veh, vu, b.dataset.subir ? i - 1 : i + 1);
    });
    root.querySelectorAll('[data-plegar]').forEach(b => b.onclick = () => {
      const k = b.dataset.plegar;
      if (b.dataset.tiene === '1') { S.plegados.has(k) ? S.plegados.delete(k) : S.plegados.add(k); }
      else { S.abiertos.has(k) ? S.abiertos.delete(k) : S.abiertos.add(k); }
      const v = k.slice(S.dia.length + 1);
      if (b.dataset.tiene === '1') { const g = gruposDia(S.dia)[v]; if (g) S.sel = { veh: v, vu: Math.min(...Object.keys(g).map(Number)) }; }
      pintar();
    });
    root.querySelectorAll('[data-ver-ruta]').forEach(b => b.onclick = () => { S.sel = { veh: b.dataset.verRuta, vu: Number(b.dataset.vuRuta) }; pintar(); });
    root.querySelectorAll('[data-conductor]').forEach(b => b.onclick = () => abrirConductores(b.dataset.conductor, Number(b.dataset.vuCond)));
    root.querySelectorAll('[data-detalle]').forEach(el => el.onclick = () => abrirDetalle(el.dataset.detalle));
    const amp = $('rp-ampliar'); if (amp) amp.onclick = () => { S.mapaGrande = !S.mapaGrande; pintar(); };
    if (puedeEditar()) enlazarArrastre(root);
  }

  // ── Arrastrar y soltar (escritorio); en móvil/tablet se usa «Asignar» ──
  let arrastre = null;
  function enlazarArrastre(root) {
    root.querySelectorAll('[draggable="true"][data-clave]').forEach(el => {
      el.addEventListener('dragstart', e => {
        const clave = el.dataset.clave;
        const claves = S.seleccion.has(clave) && !el.dataset.origen ? [...S.seleccion] : [clave];
        arrastre = { claves, origen: el.dataset.origen || null };
        S.ocupado++;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', clave); } catch (er) {}
        setTimeout(() => el.classList.add('arrastrando'), 0);
      });
      el.addEventListener('dragend', () => { el.classList.remove('arrastrando'); if (arrastre) { arrastre = null; S.ocupado = Math.max(0, S.ocupado - 1); } limpiarMarcas(); });
    });
    root.querySelectorAll('[data-soltar]').forEach(zona => {
      zona.addEventListener('dragover', e => {
        if (!arrastre) return;
        e.preventDefault();
        limpiarMarcas();
        zona.classList.add('soltar-encima');
        const li = e.target.closest('.rp-parada');
        if (li && zona.contains(li)) {
          const r = li.getBoundingClientRect();
          li.classList.add(e.clientY < r.top + r.height / 2 ? 'marca-antes' : 'marca-despues');
        }
      });
      zona.addEventListener('dragleave', e => { if (!zona.contains(e.relatedTarget)) zona.classList.remove('soltar-encima'); });
      zona.addEventListener('drop', e => {
        if (!arrastre) return;
        e.preventDefault();
        const veh = zona.dataset.soltar, vu = Number(zona.dataset.vu);
        const lista = ((gruposDia(S.dia)[veh] || {})[vu] || []).filter(p => !arrastre.claves.includes(p.clave));
        let pos = lista.length;
        const li = e.target.closest('.rp-parada');
        if (li && zona.contains(li)) {
          const i = lista.findIndex(p => p.clave === li.dataset.clave);
          if (i !== -1) { const r = li.getBoundingClientRect(); pos = e.clientY < r.top + r.height / 2 ? i : i + 1; }
        }
        const claves = arrastre.claves;
        arrastre = null; S.ocupado = Math.max(0, S.ocupado - 1);
        limpiarMarcas();
        asignar(claves, veh, vu, pos);
      });
    });
    const bandeja = root.querySelector('[data-soltar-bandeja]');
    if (bandeja) {
      bandeja.addEventListener('dragover', e => { if (arrastre && arrastre.origen) { e.preventDefault(); bandeja.classList.add('soltar-encima'); } });
      bandeja.addEventListener('dragleave', e => { if (!bandeja.contains(e.relatedTarget)) bandeja.classList.remove('soltar-encima'); });
      bandeja.addEventListener('drop', e => {
        if (!arrastre || !arrastre.origen) return;
        e.preventDefault();
        const claves = arrastre.claves; arrastre = null; S.ocupado = Math.max(0, S.ocupado - 1);
        limpiarMarcas(); desasignar(claves);
      });
    }
  }
  function limpiarMarcas() {
    document.querySelectorAll('#rp-root .soltar-encima, #rp-root .marca-antes, #rp-root .marca-despues').forEach(el => el.classList.remove('soltar-encima', 'marca-antes', 'marca-despues'));
  }

  // ── Guardado: mismo endpoint y misma forma que rutas.html (set_asignacion) ──
  function cuerpoAsignacion(p) {
    return { action: 'set_asignacion', clave: p.clave, proyecto_id: p.proyecto_id, tipo: p.tipo, fecha: fechaDe(p),
      vehiculo: vehsDe(p).join(','), conductor: p.conductor || {}, notas: p.notas || '', vuelta: vueltaDe(p), orden: p.orden || 0, cid: CID };
  }
  async function enviar(url, cuerpo) {
    const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok || j.error) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  // Las paradas se ven «Guardando…» hasta que el servidor confirma; si algo falla se
  // vuelve al estado anterior y se recarga lo que de verdad quedó guardado.
  async function guardarCambios(cambiadas, copia, mensajeOk) {
    cambiadas.forEach(p => S.guardando.add(p.clave));
    pintar();
    const resultados = await Promise.allSettled(cambiadas.map(p => enviar('/api/rutas/manual', cuerpoAsignacion(p))));
    cambiadas.forEach(p => S.guardando.delete(p.clave));
    const fallos = resultados.filter(r => r.status === 'rejected');
    if (fallos.length) {
      copia.forEach(c => { const p = S.d.paradas.find(x => x.clave === c.clave); if (p) Object.assign(p, c); });
      pintar();
      toast('No se ha podido guardar (' + fallos[0].reason.message + '). Se muestra lo que hay guardado.', true);
      cargar(true);
      return false;
    }
    pintar();
    toast(mensajeOk);
    return true;
  }
  function copiaDe(lista) { return lista.map(p => ({ clave: p.clave, vehiculo: p.vehiculo, vuelta: p.vuelta, orden: p.orden })); }

  async function asignar(claves, veh, vu, pos) {
    if (!puedeEditar() || !claves.length) return;
    const moviendo = claves.map(c => S.d.paradas.find(p => p.clave === c)).filter(Boolean);
    if (!moviendo.length) return;
    // Paradas con varios vehículos: al moverlas aquí se quedan solo con el vehículo de destino (como en la app antigua)
    const compartidas = moviendo.filter(p => vehsDe(p).length > 1 && !(vehsDe(p).includes(veh) && vueltaDe(p) === vu));
    if (compartidas.length && !confirm(compartidas.map(p => titulo(p) + ' va en ' + vehsDe(p).join(' + ')).join('\n') + '\n\nAl moverla quedará solo en ' + veh + '. ¿Continuar?')) return;
    const dia = fechaDe(moviendo[0]);
    const destino = (((gruposDia(dia)[veh] || {})[vu]) || []).filter(p => !claves.includes(p.clave));
    pos = Math.max(0, Math.min(pos == null ? destino.length : pos, destino.length));
    destino.splice(pos, 0, ...moviendo);
    const afectadas = [...new Set(destino)];
    const copia = copiaDe(afectadas);
    moviendo.forEach(p => { p.vehiculo = veh; p.vuelta = vu; });
    destino.forEach((p, i) => { p.orden = i; });
    // Solo se envían las que cambian de verdad
    const cambiadas = afectadas.filter(p => { const c = copia.find(x => x.clave === p.clave); return c.vehiculo !== p.vehiculo || (parseInt(c.vuelta) || 1) !== p.vuelta || (c.orden || 0) !== p.orden; });
    claves.forEach(c => S.seleccion.delete(c));
    if (!cambiadas.length) { pintar(); return; }
    S.sel = { veh, vu };
    await guardarCambios(cambiadas, copia, moviendo.length > 1 ? moviendo.length + ' paradas asignadas a ' + veh + ' · vuelta ' + vu : 'Asignada a ' + veh + ' · vuelta ' + vu);
  }
  async function desasignar(claves) {
    if (!puedeEditar()) return;
    const ps = claves.map(c => S.d.paradas.find(p => p.clave === c)).filter(p => p && vehsDe(p).length);
    if (!ps.length) return;
    const copia = copiaDe(ps);
    ps.forEach(p => { p.vehiculo = ''; p.vuelta = 1; });
    await guardarCambios(ps, copia, ps.length > 1 ? ps.length + ' paradas devueltas a Sin asignar' : 'Devuelta a Sin asignar');
  }

  // ── Ventanas (asignar, conductores, detalle) ──
  function modal(html, alMontar) {
    cerrarModal();
    const velo = document.createElement('div');
    velo.className = 'rp-modal-velo';
    velo.innerHTML = `<div class="rp-modal g-vidrio" role="dialog" aria-modal="true">${html}</div>`;
    velo.addEventListener('click', e => { if (e.target === velo) cerrarModal(); });
    document.body.appendChild(velo);
    velo.querySelectorAll('[data-cerrar]').forEach(b => b.onclick = cerrarModal);
    document.addEventListener('keydown', escTecla);
    if (alMontar) alMontar(velo);
  }
  function escTecla(e) { if (e.key === 'Escape') cerrarModal(); }
  function cerrarModal() { document.querySelectorAll('.rp-modal-velo').forEach(m => m.remove()); document.removeEventListener('keydown', escTecla); }

  function abrirAsignar(claves) {
    const ps = claves.map(c => S.d.paradas.find(p => p.clave === c)).filter(Boolean);
    if (!ps.length) return;
    const dia = fechaDe(ps[0]);
    const g = gruposDia(dia);
    const vehs = listaVehiculos(g);
    const actual = vehsDe(ps[0])[0] || (S.sel && S.sel.veh) || vehs[0];
    modal(`<header><h3>${ps.length > 1 ? 'Asignar ' + ps.length + ' paradas' : 'Asignar parada'}</h3><button type="button" class="rp-icono" data-cerrar aria-label="Cerrar">✕</button></header>
      <p class="rp-sutil">${ps.length > 1 ? ps.slice(0, 4).map(p => esc(titulo(p))).join('<br>') + (ps.length > 4 ? '<br>…' : '') : esc(titulo(ps[0])) + ' · ' + esc(ps[0].hora || '')}</p>
      <label>Vehículo<select id="rpa-veh">${vehs.map(v => `<option${v === actual ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <label>Vuelta<select id="rpa-vu"></select></label>
      <label>Posición<select id="rpa-pos"></select></label>
      <footer><button type="button" class="rp-btn suave" data-cerrar>Cancelar</button><button type="button" class="rp-btn" id="rpa-ok">Asignar</button></footer>`, velo => {
      const sVeh = velo.querySelector('#rpa-veh'), sVu = velo.querySelector('#rpa-vu'), sPos = velo.querySelector('#rpa-pos');
      const rellenarVu = () => {
        const nums = Object.keys(g[sVeh.value] || {}).map(Number).sort((a, b) => a - b);
        const opciones = nums.length ? nums : [1];
        const nueva = (nums.length ? Math.max(...nums) : 1) + 1;
        const actualVu = sVeh.value === vehsDe(ps[0])[0] ? vueltaDe(ps[0]) : opciones[0];
        sVu.innerHTML = opciones.map(n => `<option value="${n}"${n === actualVu ? ' selected' : ''}>Vuelta ${n}${g[sVeh.value] && g[sVeh.value][n] ? ' (' + g[sVeh.value][n].length + ')' : ''}</option>`).join('') + `<option value="${nueva}">Nueva vuelta (${nueva})</option>`;
        rellenarPos();
      };
      const rellenarPos = () => {
        const lista = ((g[sVeh.value] || {})[Number(sVu.value)] || []).filter(p => !claves.includes(p.clave));
        sPos.innerHTML = `<option value="${lista.length}">Al final</option>` + lista.map((p, i) => `<option value="${i}">Antes de ${i + 1}. ${esc(p.hora || '')} ${esc(titulo(p))}</option>`).join('');
      };
      sVeh.onchange = rellenarVu; sVu.onchange = rellenarPos;
      rellenarVu();
      velo.querySelector('#rpa-ok').onclick = () => { const v = sVeh.value, vu = Number(sVu.value), pos = Number(sPos.value); cerrarModal(); asignar(claves, v, vu, pos); };
    });
  }

  function abrirConductores(veh, vu) {
    const fecha = S.dia;
    const actual = S.d.cond[fecha + '_' + veh + '_' + vu] || {};
    const elegidos = new Set(actual.conductores || []);
    const aus = S.d.ausencias[fecha] || [];
    const ausDe = n => aus.find(a => a.chofer === n);
    const txtAus = a => (a.tipo === 'vacaciones' ? 'de vacaciones' : 'de descanso') + (a.medio ? ' (medio día)' : '');
    const nombres = [...new Set([...S.d.choferes, ...elegidos])];
    modal(`<header><h3>Conductor · ${esc(veh)} · vuelta ${vu}</h3><button type="button" class="rp-icono" data-cerrar aria-label="Cerrar">✕</button></header>
      <p class="rp-sutil">${fechaLarga(fecha)}</p>
      <div class="rp-lista-cond">${nombres.map(n => { const a = ausDe(n); return `<label class="${a ? 'ausente' : ''}"><input type="checkbox" value="${esc(n)}"${elegidos.has(n) ? ' checked' : ''}> ${esc(n)}${a ? ` <em>${txtAus(a)}</em>` : ''}</label>`; }).join('')}</div>
      <label id="rpc-principal-l" style="display:none">Quién conduce<select id="rpc-principal"></select></label>
      <footer><button type="button" class="rp-btn suave" data-cerrar>Cancelar</button><button type="button" class="rp-btn" id="rpc-ok">Guardar</button></footer>`, velo => {
      const sel = () => [...velo.querySelectorAll('.rp-lista-cond input:checked')].map(i => i.value).sort((a, b) => a.localeCompare(b));
      const pintarPrincipal = () => {
        const s = sel(), l = velo.querySelector('#rpc-principal-l'), p = velo.querySelector('#rpc-principal');
        l.style.display = s.length > 1 ? '' : 'none';
        const previo = p.value || actual.conductor;
        p.innerHTML = '<option value="">Sin indicar</option>' + s.map(n => `<option${n === previo ? ' selected' : ''}>${esc(n)}</option>`).join('');
      };
      velo.querySelectorAll('.rp-lista-cond input').forEach(i => i.onchange = pintarPrincipal);
      pintarPrincipal();
      velo.querySelector('#rpc-ok').onclick = async () => {
        const conductores = sel();
        const faltan = conductores.filter(n => !elegidos.has(n) && ausDe(n));
        if (faltan.length && !confirm(faltan.map(n => n + ' está ' + txtAus(ausDe(n))).join('\n') + ' ese día.\n\n¿Lo asignas igualmente?')) return;
        const conductor = conductores.length > 1 ? (velo.querySelector('#rpc-principal').value || null) : null;
        const boton = velo.querySelector('#rpc-ok'); boton.disabled = true; boton.textContent = 'Guardando…';
        try {
          await enviar('/api/rutas/conductores', { action: 'set_conductores', fecha, vehiculo: veh, vuelta: vu, conductores, conductor, cid: CID });
          S.d.cond[fecha + '_' + veh + '_' + vu] = { fecha, vehiculo: veh, vuelta: vu, conductores, conductor };
          cerrarModal(); pintar(); toast('Conductor guardado');
        } catch (e) { boton.disabled = false; boton.textContent = 'Guardar'; toast('No se ha podido guardar: ' + e.message, true); }
      };
    });
  }

  function abrirDetalle(clave) {
    const p = S.d.paradas.find(x => x.clave === clave);
    if (!p) return;
    const e = S.d.estPar[p.clave] || {}, pg = S.d.pago[String(p.proyecto_id)] || {};
    const vehs = vehsDe(p), vu = vueltaDe(p);
    const cond = vehs.map(v => { const c = conductoresDe(fechaDe(p), v, vu); return v + ': ' + (c.length ? c.join(', ') : 'sin conductor'); });
    const fila = (n, v) => v ? `<div class="rp-det-fila"><span>${n}</span><b>${v}</b></div>` : '';
    const si = b => b ? 'Sí' : 'No';
    modal(`<header><h3>${esc(titulo(p))}</h3><button type="button" class="rp-icono" data-cerrar aria-label="Cerrar">✕</button></header>
      <div class="rp-det">
        ${fila('Operación', `<span class="rp-tipo ${tipoClase(p.tipo)}">${tipoCorto(p.tipo)}</span>`)}
        ${fila('Fecha y hora', esc(fechaLarga(fechaDe(p)) + (p.hora ? ' · ' + p.hora : '')))}
        ${fila('Dirección', esc(p.localizacion || 'Sin dirección') + (p.zona_codigo ? ' · ' + esc(p.zona_codigo + ' ' + (p.zona_nombre || '')) : ''))}
        ${fila('Teléfono', pg.telefono ? `<a href="tel:${esc(pg.telefono)}">${esc(pg.telefono)}</a>${pg.telefono_nombre ? ' · ' + esc(pg.telefono_nombre) : ''}` : '')}
        ${fila('Comercial', esc(pg.comercial || ''))}
        ${fila('Vehículo', vehs.length ? esc(vehs.join(' + ')) + ' · vuelta ' + vu : 'Sin asignar')}
        ${fila('Conductor', vehs.length ? esc(cond.join(' · ')) : '')}
        ${fila('Pago', pg.estado_pago ? `<span class="rp-pago ${pg.estado_pago}"></span> ${esc(tituloPago(pg))}` : '')}
        ${fila('Servicios extra', (pg.servicios_extra || []).map(s => esc(s.servicio) + (s.cantidad ? ' × ' + esc(s.cantidad) : '')).join('<br>'))}
        ${fila('Preparado (Almacén)', si(e.preparado))}
        ${fila('Cargado', si(e.cargado))}
        ${pg.tiene_lavanderia ? fila('Lavandería', pg.prep_lavanderia ? 'Preparada' : 'Sin terminar') : ''}
        ${pg.tiene_office ? fila('Office', pg.prep_office ? 'Preparado' : 'Sin terminar') : ''}
        ${fila('Transpalé', (S.d.transpale[claveTranspale(p)] || {}).transpale ? 'Sí' : '')}
        ${fila('Incidencia', e.incidencia ? esc(e.incidencia_texto || 'Sí') : '')}
        ${fila('Notas', esc(p.notas || ''))}
        ${fila('Estado en Rentman', esc(p.estado || ''))}
      </div>
      <footer>${p.google_maps_url ? `<a class="rp-btn suave" href="${esc(p.google_maps_url)}" target="_blank" rel="noopener">Abrir en Google Maps</a>` : ''}
        <a class="rp-btn suave" href="/rutas.html" target="_blank" rel="noopener" title="Notas, checks e incidencias se editan de momento en la app de Rutas">Editar en la app de Rutas ↗</a>
        ${puedeEditar() ? `<button type="button" class="rp-btn" id="rpd-asignar">${vehs.length ? 'Mover' : 'Asignar'}</button>` : ''}</footer>`, velo => {
      const b = velo.querySelector('#rpd-asignar'); if (b) b.onclick = () => { cerrarModal(); abrirAsignar([clave]); };
    });
  }

  // ── Entrada ──
  window.cargarRutasPlan = function () {
    const t = $('content-title'); if (t) t.textContent = 'Rutas';
    $('content-body').innerHTML = '<div class="rp" id="rp-root"></div>';
    if (!S.desde) fijarPeriodo('hoy');
    S.seleccion.clear();
    conectarEventos();
    cargar();
  };
})();
