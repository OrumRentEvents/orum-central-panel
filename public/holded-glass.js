/* ================================================================
   ORUM Central · Financiero → Holded (interfaz Liquid Glass)
   20 nov 2026. Solo la abre la interfaz glass (public/glass.js cambia el
   apartado «Holded ↗» por esta pantalla); el diseño clásico sigue abriendo
   /holded.html. NO tiene lógica propia: usa las mismas llamadas que holded.html
   (/api/holded/gastos, /api/holded/pendientes, aceptar, sin-pagar, pago…).
   Resumen · Gastos por aprobar · Pagos pendientes · Ventas (cobros con su forma
   de pago de Caja, facturas e incidencias). El historial y «Revisar una factura»
   siguen de momento en la pantalla clásica (botón arriba a la derecha).
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
    mas: ico('<path d="M12 5v14M5 12h14"/>'), leasing: ico('<path d="M3 17h18M5 17V9l7-4 7 4v8"/><path d="M9 17v-5h6v5"/>')
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
    const pest = [['resumen', 'Resumen', 0], ['gastos', 'Gastos por aprobar', nPA], ['pagos', 'Pagos pendientes', nPagar], ['ventas', 'Ventas', nCobros]];
    const cab = `
      <div class="pv-barra">
        <div class="pv-pestanas g-vidrio">${pest.map(([k, n, c]) => `<button class="pv-pestana ${S.pestana === k ? 'activa' : ''}" onclick="hdIr('${k}')">${n}${c ? ` <span class="hd-cuenta">${c}</span>` : ''}</button>`).join('')}</div>
        <div class="pv-acciones">
          <button class="pv-boton g-vidrio" onclick="hdRecargar()" title="Volver a cargar">${I.girar}</button>
          <button class="pv-boton g-vidrio" onclick="window.open('/holded.html','_blank')" title="Revisar una factura e historial (pantalla clásica, mientras se pasan a esta)">Revisar e historial ${I.externo}</button>
        </div>
      </div>`;
    let cuerpo;
    if (!S.g && S.cargando) cuerpo = '<div class="pv-panel g-vidrio pv-vacio">Cargando Holded…</div>';
    else if (!S.g && S.error) cuerpo = `<div class="pv-panel g-vidrio pv-vacio rojo">No se ha podido cargar: ${esc(S.error)}</div>`;
    else cuerpo = ({ resumen: vistaResumen, gastos: vistaGastos, pagos: vistaPagos, ventas: vistaVentas })[S.pestana]();
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
    const ej = (p.ejecuciones || []).slice(0, 5);
    const pr = S.progreso;
    const barra = pr && pr.total ? `<div class="hd-progreso"><div><b>${esc({ preparando: 'Preparando…', facturas: 'Facturas', 'preparando cobros': 'Preparando cobros…', cobros: 'Cobros' }[pr.fase] || pr.fase || '')}</b> · ${pr.hecho} / ${pr.total}${pr.actual ? ` <span class="pv-sutil">nº ${esc(pr.actual)}</span>` : ''}</div><div class="pv-bh-pista ancha"><i style="background:var(--g-champ)" data-ancho="${Math.round(100 * pr.hecho / pr.total)}%"></i></div></div>` : '';
    const volcado = `<div class="pv-panel g-vidrio">
      <h3>Volcado Rentman → Holded ${p.volcando ? '<span class="pv-estado e-sinpago">En marcha</span>' : ''}</h3>
      <p class="pv-sutil" style="margin:-6px 0 10px">Cada día a las 6:00 se vuelcan las facturas y cobros del día anterior. Lo ya volcado no se vuelve a enviar.</p>
      ${barra}
      <div class="hd-acciones-linea">
        <button class="pv-boton prim" onclick="hdVolcar()" ${p.volcando ? 'disabled' : ''}>${I.subir}Volcar ahora</button>
        <label class="hd-check"><input type="checkbox" id="hd-incluir-hoy"> incluir también lo de hoy</label>
      </div>
      <div class="hd-lista-ej">${ej.length ? ej.map(e => {
        const r = e.resumen || {}, gastos = /gastos/.test(e.origen);
        const txt = gastos ? `${r.compras_por_aprobar != null ? r.compras_por_aprobar + ' por aprobar' : (r.compras_enviadas || 0) + ' compras'}${r.compras_bloqueadas ? ', ' + r.compras_bloqueadas + ' bloqueadas' : ''}` : `${r.facturas_enviadas || 0} facturas · ${r.cobros_enviados || 0} cobros${r.facturas_bloqueadas ? ' · ' + r.facturas_bloqueadas + ' bloqueadas' : ''}`;
        return `<div class="hd-ej"><span class="hd-punto ${!e.fin ? 'curso' : e.ok ? 'ok' : 'mal'}"></span><span>${fh(e.inicio)}</span><span class="pv-sutil">${/^auto/.test(e.origen) ? 'automático' : 'manual' + (e.usuario ? ' · ' + esc(e.usuario) : '')}${gastos ? ' · gastos' : ''}</span><span>${e.fin ? txt : 'en curso'}</span></div>`;
      }).join('') : '<p class="pv-sutil">Todavía no ha habido ningún volcado.</p>'}</div>
    </div>`;
    // Próximos vencimientos
    const prox = [...pagar].sort((a, b) => String(a.vencimiento || '9999').localeCompare(String(b.vencimiento || '9999'))).slice(0, 6);
    const venc = `<div class="pv-panel g-vidrio"><h3>Próximos pagos <button class="pv-enlace" onclick="hdIr('pagos')">Ver todos →</button></h3>
      ${prox.length ? prox.map(x => `<button class="pv-fila-c hd-fila-venc" onclick="hdIr('pagos')">${avatar(x.proveedor)}<span class="pv-fc-txt"><b>${esc(x.proveedor)}</b><small>Nº ${esc(x.numero || '—')}</small></span>
        <span class="pv-fc-fecha ${x.vencimiento && x.vencimiento < hoy() ? 'rojo' : ''}">${x.vencimiento ? 'vence ' + ff(x.vencimiento) : 'sin vencimiento'}</span><strong>${eur(x.total)}</strong></button>`).join('') : '<p class="pv-sutil">No hay facturas pendientes de pago en Holded. Las que se aceptan como «Aún no está pagada» aparecen aquí.</p>'}</div>`;
    // Gastos: preparar y conexión
    const gastosP = `<div class="pv-panel g-vidrio"><h3>Facturas de gastos</h3>
      <p class="pv-sutil" style="margin:-6px 0 10px">A las 7:00 se preparan las facturas de proveedores nuevas: quedan por aprobar y no llegan a Holded hasta que se aceptan aquí.</p>
      <div class="hd-acciones-linea"><button class="pv-boton g-vidrio" onclick="hdPreparar(this)">${I.girar}Preparar facturas nuevas ahora</button>
      ${g.volcando ? '<span class="pv-estado e-sinpago">Preparación en marcha</span>' : ''}</div>
      <div class="hd-mini-cifras">
        <div><small>Por aprobar</small><strong>${pa.length}</strong></div>
        <div><small>Sin forma de pago</small><strong>${(g.pendientes_pago || []).length}</strong></div>
        <div><small>Bloqueadas</small><strong>${(g.pendientes || []).length}</strong></div>
        <div><small>Volcadas</small><strong>${g.total_enviadas || 0}</strong></div>
      </div></div>`;
    const conexion = `<div class="pv-panel g-vidrio"><h3>Conexión con Holded</h3>
      ${S.empresa ? (S.empresa.error ? `<p class="rojo">${esc(S.empresa.error)}</p>` : `<p style="margin:0 0 6px">Empresa: <b>${esc(S.empresa.empresa || '—')}</b></p>
        <p class="${S.empresa.todo_listo ? '' : 'rojo'}" style="margin:0 0 6px">${S.empresa.todo_listo ? '✔ Cuentas y tesorerías de ventas y cobros creadas' : 'Faltan cuentas o tesorerías en Holded'}</p>
        <p class="pv-sutil" style="margin:0">Corte: ${ff(S.empresa.fecha_corte)} · ${S.empresa.total_cuentas_holded} cuentas · cuentas de gasto ${S.empresa.gastos_faltan && S.empresa.gastos_faltan.length ? `<b class="rojo">faltan ${S.empresa.gastos_faltan.length}</b>` : 'todas creadas'}</p>`)
        : '<p class="pv-sutil" style="margin:0 0 10px">Comprueba que la empresa conectada tiene todo lo que usa el volcado.</p>'}
      <button class="pv-mini" style="margin-top:10px" onclick="hdEmpresa(this)">${I.enlace}Comprobar conexión</button></div>`;
    return kpis + `<div class="pv-rejilla dos">${volcado}${venc}</div><div class="pv-rejilla dos">${gastosP}${conexion}</div>`;
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
  function pintarFicha() {
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
    const id = x.file_id, cid = cssId(id), b = B(id), g = S.g || {};
    const val = (k, def) => b[k] !== undefined ? b[k] : def;
    const visorPrevio = cont.querySelector('.hd-visor-marco[data-id="' + cid + '"]');
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
        ${x.concepto ? `<p class="pv-concepto">${esc(x.concepto)}</p>` : ''}
        ${x.dudas ? `<div class="pv-dudas">${I.alerta}<span>${esc(x.dudas)}</span></div>` : ''}
        ${x.error ? `<div class="pv-dudas rojo">${I.alerta}<span>${esc(x.error)}</span></div>` : ''}
        <div class="hd-importes"><div><small>Base</small><b>${eur(x.base)}</b></div><div><small>IVA ${x.tipos && x.tipos.length ? x.tipos.join(' / ') + ' %' : ''}</small><b>${eur(x.iva)}</b></div>${x.retencion ? `<div><small>Retención</small><b>−${eur(x.retencion)}</b></div>` : ''}<div><small>Total</small><b>${eur(x.total)}</b></div></div>
        <h4>Fechas</h4>
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
      datos = `<div class="pv-dudas rojo">${I.alerta}<span><b>Bloqueada:</b> ${esc(x.error || x.estado)}</span></div>
        <div class="hd-importes"><div><small>Fecha</small><b>${ff(x.fecha)}</b></div><div><small>Total</small><b>${x.total != null ? eur(x.total) : '—'}</b></div></div>
        <p class="pv-sutil">Corrige la causa (ficha del proveedor en Config. Cuentas de gasto, fecha, IVA…) y pulsa Reintentar; si el PDF se leyó mal, Releer.</p>
        <div class="pv-ficha-pie"><button class="pv-boton prim" onclick="hdReintentar('${esc(id)}',false)">${I.girar}Reintentar</button><button class="pv-boton g-vidrio" onclick="hdReintentar('${esc(id)}',true)">Releer el PDF</button></div>`;
    }
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
    S.enviando.add(id); S.abierta = sig ? sig.file_id : null; pintar(); pintarFicha();
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
    btn.disabled = true; toast('Preparando facturas nuevas… puede tardar unos minutos');
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
    const chips = [['cobros', 'Cobros pendientes', cobros.length], ['facturas', 'Facturas pendientes', facturas.length], ['incidencias', 'Incidencias', incid]];
    const b = normal(S.buscar), coincide = (...v) => !b || v.some(x => normal(x).includes(b) || String(x).includes(b.replace(',', '.')));
    const metodos = p.metodos_caja || [], nombreMetodo = id => ((metodos.find(m => m.id === id) || {}).nombre) || id || '—';
    let cuerpo;
    if (S.ventas === 'cobros') {
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
        return `<tr class="${c.estado === 'sin_clasificar' ? 'hd-fila-aviso' : ''}">
          <td><div class="pv-celda-prov">${avatar(c.cliente || '?')}<span><b>${esc(c.cliente || '—')}</b><small>Factura ${esc(c.numero_factura)} · cobro ${esc(c.pago_id)}${(c.split_idx || 1) > 1 ? '/' + c.split_idx : ''}</small></span></div></td>
          <td>${ff(c.fecha)}</td><td class="n"><b>${eur(c.importe)}</b></td>
          <td><span class="pv-estado ${est.c}">${est.n}</span>${c.motivo && c.estado !== 'sin_clasificar' ? `<small class="pv-sutil">${esc(c.motivo)}</small>` : ''}</td>
          <td>${selector}</td></tr>`;
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
      const filas = lista.map(x => `<tr><td><div class="pv-celda-prov">${avatar(x.cliente || '?')}<span><b>${esc(x.cliente || '—')}</b><small>Factura ${esc(x.numero)}</small></span></div></td><td>${ff(x.fecha)}</td><td class="n"><b>${eur(x.total)}</b></td>
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
        p.modificadas.map(m => `<tr><td>${esc(m.numero)}</td><td>${esc(m.cliente)}</td><td class="n">${eur(m.total_enviado)}</td><td class="n">${eur(m.total_rentman)}</td></tr>`).join('')));
      if ((p.descuadres || []).length) bloques.push(panel('Descuadre de céntimos con Rentman', 'Holded redondeó el IVA de otra forma: aunque se cobre entera, quedará esa diferencia pendiente.',
        '<th>Factura</th><th>Cliente</th><th class="n">En Holded</th><th class="n">En Rentman</th><th class="n">Diferencia</th>',
        p.descuadres.map(m => `<tr><td>${esc(m.numero)}</td><td>${esc(m.cliente)}</td><td class="n">${eur(m.total_holded)}</td><td class="n">${eur(m.total_rentman)}</td><td class="n rojo">${eur(m.diferencia)}</td></tr>`).join('')));
      if ((p.compensaciones || []).length) bloques.push(panel('Compensaciones descuadradas', 'Los cobros «Factura 0 €» y «Rectificativa» de cada cliente tienen que sumar 0: falta la otra mitad o está mal clasificada en Caja.',
        '<th>Cliente</th><th>Facturas (cobro · importe)</th><th class="n">Descuadre</th>',
        p.compensaciones.map(k => `<tr><td>${esc(k.cliente)}</td><td style="font-size:12px">${k.lineas.map(l => `${esc(l.numero_factura)} (${esc(l.pago_id)} · ${eur(l.importe)})`).join(', ')}</td><td class="n rojo">${eur(k.neto)}</td></tr>`).join('')));
      cuerpo = bloques.join('') || '<div class="pv-panel g-vidrio pv-vacio">✔ Sin incidencias de ventas.</div>';
    }
    const buscador = S.ventas !== 'incidencias' ? `<label class="pv-buscar g-vidrio">${I.lupa}<input id="hd-buscar" placeholder="Cliente, nº de factura o importe" value="${esc(S.buscar)}" oninput="hdBuscar(this.value)"></label>` : '';
    return `<div class="pv-filtros">
        <div class="pv-chips">${chips.map(([k, n, c]) => `<button class="pv-chip ${S.ventas === k ? 'activo' : ''}" onclick="hdVentas('${k}')">${n} <em>${c}</em></button>`).join('')}</div>
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
  window.hdIr = (k, filtro) => { S.pestana = k; if (filtro && k === 'ventas') S.ventas = filtro; else if (filtro) { S.filtro = filtro; S.tipo = ''; S.mes = ''; } S.buscar = ''; pintar(); };
  window.hdVentas = k => { S.ventas = k; S.buscar = ''; pintar(); };
  window.hdFiltro = k => { S.filtro = k; pintar(); };
  window.hdTipo = k => { S.tipo = S.tipo === k ? '' : k; pintar(); };
  window.hdMes = m => { S.mes = m; pintar(); };
  window.hdPlazo = k => { S.plazo = k; pintar(); };
  let tBuscar = null;
  window.hdBuscar = v => { S.buscar = v; clearTimeout(tBuscar); tBuscar = setTimeout(pintar, 200); };
  window.hdRecargar = () => { toast('Actualizando…'); cargar(); };
  window.hdAbrir = id => { S.abierta = id; pintar(); pintarFicha(); };
  window.hdCerrar = () => { const c = $('hd-ficha'); S.abierta = null; if (c) { c.classList.remove('visible'); setTimeout(() => c.remove(), 250); } pintar(); };
  window.hdMover = d => { const l = filtrados(), i = l.findIndex(y => y.file_id === S.abierta), n = l[i + d]; if (n) { S.abierta = n.file_id; pintar(); pintarFicha(); } };
  document.addEventListener('keydown', e => {
    if (!$('hd-ficha') || /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '')) return;
    if (e.key === 'Escape') hdCerrar(); else if (e.key === 'ArrowRight') hdMover(1); else if (e.key === 'ArrowLeft') hdMover(-1);
  });

  window.cargarHoldedGlass = function () {
    const t = $('content-title'); if (t) t.textContent = 'Holded';
    $('content-body').innerHTML = '<div class="pv hd" id="hd-root"></div>';
    const c = $('hd-ficha'); if (c) c.remove();
    S.abierta = null;
    pintar();
    cargar();
  };
})();
