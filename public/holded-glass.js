/* ================================================================
   ORUM Central · Financiero → Holded (interfaz Liquid Glass)
   20 nov 2026. Solo la abre la interfaz glass (public/glass.js cambia el
   apartado «Holded ↗» por esta pantalla); el diseño clásico sigue abriendo
   /holded.html. NO tiene lógica propia: usa las mismas llamadas que holded.html
   (/api/holded/gastos, /api/holded/pendientes, aceptar, sin-pagar, pago…).
   Resumen · Gastos por aprobar · Pagos pendientes · Ventas (cobros con su forma
   de pago de Caja, facturas, incidencias y «Revisar una factura» con su PDF) ·
   Historial de todo lo volcado (gastos, facturas, cobros) con filtros y CSV.
   Estilos: reutiliza los de Facturas Proveedores (.pv-*, proveedores.css)
   más public/holded-glass.css (.hd-*).
   ================================================================ */
(function () {
  const S = {
    pestana: 'resumen', g: null, p: null, error: null, cargando: false,
    filtro: 'todas', tipo: '', mes: '', buscar: '', plazo: 'todas', ventas: 'cobros', metodoCobro: {},
    abierta: null,          // file_id de la ficha abierta
    borrador: {},           // lo que se va escribiendo en cada factura: { file_id: {campo: valor} }
    enviando: new Set(),    // facturas que se están volcando (no se pintan)
    siguiendo: null, progreso: null, empresa: null
  };

  // ── Utilidades ──
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => parseFloat(v) || 0;
  const eur = v => num(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }) + ' €';
  const eur0 = v => Math.round(num(v)).toLocaleString('es-ES', { useGrouping: 'always' }) + ' €';
  const normal = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const ff = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || '—'); };
  const fh = iso => iso ? new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
  const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
  const masDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const textoMes = m => { const t = MESES[Number(m.slice(5, 7)) - 1] || ''; return t ? t[0].toUpperCase() + t.slice(1) + ' ' + m.slice(0, 4) : m; };
  const PALETA = ['#B8956A', '#5B8DEF', '#2E9D5B', '#C9822B', '#8E6CC9', '#3C8C93', '#C0392B', '#A9A196'];
  const colorDe = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 997; return PALETA[h % PALETA.length]; };
  const iniciales = s => String(s || '?').replace(/[^A-Za-zÁÉÍÓÚÑ0-9 ]/gi, ' ').trim().split(/\s+/).filter(w => w.length > 1 && !/^(SL|SA|SLU|SAU|DE|LA|EL|Y)$/i.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  const avatar = n => `<span class="pv-avatar" style="--c:${colorDe(n)}">${esc(iniciales(n))}</span>`;
  const ico = d => `<svg viewBox="0 0 24 24">${d}</svg>`;
  const I = {
    ok: ico('<path d="m5 12 4.5 4.5L19 7"/>'), alerta: ico('<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/>'),
    lupa: ico('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>'), cerrar: ico('<path d="M6 6l12 12M18 6 6 18"/>'),
    izq: ico('<path d="m15 6-6 6 6 6"/>'), der: ico('<path d="m9 6 6 6-6 6"/>'), externo: ico('<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>'),
    doc: ico('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>'), pago: ico('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>'),
    reloj: ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'), subir: ico('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'),
    girar: ico('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'), venta: ico('<path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6"/>'),
    enlace: ico('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    mas: ico('<path d="M12 5v14M5 12h14"/>'), holdedIco: ico('<path d="M4 4h16v16H4z"/><path d="M8 12l3 3 5-6"/>'), leasing: ico('<path d="M3 17h18M5 17V9l7-4 7 4v8"/><path d="M9 17v-5h6v5"/>')
  };
  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ('Error ' + r.status));
    return d;
  }
  function toast(txt, error) {
    let t = $('pv-toast');
    if (!t) { t = document.createElement('div'); t.id = 'pv-toast'; document.body.appendChild(t); }
    t.textContent = txt; t.className = 'pv-toast visible' + (error ? ' error' : '');
    clearTimeout(t._h); t._h = setTimeout(() => { t.className = 'pv-toast'; }, error ? 6000 : 2600);
  }
  const vivo = () => !!$('hd-root');

  // ── Carga ──
  async function cargar() {
    S.cargando = true; if (!S.g) pintar();
    const [g, p] = await Promise.allSettled([api('GET', '/api/holded/gastos'), api('GET', '/api/holded/pendientes')]);
    if (g.status === 'fulfilled') S.g = g.value; else S.error = g.reason.message;
    if (p.status === 'fulfilled') S.p = p.value;
    S.cargando = false;
    if (!vivo()) return;
    pintar();
    if (S.abierta) pintarFicha();
    if (S.p && S.p.volcando) seguirVolcado();
  }

  // ── Facturas de gastos en una sola lista ──
  // Estados: por_aprobar · sinforma (sin forma de pago) · bloqueada
  function gastos() {
    const g = S.g || {};
    const pa = (g.por_aprobar || []).map(x => ({ ...x, _e: 'por_aprobar' }));
    const sf = (g.pendientes_pago || []).map(x => ({ ...x, _e: 'sinforma' }));
    const bl = (g.pendientes || []).map(x => ({ ...x, _e: 'bloqueada' }));
    return [...pa, ...sf, ...bl].filter(x => !S.enviando.has(x.file_id));
  }
  const ESTADOS = {
    por_aprobar: { n: 'Por aprobar', c: 'e-holded' }, sinforma: { n: 'Sin forma de pago', c: 'e-sinpago' }, bloqueada: { n: 'Bloqueada', c: 'e-revisar' }
  };
  const ETIQUETAS = {
    leasing: { n: 'Leasing', f: x => !!x.reparto }, abono: { n: 'Abono', f: x => !!x.es_abono },
    sinpagar: { n: 'Sin pagar', f: x => !!x.sin_pagar }, dudas: { n: 'Con dudas', f: x => !!x.dudas },
    nuevo: { n: 'Sin cuenta habitual', f: x => x._e === 'por_aprobar' && !x.reparto && !x.cuenta_habitual }
  };
  const etiquetasDe = x => Object.entries(ETIQUETAS).filter(([, e]) => e.f(x)).map(([k, e]) => `<span class="hd-etq t-${k}">${e.n}</span>`).join('');
  const mesDe = x => String(x.fecha || '').slice(0, 7);
  function filtrados() {
    let l = gastos();
    if (S.filtro !== 'todas') l = l.filter(x => x._e === S.filtro);
    if (S.tipo) l = l.filter(ETIQUETAS[S.tipo].f);
    if (S.mes) l = l.filter(x => mesDe(x) === S.mes);
    if (S.buscar) {
      const b = normal(S.buscar), bn = b.replace(',', '.');
      l = l.filter(x => normal(x.proveedor).includes(b) || normal(x.numero).includes(b) || normal(x.concepto).includes(b) || String(x.total).includes(bn));
    }
    return l;
  }

  // ── Cuentas ──
  const cuentas = () => (S.g && S.g.cuentas) || [];
  const etiquetaCuenta = n => { if (!n) return ''; const c = cuentas().find(x => String(x.numero) === String(n)); return n + (c ? ' ' + c.nombre : ''); };
  const numeroDe = v => { const m = /^(\d{8})\b/.exec(String(v || '').trim()); return m && cuentas().some(c => String(c.numero) === m[1]) ? m[1] : ''; };
  const CREAR = '➕ Crear cuenta nueva';
  const datalist = () => `<datalist id="hd-dl-cuentas"><option id="hd-dl-crear" value="${CREAR}"></option>${cuentas().map(c => `<option value="${esc(c.numero + ' ' + c.nombre)}"></option>`).join('')}</datalist>`;

  // ── Borrador por factura (lo escrito no se pierde al recargar) ──
  const B = id => (S.borrador[id] = S.borrador[id] || {});
  window.hdCampo = (id, campo, el) => {
    B(id)[campo] = el.type === 'checkbox' ? el.checked : el.value;
    if (campo === 'sinPagar') { const pp = $('hd-pago-' + cssId(id)); if (pp) pp.style.display = el.checked ? 'none' : ''; }
    if (campo === 'cuenta') marcarHabitual(id);
    if (campo.startsWith('rep_')) sumaReparto(id);
  };
  const cssId = id => String(id).replace(/[^A-Za-z0-9_-]/g, '_');

  // ── Pintado general ──
  function pintar() {
    const root = $('hd-root'); if (!root) return;
    const g = S.g || {}, p = S.p || {};
    const nPA = (g.por_aprobar || []).length, nPagar = (g.pagar_en_holded || []).length;
    const nCobros = (p.cobros || []).filter(c => c.estado === 'sin_clasificar').length;
    const pest = [['resumen', 'Resumen', 0], ['gastos', 'Gastos por aprobar', nPA], ['pagos', 'Pagos pendientes', nPagar], ['ventas', 'Ventas', nCobros], ['historial', 'Historial', 0]];
    const cab = `
      <div class="pv-barra">
        <div class="pv-pestanas g-vidrio">${pest.map(([k, n, c]) => `<button class="pv-pestana ${S.pestana === k ? 'activa' : ''}" onclick="hdIr('${k}')">${n}${c ? ` <span class="hd-cuenta">${c}</span>` : ''}</button>`).join('')}</div>
        <div class="pv-acciones">
          <button class="pv-boton g-vidrio" onclick="hdRecargar()" title="Volver a cargar">${I.girar}</button>
          <button class="pv-boton g-vidrio" onclick="window.open('/holded.html','_blank')" title="La pantalla de Holded de siempre">Pantalla clásica ${I.externo}</button>
        </div>
      </div>`;
    let cuerpo;
    if (!S.g && S.cargando) cuerpo = '<div class="pv-panel g-vidrio pv-vacio">Cargando Holded…</div>';
    else if (!S.g && S.error) cuerpo = `<div class="pv-panel g-vidrio pv-vacio rojo">No se ha podido cargar: ${esc(S.error)}</div>`;
    else cuerpo = ({ resumen: vistaResumen, gastos: vistaGastos, pagos: vistaPagos, ventas: vistaVentas, historial: vistaHistorial })[S.pestana]();
    // El foco y el cursor del buscador se conservan al repintar
    const foco = document.activeElement && document.activeElement.id === 'hd-buscar' ? document.activeElement.selectionStart : null;
    // La animación de entrada solo al cambiar de pestaña (no en cada filtro o tecla)
    const entra = S.pintada !== S.pestana; S.pintada = S.pestana;
    root.innerHTML = cab + `<div class="pv-cuerpo${entra ? '' : ' hd-quieto'}">${cuerpo}</div>` + datalist();
    if (foco !== null) { const b = $('hd-buscar'); if (b) { b.focus(); b.setSelectionRange(foco, foco); } }
    animar(root);
  }
  function animar(root) {
    requestAnimationFrame(() => requestAnimationFrame(() => root.querySelectorAll('[data-ancho]').forEach(b => { b.style.width = b.dataset.ancho; })));
    root.querySelectorAll('[data-cuenta]').forEach(el => {
      const fin = Number(el.dataset.cuenta), dec = el.dataset.dec === '1', t0 = performance.now();
      const paso = t => { const q = Math.min(1, (t - t0) / 700), v = fin * (1 - Math.pow(1 - q, 3)); el.textContent = dec ? eur0(v) : Math.round(v).toLocaleString('es-ES'); if (q < 1) requestAnimationFrame(paso); };
      requestAnimationFrame(paso);
    });
  }

  // ── Resumen ──
  function vistaResumen() {
    const g = S.g || {}, p = S.p || {};
    const pa = g.por_aprobar || [], pagar = g.pagar_en_holded || [];
    const vencidas = pagar.filter(x => x.vencimiento && x.vencimiento < hoy());
    const avisos = (g.pendientes || []).length + (p.modificadas || []).length + (p.descuadres || []).length + (p.compensaciones || []).length;
    const kpi = (k, titulo, cifra, dec, sub, accion, ic) => `
      <button class="pv-pend g-vidrio ${cifra ? 'hay' : 'cero'} k-${k}" onclick="${accion}">
        <span class="pv-pend-ico">${cifra ? ic : I.ok}</span>
        <span><strong data-cuenta="${Math.round(cifra)}" ${dec ? 'data-dec="1"' : ''}>${dec ? eur0(cifra) : cifra}</strong><b>${titulo}</b><small>${sub}</small></span></button>`;
    const totalPA = pa.reduce((s, x) => s + num(x.total), 0), totalPagar = pagar.reduce((s, x) => s + num(x.total), 0);
    const kpis = `<div class="pv-pendientes hd-kpis">
      ${kpi('holded', 'Gastos por aprobar', pa.length, false, pa.length ? eur(totalPA) + ' en total' : 'Todo aprobado', "hdIr('gastos','por_aprobar')", I.doc)}
      ${kpi('sinpago', 'Pendiente de pago en Holded', totalPagar, true, pagar.length ? `${pagar.length} facturas${vencidas.length ? ` · <b class="rojo">${vencidas.length} vencidas</b>` : ''}` : 'Nada pendiente', "hdIr('pagos')", I.pago)}
      ${kpi('venta', 'Ventas por volcar', (p.facturas || []).length + (p.cobros || []).length, false, S.p ? `${(p.facturas || []).length} facturas · ${(p.cobros || []).length} cobros${(p.cobros || []).some(c => c.estado === 'sin_clasificar') ? ` · <b class="rojo">${p.cobros.filter(c => c.estado === 'sin_clasificar').length} sin forma de pago</b>` : ''}` : 'Cargando…', "hdIr('ventas','cobros')", I.venta)}
      ${kpi('revisar', 'Avisos', avisos, false, avisos ? [(g.pendientes || []).length && `${(g.pendientes || []).length} gastos bloqueados`, (p.modificadas || []).length && `${p.modificadas.length} cambiadas en Rentman`, (p.descuadres || []).length && `${p.descuadres.length} descuadres`, (p.compensaciones || []).length && `${p.compensaciones.length} compensaciones`].filter(Boolean).join(' · ') : 'Sin avisos', (g.pendientes || []).length ? "hdIr('gastos','bloqueada')" : "hdIr('ventas','incidencias')", I.alerta)}
    </div>`;
    // Volcado de ventas
    const ejecs = p.ejecuciones || [];
    const pr = S.progreso;
    const barra = pr && pr.total ? `<div class="hd-progreso"><div><b>${esc({ preparando: 'Preparando…', facturas: 'Facturas', 'preparando cobros': 'Preparando cobros…', cobros: 'Cobros' }[pr.fase] || pr.fase || '')}</b> · ${pr.hecho} / ${pr.total}${pr.actual ? ` <span class="pv-sutil">nº ${esc(pr.actual)}</span>` : ''}</div><div class="pv-bh-pista ancha"><i style="background:var(--g-champ)" data-ancho="${Math.round(100 * pr.hecho / pr.total)}%"></i></div></div>` : '';
    const listaEj = (lista, gastos) => `<div class="hd-lista-ej">${lista.length ? lista.slice(0, 4).map(e => {
        const r = e.resumen || {};
        const txt = gastos ? `${r.compras_por_aprobar != null ? r.compras_por_aprobar + ' por aprobar' : (r.compras_enviadas || 0) + ' compras'}${r.compras_bloqueadas ? ' · ' + r.compras_bloqueadas + ' bloqueadas' : ''}` : `${r.facturas_enviadas || 0} facturas · ${r.cobros_enviados || 0} cobros${r.facturas_bloqueadas ? ' · ' + r.facturas_bloqueadas + ' bloqueadas' : ''}`;
        return `<div class="hd-ej"><span class="hd-punto ${!e.fin ? 'curso' : e.ok ? 'ok' : 'mal'}"></span><span>${fh(e.inicio)}</span><span class="pv-sutil">${/^auto/.test(e.origen) ? 'automático' : (e.usuario ? esc(e.usuario) : 'manual')}</span><span>${e.fin ? txt : 'en curso'}</span></div>`;
      }).join('') : '<p class="pv-sutil">Sin importaciones todavía.</p>'}</div>`;
    const cifras = l => `<div class="hd-mini-cifras">${l.map(([n, v, rojo]) => `<div><small>${n}</small><strong class="${rojo && v ? 'rojo' : ''}">${v}</strong></div>`).join('')}</div>`;
    const sinForma = (p.cobros || []).filter(c => c.estado === 'sin_clasificar').length;
    const volcado = `<div class="pv-panel g-vidrio hd-tarjeta-imp">
      <h3>Facturas de Venta ${p.volcando ? '<span class="pv-estado e-sinpago">Importando</span>' : ''}</h3>
      ${cifras([['Facturas pendientes', (p.facturas || []).length], ['Cobros pendientes', (p.cobros || []).length], ['Sin forma de pago', sinForma, true], ['Incidencias', (p.modificadas || []).length + (p.descuadres || []).length + (p.compensaciones || []).length, true]])}
      ${listaEj(ejecs.filter(e => !/gastos/.test(e.origen)), false)}
      ${barra}
      <div class="hd-acciones-linea hd-pie-imp">
        <button class="pv-boton prim" onclick="hdVolcar()" ${p.volcando ? 'disabled' : ''}>${I.subir}Importar</button>
        <label class="hd-check"><input type="checkbox" id="hd-incluir-hoy"> incluir lo de hoy</label>
      </div>
    </div>`;
    // Próximos vencimientos
    const prox = [...pagar].sort((a, b) => String(a.vencimiento || '9999').localeCompare(String(b.vencimiento || '9999'))).slice(0, 6);
    const venc = `<div class="pv-panel g-vidrio"><h3>Próximos pagos <button class="pv-enlace" onclick="hdIr('pagos')">Ver todos →</button></h3>
      ${prox.length ? prox.map(x => `<button class="pv-fila-c hd-fila-venc" onclick="hdIr('pagos')">${avatar(x.proveedor)}<span class="pv-fc-txt"><b>${esc(x.proveedor)}</b><small>Nº ${esc(x.numero || '—')}</small></span>
        <span class="pv-fc-fecha ${x.vencimiento && x.vencimiento < hoy() ? 'rojo' : ''}">${x.vencimiento ? 'vence ' + ff(x.vencimiento) : 'sin vencimiento'}</span><strong>${eur(x.total)}</strong></button>`).join('') : '<p class="pv-sutil">Nada pendiente de pago.</p>'}</div>`;
    // Gastos: preparar y conexión
    const gastosP = `<div class="pv-panel g-vidrio hd-tarjeta-imp">
      <h3>Facturas de Compra ${g.volcando ? '<span class="pv-estado e-sinpago">Importando</span>' : ''}</h3>
      ${cifras([['Por aprobar', pa.length], ['Sin forma de pago', (g.pendientes_pago || []).length], ['Bloqueadas', (g.pendientes || []).length, true], ['En Holded', g.total_enviadas || 0]])}
      ${listaEj(ejecs.filter(e => /gastos/.test(e.origen)), true)}
      <div class="hd-acciones-linea hd-pie-imp">
        <button class="pv-boton prim" onclick="hdPreparar(this)" ${g.volcando ? 'disabled' : ''}>${I.subir}Importar</button>
      </div>
    </div>`;
    const conexion = `<div class="pv-panel g-vidrio"><h3>Conexión con Holded</h3>
      ${S.empresa ? (S.empresa.error ? `<p class="rojo">${esc(S.empresa.error)}</p>` : `<p style="margin:0 0 6px">Empresa: <b>${esc(S.empresa.empresa || '—')}</b></p>
        <p class="${S.empresa.todo_listo ? '' : 'rojo'}" style="margin:0 0 6px">${S.empresa.todo_listo ? '✔ Cuentas y tesorerías de ventas y cobros creadas' : 'Faltan cuentas o tesorerías en Holded'}</p>
        <p class="pv-sutil" style="margin:0">Corte: ${ff(S.empresa.fecha_corte)} · ${S.empresa.total_cuentas_holded} cuentas · cuentas de gasto ${S.empresa.gastos_faltan && S.empresa.gastos_faltan.length ? `<b class="rojo">faltan ${S.empresa.gastos_faltan.length}</b>` : 'todas creadas'}</p>`)
        : ''}
      <button class="pv-mini" style="margin-top:10px" onclick="hdEmpresa(this)">${I.enlace}Comprobar conexión</button></div>`;
    return kpis + `<div class="pv-rejilla dos">${volcado}${gastosP}</div><div class="pv-rejilla dos">${venc}${conexion}</div>`;
  }

  // ── Gastos por aprobar ──
  function vistaGastos() {
    const todas = gastos();
    const lista = filtrados();
    const cuenta = e => todas.filter(x => x._e === e).length;
    const chips = [['todas', 'Todas', todas.length], ['por_aprobar', 'Por aprobar', cuenta('por_aprobar')], ['sinforma', 'Sin forma de pago', cuenta('sinforma')], ['bloqueada', 'Bloqueadas', cuenta('bloqueada')]];
    const meses = [...new Set(todas.map(mesDe).filter(Boolean))].sort().reverse();
    const total = lista.reduce((s, x) => s + num(x.total), 0);
    const filas = lista.map(x => {
      const est = ESTADOS[x._e];
      const cta = x._e === 'por_aprobar' ? (x.reparto ? '<span class="pv-sutil">Reparto leasing</span>' : esc(etiquetaCuenta(B(x.file_id).cuenta !== undefined ? numeroDe(B(x.file_id).cuenta) || '' : x.cuenta_propuesta)) || '<span class="pv-sutil">Sin cuenta</span>') : (x._e === 'bloqueada' ? `<span class="rojo">${esc(x.error || '')}</span>` : '<span class="pv-sutil">Asignar forma de pago</span>');
      return `<tr class="${S.abierta === x.file_id ? 'sel' : ''}" onclick="hdAbrir('${esc(x.file_id)}')">
        <td><div class="pv-celda-prov">${avatar(x.proveedor)}<span><b>${esc(x.proveedor)}</b><small>${esc(x.concepto || ('Nº ' + (x.numero || '—')))}</small></span></div></td>
        <td><b class="pv-num">${esc(x.numero || '—')}</b><small class="pv-sutil">${ff(x.fecha)}</small></td>
        <td><span class="pv-estado ${est.c}">${est.n}</span> ${etiquetasDe(x)}</td>
        <td class="hd-celda-cta">${cta}</td>
        <td class="pv-sutil">${esc(x.forma_pago || (x.sin_pagar ? 'Sin pagar' : '—'))}</td>
        <td class="n"><b>${x.total != null ? eur(x.total) : '—'}</b>${x.base != null ? `<small class="pv-sutil">${eur(x.base)} + IVA</small>` : ''}</td></tr>`;
    }).join('');
    return `
      <div class="pv-filtros">
        <div class="pv-chips">${chips.map(([k, n, c]) => `<button class="pv-chip ${S.filtro === k ? 'activo' : ''}" onclick="hdFiltro('${k}')">${n} <em>${c}</em></button>`).join('')}</div>
        <label class="pv-buscar g-vidrio">${I.lupa}<input id="hd-buscar" placeholder="Proveedor, nº, concepto o importe" value="${esc(S.buscar)}" oninput="hdBuscar(this.value)"></label>
      </div>
      <div class="pv-filtros">
        <div class="pv-chips">${Object.entries(ETIQUETAS).map(([k, e]) => { const n = todas.filter(e.f).length; return n ? `<button class="pv-chip hd-chip-t ${S.tipo === k ? 'activo' : ''}" onclick="hdTipo('${k}')">${e.n} <em>${n}</em></button>` : ''; }).join('')}</div>
        <select class="hd-select g-vidrio" onchange="hdMes(this.value)"><option value="">Todos los meses</option>${meses.map(m => `<option value="${m}" ${S.mes === m ? 'selected' : ''}>${textoMes(m)}</option>`).join('')}</select>
      </div>
      <div class="pv-panel g-vidrio pv-tabla-panel">
        <div class="pv-tabla-cab"><span>${lista.length} facturas${S.filtro !== 'todas' || S.tipo || S.mes || S.buscar ? ' con este filtro' : ''}</span><b>${eur(total)}</b></div>
        <div class="pv-tabla-wrap"><table class="pv-tabla"><thead><tr><th>Proveedor</th><th>Nº · fecha</th><th>Estado</th><th>Cuenta</th><th>Pago</th><th class="n">Total</th></tr></thead>
        <tbody>${filas || `<tr><td colspan="6" class="pv-vacio">${todas.length ? 'Nada con este filtro.' : '✔ No hay facturas de gastos pendientes.'}</td></tr>`}</tbody></table></div>
      </div>`;
  }

  // ── Ficha de una factura de gastos ──
  // Lo propio de Holded de una factura de compra: cuenta, fechas, pago, reparto
  // y Aceptar (por aprobar), asignar pago (sin forma de pago) o corregir (bloqueada).
  // enPv: va dentro de la ficha de Facturas Proveedores (no repite concepto ni importes).
  function datosGasto(x, enPv) {
    const id = x.file_id, cid = cssId(id), b = B(id), g = S.g || {};
    const val = (k, def) => b[k] !== undefined ? b[k] : def;
    let datos;
    if (x._e === 'por_aprobar') {
      const ctaDef = etiquetaCuenta(x.cuenta_propuesta);
      const sage = (x.sage || []).slice(0, 5);
      const reparto = x.reparto ? `<h4>${I.leasing}Leasing ${esc(x.reparto.contrato || '')}${x.reparto.bien ? ' · ' + esc(x.reparto.bien) : ''}</h4>
        ${x.reparto.contrato_existe ? '' : '<div class="pv-dudas">Contrato nuevo: al aceptar se crean sus cuentas 524 (amortización) y 625 (seguro). Si ya existen, búscalas.</div>'}
        <div class="hd-reparto">${x.reparto.lineas.map((l, k) => `<label class="pv-campo"><span>${({ amortizacion: 'Amortización', intereses: 'Intereses', seguro: 'Seguro', otros: 'Otros' })[l.tipo]}</span>
          <input list="hd-dl-cuentas" placeholder="nueva: se crea" value="${esc(val('rep_c' + k, etiquetaCuenta(l.cuenta)))}" onfocus="hdFocoCuenta(this)" oninput="hdCuentaInput(this,'${esc(id)}','rep_c${k}')"></label>
          <label class="pv-campo"><span>Importe</span><input class="n" value="${esc(val('rep_i' + k, String(l.importe).replace('.', ',')))}" oninput="hdCampo('${esc(id)}','rep_i${k}',this)"></label>`).join('')}</div>
        <div class="pv-sutil" id="hd-suma-${cid}"></div>`
        : `<h4>Cuenta de gasto</h4>
        <label class="pv-campo ancho"><input id="hd-cta-${cid}" list="hd-dl-cuentas" placeholder="Buscar cuenta: nº o nombre…" value="${esc(val('cuenta', ctaDef))}" onfocus="hdFocoCuenta(this)" oninput="hdCuentaInput(this,'${esc(id)}','cuenta')"></label>
        ${!x.cuenta_habitual ? '<div class="pv-sutil">Proveedor sin cuenta habitual</div>' : ''}
        <label class="hd-check" id="hd-hab-${cid}" style="display:none"><input type="checkbox" ${val('habitual', false) ? 'checked' : ''} onchange="hdCampo('${esc(id)}','habitual',this)"> usar siempre para este proveedor</label>
        ${sage.length > 1 ? `<div class="hd-sage">En Sage usaba: ${sage.map(s => `<button class="pv-dep" onclick="hdElegirCuenta('${esc(id)}','${s.cuenta}')" title="${s.apuntes} apuntes en 2026">${s.cuenta} ${esc(s.nombre)}</button>`).join('')}</div>` : ''}`;
      const tes = (g.tesorerias_pago || []), tesDef = (g.tesoreria_por_forma || {})[x.forma_pago] || '';
      const sinPagar = !!x.sin_pagar || !!val('sinPagar', false);
      const pago = x.sin_pagar ? `<div class="hd-aviso-sp"><span class="hd-etq t-sinpagar">Sin pagar</span> Entra en Holded pendiente de pago${x.vencimiento ? ' · vence ' + ff(val('vencimiento', x.vencimiento)) : ''}.</div>`
        : `<label class="hd-check"><input type="checkbox" ${val('sinPagar', false) ? 'checked' : ''} onchange="hdCampo('${esc(id)}','sinPagar',this)"> Aún no está ${x.es_abono ? 'cobrado' : 'pagada'} (entra en Holded pendiente de pago)</label>
          <div class="pv-campos" id="hd-pago-${cid}" style="${sinPagar ? 'display:none' : ''}">
            <label class="pv-campo"><span>${x.es_abono ? 'Devuelto el' : 'Pagada el'} · ${esc(x.forma_pago || '')}</span><input type="date" value="${esc(val('pagoFecha', x.fecha || ''))}" onchange="hdCampo('${esc(id)}','pagoFecha',this)"></label>
            <label class="pv-campo"><span>Desde</span><select onchange="hdCampo('${esc(id)}','pagoTesoreria',this)">${tesDef ? '' : '<option value="">— elegir —</option>'}${tes.map(t => `<option value="${t.key}" ${val('pagoTesoreria', tesDef) === t.key ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select></label>
          </div>`;
      datos = `
        ${!enPv && x.concepto ? `<p class="pv-concepto">${esc(x.concepto)}</p>` : ''}
        ${!enPv && x.dudas ? `<div class="pv-dudas">${I.alerta}<span>${esc(x.dudas)}</span></div>` : ''}
        ${x.error ? `<div class="pv-dudas rojo">${I.alerta}<span>${esc(x.error)}</span></div>` : ''}
        ${enPv ? '' : `<div class="hd-importes"><div><small>Base</small><b>${eur(x.base)}</b></div><div><small>IVA ${x.tipos && x.tipos.length ? x.tipos.join(' / ') + ' %' : ''}</small><b>${eur(x.iva)}</b></div>${x.retencion ? `<div><small>Retención</small><b>−${eur(x.retencion)}</b></div>` : ''}<div><small>Total</small><b>${eur(x.total)}</b></div></div>`}
        <h4>Fechas en Holded</h4>
        <div class="pv-campos">
          <label class="pv-campo"><span>Fecha factura</span><input type="date" value="${esc(val('fecha', x.fecha || ''))}" onchange="hdCampo('${esc(id)}','fecha',this)"></label>
          <label class="pv-campo"><span>Vencimiento</span><input type="date" value="${esc(val('vencimiento', x.vencimiento || ''))}" onchange="hdCampo('${esc(id)}','vencimiento',this)"></label>
        </div>
        ${reparto}
        <h4>Pago</h4>${pago}
        <div class="pv-ficha-pie">
          <button class="pv-boton prim" onclick="hdAceptar('${esc(id)}')">${I.ok}Aceptar y volcar a Holded</button>
          <button class="pv-boton g-vidrio" onclick="hdReintentar('${esc(id)}',true)" title="Vuelve a leer el PDF con Claude">${I.girar}Releer</button>
        </div>`;
    } else if (x._e === 'sinforma') {
      datos = `<div class="pv-dudas">Esta factura no tiene forma de pago en Facturas Proveedores: no se vuelca hasta saber cómo se pagó, o hasta volcarla sin pagar.</div>
        <div class="hd-importes"><div><small>Fecha</small><b>${ff(x.fecha)}</b></div><div><small>Total</small><b>${x.total != null ? eur(x.total) : '—'}</b></div></div>
        <h4>Ya está pagada</h4>
        <div class="hd-acciones-linea"><select class="hd-select" id="hd-fp-${cid}"><option value="">— forma de pago —</option>${(g.formas_pago || []).map(v => `<option>${esc(v)}</option>`).join('')}</select>
          <button class="pv-boton prim" onclick="hdAsignarPago('${esc(id)}')">${I.pago}Asignar y pasar a Por aprobar</button></div>
        <h4>Aún no está pagada</h4>
        <div class="hd-acciones-linea"><button class="pv-boton g-vidrio" onclick="hdSinPagar('${esc(id)}')">Volcar sin pagar</button><span class="pv-sutil">Pasa a Por aprobar y entra en Holded pendiente de pago.</span></div>`;
    } else {
      datos = bloqueadaHtml(x);
    }
    return datos;
  }
  // (20 nov 2026, pedido por el usuario) La ficha es la de Facturas Proveedores
  // (visor con zoom, proveedor, nº, importes, pago, vehículo, notas) con un
  // bloque «Holded» arriba y las flechas para ir a la siguiente.
  const fichaPv = () => typeof window.pvAbrirDesdeFuera === 'function';
  window.pvFichaExtra = fileId => {
    if (!vivo() || S.abierta !== fileId) return '';
    const x = gastos().find(y => y.file_id === fileId); if (!x) return '';
    const est = ESTADOS[x._e];
    return `<section class="hd-bloque-holded"><h3>${I.holdedIco}Holded <span class="pv-estado ${est.c}">${est.n}</span> ${etiquetasDe(x)}</h3>${datosGasto(x, true)}</section>`;
  };
  window.pvFichaNav = fileId => {
    if (!vivo() || S.abierta !== fileId) return '';
    const lista = filtrados(), pos = lista.findIndex(y => y.file_id === fileId);
    return `<span class="hd-nav"><button class="pv-flecha" ${pos > 0 ? '' : 'disabled'} onclick="hdMover(-1)" title="Anterior (←)">${I.izq}</button><span class="pv-sutil">${pos + 1} / ${lista.length}</span><button class="pv-flecha" ${pos >= 0 && pos < lista.length - 1 ? '' : 'disabled'} onclick="hdMover(1)" title="Siguiente (→)">${I.der}</button></span>`;
  };
  window.pvFichaDespues = fileId => {
    if (!vivo() || S.abierta !== fileId) return;
    const x = gastos().find(y => y.file_id === fileId); if (!x || x._e !== 'por_aprobar') return;
    if (x.reparto) sumaReparto(fileId); else marcarHabitual(fileId);
  };
  window.pvFichaAlCerrar = () => { if (vivo() && S.abierta) { S.abierta = null; pintar(); } };
  function pintarFicha() {
    if (fichaPv()) {
      const pvF = $('pv-ficha');
      if (!S.abierta || !gastos().some(y => y.file_id === S.abierta)) { S.abierta = null; if (pvF) window.pvCerrar(); return; }
      window.pvAbrirDesdeFuera(S.abierta, S.pvRecargar).then(ok => {
        if (!ok && S.abierta) { // no está en Facturas Proveedores: ficha propia
          const fichaVieja = window.pvAbrirDesdeFuera; window.pvAbrirDesdeFuera = null; pintarFicha(); window.pvAbrirDesdeFuera = fichaVieja;
        }
      });
      S.pvRecargar = false;
      return;
    }
    let cont = $('hd-ficha');
    const x = gastos().find(y => y.file_id === S.abierta);
    if (!S.abierta || !x) { if (cont) cont.remove(); S.abierta = null; return; }
    const nueva = !cont;
    if (nueva) {
      cont = document.createElement('div'); cont.id = 'hd-ficha'; cont.className = 'pv-ficha-fondo';
      cont.onclick = e => { if (e.target === cont) hdCerrar(); };
      document.body.appendChild(cont);
    }
    const lista = filtrados(), pos = lista.findIndex(y => y.file_id === x.file_id);
    const id = x.file_id, cid = cssId(id);
    const visorPrevio = cont.querySelector('.hd-visor-marco[data-id="' + cid + '"]');
    const datos = datosGasto(x, false);
    const est = ESTADOS[x._e];
    const cabecera = `<header>${avatar(x.proveedor)}<div><small>${x.es_abono ? 'Abono' : 'Factura'} ${esc(x.numero || '')} · ${ff(x.fecha)} · <span class="pv-estado ${est.c}">${est.n}</span> ${etiquetasDe(x)}</small><h2>${esc(x.proveedor)}</h2></div>
        <strong>${x.total != null ? eur(x.total) : ''}</strong>
        <span class="hd-nav"><button class="pv-flecha" ${pos > 0 ? '' : 'disabled'} onclick="hdMover(-1)" title="Anterior">${I.izq}</button><span class="pv-sutil">${pos + 1} / ${lista.length}</span><button class="pv-flecha" ${pos < lista.length - 1 ? '' : 'disabled'} onclick="hdMover(1)" title="Siguiente">${I.der}</button></span>
        <button class="pv-flecha" onclick="hdCerrar()" title="Cerrar">${I.cerrar}</button></header>`;
    if (visorPrevio) {
      // Misma factura: solo se cambian cabecera y datos; el PDF no se recarga
      // (moverlo lo recargaría y su enlace firmado caduca al minuto).
      cont.querySelector('.pv-ficha header').outerHTML = cabecera;
      cont.querySelector('.pv-datos').innerHTML = datos;
    } else {
      cont.innerHTML = `<aside class="pv-ficha g-vidrio">${cabecera}
      <div class="pv-ficha-cuerpo">
        <div class="pv-visor"><div class="pv-visor-barra"><span class="pv-sutil">${esc(x.nombre_archivo || '')}</span><button class="pv-mini" style="margin-left:auto" onclick="window.open('${esc(x.pdf_url || '/api/facturas-proveedores/' + encodeURIComponent(id) + '/archivo')}','_blank')">Abrir en otra pestaña ${I.externo}</button></div>
          <div class="pv-visor-marco hd-visor-marco" data-id="${cid}"><div class="pv-vacio">Cargando la factura…</div></div></div>
        <div class="pv-datos">${datos}</div>
      </div></aside>`;
      cargarVisor(id);
    }
    if (nueva) requestAnimationFrame(() => cont.classList.add('visible')); else cont.classList.add('visible');
    if (x._e === 'por_aprobar') { if (x.reparto) sumaReparto(id); else marcarHabitual(id); }
  }
  async function cargarVisor(id) {
    const marco = document.querySelector('.hd-visor-marco[data-id="' + cssId(id) + '"]'); if (!marco) return;
    let info = { url: '/api/facturas-proveedores/' + encodeURIComponent(id) + '/archivo', mime: '' };
    try { const r = await fetch(info.url + '?info=1'); if (r.ok) info = await r.json(); } catch (e) { /* se usa el enlace directo */ }
    const m2 = document.querySelector('.hd-visor-marco[data-id="' + cssId(id) + '"]'); if (!m2) return;
    m2.innerHTML = /^image\//.test(info.mime || '') ? `<div class="pv-img-caja hd-img"><img alt="Factura" src="${esc(info.url)}" onclick="this.classList.toggle('zoom')"></div>` : `<iframe title="Factura" src="${esc(info.url)}#view=FitH"></iframe>`;
  }
  function marcarHabitual(id) {
    const x = gastos().find(y => y.file_id === id), el = $('hd-hab-' + cssId(id)); if (!x || !el) return;
    const v = B(id).cuenta !== undefined ? numeroDe(B(id).cuenta) : String(x.cuenta_propuesta || '');
    el.style.display = v && v !== String(x.cuenta_habitual || '') ? '' : 'none';
  }
  function lineasReparto(id) {
    const x = gastos().find(y => y.file_id === id), b = B(id);
    return x.reparto.lineas.map((l, k) => {
      const c = b['rep_c' + k] !== undefined ? b['rep_c' + k] : String(l.cuenta || '');
      const i = b['rep_i' + k] !== undefined ? b['rep_i' + k] : String(l.importe);
      return { tipo: l.tipo, cuenta: (String(c).trim().match(/^\d+/) || [''])[0], importe: numES(i) };
    });
  }
  const numES = v => { const s = String(v || '').trim().replace(/[€\s]/g, ''); return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0; };
  function sumaReparto(id) {
    const x = gastos().find(y => y.file_id === id), box = $('hd-suma-' + cssId(id)); if (!x || !box || !x.reparto) return;
    const s = Math.round(lineasReparto(id).reduce((a, l) => a + l.importe, 0) * 100) / 100;
    box.innerHTML = `Suma ${eur(s)} · base ${eur(x.base)} ${Math.abs(s - x.base) < 0.005 ? '<b style="color:#23804A">✔ cuadra</b>' : '<b class="rojo">no cuadra</b>'}`;
  }

  // ── Buscador de cuentas con «Crear cuenta nueva» ──
  let campoCrear = null, valorAntes = '';
  window.hdFocoCuenta = el => { valorAntes = el.value; el.select(); };
  window.hdCuentaInput = (el, id, campo) => {
    const op = $('hd-dl-crear');
    if (el.value.includes(CREAR)) {
      const escrito = el.value.split(CREAR)[0].replace(/·\s*$/, '').trim();
      el.value = valorAntes; if (op) op.value = CREAR;
      campoCrear = { el, id, campo }; abrirCrear(escrito); return;
    }
    const t = el.value.trim(); if (op) op.value = t ? t + '  ·  ' + CREAR : CREAR;
    hdCampo(id, campo, el);
  };
  window.hdElegirCuenta = (id, n) => { const el = $('hd-cta-' + cssId(id)); if (el) { el.value = etiquetaCuenta(n); hdCampo(id, 'cuenta', el); } };
  function abrirCrear(escrito) {
    let d = $('hd-dlg');
    if (!d) {
      d = document.createElement('div'); d.id = 'hd-dlg'; d.className = 'hd-dlg-fondo';
      d.innerHTML = `<div class="hd-dlg g-vidrio"><h3>Crear cuenta de gasto nueva</h3>
        <label class="pv-campo"><span>Número (grupo 6, 8 cifras) — escribe el principio, p. ej. 629</span><input id="hd-cc-num" inputmode="numeric" maxlength="8" placeholder="629" oninput="hdNumCuenta()"></label>
        <div id="hd-cc-sig" class="pv-sutil"></div>
        <label class="pv-campo"><span>Nombre</span><input id="hd-cc-nom" placeholder="SUSCRIPCIONES SOFTWARE" onkeydown="if(event.key==='Enter')hdCrearCuenta()"></label>
        <div class="pv-sutil">Se guarda en Config. Cuentas de gasto y se crea también en Holded.</div>
        <div id="hd-cc-res" class="pv-sutil"></div>
        <div class="pv-ficha-pie"><button class="pv-boton prim" id="hd-cc-ok" onclick="hdCrearCuenta()">Crear y elegir</button><button class="pv-boton g-vidrio" onclick="hdCerrarCrear()">Cancelar</button></div></div>`;
      d.onclick = e => { if (e.target === d) hdCerrarCrear(); };
      document.body.appendChild(d);
    }
    const n = (escrito.match(/\d+/) || [''])[0];
    $('hd-cc-num').value = n; $('hd-cc-nom').value = escrito.replace(/\d+/g, '').trim().toUpperCase();
    $('hd-cc-sig').innerHTML = ''; $('hd-cc-res').textContent = '';
    d.classList.add('visible');
    if (n.length >= 3 && n.length <= 7) siguienteLibre(n, true);
    (n.length === 8 ? $('hd-cc-nom') : $('hd-cc-num')).focus();
  }
  window.hdCerrarCrear = () => { const d = $('hd-dlg'); if (d) d.classList.remove('visible'); };
  let tSig = null;
  window.hdNumCuenta = () => {
    const v = $('hd-cc-num').value.replace(/\D/g, ''); clearTimeout(tSig);
    if (v.length < 3 || v.length > 7) { $('hd-cc-sig').innerHTML = ''; return; }
    tSig = setTimeout(() => siguienteLibre(v, false), 300);
  };
  async function siguienteLibre(pref, rellenar) {
    const box = $('hd-cc-sig'); box.textContent = 'Buscando el siguiente libre…';
    try {
      const r = await api('GET', '/api/cuentas-gasto/siguiente?prefijo=' + encodeURIComponent(pref));
      if (!rellenar && $('hd-cc-num').value.replace(/\D/g, '') !== pref) return;
      const ult = r.ultima ? 'última: ' + r.ultima + ' ' + esc((cuentas().find(c => c.numero === r.ultima) || {}).nombre || '') : 'no hay ninguna todavía';
      if (rellenar) { $('hd-cc-num').value = r.numero; box.innerHTML = `Siguiente libre de ${pref} (${ult})`; }
      else box.innerHTML = `<button class="pv-enlace" onclick="document.getElementById('hd-cc-num').value='${r.numero}';this.parentNode.textContent='Siguiente libre de ${pref}'">Usar ${r.numero}</button> (siguiente libre; ${ult})`;
      if (!r.comprobado_holded) box.innerHTML += ' · <span class="rojo">no se pudo consultar Holded</span>';
    } catch (e) { box.innerHTML = `<span class="rojo">${esc(e.message)}</span>`; }
  }
  window.hdCrearCuenta = async () => {
    const res = $('hd-cc-res'), btn = $('hd-cc-ok');
    const numero = $('hd-cc-num').value.replace(/\D/g, ''), nombre = $('hd-cc-nom').value.trim().toUpperCase();
    if (!/^6\d{7}$/.test(numero)) { res.innerHTML = '<span class="rojo">El número tiene que ser del grupo 6 y de 8 cifras</span>'; return; }
    if (!nombre) { res.innerHTML = '<span class="rojo">Escribe el nombre de la cuenta</span>'; return; }
    const ya = cuentas().find(c => String(c.numero) === numero);
    if (!ya) {
      btn.disabled = true; res.textContent = 'Creando en ORUM y en Holded…';
      try {
        const r = await api('POST', '/api/cuentas-gasto', { lineas: [{ numero, nombre }] });
        S.g.cuentas.push({ numero: Number(numero), nombre, activa: true }); S.g.cuentas.sort((a, b) => a.numero - b.numero);
        const dl = $('hd-dl-cuentas'); if (dl) { const o = document.createElement('option'); o.value = numero + ' ' + nombre; dl.appendChild(o); }
        if ((r.errores_holded || []).length) toast('Guardada en ORUM; Holded dio un error (se reintentará al aceptar): ' + r.errores_holded.join(' · '), true);
      } catch (e) { res.innerHTML = `<span class="rojo">${esc(e.message)}</span>`; btn.disabled = false; return; }
      btn.disabled = false;
    } else toast('La cuenta ' + numero + ' ya existía: queda elegida');
    if (campoCrear) { campoCrear.el.value = etiquetaCuenta(numero); hdCampo(campoCrear.id, campoCrear.campo, campoCrear.el); }
    hdCerrarCrear();
  };

  // ── Acciones de gastos ──
  window.hdAceptar = async id => {
    const x = gastos().find(y => y.file_id === id); if (!x) return;
    const b = B(id), g = S.g || {};
    let cuenta = '', reparto = null, detalle;
    if (x.reparto) {
      reparto = lineasReparto(id);
      const s = Math.round(reparto.reduce((a, l) => a + l.importe, 0) * 100) / 100;
      if (Math.abs(s - x.base) >= 0.005) { toast(`El reparto suma ${eur(s)} y la base es ${eur(x.base)}: corrígelo`, true); return; }
      detalle = reparto.map(l => `  ${l.tipo}: ${l.cuenta || 'cuenta nueva'} · ${eur(l.importe)}`).join('\n');
    } else {
      cuenta = b.cuenta !== undefined ? numeroDe(b.cuenta) : String(x.cuenta_propuesta || '');
      if (!cuenta) { toast(b.cuenta ? 'Esa cuenta no está en el plan: elígela de la lista o créala' : 'Elige la cuenta de gasto', true); return; }
      detalle = 'Cuenta: ' + etiquetaCuenta(cuenta);
    }
    const fecha = b.fecha !== undefined ? b.fecha : (x.fecha || ''), vencimiento = b.vencimiento !== undefined ? b.vencimiento : (x.vencimiento || '');
    if (!fecha) { toast('Falta la fecha de la factura', true); return; }
    if (vencimiento && vencimiento < fecha) { toast('El vencimiento es anterior a la fecha de la factura', true); return; }
    const sinPagar = !!x.sin_pagar || !!b.sinPagar;
    let pagoFecha = '', pagoTesoreria = '', textoPago;
    if (sinPagar) textoPago = 'SIN PAGAR: queda pendiente de pago' + (vencimiento ? ' (vence ' + ff(vencimiento) + ')' : '');
    else {
      pagoFecha = b.pagoFecha !== undefined ? b.pagoFecha : (x.fecha || '');
      pagoTesoreria = b.pagoTesoreria !== undefined ? b.pagoTesoreria : ((g.tesoreria_por_forma || {})[x.forma_pago] || '');
      if (!pagoFecha) { toast('Indica la fecha en que se pagó', true); return; }
      if (!pagoTesoreria) { toast('Elige desde dónde se pagó', true); return; }
      textoPago = 'Pago: ' + ff(pagoFecha) + ' desde ' + (((g.tesorerias_pago || []).find(t => t.key === pagoTesoreria) || {}).nombre || pagoTesoreria);
    }
    if (!confirm(`Se volcará a Holded APROBAD${x.es_abono ? 'O el abono' : 'A la factura'} ${x.numero || ''} de ${x.proveedor} (${eur(x.total)}).\n${detalle}\n${textoPago}\nUna compra aprobada en Holded no se puede borrar, solo rectificar. ¿Aceptar?`)) return;
    // Se pasa a la siguiente al momento; la fila vuelve si Holded da error.
    const lista = filtrados(), pos = lista.findIndex(y => y.file_id === id);
    const sig = lista[pos + 1] || lista[pos - 1] || null;
    S.enviando.add(id); S.abierta = sig ? sig.file_id : null; S.pvRecargar = true; pintar(); pintarFicha();
    toast('Volcando a Holded ' + x.proveedor + ' ' + (x.numero || '') + '…');
    let r;
    try { r = await api('POST', '/api/holded/gastos/' + encodeURIComponent(id) + '/aceptar', { cuenta, guardarHabitual: !!b.habitual, fecha, vencimiento, pagoFecha, pagoTesoreria, reparto, sinPagar }); }
    catch (e) { r = { estado: 'error', motivo: e.message }; }
    S.enviando.delete(id);
    if (r.estado === 'aprobada') { delete S.borrador[id]; toast(`✔ ${x.proveedor} ${x.numero || ''} en Holded${r.sin_pagar ? ', pendiente de pago' : r.pagada ? ' y pagada' : ''}${r.aviso ? ' · ' + r.aviso : ''}`, !!r.aviso); }
    else toast(`✖ ${x.proveedor} ${x.numero || ''}: ${r.motivo || r.estado}`, true);
    await cargar();
  };
  window.hdReintentar = async (id, releer) => {
    toast(releer ? 'Releyendo el PDF…' : 'Reintentando…');
    try { const r = await api('POST', '/api/holded/gastos/' + encodeURIComponent(id) + '/reintentar', { releer }); toast(r.estado === 'por_aprobar' ? '✔ Lista para aprobar' : 'Queda ' + r.estado + (r.motivo ? ': ' + r.motivo : ''), r.estado !== 'por_aprobar'); }
    catch (e) { toast(e.message, true); }
    await cargar();
  };
  window.hdAsignarPago = async id => {
    const v = ($('hd-fp-' + cssId(id)) || {}).value; if (!v) { toast('Elige la forma de pago', true); return; }
    try { const r = await api('POST', '/api/holded/gastos/' + encodeURIComponent(id) + '/forma-pago', { formaPago: v }); toast(r.estado === 'por_aprobar' ? '✔ Pago asignado: pasa a Por aprobar' : 'Queda ' + r.estado + (r.motivo ? ': ' + r.motivo : ''), r.estado !== 'por_aprobar'); }
    catch (e) { toast(e.message, true); }
    await cargar();
  };
  window.hdSinPagar = async id => {
    try { const r = await api('POST', '/api/holded/gastos/' + encodeURIComponent(id) + '/sin-pagar'); toast(r.estado === 'por_aprobar' ? '✔ Pasa a Por aprobar marcada SIN PAGAR' : 'Queda ' + r.estado + (r.motivo ? ': ' + r.motivo : ''), r.estado !== 'por_aprobar'); }
    catch (e) { toast(e.message, true); }
    await cargar();
  };
  window.hdPreparar = async btn => {
    btn.disabled = true; toast('Importando facturas de compra… puede tardar unos minutos');
    try { const r = await api('POST', '/api/holded/gastos/volcar'); const s = r.resumen || {}; toast(r.motivo || `${s.compras_por_aprobar || 0} por aprobar · ${s.compras_pendientes_pago || 0} sin forma de pago · ${s.compras_bloqueadas || 0} bloqueadas`, !r.ok); }
    catch (e) { toast(e.message, true); }
    await cargar();
  };

  // ── Pagos pendientes en Holded ──
  function vistaPagos() {
    const g = S.g || {}, h = hoy(), todas = g.pagar_en_holded || [];
    const plazos = { vencidas: x => x.vencimiento && x.vencimiento < h, semana: x => x.vencimiento && x.vencimiento >= h && x.vencimiento <= masDias(h, 7), mes: x => x.vencimiento && x.vencimiento >= h && x.vencimiento <= masDias(h, 31), todas: () => true };
    const nombres = [['vencidas', 'Vencidas'], ['semana', 'Esta semana'], ['mes', 'Próximos 30 días'], ['todas', 'Todas']];
    let lista = todas.filter(plazos[S.plazo]);
    if (S.buscar) { const b = normal(S.buscar); lista = lista.filter(x => normal(x.proveedor).includes(b) || normal(x.numero).includes(b) || String(x.total).includes(b.replace(',', '.'))); }
    const total = lista.reduce((s, x) => s + num(x.total), 0), totalV = todas.filter(plazos.vencidas).reduce((s, x) => s + num(x.total), 0);
    const tes = g.tesorerias_pago || [];
    const filas = lista.map(x => {
      const id = x.file_id, b = B('pago:' + id), venc = x.vencimiento && x.vencimiento < h;
      const forma = b.forma !== undefined ? b.forma : (x.forma_pago || ''), tesSel = b.tes !== undefined ? b.tes : ((g.tesoreria_por_forma || {})[forma] || '');
      return `<tr>
        <td><div class="pv-celda-prov">${avatar(x.proveedor)}<span><b>${x.es_abono ? '<span class="hd-etq t-abono">Abono</span> ' : ''}${esc(x.proveedor)}</b><small>Nº ${esc(x.numero || '—')} · ${ff(x.fecha)} · <a href="${esc(x.pdf_url)}" target="_blank" onclick="event.stopPropagation()">PDF</a></small></span></div></td>
        <td class="${venc ? 'rojo' : ''}"><b>${x.vencimiento ? ff(x.vencimiento) : '—'}</b>${venc ? '<small>vencida</small>' : ''}</td>
        <td class="n"><b>${eur(x.total)}</b></td>
        <td><div class="hd-pago-linea">
          <select class="hd-select" onchange="hdPagoCampo('${esc(id)}','forma',this)"><option value="">— forma —</option>${(g.formas_pago || []).map(v => `<option ${v === forma ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
          <input type="date" class="hd-select" value="${esc(b.fecha !== undefined ? b.fecha : h)}" onchange="hdPagoCampo('${esc(id)}','fecha',this)">
          <select class="hd-select" id="hd-pt-${cssId(id)}" onchange="hdPagoCampo('${esc(id)}','tes',this)"><option value="">— desde —</option>${tes.map(t => `<option value="${t.key}" ${t.key === tesSel ? 'selected' : ''}>${esc(t.nombre)}</option>`).join('')}</select>
          <button class="pv-boton prim" onclick="hdRegistrarPago('${esc(id)}',this)">${I.pago}Registrar pago</button></div></td></tr>`;
    }).join('');
    return `
      <div class="pv-kpis hd-kpis-pago">
        <div class="pv-kpi g-vidrio grande"><small>Pendiente de pago en Holded</small><strong data-cuenta="${Math.round(todas.reduce((s, x) => s + num(x.total), 0))}" data-dec="1">${eur0(todas.reduce((s, x) => s + num(x.total), 0))}</strong><span class="pv-sutil">${todas.length} facturas</span></div>
        <div class="pv-kpi g-vidrio"><small>Vencido</small><strong class="${totalV ? 'rojo' : ''}" data-cuenta="${Math.round(totalV)}" data-dec="1">${eur0(totalV)}</strong><span class="pv-sutil">${todas.filter(plazos.vencidas).length} facturas</span></div>
        <div class="pv-kpi g-vidrio"><small>Vence esta semana</small><strong data-cuenta="${Math.round(todas.filter(plazos.semana).reduce((s, x) => s + num(x.total), 0))}" data-dec="1">${eur0(todas.filter(plazos.semana).reduce((s, x) => s + num(x.total), 0))}</strong><span class="pv-sutil">${todas.filter(plazos.semana).length} facturas</span></div>
      </div>
      <div class="pv-filtros">
        <div class="pv-chips">${nombres.map(([k, n]) => `<button class="pv-chip ${S.plazo === k ? 'activo' : ''}" onclick="hdPlazo('${k}')">${n} <em>${todas.filter(plazos[k]).length}</em></button>`).join('')}</div>
        <label class="pv-buscar g-vidrio">${I.lupa}<input id="hd-buscar" placeholder="Proveedor, nº o importe" value="${esc(S.buscar)}" oninput="hdBuscar(this.value)"></label>
      </div>
      <div class="pv-panel g-vidrio pv-tabla-panel">
        <div class="pv-tabla-cab"><span>${lista.length} facturas</span><b>${eur(total)}</b></div>
        <div class="pv-tabla-wrap"><table class="pv-tabla hd-tabla-pagos"><thead><tr><th>Proveedor</th><th>Vence</th><th class="n">Total</th><th>Registrar el pago</th></tr></thead>
        <tbody>${filas || `<tr><td colspan="4" class="pv-vacio">${todas.length ? 'Nada con este filtro.' : 'No hay facturas pendientes de pago en Holded. Al aceptar un gasto con «Aún no está pagada» aparece aquí.'}</td></tr>`}</tbody></table></div>
      </div>`;
  }
  window.hdPagoCampo = (id, campo, el) => {
    B('pago:' + id)[campo] = el.value;
    if (campo === 'forma') { const t = ((S.g || {}).tesoreria_por_forma || {})[el.value], st = $('hd-pt-' + cssId(id)); if (t && st) { st.value = t; B('pago:' + id).tes = t; } }
  };
  window.hdRegistrarPago = async (id, btn) => {
    const g = S.g || {}, x = (g.pagar_en_holded || []).find(y => y.file_id === id); if (!x) return;
    const b = B('pago:' + id);
    const formaPago = b.forma !== undefined ? b.forma : (x.forma_pago || ''), pagoFecha = b.fecha !== undefined ? b.fecha : hoy();
    const pagoTesoreria = b.tes !== undefined ? b.tes : ((g.tesoreria_por_forma || {})[formaPago] || '');
    if (!formaPago) { toast('Elige la forma de pago', true); return; }
    if (!pagoFecha) { toast('Indica la fecha del pago', true); return; }
    if (!pagoTesoreria) { toast('Elige desde dónde se pagó', true); return; }
    const nomTes = ((g.tesorerias_pago || []).find(t => t.key === pagoTesoreria) || {}).nombre || pagoTesoreria;
    if (!confirm(`Se registrará en Holded el ${x.es_abono ? 'cobro del abono' : 'pago de la factura'} ${x.numero || ''} de ${x.proveedor} (${eur(x.total)}).\n${formaPago} · ${ff(pagoFecha)} desde ${nomTes}\n¿Registrar?`)) return;
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/holded/gastos/' + encodeURIComponent(id) + '/pago', { formaPago, pagoFecha, pagoTesoreria });
      if (r.ok) { delete S.borrador['pago:' + id]; toast(`✔ Pago registrado en Holded (${eur(r.importe)})${r.aviso ? ' · ' + r.aviso : ''}`, !!r.aviso); await cargar(); }
      else { toast('✖ ' + (r.motivo || 'No se ha podido registrar'), true); btn.disabled = false; }
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };

  // ── Ventas: cobros (forma de pago en Caja), facturas e incidencias ──
  const ESTADO_COBRO = {
    sin_clasificar: { n: 'Sin forma de pago', c: 'e-sinpago' }, listo: { n: 'Listo para volcar', c: 'e-holded' },
    sin_cuenta: { n: 'No se vuelca', c: 'e-revisar' }, sin_tesoreria: { n: 'Falta tesorería', c: 'e-revisar' }, modificado: { n: 'Cambiado en Caja', c: 'e-revisar' }
  };
  const ESTADO_FACTURA = { sin_procesar: 'Por volcar', bloqueada: 'Bloqueada', borrador: 'En borrador', error: 'Error' };
  function vistaVentas() {
    const p = S.p || {};
    if (!S.p) return '<div class="pv-panel g-vidrio pv-vacio">Cargando ventas…</div>';
    const cobros = p.cobros || [], facturas = p.facturas || [];
    const incid = (p.modificadas || []).length + (p.descuadres || []).length + (p.compensaciones || []).length;
    const sinMetodo = cobros.filter(c => c.estado === 'sin_clasificar').length;
    const chips = [['cobros', 'Cobros pendientes', cobros.length], ['facturas', 'Facturas pendientes', facturas.length], ['incidencias', 'Incidencias', incid], ['revisar', 'Revisar una factura', '']];
    const b = normal(S.buscar), coincide = (...v) => !b || v.some(x => normal(x).includes(b) || String(x).includes(b.replace(',', '.')));
    const metodos = p.metodos_caja || [], nombreMetodo = id => ((metodos.find(m => m.id === id) || {}).nombre) || id || '—';
    let cuerpo;
    if (S.ventas === 'revisar') cuerpo = vistaRevisar();
    else if (S.ventas === 'cobros') {
      const orden = c => c.estado === 'sin_clasificar' ? 0 : 1;
      const lista = cobros.filter(c => coincide(c.cliente, c.numero_factura, c.importe)).sort((a, x) => orden(a) - orden(x) || String(a.fecha).localeCompare(String(x.fecha)));
      const filas = lista.map(c => {
        const k = c.pago_id + '_' + (c.split_idx || 1), est = ESTADO_COBRO[c.estado] || { n: c.estado, c: '' };
        const elegido = S.metodoCobro[k] !== undefined ? S.metodoCobro[k] : (c.metodo || '');
        const partido = cobros.some(o => o.pago_id === c.pago_id && (o.split_idx || 1) > 1);
        const editable = p.puede_asignar_caja && c.estado !== 'modificado' && !partido;
        const opciones = metodos.map(m => `<option value="${m.id}" ${m.id === elegido ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('');
        const selector = editable
          ? `<div class="hd-pago-linea"><select class="hd-select" onchange="hdMetodoCobro('${k}',this.value)"><option value="">— forma de pago —</option>${opciones}</select>
             ${elegido && elegido !== c.metodo ? `<button class="pv-boton prim" onclick="hdAsignarCaja(${Number(c.pago_id)},'${k}',this)">${I.ok}Guardar en Caja</button>` : ''}</div>`
          : `<b>${esc(nombreMetodo(c.metodo))}</b>${p.puede_asignar_caja ? '<small class="pv-sutil">Pago partido o ya en Holded: se cambia en Caja</small>' : ''}`;
        return `<tr class="hd-clic ${c.estado === 'sin_clasificar' ? 'hd-fila-aviso' : ''} ${S.va && S.va.numero === String(c.numero_factura) ? 'sel' : ''}" onclick="hdVentaAbrir('${esc(c.numero_factura)}')">
          <td><div class="pv-celda-prov">${avatar(c.cliente || '?')}<span><b>${esc(c.cliente || '—')}</b><small>Factura ${esc(c.numero_factura)} · cobro ${esc(c.pago_id)}${(c.split_idx || 1) > 1 ? '/' + c.split_idx : ''} · <button class="pv-enlace" onclick="hdVer('/api/holded/venta/${esc(c.numero_factura)}/archivo','Factura ${esc(c.numero_factura)} · ${esc(String(c.cliente || '').replace(/'/g, ''))}')">ver factura</button></small></span></div></td>
          <td>${ff(c.fecha)}</td><td class="n"><b>${eur(c.importe)}</b></td>
          <td><span class="pv-estado ${est.c}">${est.n}</span>${c.motivo && c.estado !== 'sin_clasificar' ? `<small class="pv-sutil">${esc(c.motivo)}</small>` : ''}</td>
          <td onclick="event.stopPropagation()">${selector}</td></tr>`;
      }).join('');
      const nota = p.puede_asignar_caja
        ? 'La forma de pago se guarda en Caja (igual que desde la app de Caja). El cobro llega a Holded en el próximo volcado (6:00) o con «Volcar ahora» en el Resumen.'
        : 'Solo María y Sergio pueden asignar la forma de pago en Caja.';
      cuerpo = `<div class="pv-panel g-vidrio pv-tabla-panel">
        <div class="pv-tabla-cab"><span>${lista.length} cobros${sinMetodo ? ` · <b class="rojo">${sinMetodo} sin forma de pago en Caja</b>` : ''}</span><b>${eur(lista.reduce((s, c) => s + num(c.importe), 0))}</b></div>
        <div class="hd-nota">${nota}</div>
        <div class="pv-tabla-wrap"><table class="pv-tabla hd-tabla-pagos"><thead><tr><th>Cliente · factura</th><th>Fecha</th><th class="n">Importe</th><th>Estado</th><th>Forma de pago en Caja</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="5" class="pv-vacio">✔ Ningún cobro pendiente.</td></tr>'}</tbody></table></div></div>`;
    } else if (S.ventas === 'facturas') {
      const lista = facturas.filter(x => coincide(x.cliente, x.numero, x.total));
      const filas = lista.map(x => `<tr class="hd-clic ${S.va && S.va.numero === String(x.numero) ? 'sel' : ''}" onclick="hdVentaAbrir('${esc(x.numero)}')"><td><div class="pv-celda-prov">${avatar(x.cliente || '?')}<span><b>${esc(x.cliente || '—')}</b><small>Factura ${esc(x.numero)}</small></span></div></td><td>${ff(x.fecha)}</td><td class="n"><b>${eur(x.total)}</b></td>
          <td><span class="pv-estado ${x.estado === 'sin_procesar' ? 'e-holded' : 'e-revisar'}">${esc(ESTADO_FACTURA[x.estado] || x.estado)}</span></td><td class="${x.estado === 'sin_procesar' ? 'pv-sutil' : 'rojo'}" style="font-size:12px">${esc(x.motivo || '')}</td></tr>`).join('');
      cuerpo = `<div class="pv-panel g-vidrio pv-tabla-panel">
        <div class="pv-tabla-cab"><span>${lista.length} facturas</span><b>${eur(lista.reduce((s, x) => s + num(x.total), 0))}</b></div>
        <div class="pv-tabla-wrap"><table class="pv-tabla hd-tabla-pagos"><thead><tr><th>Cliente · factura</th><th>Fecha</th><th class="n">Total</th><th>Estado</th><th>Motivo</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="5" class="pv-vacio">✔ Ninguna factura pendiente.</td></tr>'}</tbody></table></div></div>`;
    } else {
      const panel = (titulo, texto, cab, filas) => `<div class="pv-panel g-vidrio"><h3>${titulo}</h3><p class="pv-sutil" style="margin:-6px 0 10px">${texto}</p><div class="pv-tabla-wrap"><table class="pv-tabla hd-tabla-pagos"><thead><tr>${cab}</tr></thead><tbody>${filas}</tbody></table></div></div>`;
      const bloques = [];
      if ((p.modificadas || []).length) bloques.push(panel('Cambiadas en Rentman después de volcarlas', 'Holded no se entera: corrígelo con una rectificativa en Rentman o a mano en Holded.',
        '<th>Factura</th><th>Cliente</th><th class="n">En Holded</th><th class="n">En Rentman</th>',
        p.modificadas.map(m => `<tr class="hd-clic" onclick="hdVentaAbrir('${esc(m.numero)}')"><td>${esc(m.numero)}</td><td>${esc(m.cliente)}</td><td class="n">${eur(m.total_enviado)}</td><td class="n">${eur(m.total_rentman)}</td></tr>`).join('')));
      if ((p.descuadres || []).length) bloques.push(panel('Descuadre de céntimos con Rentman', 'Holded redondeó el IVA de otra forma: aunque se cobre entera, quedará esa diferencia pendiente.',
        '<th>Factura</th><th>Cliente</th><th class="n">En Holded</th><th class="n">En Rentman</th><th class="n">Diferencia</th>',
        p.descuadres.map(m => `<tr class="hd-clic" onclick="hdVentaAbrir('${esc(m.numero)}')"><td>${esc(m.numero)}</td><td>${esc(m.cliente)}</td><td class="n">${eur(m.total_holded)}</td><td class="n">${eur(m.total_rentman)}</td><td class="n rojo">${eur(m.diferencia)}</td></tr>`).join('')));
      if ((p.compensaciones || []).length) bloques.push(panel('Compensaciones descuadradas', 'Los cobros «Factura 0 €» y «Rectificativa» de cada cliente tienen que sumar 0: falta la otra mitad o está mal clasificada en Caja.',
        '<th>Cliente</th><th>Facturas (cobro · importe)</th><th class="n">Descuadre</th>',
        p.compensaciones.map(k => `<tr><td>${esc(k.cliente)}</td><td style="font-size:12px">${k.lineas.map(l => `<button class="pv-enlace" onclick="hdVentaAbrir('${esc(l.numero_factura)}')">${esc(l.numero_factura)}</button> (${esc(l.pago_id)} · ${eur(l.importe)})`).join(', ')}</td><td class="n rojo">${eur(k.neto)}</td></tr>`).join('')));
      cuerpo = bloques.join('') || '<div class="pv-panel g-vidrio pv-vacio">✔ Sin incidencias de ventas.</div>';
    }
    const buscador = !['incidencias', 'revisar'].includes(S.ventas) ? `<label class="pv-buscar g-vidrio">${I.lupa}<input id="hd-buscar" placeholder="Cliente, nº de factura o importe" value="${esc(S.buscar)}" oninput="hdBuscar(this.value)"></label>` : '';
    return `<div class="pv-filtros">
        <div class="pv-chips">${chips.map(([k, n, c]) => `<button class="pv-chip ${S.ventas === k ? 'activo' : ''}" onclick="hdVentas('${k}')">${n}${c !== '' ? ` <em>${c}</em>` : ''}</button>`).join('')}</div>
        ${buscador}
      </div>` + cuerpo;
  }
  window.hdMetodoCobro = (k, v) => { S.metodoCobro[k] = v; pintar(); };
  window.hdAsignarCaja = async (pagoId, k, btn) => {
    const metodo = S.metodoCobro[k]; if (!metodo) return;
    const c = ((S.p || {}).cobros || []).find(x => String(x.pago_id) === String(pagoId));
    const nombre = (((S.p || {}).metodos_caja || []).find(m => m.id === metodo) || {}).nombre || metodo;
    if (c && c.metodo && !confirm(`El cobro de ${c.cliente || ''} (factura ${c.numero_factura}, ${eur(c.importe)}) tenía «${c.metodo}» en Caja. ¿Cambiarlo a «${nombre}»?`)) return;
    btn.disabled = true;
    try {
      await api('POST', '/api/holded/cobros/' + encodeURIComponent(pagoId) + '/metodo-caja', { metodo });
      delete S.metodoCobro[k];
      toast(`✔ Guardado en Caja: ${nombre}`);
      try { S.p = await api('GET', '/api/holded/pendientes'); } catch (e) { /* se ve en la próxima carga */ }
      if (vivo()) pintar();
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };

  // ── Historial de lo volcado a Holded ──
  async function cargarHistorial(forzar) {
    if (S.h && !forzar) return;
    S.hCargando = true; if (vivo() && S.pestana === 'historial') pintar();
    try { S.h = await api('GET', '/api/holded/historial'); S.hError = null; } catch (e) { S.hError = e.message; }
    S.hCargando = false; if (vivo() && S.pestana === 'historial') pintar();
  }
  const NOMBRE_METODO = { 'efectivo-marbella': 'Efectivo Marbella', 'tpv-marbella': 'TPV Marbella', 'efectivo-monda': 'Efectivo Monda', 'tpv-monda': 'TPV Monda', transferencia: 'Transferencia', factura0: 'Factura 0 €', rectificativa: 'Rectificativa' };
  function vistaHistorial() {
    if (!S.h) return S.hError ? `<div class="pv-panel g-vidrio pv-vacio rojo">No se ha podido cargar: ${esc(S.hError)}</div>` : '<div class="pv-panel g-vidrio pv-vacio">Cargando el historial…</div>';
    const H = S.h, F = S.hf;
    const tipos = [['gastos', 'Gastos', H.gastos.length], ['facturas', 'Facturas de venta', H.facturas.length], ['cobros', 'Cobros', H.cobros.length]];
    const b = normal(S.buscar), coincide = (...v) => !b || v.some(x => normal(x).includes(b) || String(x).includes(b.replace(',', '.')));
    const enRango = f => (!F.desde || String(f || '') >= F.desde) && (!F.hasta || String(f || '') <= F.hasta);
    let lista, cab, filas, extraFiltro = '';
    if (F.tipo === 'gastos') {
      const ctas = [...new Set(H.gastos.map(x => x.cuenta).filter(Boolean))].sort();
      extraFiltro = `<select class="hd-select g-vidrio" onchange="hdHF('cuenta',this.value)"><option value="">Todas las cuentas</option>${ctas.map(c => `<option value="${c}" ${String(F.cuenta) === String(c) ? 'selected' : ''}>${esc(etiquetaCuenta(c))}</option>`).join('')}</select>
        <select class="hd-select g-vidrio" onchange="hdHF('pago',this.value)"><option value="">Pagadas y sin pagar</option><option value="pagada" ${F.pago === 'pagada' ? 'selected' : ''}>Pagadas</option><option value="sinpagar" ${F.pago === 'sinpagar' ? 'selected' : ''}>Pendientes de pago</option></select>`;
      lista = H.gastos.filter(x => enRango(x.fecha) && coincide(x.proveedor, x.numero, x.total) && (!F.cuenta || String(x.cuenta) === String(F.cuenta) || (x.reparto || []).some(l => String(l.cuenta) === String(F.cuenta))) && (!F.pago || (F.pago === 'sinpagar' ? x.sin_pagar : !x.sin_pagar)));
      cab = '<th>Proveedor</th><th>Nº · fecha</th><th>Cuenta</th><th>Pago</th><th>Aprobada</th><th class="n">Total</th>';
      filas = lista.map(x => `<tr class="hd-clic" onclick="hdVer('${esc(x.pdf_url)}','${esc(String(x.proveedor).replace(/'/g, ''))} · ${esc(x.numero || '')}')" title="Ver la factura">
        <td><div class="pv-celda-prov">${avatar(x.proveedor)}<span><b>${x.es_abono ? '<span class="hd-etq t-abono">Abono</span> ' : ''}${esc(x.proveedor)}</b><small>${I.doc} Ver factura</small></span></div></td>
        <td><b class="pv-num">${esc(x.numero || '—')}</b><small class="pv-sutil">${ff(x.fecha)}</small></td>
        <td class="hd-celda-cta">${x.reparto ? x.reparto.map(l => `<small>${esc(etiquetaCuenta(l.cuenta))} · ${eur(l.importe)}</small>`).join('') : esc(etiquetaCuenta(x.cuenta))}</td>
        <td>${x.sin_pagar ? '<span class="hd-etq t-sinpagar">Sin pagar</span>' : `<span class="pv-sutil">${esc(x.forma_pago || '—')}${x.pago_fecha ? ' · ' + ff(x.pago_fecha) : ''}</span>`}</td>
        <td><span class="pv-sutil">${esc(x.aprobado_por || '')}${x.aprobado_en ? ' · ' + fh(x.aprobado_en) : ''}</span>${x.estado === 'borrador' ? ' <span class="pv-estado e-sinpago">Borrador</span>' : ''}${x.aviso ? `<small class="pv-sutil" title="${esc(x.aviso)}">⚠ ${esc(x.aviso.slice(0, 60))}${x.aviso.length > 60 ? '…' : ''}</small>` : ''}</td>
        <td class="n"><b>${eur(x.total)}</b></td></tr>`).join('');
    } else if (F.tipo === 'facturas') {
      lista = H.facturas.filter(x => enRango(x.fecha) && coincide(x.cliente, x.numero, x.total));
      const sinPdf = H.facturas.filter(x => !x.pdf_adjunto).length, ap = S.pdfVentas;
      extraFiltro = ap && !ap.fin ? `<span class="pv-sutil">Adjuntando PDFs a Holded: ${ap.hecho} / ${ap.total}…</span>`
        : sinPdf ? `<button class="pv-boton g-vidrio" onclick="hdAdjuntarPdfs(${sinPdf})" title="Adjunta en Holded el PDF de Rentman de las facturas ya volcadas que no lo tienen">${I.subir}Adjuntar PDF a ${sinPdf} sin PDF</button>` : '';
      cab = '<th>Cliente</th><th>Factura · fecha</th><th>Estado</th><th>PDF en Holded</th><th>Enviada</th><th class="n">Total</th>';
      filas = lista.map(x => `<tr class="hd-clic ${S.va && S.va.numero === String(x.numero) ? 'sel' : ''}" onclick="hdVentaAbrir('${esc(x.numero)}')">
        <td><div class="pv-celda-prov">${avatar(x.cliente || '?')}<span><b>${esc(x.cliente || '—')}</b><small>${x.tipo === 'C' ? 'Rectificativa' : 'Factura'}</small></span></div></td>
        <td><b class="pv-num">${esc(x.numero)}</b><small class="pv-sutil">${ff(x.fecha)}</small></td>
        <td><span class="pv-estado ${x.estado === 'aprobada' ? 'e-ok' : 'e-sinpago'}">${x.estado === 'aprobada' ? 'Aprobada' : 'Borrador'}</span>${x.total_holded != null && Math.abs(x.total_holded - Math.abs(x.total)) >= 0.01 ? '<small class="rojo">Descuadre de céntimos</small>' : ''}</td>
        <td>${x.pdf_adjunto ? '<span class="hd-ok-linea">' + I.ok + ' Sí</span>' : '<span class="pv-sutil">No</span>'} <button class="pv-mini" onclick="event.stopPropagation();hdVer('/api/holded/venta/${esc(x.numero)}/archivo','Factura ${esc(x.numero)} · ${esc(x.cliente || '')}')">${I.doc}Ver</button></td>
        <td class="pv-sutil">${fh(x.enviado_en)}</td><td class="n"><b>${eur(x.total)}</b></td></tr>`).join('');
    } else {
      const mets = [...new Set(H.cobros.map(x => x.metodo).filter(Boolean))];
      extraFiltro = `<select class="hd-select g-vidrio" onchange="hdHF('metodo',this.value)"><option value="">Todas las formas de pago</option>${mets.map(m => `<option value="${m}" ${F.metodo === m ? 'selected' : ''}>${esc(NOMBRE_METODO[m] || m)}</option>`).join('')}</select>`;
      lista = H.cobros.filter(x => enRango(x.fecha) && coincide(x.cliente, x.numero_factura, x.importe) && (!F.metodo || x.metodo === F.metodo));
      cab = '<th>Cliente</th><th>Factura · cobro</th><th>Fecha</th><th>Forma de pago</th><th>Enviado</th><th class="n">Importe</th>';
      filas = lista.map(x => `<tr class="hd-clic ${S.va && S.va.numero === String(x.numero_factura) ? 'sel' : ''}" onclick="hdVentaAbrir('${esc(x.numero_factura)}')">
        <td><div class="pv-celda-prov">${avatar(x.cliente || '?')}<span><b>${esc(x.cliente || '—')}</b></span></div></td>
        <td><b class="pv-num">${esc(x.numero_factura)}</b><small class="pv-sutil">cobro ${esc(x.pago_id)}${x.split_idx > 1 ? '/' + x.split_idx : ''}</small></td>
        <td>${ff(x.fecha)}</td><td>${esc(NOMBRE_METODO[x.metodo] || x.metodo || '—')}</td><td class="pv-sutil">${fh(x.enviado_en)}</td><td class="n"><b>${eur(x.importe)}</b></td></tr>`).join('');
    }
    const total = lista.reduce((s, x) => s + num(x.total != null ? x.total : x.importe), 0);
    const atajos = [['mes', 'Este mes'], ['anterior', 'Mes anterior'], ['trimestre', 'Trimestre'], ['anio', 'Este año'], ['todo', 'Todo']];
    return `<div class="pv-filtros">
        <div class="pv-chips">${tipos.map(([k, n, c]) => `<button class="pv-chip ${F.tipo === k ? 'activo' : ''}" onclick="hdHF('tipo','${k}')">${n} <em>${c}</em></button>`).join('')}</div>
        <label class="pv-buscar g-vidrio">${I.lupa}<input id="hd-buscar" placeholder="${F.tipo === 'gastos' ? 'Proveedor' : 'Cliente'}, nº o importe" value="${esc(S.buscar)}" oninput="hdBuscar(this.value)"></label>
      </div>
      <div class="pv-filtros">
        <div class="pv-chips">${atajos.map(([k, n]) => `<button class="pv-chip hd-chip-t ${F.atajo === k ? 'activo' : ''}" onclick="hdHRango('${k}')">${n}</button>`).join('')}
          <span class="hd-rango g-vidrio"><input type="date" value="${esc(F.desde)}" onchange="hdHF('desde',this.value)"> – <input type="date" value="${esc(F.hasta)}" onchange="hdHF('hasta',this.value)"></span></div>
        <div class="hd-acciones-linea">${extraFiltro}<button class="pv-boton g-vidrio" onclick="hdExportar()" title="Descargar lo filtrado en CSV (Excel)">${I.doc}CSV</button></div>
      </div>
      <div class="pv-panel g-vidrio pv-tabla-panel">
        <div class="pv-tabla-cab"><span>${lista.length} ${F.tipo === 'gastos' ? 'gastos' : F.tipo === 'facturas' ? 'facturas' : 'cobros'} volcados</span><b>${eur(total)}</b></div>
        <div class="pv-tabla-wrap"><table class="pv-tabla hd-tabla-pagos"><thead><tr>${cab}</tr></thead>
        <tbody>${filas || '<tr><td colspan="6" class="pv-vacio">Nada con este filtro.</td></tr>'}</tbody></table></div>
      </div>`;
  }
  S.hf = { tipo: 'gastos', desde: '', hasta: '', atajo: 'mes', cuenta: '', pago: '', metodo: '' };
  function rangoDe(k) {
    const h = hoy(), y = Number(h.slice(0, 4)), m = Number(h.slice(5, 7));
    const mes = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}`;
    const finMes = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
    if (k === 'mes') return [mes(y, m) + '-01', finMes(y, m)];
    if (k === 'anterior') { const yy = m === 1 ? y - 1 : y, mm = m === 1 ? 12 : m - 1; return [mes(yy, mm) + '-01', finMes(yy, mm)]; }
    if (k === 'trimestre') { const t = Math.floor((m - 1) / 3) * 3 + 1; return [mes(y, t) + '-01', finMes(y, t + 2)]; }
    if (k === 'anio') return [y + '-01-01', y + '-12-31'];
    return ['', ''];
  }
  [S.hf.desde, S.hf.hasta] = rangoDe('mes');
  window.hdHF = (k, v) => { S.hf[k] = v; if (k === 'desde' || k === 'hasta') S.hf.atajo = ''; if (k === 'tipo') S.buscar = ''; pintar(); };
  window.hdHRango = k => { S.hf.atajo = k; [S.hf.desde, S.hf.hasta] = rangoDe(k); pintar(); };
  window.hdExportar = () => {
    const filas = [...document.querySelectorAll('#hd-root .pv-tabla tbody tr')].filter(tr => !tr.querySelector('.pv-vacio'));
    const cab = [...document.querySelectorAll('#hd-root .pv-tabla thead th')].map(th => th.textContent.trim());
    const celda = t => '"' + String(t).replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"';
    const csv = [cab.map(celda).join(';'), ...filas.map(tr => [...tr.children].map(td => celda(td.innerText)).join(';'))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `holded-${S.hf.tipo}-${S.hf.desde || 'inicio'}-${S.hf.hasta || hoy()}.csv`; a.click();
  };

  // Adjuntar el PDF de Rentman a las facturas ya volcadas que no lo tienen (en segundo plano)
  window.hdAdjuntarPdfs = async n => {
    if (!confirm(`Se adjuntará en Holded el PDF de Rentman de ${n} facturas de venta ya volcadas. Tarda un rato (unas ${Math.ceil(n * 1.5 / 60)} min); puedes seguir trabajando. ¿Empezar?`)) return;
    try { const r = await api('POST', '/api/holded/ventas/adjuntar-pdf'); if (!r.ok) { toast(r.motivo || 'No se ha podido empezar', true); return; } }
    catch (e) { toast(e.message, true); return; }
    S.pdfVentas = { hecho: 0, total: n, fin: false }; pintar();
    const t = setInterval(async () => {
      let d; try { d = await api('GET', '/api/holded/ventas/adjuntar-pdf/estado'); } catch (e) { return; }
      S.pdfVentas = d.progreso || { fin: true };
      if (S.pdfVentas.fin || !vivo()) {
        clearInterval(t);
        if (d.progreso) toast(`PDFs adjuntados: ${d.progreso.ok} de ${d.progreso.total}${d.progreso.errores.length ? ' · ' + d.progreso.errores.length + ' sin PDF o con error' : ''}`, !!d.progreso.errores.length);
        await cargarHistorial(true);
      } else if (vivo() && S.pestana === 'historial') pintar();
    }, 3000);
  };
  // Visor de una factura (gasto o venta) encima de la pantalla
  window.hdVer = (url, titulo) => {
    let d = $('hd-visor-modal');
    if (!d) { d = document.createElement('div'); d.id = 'hd-visor-modal'; d.className = 'pv-ficha-fondo'; d.onclick = e => { if (e.target === d) hdCerrarVer(); }; document.body.appendChild(d); }
    d.innerHTML = `<aside class="pv-ficha g-vidrio hd-ver"><header><div><small>Factura</small><h2>${esc(titulo || '')}</h2></div>
      <button class="pv-mini" onclick="window.open('${esc(url)}','_blank')">Abrir en otra pestaña ${I.externo}</button><button class="pv-flecha" onclick="hdCerrarVer()" title="Cerrar">${I.cerrar}</button></header>
      <div class="pv-visor-marco hd-ver-marco"><div class="pv-vacio">Cargando la factura…</div></div></aside>`;
    requestAnimationFrame(() => d.classList.add('visible'));
    (async () => {
      let info = { url, mime: 'application/pdf' };
      if (/facturas-proveedores/.test(url)) { try { const r = await fetch(url + '?info=1'); if (r.ok) info = await r.json(); } catch (e) { /* enlace directo */ } }
      const m = d.querySelector('.hd-ver-marco'); if (!m) return;
      m.innerHTML = /^image\//.test(info.mime || '') ? `<div class="pv-img-caja hd-img"><img alt="Factura" src="${esc(info.url)}" onclick="this.classList.toggle('zoom')"></div>` : `<iframe title="Factura" src="${esc(info.url)}#view=FitH"></iframe>`;
    })();
  };
  window.hdCerrarVer = () => { const d = $('hd-visor-modal'); if (d) { d.classList.remove('visible'); setTimeout(() => d.remove(), 250); } };

  // ── Revisar una factura de venta (antes solo en /holded.html) ──
  window.hdRevisar = async numero => {
    S.pestana = 'ventas'; S.ventas = 'revisar'; S.rev = { numero: String(numero || '').trim(), cargando: true, d: null, error: null, res: null };
    pintar();
    if (!S.rev.numero) { S.rev.cargando = false; pintar(); return; }
    try { S.rev.d = await api('GET', '/api/holded/factura/' + encodeURIComponent(S.rev.numero)); } catch (e) { S.rev.error = e.message; }
    S.rev.cargando = false; if (vivo()) pintar();
  };
  function vistaRevisar() {
    const r = S.rev || {};
    const buscador = `<div class="pv-panel g-vidrio hd-revisar-buscar"><label class="pv-buscar">${I.lupa}<input id="hd-rev-num" placeholder="Nº de factura de Rentman, p. ej. 262166" value="${esc(r.numero || '')}" onkeydown="if(event.key==='Enter')hdRevisar(this.value)"></label>
      <button class="pv-boton prim" onclick="hdRevisar(document.getElementById('hd-rev-num').value)">Ver cómo va a Holded</button></div>`;
    if (!r.numero) return buscador + '<p class="pv-sutil">Escribe un número de factura para ver qué se manda a Holded, sus comprobaciones y sus cobros. También puedes pulsar una factura del historial.</p>';
    if (r.cargando) return buscador + '<div class="pv-panel g-vidrio pv-vacio">Cargando la factura…</div>';
    if (r.error) return buscador + `<div class="pv-panel g-vidrio pv-vacio rojo">${esc(r.error)}</div>`;
    const v = r.d.vista, s = v.sync, cobros = r.d.cobros || [];
    const estado = s ? `<span class="pv-estado ${s.estado === 'aprobada' ? 'e-ok' : s.estado === 'borrador' ? 'e-sinpago' : 'e-revisar'}">${esc(s.estado)}</span>${s.error ? `<small class="rojo">${esc(s.error)}</small>` : ''}` : '<span class="pv-estado e-holded">No enviada</span>';
    const avisos = v.avisos.length ? v.avisos.map(a => `<div class="pv-dudas ${a.nivel === 'error' ? 'rojo' : ''}">${I.alerta}<span>${esc(a.texto)}</span></div>`).join('') : `<div class="hd-ok-linea">${I.ok} Todo correcto para enviar</div>`;
    const puedeAprobar = s && s.estado === 'borrador', puedeCobros = s && s.estado === 'aprobada' && cobros.some(c => c.estado === 'listo');
    const datos = `<div class="pv-panel g-vidrio">
        <h3>${v.rentman.tipo === 'C' ? 'Rectificativa' : 'Factura'} ${esc(v.rentman.numero)} · ${esc(v.rentman.fecha)} ${estado}</h3>
        <div class="hd-kv">
          ${v.rentman.tipo === 'C' ? `<span>En Holded</span><b>Nota de crédito${(v.rectifica || []).length ? ' · rectifica ' + v.rectifica.map(f => `<button class="pv-enlace" onclick="hdRevisar('${esc(f.numero)}')">${esc(f.numero)}</button>`).join(', ') : ''}</b>` : ''}
          <span>Cliente</span><b>${esc(v.cliente.nombre)} · NIF ${esc(v.cliente.nif || '—')}</b>
          <span>Contacto en Holded</span><b>${v.cliente.holded_id ? esc(v.cliente.holded_nombre) + ' · cuenta ' + esc(v.cliente.cuenta) : '<span class="rojo">no encontrado</span>'}</b>
          <span>Total en Rentman</span><b>${eur(v.rentman.base)} + IVA ${eur(v.rentman.iva)} = ${eur(v.rentman.total)}</b>
        </div></div>`;
    const lineas = `<div class="pv-panel g-vidrio pv-tabla-panel"><div class="pv-tabla-cab"><span>Líneas que se envían</span><b>${eur(v.totales.base)} + ${eur(v.totales.iva)}</b></div>
        <div class="pv-tabla-wrap"><table class="pv-tabla hd-tabla-pagos"><thead><tr><th>Concepto</th><th>Cuenta</th><th>IVA</th><th class="n">Base</th><th class="n">Cuota IVA</th></tr></thead>
        <tbody>${v.lineas.map(l => `<tr><td>${esc(l.concepto)}</td><td>${esc(l.cuenta)}</td><td>${esc(l.iva)}</td><td class="n">${eur(l.base)}</td><td class="n">${eur(l.cuota_iva)}</td></tr>`).join('')}</tbody></table></div></div>`;
    const tCobros = `<div class="pv-panel g-vidrio pv-tabla-panel"><div class="pv-tabla-cab"><span>Cobros (forma de pago desde Caja)</span><b>${eur(cobros.reduce((a, c) => a + num(c.importe), 0))}</b></div>
        <div class="pv-tabla-wrap"><table class="pv-tabla hd-tabla-pagos"><thead><tr><th>Cobro</th><th>Fecha</th><th>Forma de pago</th><th>Cuenta</th><th class="n">Importe</th><th>Estado</th></tr></thead>
        <tbody>${cobros.map(c => `<tr><td>${esc(c.pago_id)}${c.split_idx > 1 ? '/' + c.split_idx : ''}</td><td>${ff(c.fecha)}</td><td>${esc(NOMBRE_METODO[c.metodo] || c.metodo || '—')}</td><td>${esc(c.cuenta || '—')}</td><td class="n">${eur(c.importe)}</td>
          <td><span class="pv-estado ${(ESTADO_COBRO[c.estado] || {}).c || (c.estado === 'enviado' ? 'e-ok' : '')}">${esc((ESTADO_COBRO[c.estado] || {}).n || (c.estado === 'enviado' ? 'En Holded' : c.estado))}</span>${c.motivo ? `<small class="pv-sutil">${esc(c.motivo)}</small>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="pv-vacio">Sin cobros en Rentman.</td></tr>'}</tbody></table></div>
        ${cobros.some(c => c.estado === 'sin_clasificar') ? '<div class="hd-nota">Los cobros sin forma de pago se asignan en «Cobros pendientes».</div>' : ''}</div>`;
    const acciones = `<div class="pv-panel g-vidrio"><h3>Acciones</h3><div class="hd-acciones-linea">
        <button class="pv-boton g-vidrio" ${v.se_puede_enviar ? '' : 'disabled'} onclick="hdAccionFactura('enviar',false)">Crear en Holded (borrador)</button>
        <button class="pv-boton prim" ${v.se_puede_enviar ? '' : 'disabled'} onclick="hdAccionFactura('enviar',true)">Crear y aprobar</button>
        <button class="pv-boton g-vidrio" ${puedeAprobar ? '' : 'disabled'} onclick="hdAccionFactura('aprobar')">Aprobar borrador</button>
        <button class="pv-boton g-vidrio" ${puedeCobros ? '' : 'disabled'} onclick="hdAccionFactura('cobros')">Enviar cobros</button>
        ${s && s.holded_invoice_id ? `<button class="pv-boton g-vidrio" onclick="hdAccionFactura('pdf')">${I.subir}${s.pdf_adjunto ? 'Volver a adjuntar el PDF' : 'Adjuntar el PDF en Holded'}</button>` : ''}</div>
        ${r.res ? `<div class="pv-dudas ${r.res.ok ? '' : 'rojo'}" style="margin-top:10px"><span>${esc(r.res.texto)}</span></div>` : ''}
        <details class="hd-tecnico"><summary>Datos técnicos (lo que se manda a Holded)</summary><pre>${esc(JSON.stringify(v.payload, null, 2))}</pre></details></div>`;
    const visor = `<div class="pv-panel g-vidrio hd-rev-visor"><div class="pv-visor-barra"><b>Factura de Rentman</b>${s && s.holded_invoice_id ? (s.pdf_adjunto ? `<span class="hd-ok-linea">${I.ok} Adjunta en Holded</span>` : '<span class="pv-sutil">Aún no adjunta en Holded</span>') : ''}
        <button class="pv-mini" style="margin-left:auto" onclick="window.open('/api/holded/venta/${esc(v.rentman.numero)}/archivo','_blank')">Abrir en otra pestaña ${I.externo}</button></div>
        <div class="pv-visor-marco"><iframe title="Factura" src="/api/holded/venta/${esc(v.rentman.numero)}/archivo#view=FitH"></iframe></div></div>`;
    return buscador + `<div class="hd-rev"><div class="hd-rev-datos">${datos}<div class="pv-panel g-vidrio"><h3>Comprobaciones</h3>${avisos}</div>${lineas}${tCobros}${acciones}</div>${visor}</div>`;
  }
  window.hdAccionFactura = async (que, aprobar) => {
    const v = S.rev && S.rev.d && S.rev.d.vista; if (!v) return;
    if ((que === 'enviar' && aprobar) || que === 'aprobar') { if (!confirm('Una factura aprobada en Holded no se puede borrar, solo anular. ¿' + (que === 'aprobar' ? 'Aprobar' : 'Crear y aprobar') + '?')) return; }
    const num = encodeURIComponent(v.rentman.numero);
    const url = que === 'enviar' ? `/api/holded/factura/${num}/enviar` : que === 'aprobar' ? `/api/holded/factura/${v.rentman.id}/aprobar` : que === 'pdf' ? `/api/holded/factura/${num}/adjuntar-pdf` : `/api/holded/factura/${num}/cobros`;
    toast('Enviando a Holded…');
    let r;
    try { r = await api('POST', url, que === 'enviar' ? { aprobar: !!aprobar } : undefined); }
    catch (e) { r = { ok: false, motivo: e.message }; }
    const enviados = Array.isArray(r.resultados) ? r.resultados.filter(x => x.estado === 'enviado').length : null;
    const texto = r.ok === false ? '✖ ' + (r.motivo || 'No se ha podido') + (Array.isArray(r.resultados) ? ' · ' + r.resultados.filter(x => x.estado === 'error').map(x => x.error || x.motivo).join(' · ') : '')
      : '✔ ' + (que === 'pdf' ? 'PDF adjuntado en Holded' : 'Hecho' + (r.estado ? ': ' + r.estado : '') + (enviados != null ? ' · ' + enviados + ' cobros enviados' : ''));
    await hdRevisar(v.rentman.numero);
    S.rev.res = { ok: !(r.ok === false || r.error), texto }; pintar();
    try { S.p = await api('GET', '/api/holded/pendientes'); } catch (e) { /* no pasa nada */ }
  };

  // ── Panel lateral de una factura de venta (20 nov 2026, pedido por el usuario) ──
  // Al pulsar un cobro, una factura pendiente, una incidencia o una venta del
  // historial se abre a la derecha (el listado sigue a la izquierda): el PDF de
  // Rentman, sus cobros con la forma de pago de Caja editable, comprobaciones y
  // acciones. Vive fuera de #hd-root para que repintar el listado no recargue
  // el PDF. Flechas ← → (o los botones) para ir a la siguiente del listado.
  function listaPanel() {
    const p = S.p || {}, h = S.h || {}, uniq = a => [...new Set(a.map(String))];
    if (S.pestana === 'historial') return uniq(S.hf.tipo === 'cobros' ? (h.cobros || []).map(x => x.numero_factura) : (h.facturas || []).map(x => x.numero));
    if (S.ventas === 'facturas') return uniq((p.facturas || []).map(x => x.numero));
    if (S.ventas === 'incidencias') return uniq([...(p.modificadas || []).map(x => x.numero), ...(p.descuadres || []).map(x => x.numero), ...(p.compensaciones || []).flatMap(k => k.lineas.map(l => l.numero_factura))]);
    const orden = c => c.estado === 'sin_clasificar' ? 0 : 1;
    return uniq([...(p.cobros || [])].sort((a, x) => orden(a) - orden(x) || String(a.fecha).localeCompare(String(x.fecha))).map(c => c.numero_factura));
  }
  window.hdVentaAbrir = async numero => {
    numero = String(numero);
    const cambia = !S.va || S.va.numero !== numero;
    S.va = { numero, cargando: true, d: cambia ? null : S.va.d, res: null, metodo: {} };
    montarPanel(cambia);
    await cargarVenta();
  };
  async function cargarVenta() {
    const n = S.va && S.va.numero; if (!n) return;
    try { const d = await api('GET', '/api/holded/factura/' + encodeURIComponent(n)); if (S.va && S.va.numero === n) { S.va.d = d; S.va.error = null; } }
    catch (e) { if (S.va && S.va.numero === n) S.va.error = e.message; }
    if (S.va && S.va.numero === n) { S.va.cargando = false; pintarPanel(); }
  }
  function montarPanel(cambiaPdf) {
    const body = $('content-body'); if (!body || !$('hd-root')) return;
    body.classList.add('hd-split');
    let pn = $('hd-va');
    if (!pn) { pn = document.createElement('aside'); pn.id = 'hd-va'; pn.className = 'hd-va g-vidrio'; body.appendChild(pn); }
    if (cambiaPdf || !pn.querySelector('iframe')) {
      pn.innerHTML = `<div id="hd-va-cab"></div>
        <div class="hd-va-pdf"><iframe title="Factura" src="/api/holded/venta/${encodeURIComponent(S.va.numero)}/archivo#view=FitH"></iframe></div>
        <div id="hd-va-datos" class="hd-va-datos"></div>`;
    }
    pintar(); pintarPanel();
  }
  window.hdVentaCerrar = () => { S.va = null; const pn = $('hd-va'); if (pn) pn.remove(); const b = $('content-body'); if (b) b.classList.remove('hd-split'); pintar(); };
  window.hdVentaMover = d => { const l = listaPanel(), i = l.indexOf(S.va && S.va.numero), n = l[i + d]; if (n) hdVentaAbrir(n); };
  function pintarPanel() {
    const va = S.va, cab = $('hd-va-cab'), cont = $('hd-va-datos'); if (!va || !cab || !cont) return;
    const l = listaPanel(), i = l.indexOf(va.numero), p = S.p || {};
    const v = va.d && va.d.vista, s = v && v.sync;
    cab.innerHTML = `<header class="hd-va-cab">${avatar(v ? v.cliente.nombre : '?')}<div><small>${v && v.rentman.tipo === 'C' ? 'Rectificativa' : 'Factura'} ${esc(va.numero)}${v ? ' · ' + esc(v.rentman.fecha) : ''}</small><h2>${esc(v ? v.cliente.nombre : 'Cargando…')}</h2></div>
      ${v ? `<strong>${eur(v.rentman.total)}</strong>` : ''}
      <span class="hd-nav"><button class="pv-flecha" ${i > 0 ? '' : 'disabled'} onclick="hdVentaMover(-1)" title="Anterior (←)">${I.izq}</button><span class="pv-sutil">${i >= 0 ? (i + 1) + ' / ' + l.length : ''}</span><button class="pv-flecha" ${i >= 0 && i < l.length - 1 ? '' : 'disabled'} onclick="hdVentaMover(1)" title="Siguiente (→)">${I.der}</button></span>
      <button class="pv-flecha" onclick="window.open('/api/holded/venta/${encodeURIComponent(va.numero)}/archivo','_blank')" title="Abrir el PDF en otra pestaña">${I.externo}</button>
      <button class="pv-flecha" onclick="hdVentaCerrar()" title="Cerrar (Esc)">${I.cerrar}</button></header>`;
    if (va.error) { cont.innerHTML = `<div class="pv-dudas rojo">${I.alerta}<span>${esc(va.error)}</span></div>`; return; }
    if (!v) { cont.innerHTML = '<div class="pv-vacio">Cargando la factura…</div>'; return; }
    const cobros = va.d.cobros || [], metodos = p.metodos_caja || [], puede = !!p.puede_asignar_caja;
    const estado = s ? `<span class="pv-estado ${s.estado === 'aprobada' ? 'e-ok' : s.estado === 'borrador' ? 'e-sinpago' : 'e-revisar'}">${s.estado === 'aprobada' ? 'En Holded' : esc(s.estado)}</span>${s.pdf_adjunto ? ` <span class="hd-ok-linea">${I.ok} PDF en Holded</span>` : ''}` : '<span class="pv-estado e-holded">Aún no está en Holded</span>';
    const filasCobro = cobros.map(c => {
      const k = c.pago_id + '_' + (c.split_idx || 1), est = ESTADO_COBRO[c.estado] || { n: c.estado === 'enviado' ? 'En Holded' : c.estado, c: c.estado === 'enviado' ? 'e-ok' : '' };
      const partido = cobros.some(o => o.pago_id === c.pago_id && (o.split_idx || 1) > 1);
      const editable = puede && !['enviado', 'modificado'].includes(c.estado) && !partido;
      const elegido = va.metodo[k] !== undefined ? va.metodo[k] : (c.metodo || '');
      const forma = editable
        ? `<select class="hd-select" onchange="hdVaMetodo('${k}',this.value)"><option value="">— forma de pago —</option>${metodos.map(m => `<option value="${m.id}" ${m.id === elegido ? 'selected' : ''}>${esc(m.nombre)}</option>`).join('')}</select>
           ${elegido && elegido !== c.metodo ? `<button class="pv-boton prim" onclick="hdVaGuardarCaja(${Number(c.pago_id)},'${k}',this)">${I.ok}Guardar en Caja</button>` : ''}`
        : `<b>${esc(NOMBRE_METODO[c.metodo] || c.metodo || '—')}</b>`;
      return `<div class="hd-va-cobro ${c.estado === 'sin_clasificar' ? 'aviso' : ''}"><div><b>${eur(c.importe)}</b><small class="pv-sutil">cobro ${esc(c.pago_id)}${(c.split_idx || 1) > 1 ? '/' + c.split_idx : ''} · ${ff(c.fecha)}</small></div>
        <span class="pv-estado ${est.c}">${est.n}</span><div class="hd-pago-linea">${forma}</div>${c.motivo && c.estado !== 'sin_clasificar' ? `<small class="pv-sutil hd-va-motivo">${esc(c.motivo)}</small>` : ''}</div>`;
    }).join('');
    const errores = v.avisos.filter(a => a.nivel === 'error'), avisos = v.avisos.filter(a => a.nivel !== 'error');
    const puedeAprobar = s && s.estado === 'borrador', puedeCobros = s && s.estado === 'aprobada' && cobros.some(c => c.estado === 'listo');
    cont.innerHTML = `
      <div class="hd-va-linea">${estado}</div>
      <div class="hd-importes"><div><small>Base</small><b>${eur(v.rentman.base)}</b></div><div><small>IVA</small><b>${eur(v.rentman.iva)}</b></div><div><small>Total</small><b>${eur(v.rentman.total)}</b></div></div>
      <h4>Cobros · forma de pago en Caja</h4>
      ${filasCobro || '<p class="pv-sutil">Sin cobros en Rentman.</p>'}
      ${!puede && cobros.some(c => c.estado === 'sin_clasificar') ? '<p class="pv-sutil">Solo María y Sergio pueden asignar la forma de pago en Caja.</p>' : ''}
      <h4>Comprobaciones</h4>
      ${errores.concat(avisos).map(a => `<div class="pv-dudas ${a.nivel === 'error' ? 'rojo' : ''}">${I.alerta}<span>${esc(a.texto)}</span></div>`).join('') || `<div class="hd-ok-linea">${I.ok} Todo correcto</div>`}
      <div class="hd-kv"><span>Cliente</span><b>${esc(v.cliente.nombre)} · ${esc(v.cliente.nif || 'sin NIF')}</b><span>En Holded</span><b>${v.cliente.holded_id ? esc(v.cliente.holded_nombre) + ' · ' + esc(v.cliente.cuenta) : '<span class="rojo">contacto no encontrado</span>'}</b></div>
      <h4>Acciones</h4>
      <div class="hd-acciones-linea">
        ${v.se_puede_enviar ? `<button class="pv-boton prim" onclick="hdVaAccion('enviar',true)">Crear y aprobar en Holded</button><button class="pv-boton g-vidrio" onclick="hdVaAccion('enviar',false)">Crear en borrador</button>` : ''}
        ${puedeAprobar ? `<button class="pv-boton prim" onclick="hdVaAccion('aprobar')">Aprobar borrador</button>` : ''}
        ${puedeCobros ? `<button class="pv-boton prim" onclick="hdVaAccion('cobros')">Enviar cobros a Holded</button>` : ''}
        ${s && s.holded_invoice_id ? `<button class="pv-boton g-vidrio" onclick="hdVaAccion('pdf')">${I.subir}${s.pdf_adjunto ? 'Volver a adjuntar el PDF' : 'Adjuntar el PDF en Holded'}</button>` : ''}
        <button class="pv-boton g-vidrio" onclick="hdRevisar('${esc(va.numero)}')" title="Ver líneas y datos técnicos">Ver detalle completo</button>
      </div>
      ${va.res ? `<div class="pv-dudas ${va.res.ok ? '' : 'rojo'}"><span>${esc(va.res.texto)}</span></div>` : ''}`;
  }
  window.hdVaMetodo = (k, v) => { S.va.metodo[k] = v; pintarPanel(); };
  window.hdVaGuardarCaja = async (pagoId, k, btn) => {
    const metodo = S.va.metodo[k]; if (!metodo) return;
    const nombre = (((S.p || {}).metodos_caja || []).find(m => m.id === metodo) || {}).nombre || metodo;
    btn.disabled = true;
    try {
      await api('POST', '/api/holded/cobros/' + encodeURIComponent(pagoId) + '/metodo-caja', { metodo });
      delete S.va.metodo[k];
      toast(`✔ Guardado en Caja: ${nombre}`);
      await cargarVenta();
      try { S.p = await api('GET', '/api/holded/pendientes'); } catch (e) { /* se ve al recargar */ }
      if (vivo()) { pintar(); pintarPanel(); }
      // Si esta factura ya no tiene cobros sin forma de pago, pasa a la siguiente que sí tenga.
      const queda = S.va && S.va.d && (S.va.d.cobros || []).some(c => c.estado === 'sin_clasificar');
      if (!queda && S.pestana === 'ventas' && S.ventas === 'cobros') {
        const sig = ((S.p || {}).cobros || []).find(c => c.estado === 'sin_clasificar' && String(c.numero_factura) !== S.va.numero);
        if (sig) hdVentaAbrir(sig.numero_factura);
      }
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
  window.hdVaAccion = async (que, aprobar) => {
    const v = S.va && S.va.d && S.va.d.vista; if (!v) return;
    if ((que === 'enviar' && aprobar) || que === 'aprobar') { if (!confirm('Una factura aprobada en Holded no se puede borrar, solo anular. ¿' + (que === 'aprobar' ? 'Aprobar' : 'Crear y aprobar') + '?')) return; }
    const num = encodeURIComponent(v.rentman.numero);
    const url = que === 'enviar' ? `/api/holded/factura/${num}/enviar` : que === 'aprobar' ? `/api/holded/factura/${v.rentman.id}/aprobar` : que === 'pdf' ? `/api/holded/factura/${num}/adjuntar-pdf` : `/api/holded/factura/${num}/cobros`;
    toast('Enviando a Holded…');
    let r;
    try { r = await api('POST', url, que === 'enviar' ? { aprobar: !!aprobar } : undefined); } catch (e) { r = { ok: false, motivo: e.message }; }
    const enviados = Array.isArray(r.resultados) ? r.resultados.filter(x => x.estado === 'enviado').length : null;
    const texto = r.ok === false ? '✖ ' + (r.motivo || 'No se ha podido') + (Array.isArray(r.resultados) ? ' · ' + r.resultados.filter(x => x.estado === 'error').map(x => x.error || x.motivo).join(' · ') : '')
      : '✔ ' + (que === 'pdf' ? 'PDF adjuntado en Holded' : 'Hecho' + (r.estado ? ': ' + r.estado : '') + (enviados != null ? ' · ' + enviados + ' cobros enviados' : ''));
    await cargarVenta();
    if (S.va) { S.va.res = { ok: r.ok !== false, texto }; pintarPanel(); }
    try { S.p = await api('GET', '/api/holded/pendientes'); } catch (e) { /* no pasa nada */ }
    if (vivo()) pintar();
  };

  // ── Corregir una factura de compra bloqueada (20 nov 2026) ──
  // Lo que la IA leyó (nº, fecha, NIF, cuadro de IVA, total) y la ficha del
  // proveedor (IVA 0 %, retención, NIF), editables; «Guardar y reintentar».
  function bloqueadaHtml(x) {
    const id = x.file_id, b = B(id), g = S.g || {}, l = x.lectura, fi = x.ficha || {};
    const val = (k, def) => b[k] !== undefined ? b[k] : (def == null ? '' : def);
    const motivo = String(x.error || x.estado || '');
    const campo = (etq, k, def, tipo, extra) => `<label class="pv-campo"><span>${etq}</span><input ${tipo ? `type="${tipo}"` : ''} value="${esc(val(k, def))}" oninput="hdCampo('${esc(id)}','${k}',this)" ${extra || ''}></label>`;
    if (!l) return `<div class="pv-dudas rojo">${I.alerta}<span><b>Bloqueada:</b> ${esc(motivo)}</span></div>
      <p class="pv-sutil">Esta factura aún no tiene lectura: pulsa «Releer el PDF».</p>
      <div class="pv-ficha-pie"><button class="pv-boton prim" onclick="hdReintentar('${esc(id)}',true)">${I.girar}Releer el PDF</button></div>`;
    const lineas = b.c_lineas || (l.lineas_iva || []).map(x => ({ tipo: x.tipo, base: x.base, cuota: x.cuota }));
    if (!b.c_lineas) b.c_lineas = lineas.map(x => ({ ...x }));
    const sumaB = lineas.reduce((s, x) => s + num(x.base), 0), sumaC = lineas.reduce((s, x) => s + num(x.cuota), 0);
    const tot = num(val('c_total', l.total)), ret = num(val('c_ret', l.retencion_importe));
    const cuadra = Math.abs(sumaB + sumaC - ret - tot) <= 0.03;
    return `<div class="pv-dudas rojo">${I.alerta}<span><b>Bloqueada:</b> ${esc(motivo)}</span></div>
      <h4>Datos de la factura</h4>
      <div class="pv-campos">
        ${campo('Nº de factura', 'c_numero', l.numero)}
        ${campo('Fecha', 'c_fecha', l.fecha, 'date')}
        ${campo('Vencimiento', 'c_venc', l.vencimiento, 'date')}
        ${campo('NIF del emisor', 'c_nif', l.nif)}
      </div>
      <h4>Cuadro de IVA</h4>
      <div class="hd-iva">${lineas.map((x, k) => `
        <label class="pv-campo"><span>IVA %</span><input class="n" value="${esc(x.tipo)}" oninput="hdIvaLinea('${esc(id)}',${k},'tipo',this.value)"></label>
        <label class="pv-campo"><span>Base</span><input class="n" value="${esc(x.base)}" oninput="hdIvaLinea('${esc(id)}',${k},'base',this.value)"></label>
        <label class="pv-campo"><span>Cuota</span><input class="n" value="${esc(x.cuota)}" oninput="hdIvaLinea('${esc(id)}',${k},'cuota',this.value)"></label>
        <button class="pv-flecha" title="Quitar línea" onclick="hdIvaQuitar('${esc(id)}',${k})">${I.cerrar}</button>`).join('')}</div>
      <button class="pv-mini" style="align-self:flex-start" onclick="hdIvaAnadir('${esc(id)}')">${I.mas}Añadir línea de IVA</button>
      <div class="pv-campos">
        ${campo('Retención (importe)', 'c_ret', l.retencion_importe)}
        ${campo('Total de la factura', 'c_total', l.total)}
      </div>
      <div id="hd-cuadre-${cssId(id)}" class="${cuadra ? 'hd-ok-linea' : 'rojo'}" style="font-size:12.5px">${cuadra ? I.ok + ' Cuadra' : 'No cuadra'}: base ${eur(sumaB)} + IVA ${eur(sumaC)} − retención ${eur(ret)} = ${eur(sumaB + sumaC - ret)} · total ${eur(tot)}</div>
      <h4>Ficha del proveedor</h4>
      <div class="pv-campos">
        <label class="pv-campo"><span>IVA al 0 % es…</span><select onchange="hdCampo('${esc(id)}','f_iva0',this)"><option value="">— sin indicar —</option>${(g.opciones_iva_cero || []).map(o => `<option value="${o.key}" ${val('f_iva0', fi.iva_cero) === o.key ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}</select></label>
        <label class="pv-campo"><span>Retención</span><select onchange="hdCampo('${esc(id)}','f_ret',this)"><option value="">— la que diga la factura —</option>${(g.opciones_retencion || []).map(o => `<option value="${o.key}" ${val('f_ret', fi.retencion) === o.key ? 'selected' : ''}>${esc(o.nombre)}</option>`).join('')}</select></label>
        ${campo('NIF en la ficha', 'f_nif', fi.nif)}
      </div>
      <div class="pv-ficha-pie">
        <button class="pv-boton prim" onclick="hdCorregir('${esc(id)}',this)">${I.ok}Guardar y reintentar</button>
        <button class="pv-boton g-vidrio" onclick="hdReintentar('${esc(id)}',true)" title="Vuelve a leer el PDF con Claude">${I.girar}Releer el PDF</button>
      </div>`;
  }
  function cuadreBloqueada(id) {
    const x = gastos().find(y => y.file_id === id), el = $('hd-cuadre-' + cssId(id)); if (!x || !el || !x.lectura) return;
    const b = B(id), ls = b.c_lineas || [];
    const sB = ls.reduce((s, l) => s + numES(l.base), 0), sC = ls.reduce((s, l) => s + numES(l.cuota), 0);
    const tot = numES(b.c_total !== undefined ? b.c_total : x.lectura.total), ret = numES(b.c_ret !== undefined ? b.c_ret : x.lectura.retencion_importe);
    const ok = Math.abs(sB + sC - ret - tot) <= 0.03;
    el.className = ok ? 'hd-ok-linea' : 'rojo';
    el.innerHTML = `${ok ? I.ok + ' Cuadra' : 'No cuadra'}: base ${eur(sB)} + IVA ${eur(sC)} − retención ${eur(ret)} = ${eur(sB + sC - ret)} · total ${eur(tot)}`;
  }
  window.hdIvaLinea = (id, k, campo, v) => {
    const ls = B(id).c_lineas; ls[k][campo] = v;
    if (campo !== 'cuota') { const t = numES(ls[k].tipo), base = numES(ls[k].base); ls[k].cuota = String(Math.round(base * t) / 100).replace('.', ','); const ins = document.querySelectorAll('#hd-ficha .hd-iva input'); if (ins[k * 3 + 2]) ins[k * 3 + 2].value = ls[k].cuota; }
    cuadreBloqueada(id);
  };
  window.hdIvaAnadir = id => { B(id).c_lineas.push({ tipo: 21, base: '', cuota: '' }); pintarFicha(); };
  window.hdIvaQuitar = (id, k) => { B(id).c_lineas.splice(k, 1); pintarFicha(); };
  window.hdCorregir = async (id, btn) => {
    const x = gastos().find(y => y.file_id === id); if (!x || !x.lectura) return;
    const b = B(id), l = x.lectura, cambio = (k, def) => b[k] !== undefined && String(b[k]) !== String(def == null ? '' : def);
    const cuerpo = {};
    if (cambio('c_numero', l.numero)) cuerpo.numero = b.c_numero;
    if (cambio('c_fecha', l.fecha)) cuerpo.fecha = b.c_fecha;
    if (cambio('c_venc', l.vencimiento)) cuerpo.vencimiento = b.c_venc;
    if (cambio('c_nif', l.nif)) cuerpo.nif = b.c_nif;
    if (cambio('c_total', l.total)) cuerpo.total = numES(b.c_total);
    if (cambio('c_ret', l.retencion_importe)) cuerpo.retencion_importe = numES(b.c_ret);
    const ls = (b.c_lineas || []).map(y => ({ tipo: numES(y.tipo), base: numES(y.base), cuota: numES(y.cuota) }));
    if (JSON.stringify(ls) !== JSON.stringify((l.lineas_iva || []).map(y => ({ tipo: num(y.tipo), base: num(y.base), cuota: num(y.cuota) })))) cuerpo.lineas_iva = ls;
    const fi = x.ficha || {};
    if (cambio('f_iva0', fi.iva_cero)) cuerpo.ivaCero = b.f_iva0;
    if (cambio('f_ret', fi.retencion)) cuerpo.retencion = b.f_ret;
    if (cambio('f_nif', fi.nif)) cuerpo.nifFicha = b.f_nif;
    btn.disabled = true; toast('Guardando y comprobando…');
    try {
      const r = await api('POST', '/api/holded/gastos/' + encodeURIComponent(id) + '/corregir', cuerpo);
      if (r.estado === 'por_aprobar') { delete S.borrador[id]; toast('✔ Corregida: pasa a Por aprobar'); }
      else toast('Sigue ' + (r.estado || 'bloqueada') + (r.motivo ? ': ' + r.motivo : ''), true);
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
    await cargar();
  };

  // ── Volcado de ventas ──
  window.hdVolcar = async () => {
    const incluirHoy = !!($('hd-incluir-hoy') || {}).checked;
    if (!confirm('Se volcarán a Holded (aprobadas) todas las facturas y cobros ' + (incluirHoy ? 'hasta hoy' : 'hasta ayer') + ' que falten. ¿Seguir?')) return;
    try { const r = await api('POST', '/api/holded/volcar', { incluirHoy }); if (!r.ok && r.motivo) toast(r.motivo, true); }
    catch (e) { toast(e.message, true); return; }
    seguirVolcado();
  };
  async function seguirVolcado() {
    if (S.siguiendo) return;
    S.siguiendo = setInterval(async () => {
      if (!vivo()) { clearInterval(S.siguiendo); S.siguiendo = null; return; }
      let d; try { d = await api('GET', '/api/holded/volcado/estado'); } catch (e) { return; }
      if (d.volcando && d.progreso) { S.progreso = d.progreso; if (S.p) S.p.volcando = true; if (S.pestana === 'resumen') pintar(); return; }
      clearInterval(S.siguiendo); S.siguiendo = null; S.progreso = null;
      const pr = d.progreso;
      if (pr && pr.fin) { const s = pr.resumen || {}; toast(`Volcado terminado: ${s.facturas_enviadas || 0} facturas · ${s.cobros_enviados || 0} cobros${(s.errores || []).length ? ' · ' + s.errores.length + ' errores' : ''}`, !pr.ok); }
      cargar();
    }, 2000);
  }
  window.hdEmpresa = async btn => {
    btn.disabled = true; btn.textContent = 'Comprobando…';
    try { S.empresa = await api('GET', '/api/holded/empresa'); } catch (e) { S.empresa = { error: e.message }; }
    if (vivo()) pintar();
  };

  // ── Navegación ──
  window.hdIr = (k, filtro) => { if (S.va && !['ventas', 'historial'].includes(k)) hdVentaCerrar(); S.pestana = k; if (k === 'historial') cargarHistorial(); if (filtro && k === 'ventas') S.ventas = filtro; else if (filtro) { S.filtro = filtro; S.tipo = ''; S.mes = ''; } S.buscar = ''; pintar(); };
  window.hdVentas = k => { S.ventas = k; S.buscar = ''; pintar(); };
  window.hdFiltro = k => { S.filtro = k; pintar(); };
  window.hdTipo = k => { S.tipo = S.tipo === k ? '' : k; pintar(); };
  window.hdMes = m => { S.mes = m; pintar(); };
  window.hdPlazo = k => { S.plazo = k; pintar(); };
  let tBuscar = null;
  window.hdBuscar = v => { S.buscar = v; clearTimeout(tBuscar); tBuscar = setTimeout(pintar, 200); };
  window.hdRecargar = () => { toast('Actualizando…'); cargar(); if (S.pestana === 'historial') cargarHistorial(true); };
  window.hdAbrir = id => { S.abierta = id; pintar(); pintarFicha(); };
  window.hdCerrar = () => { const c = $('hd-ficha'); S.abierta = null; if ($('pv-ficha') && fichaPv()) window.pvCerrar(); if (c) { c.classList.remove('visible'); setTimeout(() => c.remove(), 250); } pintar(); };
  window.hdMover = d => { const l = filtrados(), i = l.findIndex(y => y.file_id === S.abierta), n = l[i + d]; if (n) { S.abierta = n.file_id; pintar(); pintarFicha(); } };
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('hd-visor-modal')) { hdCerrarVer(); return; }
    if ($('hd-va') && !$('hd-ficha') && !/INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) {
      if (e.key === 'Escape') { hdVentaCerrar(); return; } if (e.key === 'ArrowRight') { hdVentaMover(1); return; } if (e.key === 'ArrowLeft') { hdVentaMover(-1); return; }
    }
    if (!($('hd-ficha') || ($('pv-ficha') && S.abierta && vivo())) || /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
    if (e.key === 'Escape') hdCerrar(); else if (e.key === 'ArrowRight') hdMover(1); else if (e.key === 'ArrowLeft') hdMover(-1);
  });

  window.cargarHoldedGlass = function () {
    const t = $('content-title'); if (t) t.textContent = 'Holded';
    $('content-body').innerHTML = '<div class="pv hd" id="hd-root"></div>';
    const c = $('hd-ficha'); if (c) c.remove();
    S.abierta = null; S.va = null; $('content-body').classList.remove('hd-split');
    pintar();
    cargar();
  };
})();
