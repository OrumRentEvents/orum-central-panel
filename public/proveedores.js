/* ================================================================
   ORUM Central · Financiero → Facturas Proveedores (interfaz Liquid Glass)
   19 nov 2026. Solo la abre la interfaz glass (public/glass.js sustituye
   cargarFacturasProveedores); el diseño clásico sigue con su tabla de siempre.
   NO tiene datos propios: lee /api/facturas-proveedores?detalle=1 y guarda
   con /api/facturas-proveedores/actualizar, igual que la tabla clásica.
   Al entrar se ve el MES EN CURSO (petición del usuario).
   Pestañas: Mes · Facturas · Proveedores · Vehículos · Análisis.
   ================================================================ */
(function () {
  const TZ = 'Europe/Madrid';
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  // Mismos tipos que lib/lecturaFacturas.js (TIPOS_GASTO_VEHICULO)
  const TIPOS_VEH = {
    combustible: { n: 'Combustible', c: '#C9822B' }, adblue: { n: 'AdBlue', c: '#5B8DEF' }, neumaticos: { n: 'Neumáticos', c: '#4A4540' },
    reparacion: { n: 'Reparación', c: '#C0392B' }, revision: { n: 'Revisión', c: '#2E9D5B' }, itv: { n: 'ITV', c: '#8E6CC9' },
    seguro: { n: 'Seguro', c: '#3C8C93' }, lavado: { n: 'Lavado', c: '#7FB4D9' }, peajes: { n: 'Peajes y parking', c: '#B8956A' },
    renting: { n: 'Renting', c: '#9C7A54' }, otro: { n: 'Otro', c: '#A9A196' },
    sin: { n: 'Sin tipo', c: '#D9D2C7' } // gasto de vehículo al que aún no se le ha puesto tipo
  };
  const FORMAS_PAGO = ['Transferencia', 'Tarjeta', 'Domiciliación', 'Efectivo', 'Otro'];
  const PALETA = ['#B8956A', '#5B8DEF', '#2E9D5B', '#C9822B', '#8E6CC9', '#3C8C93', '#C0392B', '#A9A196'];

  const S = {
    pestana: 'mes', mes: null, todoAnio: false, d: null, cargando: false,
    filtro: '', buscar: '', depto: '', abierta: null, vehiculos: null
  };

  // ── Utilidades ──
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => parseFloat(v) || 0;
  const eur = v => num(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }) + ' €';
  const eur0 = v => Math.round(num(v)).toLocaleString('es-ES', { useGrouping: 'always' }) + ' €';
  const hoyMes = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  const usuario = () => { try { return usuarioActual || window.usuarioActual || null; } catch (e) { return window.usuarioActual || null; } };
  const normal = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const iniciales = s => String(s || '?').replace(/[^A-Za-zÁÉÍÓÚÑ0-9 ]/gi, ' ').trim().split(/\s+/).filter(w => w.length > 1 && !/^(SL|SA|SLU|SAU|DE|LA|EL|Y)$/i.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  const colorDe = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 997; return PALETA[h % PALETA.length]; };
  const mesOk = f => f.mes >= 1 && f.mes <= 12; // hay alguna fecha mal escrita (p. ej. 08/19/2026)
  const mesDe = f => (f.anio && mesOk(f)) ? f.anio + '-' + String(f.mes).padStart(2, '0') : '';
  const baseDe = f => num(f.importeBase_propio ?? f.importeBase);
  const ivaDe = f => num(f.iva_propio ?? f.iva);
  const anioSel = () => Number(S.mes.slice(0, 4));
  const mesSel = () => Number(S.mes.slice(5, 7));
  const textoMes = m => { const t = MESES[Number(m.slice(5, 7)) - 1]; return t[0].toUpperCase() + t.slice(1) + ' ' + m.slice(0, 4); };
  const sumarMes = (m, n) => { const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const ico = d => `<svg viewBox="0 0 24 24">${d}</svg>`;
  const I = {
    subir: ico('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'),
    alerta: ico('<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17v.5"/>'),
    reloj: ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    izq: ico('<path d="m15 6-6 6 6 6"/>'), der: ico('<path d="m9 6 6 6-6 6"/>'), cerrar: ico('<path d="M6 6l12 12M18 6 6 18"/>'),
    euro: ico('<path d="M17 6.5A7 7 0 1 0 17 17.5"/><path d="M4 10h9M4 14h9"/>'), doc: ico('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>'),
    lupa: ico('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>'), pago: ico('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>'),
    ojo: ico('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>'), ok: ico('<path d="m5 12 4.5 4.5L19 7"/>'),
    camion: ico('<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>'),
    holded: ico('<path d="M4 4h16v16H4z"/><path d="M8 12l3 3 5-6"/>'), historial: ico('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 8v4l3 2"/>'),
    papelera: ico('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'), externo: ico('<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>'),
    copia: ico('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
    nota: ico('<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4M8 9h8M8 13h5"/>'),
    mas: ico('<path d="M12 5v14M5 12h14"/>'), menos: ico('<path d="M5 12h14"/>'), girar: ico('<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>'),
    ajustar: ico('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'), ancho: ico('<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>')
  };

  function toast(txt, error) {
    let t = $('pv-toast');
    if (!t) { t = document.createElement('div'); t.id = 'pv-toast'; document.body.appendChild(t); }
    t.textContent = txt; t.className = 'pv-toast visible' + (error ? ' error' : '');
    clearTimeout(t._h); t._h = setTimeout(() => { t.className = 'pv-toast'; }, error ? 5000 : 2000);
  }

  // ── Estado de cada línea ──
  // Orden de prioridad: Contabilizada > Revisar (lectura dudosa) > Sin pago > Pendiente de Holded.
  // Una contabilizada ya no tiene nada pendiente aunque no tenga forma de pago
  // (hay ~80 antiguas así, contabilizadas antes de Holded).
  function estado(f) {
    if (f.contabilizada) return { k: 'ok', n: 'Contabilizada' };
    if (f.confianza && f.confianza !== 'alta') return { k: 'revisar', n: 'Revisar' };
    if (!f.formaPago) return { k: 'sinpago', n: 'Sin pago' };
    return { k: 'holded', n: 'Pendiente Holded' };
  }
  const esVehiculo = f => f.tipoGasto === 'vehiculos' || !!f.matricula || !!f.gastoVehiculo;

  // ── Posibles duplicadas (19 nov 2026) ──
  // Misma fecha, mismo total, proveedor parecido y número parecido (la IA confunde
  // I/1 y O/0, o añade el año delante: «2026 01FCO/47104»). Dos peajes del mismo día
  // con números distintos NO salen. «No es duplicada» las quita de la lista.
  const normNum = s => String(s || '').toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0').replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
  const normProv = s => normal(s).replace(/[^a-z0-9]/g, '').slice(0, 7);
  function distancia(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 99;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const numerosParecidos = (a, b) => { a = normNum(a); b = normNum(b); if (!a || !b) return false; return a === b || (a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b)) || (a.length >= 6 && distancia(a, b) <= 2); };
  let duplicadasCache = null;
  function duplicadas() {
    if (duplicadasCache) return duplicadasCache;
    const grupos = {}, mapa = {};
    lineas().forEach(f => { const k = f.fecha + '|' + num(f.importeTotal).toFixed(2) + '|' + normProv(f.proveedor); (grupos[k] = grupos[k] || []).push(f); });
    Object.values(grupos).forEach(g => {
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const a = g[i], b = g[j];
        if (String(a.fileId) === String(b.fileId) || a.noDuplicada || b.noDuplicada || !numerosParecidos(a.numeroFactura, b.numeroFactura)) continue;
        (mapa[a.fileId] = mapa[a.fileId] || []).push(b); (mapa[b.fileId] = mapa[b.fileId] || []).push(a);
      }
    });
    return (duplicadasCache = mapa);
  }
  const esDuplicada = f => !!duplicadas()[f.fileId];
  const PENDIENTES = [
    { k: 'revisar', n: 'Por revisar', d: 'La IA no la leyó con seguridad', ico: 'ojo', f: f => estado(f).k === 'revisar' },
    { k: 'sinpago', n: 'Sin forma de pago', d: 'No pasan a Holded hasta pagarlas', ico: 'pago', f: f => !f.formaPago && !f.contabilizada },
    { k: 'holded', n: 'Pendientes de Holded', d: 'Pagadas, falta aprobarlas', ico: 'holded', f: f => !!f.formaPago && !f.contabilizada },
    { k: 'sinmatricula', n: 'Vehículo sin matrícula', d: 'Gasto de vehículo sin asignar', ico: 'camion', f: f => esVehiculo(f) && !f.matricula },
    { k: 'duplicadas', n: 'Posibles duplicadas', d: 'Misma fecha, importe y nº parecido', ico: 'copia', f: f => esDuplicada(f) }
  ];

  // ── Carga ──
  async function cargar() {
    S.cargando = true; pintar();
    try {
      const r = await fetch('/api/facturas-proveedores?detalle=1');
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Error ' + r.status);
      S.d = d; duplicadasCache = null;
      try { facturasProveedoresDataGlobal = d; } catch (e) { /* la usa eliminarFacturaProveedor del panel */ }
    } catch (e) { S.error = e.message; }
    S.cargando = false; pintar();
    if (S.abierta) pintarFicha();
  }
  async function cargarVehiculos() {
    if (S.vehiculos) return S.vehiculos;
    try { const r = await fetch('/api/vehiculos/lista'); const j = await r.json(); S.vehiculos = (j.ok && j.vehiculos) || []; }
    catch (e) { S.vehiculos = []; }
    if (!S.vehiculos.length && typeof VEHICULOS_ORUM_FACTURAS !== 'undefined') S.vehiculos = VEHICULOS_ORUM_FACTURAS.map(v => ({ matricula: v.matricula, label: v.label }));
    return S.vehiculos;
  }

  const lineas = () => (S.d && S.d.facturas) || [];
  const delPeriodo = () => S.todoAnio ? lineas().filter(f => f.anio === anioSel()) : lineas().filter(f => mesDe(f) === S.mes);

  // ── Pintado general ──
  function pintar() {
    const root = $('pv-root'); if (!root) return;
    const pest = [['mes', 'Resumen del mes'], ['facturas', 'Facturas'], ['proveedores', 'Proveedores'], ['vehiculos', 'Vehículos'], ['analisis', 'Análisis']];
    const u = usuario() || {};
    const cabecera = `
      <div class="pv-barra">
        <div class="pv-pestanas g-vidrio">${pest.map(([k, n]) => `<button class="pv-pestana ${S.pestana === k ? 'activa' : ''}" onclick="pvIr('${k}')">${n}</button>`).join('')}</div>
        <div class="pv-acciones">
          <div class="pv-periodo g-vidrio">
            <button class="pv-flecha" onclick="pvMes(-1)" title="${S.todoAnio ? 'Año anterior' : 'Mes anterior'}">${I.izq}</button>
            <span>${S.todoAnio ? 'Año ' + anioSel() : textoMes(S.mes)}</span>
            <button class="pv-flecha" onclick="pvMes(1)" title="${S.todoAnio ? 'Año siguiente' : 'Mes siguiente'}">${I.der}</button>
            <button class="pv-mini ${S.todoAnio ? 'activo' : ''}" onclick="pvTodoAnio()">Todo el año</button>
            ${S.mes !== hoyMes() || S.todoAnio ? `<button class="pv-mini" onclick="pvHoy()">Mes actual</button>` : ''}
          </div>
          <button class="pv-boton prim" onclick="abrirSubirFacturas()">${I.subir}Subir facturas</button>
          <button class="pv-boton g-vidrio" onclick="abrirErroresFacturas()" title="Facturas que no se pudieron leer">${I.alerta}</button>
          <button class="pv-boton g-vidrio" onclick="abrirHistoricoImportaciones()" title="Histórico de importaciones">${I.reloj}</button>
          ${['Direccion', 'Contabilidad'].includes(u.rol) ? `<button class="pv-boton g-vidrio" onclick="pvAbrirHolded()" title="Abrir Holded (aprobar y volcar)">Holded ${I.externo}</button>` : ''}
        </div>
      </div>`;
    let cuerpo;
    if (S.cargando && !S.d) cuerpo = '<div class="pv-panel g-vidrio pv-vacio">Cargando facturas…</div>';
    else if (S.error && !S.d) cuerpo = `<div class="pv-panel g-vidrio pv-vacio rojo">No se han podido cargar: ${esc(S.error)}</div>`;
    else cuerpo = ({ mes: vistaMes, facturas: vistaFacturas, proveedores: vistaProveedores, vehiculos: vistaVehiculos, analisis: vistaAnalisis })[S.pestana]();
    root.innerHTML = cabecera + `<div class="pv-cuerpo" key="${S.pestana}">${cuerpo}</div>`;
    animar(root);
  }
  // Barras que se llenan y números que suben al entrar
  function animar(root) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      root.querySelectorAll('[data-ancho]').forEach(b => { b.style.width = b.dataset.ancho; });
      root.querySelectorAll('[data-alto]').forEach(b => { b.setAttribute('height', b.dataset.alto); b.setAttribute('y', b.dataset.y); });
    }));
    root.querySelectorAll('[data-cuenta]').forEach(el => {
      const fin = Number(el.dataset.cuenta), dec = el.dataset.dec === '1', t0 = performance.now();
      const paso = t => { const p = Math.min(1, (t - t0) / 700), v = fin * (1 - Math.pow(1 - p, 3)); el.textContent = dec ? eur0(v) : Math.round(v).toLocaleString('es-ES'); if (p < 1) requestAnimationFrame(paso); };
      requestAnimationFrame(paso);
    });
  }

  // ── Pestaña: Resumen del mes ──
  function vistaMes() {
    const per = delPeriodo();
    const total = per.reduce((s, f) => s + baseDe(f), 0), iva = per.reduce((s, f) => s + ivaDe(f), 0);
    const nFact = new Set(per.map(f => f.fileId)).size;
    // Comparación con el mismo periodo del año anterior
    const antes = S.todoAnio ? lineas().filter(f => f.anio === anioSel() - 1) : lineas().filter(f => mesDe(f) === (anioSel() - 1) + '-' + S.mes.slice(5));
    const totalAntes = antes.reduce((s, f) => s + baseDe(f), 0);
    const varPct = totalAntes > 0 ? Math.round((total - totalAntes) / totalAntes * 100) : null;
    const nombrePer = S.todoAnio ? 'el año' : 'el mes';
    const kpis = `
      <div class="pv-kpis">
        <div class="pv-kpi g-vidrio grande"><small>Gasto de ${nombrePer} (sin IVA)</small><strong data-cuenta="${Math.round(total)}" data-dec="1">${eur0(total)}</strong>
          ${varPct !== null ? `<span class="pv-pildora ${varPct > 0 ? 'sube' : 'baja'}">${varPct > 0 ? '▲' : '▼'} ${Math.abs(varPct)} % vs ${S.todoAnio ? anioSel() - 1 : MES_CORTO[mesSel() - 1] + ' ' + (anioSel() - 1)}</span>` : '<span class="pv-sutil">Sin datos del año anterior</span>'}</div>
        <div class="pv-kpi g-vidrio"><small>IVA soportado</small><strong data-cuenta="${Math.round(iva)}" data-dec="1">${eur0(iva)}</strong></div>
        <div class="pv-kpi g-vidrio"><small>Facturas</small><strong data-cuenta="${nFact}">${nFact}</strong></div>
        <div class="pv-kpi g-vidrio"><small>Proveedores</small><strong data-cuenta="${new Set(per.map(f => f.proveedor)).size}">${new Set(per.map(f => f.proveedor)).size}</strong></div>
      </div>`;
    // Lo pendiente es de TODAS las facturas (no solo del mes): es lo que hay que vaciar
    const pend = `
      <div class="pv-pendientes">${PENDIENTES.map(p => {
        const n = lineas().filter(p.f).length;
        return `<button class="pv-pend g-vidrio ${n ? 'hay' : 'cero'} k-${p.k}" onclick="pvFiltro('${p.k}')">
          <span class="pv-pend-ico">${n ? I[p.ico] : I.ok}</span><span><strong>${n}</strong><b>${p.n}</b><small>${n ? p.d : 'Todo al día'}</small></span></button>`;
      }).join('')}</div>`;
    // Por departamento
    const porDep = {};
    per.forEach(f => (f.desglose_departamentos || []).forEach(d => { porDep[d.departamento] = (porDep[d.departamento] || 0) + num(d.importe); }));
    const deps = Object.entries(porDep).sort((a, b) => b[1] - a[1]);
    const maxDep = deps.length ? deps[0][1] : 1;
    const bloqueDep = `<div class="pv-panel g-vidrio"><h3>Por departamento</h3>${deps.length ? deps.map(([n, v], i) => `
      <button class="pv-barra-h" onclick="pvDepto('${esc(n).replace(/'/g, "\\'")}')" title="Ver sus facturas">
        <span class="pv-bh-nombre">${esc(n)}</span><span class="pv-bh-pista"><i style="background:${PALETA[i % PALETA.length]}" data-ancho="${Math.max(2, v / maxDep * 100)}%"></i></span><span class="pv-bh-valor">${eur0(v)}</span></button>`).join('') : '<p class="pv-sutil">Sin facturas en este periodo.</p>'}</div>`;
    // Top proveedores
    const porProv = {};
    per.forEach(f => { porProv[f.proveedor] = (porProv[f.proveedor] || 0) + baseDe(f); });
    const top = Object.entries(porProv).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const bloqueTop = `<div class="pv-panel g-vidrio"><h3>Proveedores que más cuestan</h3>${top.length ? top.map(([n, v]) => `
      <button class="pv-fila-prov" onclick="pvBuscarProv('${esc(n).replace(/'/g, "\\'")}')">${avatar(n)}<span class="pv-fp-nombre">${esc(n)}</span><span class="pv-fp-pct">${total ? Math.round(v / total * 100) : 0} %</span><b>${eur0(v)}</b></button>`).join('') : '<p class="pv-sutil">—</p>'}</div>`;
    // (19 nov 2026) El bloque de Vehículos ya no sale en el resumen: está en su pestaña.
    // Últimas facturas
    const ultimas = [...per].sort((a, b) => String(b.procesadoEn || '').localeCompare(String(a.procesadoEn || ''))).slice(0, 7);
    const bloqueUlt = `<div class="pv-panel g-vidrio pv-ultimas"><h3>Últimas facturas ${S.todoAnio ? 'del año' : 'del mes'} <button class="pv-enlace" onclick="pvIr('facturas')">Ver todas →</button></h3>
      ${ultimas.length ? ultimas.map(f => filaCompacta(f)).join('') : '<p class="pv-sutil">Aún no hay facturas en este periodo. Súbelas con «Subir facturas».</p>'}</div>`;
    return kpis + pend + `<div class="pv-rejilla dos">${bloqueDep}${bloqueTop}</div>` + bloqueUlt;
  }
  // Logo del proveedor: icono de su web (tabla proveedores_web); si no hay o no carga, sus iniciales
  const webDe = n => (S.d && S.d.webs && S.d.webs[n]) || '';
  const avatar = n => {
    const w = webDe(n);
    return `<span class="pv-avatar" style="--c:${colorDe(n)}">${esc(iniciales(n))}${w ? `<img src="https://icons.duckduckgo.com/ip3/${encodeURIComponent(w)}.ico" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
  };
  const marcas = f => (esDuplicada(f) ? `<span class="pv-marca dup" title="Posible duplicada">${I.copia}</span>` : '') + (f.notas ? `<span class="pv-marca" title="${esc(f.notas)}">${I.nota}</span>` : '');
  const pildora = f => { const e = estado(f); return `<span class="pv-estado e-${e.k}">${e.n}</span>`; };
  function filaCompacta(f) {
    return `<button class="pv-fila-c" onclick="pvAbrir('${esc(f.fileId)}')">${avatar(f.proveedor)}
      <span class="pv-fc-txt"><b>${esc(f.proveedor)} ${marcas(f)}</b><small>${esc(f.concepto || ('Nº ' + (f.numeroFactura || '—')))}</small></span>
      <span class="pv-fc-fecha">${esc(f.fecha)}</span>${pildora(f)}<strong>${eur(f.importeTotal)}</strong></button>`;
  }

  // ── Pestaña: Facturas ──
  function vistaFacturas() {
    const filtros = [['', 'Todas'], ...PENDIENTES.map(p => [p.k, p.n]), ['vehiculos', 'Vehículos']];
    let lista = S.filtro ? lineas() : delPeriodo(); // los pendientes se buscan en todas las fechas
    if (S.filtro === 'vehiculos') lista = delPeriodo().filter(esVehiculo);
    else if (S.filtro) { const p = PENDIENTES.find(x => x.k === S.filtro); lista = lista.filter(p.f); }
    if (S.depto) lista = lista.filter(f => (f.desglose_departamentos || []).some(d => d.departamento === S.depto));
    if (S.buscar) {
      const b = normal(S.buscar);
      lista = lista.filter(f => normal(f.proveedor).includes(b) || normal(f.numeroFactura).includes(b) || normal(f.concepto).includes(b) || normal(f.notas).includes(b) || normal(f.matricula).includes(b) || String(f.importeTotal).includes(b.replace(',', '.')));
    }
    lista = [...lista].sort((a, b) => (b.anio - a.anio) || (b.mes - a.mes) || String(b.fecha).split('/')[0].localeCompare(String(a.fecha).split('/')[0]));
    const total = lista.reduce((s, f) => s + num(f.importeTotal), 0);
    const filas = lista.map(f => {
      const deps = (f.desglose_departamentos || []).map(d => `<span class="pv-dep">${esc(d.departamento)}${d.porcentaje < 100 ? ' ' + d.porcentaje + '%' : ''}</span>`).join('');
      const veh = f.matricula ? `<span class="pv-dep veh">${esc(f.matricula)}${f.gastoVehiculo ? ' · ' + esc((TIPOS_VEH[f.gastoVehiculo] || TIPOS_VEH.otro).n) : ''}</span>` : '';
      return `<tr class="${S.abierta === String(f.fileId) ? 'sel' : ''}" onclick="pvAbrir('${esc(f.fileId)}')">
        <td><div class="pv-celda-prov">${avatar(f.proveedor)}<span><b>${esc(f.proveedor)} ${marcas(f)}</b><small>${esc(f.concepto || '')}</small></span></div></td>
        <td><b class="pv-num">${esc(f.numeroFactura || '—')}</b><small class="pv-sutil">${esc(f.fecha)}</small></td>
        <td>${deps}${veh}</td>
        <td>${pildora(f)}</td>
        <td class="pv-sutil">${esc(f.formaPago || '—')}</td>
        <td class="n"><b>${eur(f.importeTotal)}</b><small class="pv-sutil">${eur(f.importeBase)} + IVA</small></td></tr>`;
    }).join('');
    const etiquetaPer = S.filtro && S.filtro !== 'vehiculos' ? 'todas las fechas' : (S.todoAnio ? 'año ' + anioSel() : textoMes(S.mes).toLowerCase());
    return `
      <div class="pv-filtros">
        <div class="pv-chips">${filtros.map(([k, n]) => `<button class="pv-chip ${S.filtro === k ? 'activo' : ''}" onclick="pvFiltro('${k}')">${n}${k && k !== 'vehiculos' ? ` <em>${lineas().filter(PENDIENTES.find(p => p.k === k).f).length}</em>` : ''}</button>`).join('')}
          ${S.depto ? `<button class="pv-chip activo" onclick="pvDepto('')">${esc(S.depto)} ✕</button>` : ''}</div>
        <label class="pv-buscar g-vidrio">${I.lupa}<input id="pv-buscar" placeholder="Proveedor, nº, concepto, matrícula o importe" value="${esc(S.buscar)}" oninput="pvBuscar(this.value)"></label>
      </div>
      <div class="pv-panel g-vidrio pv-tabla-panel">
        <div class="pv-tabla-cab"><span>${lista.length} líneas · ${etiquetaPer}</span><b>${eur(total)}</b></div>
        <div class="pv-tabla-wrap"><table class="pv-tabla"><thead><tr><th>Proveedor</th><th>Nº · fecha</th><th>Departamento</th><th>Estado</th><th>Pago</th><th class="n">Total</th></tr></thead>
        <tbody>${filas || '<tr><td colspan="6" class="pv-vacio">Nada con este filtro.</td></tr>'}</tbody></table></div>
      </div>`;
  }

  // ── Ficha lateral de una factura ──
  function pintarFicha() {
    let cont = $('pv-ficha');
    const ls = lineas().filter(f => String(f.fileId) === String(S.abierta));
    if (!S.abierta || !ls.length) { if (cont) cont.remove(); S.abierta = null; return; }
    if (!cont) {
      cont = document.createElement('div'); cont.id = 'pv-ficha'; cont.className = 'pv-ficha-fondo';
      cont.onclick = e => { if (e.target === cont) pvCerrar(); };
      document.body.appendChild(cont);
    }
    const f = ls[0], u = usuario() || {};
    const total = ls.reduce((s, x) => s + num(x.importeTotal), 0);
    const id = esc(f.fileId);
    const flota = (S.vehiculos || (typeof VEHICULOS_ORUM_FACTURAS !== 'undefined' ? VEHICULOS_ORUM_FACTURAS : []));
    const enFlota = !f.matricula || flota.some(v => v.matricula === f.matricula);
    const campo = (etq, c, valor, tipo, ancho) => `<label class="pv-campo ${ancho || ''}"><span>${etq}</span><input type="${tipo || 'text'}" ${tipo === 'number' ? 'step="0.01"' : ''} value="${esc(valor ?? '')}" onchange="pvGuardar(this,'${c}')"></label>`;
    const periodos = ls.map(x => `<div class="pv-periodo-l" data-fila="${esc(x.fila)}">
        ${campo('Fecha', 'fecha', x.fecha)}${campo('Base', 'importeBase', x.importeBase, 'number')}${campo('IVA', 'iva', x.iva, 'number')}${campo('Total', 'importeTotal', x.importeTotal, 'number')}</div>`).join('');
    const deps = (f.desglose_departamentos || []).map(d => `<span class="pv-dep">${esc(d.departamento)} · ${d.porcentaje}% · ${eur(d.importe)}</span>`).join('');
    // Al volver a pintar la misma factura (tras guardar un dato) se conserva el visor tal cual
    // (zoom, giro y el PDF ya cargado: su enlace firmado caduca al minuto)
    const visorPrevio = VIS.fileId === String(f.fileId) ? $('pv-visor') : null;
    if (visorPrevio) visorPrevio.remove();
    cont.innerHTML = `<aside class="pv-ficha g-vidrio">
      <header>${avatar(f.proveedor)}<div><small>${f.rectificativa ? 'Factura rectificativa' : 'Factura'} ${esc(f.numeroFactura || '')}</small><h2>${esc(f.proveedor)}</h2></div>
        <strong>${eur(total)}</strong>${window.pvFichaNav ? window.pvFichaNav(String(f.fileId)) : ''}<button class="pv-flecha" onclick="pvCerrar()" title="Cerrar">${I.cerrar}</button></header>
      <div class="pv-ficha-cuerpo">
        <div class="pv-visor">
          <div class="pv-visor-barra">
            <button class="pv-mini" onclick="pvVisor('ajustar')" title="Ver la factura entera">${I.ajustar}Ajustar</button>
            <button class="pv-mini" onclick="pvVisor('ancho')" title="Ajustar al ancho">${I.ancho}Ancho</button>
            <button class="pv-flecha" onclick="pvVisor('menos')" title="Alejar">${I.menos}</button>
            <button class="pv-flecha" onclick="pvVisor('mas')" title="Acercar">${I.mas}</button>
            <button class="pv-flecha" id="pv-visor-girar" onclick="pvVisor('girar')" title="Girar la foto">${I.girar}</button>
            <button class="pv-mini" style="margin-left:auto" onclick="verArchivoFactura('${id}')">Abrir en otra pestaña ${I.externo}</button>
          </div>
          <div class="pv-visor-marco" id="pv-visor"><div class="pv-vacio">Cargando la factura…</div></div>
        </div>
        <div class="pv-datos">
          ${window.pvFichaExtra ? window.pvFichaExtra(String(f.fileId)) : ''}
          <div class="pv-estado-linea">${pildora(f)} ${f.confianza ? `<span class="pv-sutil">Lectura de la IA: confianza ${esc(f.confianza)}</span>` : ''}
            ${estado(f).k === 'revisar' ? `<button class="pv-boton prim pv-revisada" onclick="pvRevisada()">${I.ok}Marcar como revisada</button>` : ''}</div>
          ${esDuplicada(f) ? `<div class="pv-duplicada">${I.copia}<div><b>Posible duplicada</b> de ${duplicadas()[f.fileId].map(o => `<button class="pv-enlace" onclick="pvAbrir('${esc(o.fileId)}')">${esc(o.proveedor)} nº ${esc(o.numeroFactura || '—')} (${esc(o.formaPago || 'sin pago')}${o.contabilizada ? ', contabilizada' : ''})</button>`).join(', ')}.
            <small>Misma fecha e importe y número casi igual. Si sobra una, elimínala; si no, márcalas como distintas.</small>
            <button class="pv-mini" onclick="pvNoDuplicada()">No es duplicada</button></div></div>` : ''}
          ${f.dudas ? `<p class="pv-dudas">${I.alerta}<span>${esc(f.dudas)}</span></p>` : ''}
          ${f.concepto ? `<p class="pv-concepto">${esc(f.concepto)}</p>` : ''}
          <h4>Datos de la factura</h4>
          <div class="pv-campos" data-fila="${esc(f.fila)}" data-todas="1">
            <label class="pv-campo ancho"><span>Proveedor <em class="pv-sutil">(elige de la lista para no duplicarlo)</em></span><input list="pv-lista-prov" value="${esc(f.proveedor)}" onchange="pvGuardarProveedor(this)">
              <datalist id="pv-lista-prov">${[...new Set(lineas().map(x => x.proveedor).filter(Boolean))].sort().map(p => `<option value="${esc(p)}">`).join('')}</datalist></label>
            ${campo('Nº de factura', 'numeroFactura', f.numeroFactura)}
            <label class="pv-campo"><span>Web (para el logo)</span><input placeholder="p. ej. euromaster.es" value="${esc(webDe(f.proveedor))}" onchange="pvGuardarWeb(this)"></label>
            ${f.vencimiento ? `<label class="pv-campo"><span>Vence</span><input disabled value="${esc(f.vencimiento.split('-').reverse().join('/'))}"></label>` : ''}
          </div>
          <h4>${ls.length > 1 ? ls.length + ' periodos' : 'Importes'}</h4>${periodos}
          <h4>Pago y contabilidad</h4>
          <div class="pv-campos" data-fila="${esc(f.fila)}" data-todas="1">
            <label class="pv-campo"><span>Forma de pago</span><select onchange="pvGuardar(this,'formaPago')"><option value="">Sin pagar</option>${FORMAS_PAGO.map(v => `<option ${v === f.formaPago ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
            <label class="pv-campo"><span>Holded</span><input disabled value="${f.contabilizada ? 'Contabilizada ✓' : 'Pendiente'}"></label>
          </div>
          <div class="pv-deps">${deps}</div>
          <h4>${I.camion} Vehículo</h4>
          <div class="pv-campos" data-fila="${esc(f.fila)}" data-todas="1">
            <label class="pv-campo"><span>Matrícula</span><select onchange="pvGuardar(this,'matricula')"><option value="">— No es de vehículo</option>
              ${flota.map(v => `<option value="${esc(v.matricula)}" ${v.matricula === f.matricula ? 'selected' : ''}>${esc(v.label || v.matricula)}</option>`).join('')}
              ${!enFlota ? `<option selected value="${esc(f.matricula)}">${esc(f.matricula)} (texto antiguo)</option>` : ''}</select></label>
            <label class="pv-campo"><span>Tipo de gasto</span><select onchange="pvGuardar(this,'gastoVehiculo')"><option value="">—</option>${Object.entries(TIPOS_VEH).filter(([k]) => k !== 'sin').map(([k, t]) => `<option value="${k}" ${k === f.gastoVehiculo ? 'selected' : ''}>${t.n}</option>`).join('')}</select></label>
            ${ls.length === 1 ? `<label class="pv-campo"><span>Litros</span><input type="number" step="0.01" value="${esc(f.litros ?? '')}" onchange="pvGuardar(this,'litros')"></label>` : ''}
          </div>
          <h4>${I.nota} Notas</h4>
          <div data-fila="${esc(f.fila)}" data-todas="1">
            <textarea class="pv-notas" placeholder="Cualquier aclaración sobre esta factura (se guarda al salir del cuadro)" onchange="pvGuardar(this,'notas')">${esc(f.notas || '')}</textarea>
          </div>
          <div class="pv-ficha-pie">
            <button class="pv-boton g-vidrio" onclick="abrirHistorialFactura('${id}')">${I.historial}Historial</button>
            ${u.rol === 'Direccion' && !f.contabilizada ? `<button class="pv-boton g-vidrio rojo" onclick="eliminarFacturaProveedor('${id}')">${I.papelera}Eliminar</button>` : ''}
          </div>
        </div>
      </div></aside>`;
    requestAnimationFrame(() => cont.classList.add('visible'));
    if (visorPrevio) { $('pv-visor').replaceWith(visorPrevio); const g = $('pv-visor-girar'); if (g) g.style.display = esFoto() ? '' : 'none'; }
    else cargarVisor(f.fileId);
    if (window.pvFichaDespues) window.pvFichaDespues(String(f.fileId));
  }

  // ── Visor de la factura: foto ajustable (zoom, ancho, girar) o PDF ──
  let VIS = { fileId: null };
  async function infoArchivo(fileId) {
    try { const r = await fetch('/api/facturas-proveedores/' + encodeURIComponent(fileId) + '/archivo?info=1'); if (r.ok) return await r.json(); } catch (e) { /* se usa el enlace directo */ }
    return { url: '/api/facturas-proveedores/' + encodeURIComponent(fileId) + '/archivo', mime: '' };
  }
  async function cargarVisor(fileId) {
    if (VIS.fileId !== String(fileId)) {
      VIS = { fileId: String(fileId), modo: 'ajustar', zoom: 1, giro: 0, url: '', mime: '' };
      Object.assign(VIS, await infoArchivo(fileId));
    }
    pintarVisor();
  }
  const esFoto = () => /^image\//.test(VIS.mime || '');
  async function pintarVisor(recargarPdf) {
    const marco = $('pv-visor'); if (!marco) return;
    const g = $('pv-visor-girar'); if (g) g.style.display = esFoto() ? '' : 'none';
    if (esFoto()) {
      if (!marco.querySelector('img')) {
        marco.innerHTML = `<div class="pv-img-caja"><div class="pv-lienzo"><img alt="Factura" src="${esc(VIS.url)}"></div></div>`;
        marco.querySelector('img').onload = ajustarFoto;
      }
      return ajustarFoto();
    }
    // PDF: el visor del navegador entiende #view=Fit / FitH / zoom=N. El enlace firmado
    // caduca en un minuto, así que al cambiar el zoom se pide uno nuevo.
    if (recargarPdf) Object.assign(VIS, await infoArchivo(VIS.fileId));
    const vista = VIS.zoom !== 1 ? 'zoom=' + Math.round(VIS.zoom * 100) : (VIS.modo === 'ancho' ? 'view=FitH' : 'view=Fit');
    marco.innerHTML = `<iframe title="Factura" src="${esc(VIS.url)}#${vista}"></iframe>`;
  }
  function ajustarFoto() {
    const caja = document.querySelector('#pv-visor .pv-img-caja'), img = caja && caja.querySelector('img');
    if (!img || !img.naturalWidth) return;
    const W = caja.clientWidth - 16, H = caja.clientHeight - 16, girada = VIS.giro % 180 !== 0;
    const w = img.naturalWidth, h = img.naturalHeight, wv = girada ? h : w, hv = girada ? w : h;
    const s = (VIS.modo === 'ancho' ? W / wv : Math.min(W / wv, H / hv)) * VIS.zoom;
    const lienzo = caja.querySelector('.pv-lienzo');
    lienzo.style.width = wv * s + 'px'; lienzo.style.height = hv * s + 'px';
    img.style.width = w * s + 'px'; img.style.height = h * s + 'px';
    img.style.transform = `translate(-50%, -50%) rotate(${VIS.giro}deg)`;
  }
  window.pvVisor = accion => {
    if (accion === 'ajustar' || accion === 'ancho') { VIS.modo = accion; VIS.zoom = 1; }
    else if (accion === 'mas') VIS.zoom = Math.min(5, VIS.zoom * 1.25);
    else if (accion === 'menos') VIS.zoom = Math.max(0.3, VIS.zoom / 1.25);
    else if (accion === 'girar') VIS.giro = (VIS.giro + 90) % 360;
    pintarVisor(true);
  };
  window.addEventListener('resize', () => { if (S.abierta && esFoto()) ajustarFoto(); });

  // Guarda en todas las líneas de la factura abierta (o de otra, con fileId)
  async function guardarEnFactura(campo, valor, fileId) {
    const filas = lineas().filter(x => String(x.fileId) === String(fileId || S.abierta));
    for (const x of filas) {
      const r = await fetch('/api/facturas-proveedores/actualizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fila: x.fila, campo, valor }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Error ' + r.status);
      x[campo] = valor;
    }
  }
  // «Marcar como revisada»: la lectura de la IA queda como buena y sale de «Por revisar»
  window.pvRevisada = async () => {
    try { await guardarEnFactura('confianza', 'alta'); toast('Marcada como revisada'); pintar(); pintarFicha(); }
    catch (e) { toast('No se ha guardado: ' + e.message, true); }
  };
  // «No es duplicada»: esta factura y las que se le parecían salen de «Posibles duplicadas»
  window.pvNoDuplicada = async () => {
    const otras = duplicadas()[S.abierta] || [];
    try {
      await guardarEnFactura('noDuplicada', true);
      for (const o of otras) await guardarEnFactura('noDuplicada', true, o.fileId);
      duplicadasCache = null; toast('Marcadas como facturas distintas'); pintar(); pintarFicha();
    } catch (e) { toast('No se ha guardado: ' + e.message, true); }
  };
  // Proveedor: se elige de la lista; si se escribe uno nuevo, se pregunta antes (evita duplicados)
  window.pvGuardarProveedor = el => {
    const v = el.value.trim();
    const existe = lineas().some(x => x.proveedor === v);
    if (!v) { el.value = (lineas().find(x => String(x.fileId) === S.abierta) || {}).proveedor || ''; return; }
    if (!existe && !confirm(`«${v}» no está en la lista: se creará como proveedor nuevo (sin reparto por departamento).\n\n¿Seguro? Si ya existe con otro nombre, cancela y elígelo de la lista.`)) {
      el.value = (lineas().find(x => String(x.fileId) === S.abierta) || {}).proveedor || ''; return;
    }
    el.value = v; guardar(el, 'proveedor');
  };
  window.pvGuardarWeb = async el => {
    const f = lineas().find(x => String(x.fileId) === S.abierta); if (!f) return;
    try {
      const r = await fetch('/api/facturas-proveedores/web', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proveedor: f.proveedor, dominio: el.value }) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || 'Error ' + r.status);
      S.d.webs = S.d.webs || {};
      if (d.dominio) S.d.webs[f.proveedor] = d.dominio; else delete S.d.webs[f.proveedor];
      toast(d.dominio ? 'Logo guardado' : 'Web quitada'); pintar(); pintarFicha();
    } catch (e) { toast('No se ha guardado: ' + e.message, true); }
  };

  // Guarda un campo. Los de [data-todas] van a todas las líneas (periodos) de la factura.
  async function guardar(el, campo) {
    const cont = el.closest('[data-fila]');
    const todas = cont && cont.dataset.todas === '1';
    const filas = todas ? lineas().filter(f => String(f.fileId) === String(S.abierta)).map(f => f.fila) : [cont.dataset.fila];
    const valor = el.value;
    el.disabled = true;
    try {
      for (const fila of filas) {
        const r = await fetch('/api/facturas-proveedores/actualizar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fila, campo, valor }) });
        const d = await r.json();
        if (!r.ok || d.error) throw new Error(d.error || 'Error ' + r.status);
        const f = lineas().find(x => String(x.fila) === String(fila));
        if (f) {
          f[campo] = ['importeBase', 'iva', 'importeTotal', 'litros'].includes(campo) ? (valor === '' ? null : Number(valor)) : valor;
          if (campo === 'matricula' || campo === 'gastoVehiculo') { if (f.matricula || f.gastoVehiculo) f.tipoGasto = 'vehiculos'; }
          if (campo === 'fecha') { const p = valor.split('/'); if (p.length === 3) { f.mes = Number(p[1]); f.anio = Number(p[2].length === 2 ? '20' + p[2] : p[2]); } }
          if (campo === 'importeBase' && !f.porcentaje_externo) f.importeBase_propio = f.importeBase;
          if (campo === 'iva' && !f.porcentaje_externo) f.iva_propio = f.iva;
        }
      }
      toast('Guardado');
      if (['proveedor', 'numeroFactura', 'fecha', 'importeTotal'].includes(campo)) duplicadasCache = null;
      // Cambiar el proveedor cambia el reparto por departamento: se recarga del servidor
      if (campo === 'proveedor') return cargar();
      pintar(); pintarFicha();
    } catch (e) { toast('No se ha guardado: ' + e.message, true); el.disabled = false; }
  }

  // ── Pestaña: Proveedores ──
  function vistaProveedores() {
    const anio = anioSel();
    const del = lineas().filter(f => f.anio === anio);
    const prov = {};
    del.forEach(f => {
      const p = prov[f.proveedor] = prov[f.proveedor] || { n: f.proveedor, total: 0, facturas: new Set(), meses: Array(12).fill(0), deps: new Set(), ultima: '', veh: false };
      p.total += baseDe(f); p.facturas.add(f.fileId); if (mesOk(f)) p.meses[f.mes - 1] += baseDe(f);
      (f.desglose_departamentos || []).forEach(d => p.deps.add(d.departamento));
      if (esVehiculo(f)) p.veh = true;
    });
    let lista = Object.values(prov).sort((a, b) => b.total - a.total);
    if (S.buscar) { const b = normal(S.buscar); lista = lista.filter(p => normal(p.n).includes(b)); }
    const sinClasificar = (S.d.proveedores_sin_clasificar || []);
    const tarjetas = lista.map(p => {
      const max = Math.max(...p.meses, 1);
      const mesActual = Number(hoyMes().slice(5)) - 1;
      // Aviso: gasto de este mes muy por encima de su media de los meses con factura
      const conGasto = p.meses.filter((v, i) => v > 0 && i !== mesActual);
      const media = conGasto.length ? conGasto.reduce((s, v) => s + v, 0) / conGasto.length : 0;
      const alto = anio === Number(hoyMes().slice(0, 4)) && media > 0 && conGasto.length >= 3 && p.meses[mesActual] > media * 1.4;
      return `<button class="pv-tarjeta g-vidrio" onclick="pvBuscarProv('${esc(p.n).replace(/'/g, "\\'")}')">
        <div class="pv-t-cab">${avatar(p.n)}<span><b>${esc(p.n)}</b><small>${p.facturas.size} factura${p.facturas.size === 1 ? '' : 's'} · ${[...p.deps].map(esc).join(', ') || 'Sin clasificar'}</small></span></div>
        <div class="pv-t-cifra"><strong>${eur0(p.total)}</strong>${p.veh ? `<span class="pv-dep veh">${I.camion}</span>` : ''}</div>
        <svg class="pv-spark" viewBox="0 0 120 30" preserveAspectRatio="none">${p.meses.map((v, i) => `<rect x="${i * 10 + 1}" width="8" y="30" height="0" data-y="${30 - v / max * 28}" data-alto="${v / max * 28}" rx="1.5" class="${i === mesActual ? 'actual' : ''}"/>`).join('')}</svg>
        ${alto ? `<span class="pv-aviso">${I.alerta} Este mes ${Math.round((p.meses[mesActual] / media - 1) * 100)} % por encima de lo normal</span>` : ''}
      </button>`;
    }).join('');
    return `
      <div class="pv-filtros">
        <div class="pv-sutil">${lista.length} proveedores con facturas en ${anio}. Pulsa uno para ver sus facturas.</div>
        <label class="pv-buscar g-vidrio">${I.lupa}<input id="pv-buscar" placeholder="Buscar proveedor" value="${esc(S.buscar)}" oninput="pvBuscar(this.value)"></label>
      </div>
      ${sinClasificar.length ? `<div class="pv-panel g-vidrio pv-aviso-panel">${I.alerta}<span><b>${sinClasificar.length} proveedores sin departamento:</b> ${sinClasificar.slice(0, 6).map(esc).join(', ')}${sinClasificar.length > 6 ? '…' : ''}</span>
        <button class="pv-mini" onclick="cargarConfiguracionProveedores()">Configurar reparto</button></div>` : ''}
      <div class="pv-tarjetas">${tarjetas || '<div class="pv-panel g-vidrio pv-vacio">Sin proveedores en este año.</div>'}</div>
      <div class="pv-config">
        <button class="pv-boton g-vidrio" onclick="cargarConfiguracionProveedores()">Reparto por departamento</button>
        ${['Direccion', 'Contabilidad'].includes((usuario() || {}).rol) ? '<button class="pv-boton g-vidrio" onclick="cargarCuentasGasto()">Cuentas contables</button>' : ''}
      </div>`;
  }

  // ── Pestaña: Vehículos ──
  function vistaVehiculos() {
    if (!S.vehiculos) { cargarVehiculos().then(() => { if (S.pestana === 'vehiculos') pintar(); }); return '<div class="pv-panel g-vidrio pv-vacio">Cargando flota…</div>'; }
    const anio = anioSel();
    const delAnio = lineas().filter(f => f.anio === anio && esVehiculo(f));
    const porMat = {};
    delAnio.forEach(f => {
      const m = f.matricula || '—';
      const v = porMat[m] = porMat[m] || { anio: 0, mes: 0, tipos: {}, litros: 0, n: 0 };
      v.anio += baseDe(f); v.n++;
      if (mesDe(f) === S.mes) v.mes += baseDe(f);
      const t = f.gastoVehiculo || 'sin'; v.tipos[t] = (v.tipos[t] || 0) + baseDe(f);
      if (f.gastoVehiculo === 'combustible') v.litros += num(f.litros);
    });
    const maxAnio = Math.max(1, ...Object.values(porMat).map(v => v.anio));
    const tarjeta = (veh, m) => {
      const v = porMat[m] || { anio: 0, mes: 0, tipos: {}, litros: 0, n: 0 };
      const tipos = Object.entries(v.tipos).sort((a, b) => b[1] - a[1]);
      const nombre = veh ? (veh.label || m).replace(m + ' · ', '') : 'Sin matrícula';
      return `<div class="pv-veh g-vidrio ${veh && veh.id ? 'clic' : ''}" ${veh && veh.id ? `onclick="pvFichaVehiculo(${veh.id})" title="Abrir su ficha (pestaña Gastos)"` : ''}>
        <div class="pv-veh-cab"><span class="pv-veh-ico">${I.camion}</span><span><b>${esc(nombre)}</b><small>${esc(m)}</small></span></div>
        <div class="pv-veh-cifras"><div><small>${MES_CORTO[mesSel() - 1]} ${anio}</small><strong>${eur0(v.mes)}</strong></div><div><small>Año ${anio}</small><strong>${eur0(v.anio)}</strong></div><div><small>Gastos</small><strong>${v.n}</strong></div></div>
        <div class="pv-bh-pista ancha"><i style="background:var(--g-champ)" data-ancho="${v.anio / maxAnio * 100}%"></i></div>
        ${tipos.length ? `<div class="pv-leyenda">${tipos.map(([t, x]) => `<span><i style="background:${(TIPOS_VEH[t] || TIPOS_VEH.otro).c}"></i>${(TIPOS_VEH[t] || TIPOS_VEH.otro).n} <b>${eur0(x)}</b></span>`).join('')}</div>` : '<p class="pv-sutil">Sin gastos este año.</p>'}
      </div>`;
    };
    const flota = S.vehiculos.filter(v => v.matricula);
    const sinMat = delAnio.filter(f => !f.matricula);
    const fuera = Object.keys(porMat).filter(m => m !== '—' && !flota.some(v => v.matricula === m));
    const totalAnio = delAnio.reduce((s, f) => s + baseDe(f), 0);
    const porTipo = {};
    delAnio.forEach(f => { const t = f.gastoVehiculo || 'sin'; porTipo[t] = (porTipo[t] || 0) + baseDe(f); });
    return `
      <div class="pv-panel g-vidrio pv-veh-resumen"><div><small>Gasto en vehículos ${anio}</small><strong data-cuenta="${Math.round(totalAnio)}" data-dec="1">${eur0(totalAnio)}</strong></div>
        ${totalAnio ? `<div class="pv-apilada grande">${Object.entries(porTipo).sort((a, b) => b[1] - a[1]).map(([t, v]) => `<i style="background:${(TIPOS_VEH[t] || TIPOS_VEH.otro).c}" data-ancho="${v / totalAnio * 100}%" title="${(TIPOS_VEH[t] || TIPOS_VEH.otro).n}: ${eur(v)}"></i>`).join('')}</div>
        <div class="pv-leyenda">${Object.entries(porTipo).sort((a, b) => b[1] - a[1]).map(([t, v]) => `<span><i style="background:${(TIPOS_VEH[t] || TIPOS_VEH.otro).c}"></i>${(TIPOS_VEH[t] || TIPOS_VEH.otro).n} <b>${eur0(v)}</b></span>`).join('')}</div>` : ''}</div>
      <div class="pv-vehs">${flota.map(v => tarjeta(v, v.matricula)).join('')}${fuera.map(m => tarjeta({ label: m + ' (no está en la flota)' }, m)).join('')}</div>
      ${sinMat.length ? `<div class="pv-panel g-vidrio"><h3>${I.alerta} Gastos de vehículo sin matrícula (${sinMat.length})</h3><p class="pv-sutil">Ábrelos y elige el vehículo para que cuenten en su ficha.</p>${sinMat.slice(0, 30).map(filaCompacta).join('')}</div>` : ''}`;
  }

  // ── Pestaña: Análisis ──
  function vistaAnalisis() {
    const anio = anioSel();
    const meses = Array(12).fill(0), mesesAntes = Array(12).fill(0);
    lineas().filter(mesOk).forEach(f => { if (f.anio === anio) meses[f.mes - 1] += baseDe(f); if (f.anio === anio - 1) mesesAntes[f.mes - 1] += baseDe(f); });
    const max = Math.max(1, ...meses, ...mesesAntes);
    const W = 720, H = 220, bw = W / 12;
    const barras = meses.map((v, i) => {
      const h = v / max * (H - 30), ha = mesesAntes[i] / max * (H - 30);
      return `<rect class="pv-b-antes" x="${i * bw + bw * 0.18}" width="${bw * 0.3}" y="${H - 20}" height="0" data-y="${H - 20 - ha}" data-alto="${ha}" rx="3"><title>${MES_CORTO[i]} ${anio - 1}: ${eur(mesesAntes[i])}</title></rect>
        <rect class="pv-b ${i === mesSel() - 1 ? 'sel' : ''}" x="${i * bw + bw * 0.5}" width="${bw * 0.32}" y="${H - 20}" height="0" data-y="${H - 20 - h}" data-alto="${h}" rx="3" onclick="pvIrMes(${i + 1})"><title>${MES_CORTO[i]} ${anio}: ${eur(v)}</title></rect>
        <text x="${i * bw + bw / 2}" y="${H - 4}" text-anchor="middle">${MES_CORTO[i]}</text>`;
    }).join('');
    const total = meses.reduce((s, v) => s + v, 0), totalAntes = mesesAntes.reduce((s, v) => s + v, 0);
    // Departamentos del año (donut)
    const porDep = {};
    lineas().filter(f => f.anio === anio).forEach(f => (f.desglose_departamentos || []).forEach(d => { porDep[d.departamento] = (porDep[d.departamento] || 0) + num(d.importe); }));
    const deps = Object.entries(porDep).sort((a, b) => b[1] - a[1]);
    const totDep = deps.reduce((s, d) => s + d[1], 0) || 1;
    let ang = 0;
    const R = 60, C = 2 * Math.PI * R;
    const arcos = deps.map(([n, v], i) => { const largo = v / totDep * C; const a = `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${PALETA[i % PALETA.length]}" stroke-width="22" stroke-dasharray="${largo} ${C - largo}" stroke-dashoffset="${-ang}" transform="rotate(-90 80 80)"><title>${esc(n)}: ${eur(v)}</title></circle>`; ang += largo; return a; }).join('');
    // Top 10 proveedores del año
    const porProv = {};
    lineas().filter(f => f.anio === anio).forEach(f => { porProv[f.proveedor] = (porProv[f.proveedor] || 0) + baseDe(f); });
    const top = Object.entries(porProv).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const maxTop = top.length ? top[0][1] : 1;
    return `
      <div class="pv-panel g-vidrio"><h3>Gasto por mes · ${anio} <span class="pv-sutil">(barra clara: ${anio - 1}) · pulsa un mes para verlo</span></h3>
        <div class="pv-an-cifras"><div><small>Total ${anio}</small><strong>${eur0(total)}</strong></div><div><small>Total ${anio - 1}</small><strong>${eur0(totalAntes)}</strong></div><div><small>Media mensual ${anio}</small><strong>${eur0(total / Math.max(1, meses.filter(v => v > 0).length))}</strong></div></div>
        <svg class="pv-grafica" viewBox="0 0 ${W} ${H}">${barras}</svg></div>
      <div class="pv-rejilla dos">
        <div class="pv-panel g-vidrio"><h3>Por departamento · ${anio}</h3><div class="pv-donut"><svg viewBox="0 0 160 160">${arcos}<text x="80" y="76" text-anchor="middle" class="pv-donut-t">${eur0(totDep)}</text><text x="80" y="94" text-anchor="middle" class="pv-donut-s">sin IVA</text></svg>
          <div class="pv-leyenda col">${deps.map(([n, v], i) => `<span><i style="background:${PALETA[i % PALETA.length]}"></i>${esc(n)} <b>${eur0(v)} · ${Math.round(v / totDep * 100)} %</b></span>`).join('')}</div></div></div>
        <div class="pv-panel g-vidrio"><h3>Los 10 proveedores de ${anio}</h3>${top.map(([n, v], i) => `
          <button class="pv-barra-h" onclick="pvBuscarProv('${esc(n).replace(/'/g, "\\'")}')"><span class="pv-bh-nombre">${i + 1}. ${esc(n)}</span><span class="pv-bh-pista"><i style="background:var(--g-champ)" data-ancho="${v / maxTop * 100}%"></i></span><span class="pv-bh-valor">${eur0(v)}</span></button>`).join('')}</div>
      </div>`;
  }

  // ── Acciones (onclick en el HTML) ──
  window.pvIr = k => { S.pestana = k; if (k !== 'facturas') { S.filtro = ''; S.depto = ''; } if (k !== 'facturas' && k !== 'proveedores') S.buscar = ''; pintar(); };
  window.pvMes = n => { S.mes = S.todoAnio ? sumarMes(S.mes, 12 * n) : sumarMes(S.mes, n); pintar(); };
  window.pvTodoAnio = () => { S.todoAnio = !S.todoAnio; pintar(); };
  window.pvHoy = () => { S.mes = hoyMes(); S.todoAnio = false; pintar(); };
  window.pvIrMes = m => { S.mes = anioSel() + '-' + String(m).padStart(2, '0'); S.todoAnio = false; S.pestana = 'mes'; pintar(); };
  window.pvFiltro = k => { S.filtro = k; S.pestana = 'facturas'; pintar(); };
  window.pvDepto = d => { S.depto = d; S.pestana = 'facturas'; pintar(); };
  window.pvBuscarProv = n => { S.buscar = n; S.filtro = ''; S.depto = ''; S.pestana = 'facturas'; S.todoAnio = true; pintar(); };
  let tBuscar = null;
  window.pvBuscar = v => { S.buscar = v; clearTimeout(tBuscar); tBuscar = setTimeout(() => { pintar(); const i = $('pv-buscar'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 200); };
  window.pvAbrir = id => { S.abierta = String(id); cargarVehiculos().then(pintarFicha); pintarFicha(); pintar(); };
  window.pvCerrar = () => { const c = $('pv-ficha'); S.abierta = null; if (c) { c.classList.remove('visible'); setTimeout(() => c.remove(), 250); } pintar(); if (window.pvFichaAlCerrar) window.pvFichaAlCerrar(); };
  // (20 nov 2026) Holded glass abre esta misma ficha para sus facturas de compra
  // (con su bloque «Holded» arriba: ver pvFichaExtra en holded-glass.js).
  window.pvAbrirDesdeFuera = async (fileId, recargar) => {
    S.abierta = String(fileId);
    if (!S.d || recargar) await cargar(); else pintarFicha();
    cargarVehiculos().then(() => { if (S.abierta === String(fileId)) pintarFicha(); });
    return !!$('pv-ficha');
  };
  window.pvGuardar = (el, campo) => guardar(el, campo);
  window.pvFichaVehiculo = id => { if (typeof abrirFichaVehiculo === 'function') abrirFichaVehiculo(id).then(() => { const s = $('veh-sec-gastos'); if (s) s.scrollIntoView({ behavior: 'smooth' }); }); };
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.abierta) window.pvCerrar(); });

  // ── Entrada ── (glass.js la pone en lugar de cargarFacturasProveedores)
  window.pvAbrirHolded = function () {
    const a = typeof accesosDisponibles === 'function' && accesosDisponibles()['fin-holded'];
    if (a && typeof window.cargarHoldedGlass === 'function') a.abrir(); else window.open('/holded.html', '_blank');
  };
  window.cargarProveedoresGlass = function () {
    const t = $('content-title'); if (t) t.textContent = 'Facturas Proveedores';
    $('content-body').innerHTML = '<div class="pv" id="pv-root"></div>';
    if (!S.mes) S.mes = hoyMes();
    S.abierta = null; const c = $('pv-ficha'); if (c) c.remove();
    pintar();
    cargar();
  };
})();
