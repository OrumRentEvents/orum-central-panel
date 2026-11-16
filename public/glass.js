// ================================================================
// ORUM Central · Interfaz Liquid Glass (beta, nov 2026) — public/glass.css
//
// Capa de presentación sobre el panel de siempre: NO cambia la lógica.
// - Usa el mismo MENU, los mismos permisos (menuVisibleUsuario / itemVisibleUsuario)
//   y las mismas funciones de cada pantalla (accesosDisponibles()[id].abrir()).
// - El menú antiguo sigue en el DOM, oculto: marcarMenuActivo(), los contadores
//   (incidencias, vehículos, material recuperado) y las estrellas siguen funcionando.
// - Tres niveles: menú lateral por áreas, pestañas del módulo, accesos desde tarjetas.
// - Cada pantalla tiene dirección propia (#/<id del menú>): atrás, recargar y enlaces.
// - Preferencias por usuario en usuarios.accesos.interfaz (['oscuro'], ['clasica']).
// Solo se activa para INTERFAZ_GLASS_USUARIOS mientras está en pruebas.
// ================================================================
(function () {
  const INTERFAZ_GLASS_USUARIOS = ['sergio'];

  // Áreas del menú lateral (ids del MENU de index.html). Calendario, Chat y Ayuda
  // pasan a la cabecera / perfil; Configuración, al pie.
  const AREAS = [
    { nombre: 'Principal', ids: ['resumen', 'proyectos'] },
    { nombre: 'Gestión', ids: ['fin', 'per', 'comercial', 'analisis'] },
    { nombre: 'Operaciones', ids: ['log', 'mantenimiento', 'vehiculos', 'recuperacion', 'incidencias'] }
  ];
  const AL_PIE = ['config'];
  const EN_CABECERA = ['calendario', 'chat', 'ayuda', 'nueva-interfaz'];

  // Pestañas agrupadas (nivel 2). Lo que no esté aquí sale como pestaña suelta.
  const PESTANAS = {
    fin: [['Resumen', ['fin-resumen']], ['Cobros', ['fin-control-pagos', 'fin-extracto-cliente', 'fin-vencidas']],
      ['Contabilidad', ['fin-cierre-mensual', 'fin-fact-listado', 'fin-fianzas']], ['Tesorería', ['fin-caja']],
      ['Informes', ['fin-informe-semanal', 'fin-auditoria']], ['Integraciones', ['fin-holded']]],
    per: [['Gestión', ['per-nominas', 'per-informe']], ['Horas y extras', ['per-bolsa', 'per-extras']],
      ['Aprobaciones', ['per-aprobar-extras']], ['Análisis', ['per-analisis', 'per-historico', 'per-comparador']]]
  };
  const MAX_PESTANAS = 7;

  // Foto de fondo por módulo (public/img/nueva). Se irán sustituyendo por las definitivas.
  const FOTOS = ['mesa', 'sillon', 'silla'];
  const FOTO_MODULO = { resumen: 'mesa', proyectos: 'sillon', fin: 'silla', per: 'mesa', comercial: 'sillon', analisis: 'silla',
    log: 'silla', mantenimiento: 'mesa', vehiculos: 'mesa', recuperacion: 'sillon', incidencias: 'silla', config: 'sillon',
    calendario: 'mesa', chat: 'sillon', ayuda: 'mesa' };

  const SVG = d => `<span class="nav-icon"><svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg></span>`;
  const ICO = {
    buscar: SVG('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    campana: SVG('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21h4"/>'),
    menu: SVG('<path d="M4 6h16M4 12h16M4 18h16"/>'),
    plegar: SVG('<path d="m15 6-6 6 6 6"/>'),
    luna: SVG('<path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"/>'),
    sol: SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    salir: SVG('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'),
    clasico: SVG('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
    abajo: '<span class="g-flecha">▾</span>'
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);
  const quitarFlecha = s => String(s || '').replace(/\s*↗\s*$/, '');

  let prefs = [];
  let activoId = null;       // id del menú de la pantalla abierta (sin 'menu-item-')
  let desdeHistorial = false;

  // ── Preferencias por usuario ──
  async function leerPrefs() {
    try { const d = await (await fetch('/api/mis-accesos')).json(); prefs = (d.accesos && d.accesos.interfaz) || []; } catch (e) { prefs = []; }
  }
  async function guardarPrefs() {
    try { await fetch('/api/mis-accesos', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ interfaz: prefs }) }); } catch (e) {}
  }
  const tienePref = p => prefs.includes(p);
  function ponerPref(p, si) { prefs = prefs.filter(x => x !== p); if (si) prefs.push(p); guardarPrefs(); }

  // ── Qué ve este usuario (mismo criterio que el menú de siempre) ──
  function itemsVisibles() { return menuVisibleUsuario(); }
  function subsVisibles(item) { return (item.submenu || []).filter(itemVisibleUsuario); }
  function moduloDe(id) {
    for (const item of itemsVisibles()) {
      if (item.id === id) return item;
      if (subsVisibles(item).some(s => s.id === id)) return item;
    }
    return null;
  }
  function primeraPantalla(item) {
    if (!item.submenu) return item.id;
    const s = subsVisibles(item).find(x => !x.especial);
    return s ? s.id : null;
  }
  function etiqueta(id) {
    for (const item of MENU) {
      if (item.id === id) return quitarFlecha(item.label);
      const s = (item.submenu || []).find(x => x.id === id);
      if (s) return quitarFlecha(s.label);
    }
    return '';
  }
  // Abre una pantalla con la función de siempre.
  function abrir(id) {
    const item = itemsVisibles().find(i => i.id === id);
    if (item && item.submenu) { const p = primeraPantalla(item); if (p) id = p; }
    const a = accesosDisponibles()[id];
    if (a) { a.abrir(); return true; }
    const it = itemsVisibles().find(i => i.id === id);
    if (it && it.onClick) { it.onClick(); return true; }
    for (const i of itemsVisibles()) { const s = subsVisibles(i).find(x => x.id === id); if (s) { s.onClick(); return true; } }
    return false;
  }

  // ── Construcción ──
  function montar() {
    document.documentElement.classList.add('glass');
    document.documentElement.classList.toggle('oscuro', tienePref('oscuro'));

    const fondo = document.createElement('div');
    fondo.className = 'g-fondo';
    fondo.setAttribute('aria-hidden', 'true');
    fondo.innerHTML = FOTOS.map(f => `<div class="g-foto" data-foto="${f}" style="background-image:url(/img/nueva/${f}.webp)"></div>`).join('');
    document.body.prepend(fondo);

    const layout = document.querySelector('.app-layout');
    const menu = document.createElement('nav');
    menu.className = 'g-menu g-vidrio';
    menu.id = 'g-menu';
    menu.setAttribute('aria-label', 'Menú principal');
    if (tienePref('plegado')) menu.classList.add('plegado');
    layout.prepend(menu);
    const veloMenu = document.createElement('div');
    veloMenu.className = 'g-velo-menu';
    veloMenu.id = 'g-velo-menu';
    veloMenu.onclick = () => abrirMenuMovil(false);
    document.body.appendChild(veloMenu);

    const main = document.querySelector('.main-content');
    const cab = document.createElement('header');
    cab.className = 'g-cabecera g-vidrio';
    main.prepend(cab);
    const pest = document.createElement('div');
    pest.className = 'g-pestanas g-vidrio';
    pest.id = 'g-pestanas';
    cab.after(pest);

    pintarMenu();
    pintarCabecera();
    sincronizarContadores();
    new MutationObserver(sincronizarContadores).observe($('nav-container'), { childList: true, subtree: true, characterData: true });

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); const i = $('g-buscar-input'); if (i) i.focus(); }
      if (e.key === 'Escape') cerrarDesplegables();
    });
    document.addEventListener('click', e => { if (!e.target.closest('.g-buscar, .g-perfil, .g-pestana-grupo')) cerrarDesplegables(); });
    window.addEventListener('resize', () => colocarSelector());
    window.addEventListener('popstate', () => { const id = idDeHash(); if (id && id !== activoId) { desdeHistorial = true; abrir(id); desdeHistorial = false; } });
  }

  function pintarMenu() {
    const menu = $('g-menu');
    const visibles = itemsVisibles();
    const porId = Object.fromEntries(visibles.map(i => [i.id, i]));
    const usados = new Set([...AREAS.flatMap(a => a.ids), ...AL_PIE, ...EN_CABECERA]);
    // Lo que el usuario ve y no está en ninguna área (p. ej. menús de roles concretos) va a Operaciones.
    const extra = visibles.filter(i => !usados.has(i.id)).map(i => i.id);
    const areas = AREAS.map(a => ({ nombre: a.nombre, ids: a.ids.concat(a.nombre === 'Operaciones' ? extra : []).filter(id => porId[id]) })).filter(a => a.ids.length);
    const op = id => {
      const it = porId[id];
      return `<button type="button" class="g-op" data-mod="${id}" aria-label="${esc(quitarFlecha(it.label))}">${iconoMenuHtml(it.icon)}<span class="g-et" style="flex:1">${esc(quitarFlecha(it.label))}</span><span class="g-chip" data-chip="${id}" hidden></span><span class="g-tip">${esc(quitarFlecha(it.label))}</span></button>`;
    };
    menu.innerHTML = `
      <div class="g-marca" data-mod="resumen" title="Inicio">
        <div class="g-logo"><img src="/logo-orum-crown.png" alt="ORUM"></div>
        <span class="g-central g-et">CENTRAL</span>
      </div>
      <div class="g-lista" id="g-lista"><span class="g-sel" id="g-sel" style="opacity:0"></span>
        ${areas.map(a => `<div class="g-grupo">${esc(a.nombre)}</div>${a.ids.map(op).join('')}`).join('')}
      </div>
      <div class="g-pie">
        ${AL_PIE.filter(id => porId[id]).map(op).join('')}
        <button type="button" class="g-op g-plegar" id="g-plegar" aria-label="Comprimir menú">${ICO.plegar}<span class="g-et">Comprimir menú</span><span class="g-tip">Abrir menú</span></button>
      </div>`;
    menu.querySelectorAll('[data-mod]').forEach(b => b.addEventListener('click', () => { abrirMenuMovil(false); abrir(b.dataset.mod); }));
    $('g-plegar').onclick = () => { const p = !menu.classList.contains('plegado'); menu.classList.toggle('plegado', p); ponerPref('plegado', p); setTimeout(colocarSelector, 60); setTimeout(colocarSelector, 520); };
    colocarSelector();
  }
  function colocarSelector() {
    const sel = $('g-sel');
    if (!sel) return;
    const mod = activoId && moduloDe(activoId);
    const b = mod && document.querySelector(`#g-lista .g-op[data-mod="${mod.id}"]`);
    document.querySelectorAll('#g-menu .g-op').forEach(x => x.classList.toggle('activo', !!mod && x.dataset.mod === mod.id));
    if (!b) { sel.style.opacity = 0; return; }
    sel.style.opacity = 1;
    sel.style.top = b.offsetTop + 'px';
  }
  function abrirMenuMovil(si) { $('g-menu').classList.toggle('movil-abierto', si); $('g-velo-menu').classList.toggle('abierto', si); }

  function pintarCabecera() {
    const cab = document.querySelector('.g-cabecera');
    const visibles = itemsVisibles().map(i => i.id);
    const nombre = (usuarioActual.nombre || usuarioActual.usuario || '').trim();
    const ini = (inicialesNombre(nombre) || '?').toUpperCase();
    const boton = (id, icono, titulo) => visibles.includes(id) ? `<button type="button" class="g-pildora g-redondo" data-abrir="${id}" title="${titulo}" aria-label="${titulo}">${iconoMenuHtml(icono)}</button>` : '';
    cab.innerHTML = `
      <button type="button" class="g-pildora g-redondo g-hamburguesa" id="g-hamburguesa" aria-label="Abrir menú">${ICO.menu}</button>
      <div class="g-migas"><span class="g-modulo" id="g-modulo">Inicio</span><span class="g-seccion" id="g-seccion"></span></div>
      <label class="g-pildora g-buscar">${ICO.buscar}<input id="g-buscar-input" type="text" placeholder="Buscar herramienta… (p. ej. morosidad)" aria-label="Buscar herramienta" autocomplete="off"><kbd>Ctrl K</kbd>
        <div class="g-resultados g-vidrio" id="g-resultados"></div></label>
      ${boton('calendario', 'calendario', 'Calendario')}
      ${boton('chat', 'chat', 'Chat')}
      <button type="button" class="g-pildora g-redondo" id="g-campana" title="Incidencias asignadas a ti" aria-label="Incidencias">${ICO.campana}<span class="g-num" id="g-campana-n" hidden></span></button>
      <div class="g-perfil">
        <button type="button" class="g-pildora" id="g-perfil-btn" style="padding-left:5px" aria-haspopup="true"><span class="g-avatar">${esc(ini)}</span><span class="g-nombre">${esc(nombre.split(/\s+/)[0])}</span>${ICO.abajo}</button>
        <div class="g-desplegable g-vidrio" id="g-perfil-menu">
          <div style="padding:10px 12px 6px"><b>${esc(nombre)}</b><br><span style="font-size:12px; color:var(--g-suave)">${esc(ETIQUETA_ROL[usuarioActual.rol] || usuarioActual.rol || '')}</span></div>
          <hr>
          <button type="button" class="g-resultado" id="g-tema">${tienePref('oscuro') ? ICO.sol + 'Modo claro' : ICO.luna + 'Modo oscuro'}</button>
          ${visibles.includes('ayuda') ? `<button type="button" class="g-resultado" data-abrir="ayuda">${iconoMenuHtml('ayuda')}Ayuda</button>` : ''}
          <button type="button" class="g-resultado" id="g-clasica">${ICO.clasico}Volver al diseño clásico</button>
          <hr>
          <button type="button" class="g-resultado" id="g-salir">${ICO.salir}Cerrar sesión</button>
        </div>
      </div>`;
    cab.querySelectorAll('[data-abrir]').forEach(b => b.addEventListener('click', () => { cerrarDesplegables(); abrir(b.dataset.abrir); }));
    $('g-hamburguesa').onclick = () => abrirMenuMovil(true);
    $('g-campana').onclick = () => abrir(visibles.includes('incidencias') ? 'incidencias' : 'resumen');
    $('g-perfil-btn').onclick = e => { e.stopPropagation(); const m = $('g-perfil-menu'); const a = !m.classList.contains('abierto'); cerrarDesplegables(); m.classList.toggle('abierto', a); };
    $('g-tema').onclick = () => { const o = !tienePref('oscuro'); ponerPref('oscuro', o); document.documentElement.classList.toggle('oscuro', o); pintarCabecera(); };
    $('g-clasica').onclick = async () => { ponerPref('clasica', true); await guardarPrefs(); location.hash = ''; location.reload(); };
    $('g-salir').onclick = () => $('logout-btn').click();
    const input = $('g-buscar-input');
    input.addEventListener('input', () => pintarResultados(input.value));
    input.addEventListener('focus', () => { if (input.value) pintarResultados(input.value); });
    input.addEventListener('keydown', e => {
      const r = [...document.querySelectorAll('#g-resultados .g-resultado')];
      let i = r.findIndex(x => x.classList.contains('marcado'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (r.length) { if (i >= 0) r[i].classList.remove('marcado'); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + r.length) % r.length; r[i].classList.add('marcado'); } }
      if (e.key === 'Enter') { e.preventDefault(); (r[i] || r[0] || { click() {} }).click(); }
    });
    sincronizarContadores();
    ponerMigas();
  }
  function ponerMigas() {
    if (!activoId || !$('g-modulo')) return;
    const mod = moduloDe(activoId);
    $('g-modulo').textContent = mod ? quitarFlecha(mod.label) : etiqueta(activoId);
    $('g-seccion').textContent = mod && mod.submenu ? etiqueta(activoId) : '';
  }

  // ── Buscador de herramientas (nivel global) ──
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function herramientas() {
    const lista = [];
    itemsVisibles().forEach(item => {
      const subs = subsVisibles(item);
      if (subs.length) subs.forEach(s => lista.push({ id: s.id, nombre: quitarFlecha(s.label), modulo: quitarFlecha(item.label), externo: !!s.especial }));
      else lista.push({ id: item.id, nombre: quitarFlecha(item.label), modulo: '', externo: !!item.especial });
    });
    return lista;
  }
  function pintarResultados(q) {
    const caja = $('g-resultados');
    const n = norm(q).trim();
    if (!n) { caja.classList.remove('abierto'); caja.innerHTML = ''; return; }
    const r = herramientas().filter(h => norm(h.nombre + ' ' + h.modulo).includes(n)).slice(0, 12);
    caja.innerHTML = r.length ? r.map((h, i) => `<button type="button" class="g-resultado${i === 0 ? ' marcado' : ''}" data-ir="${h.id}">${esc(h.nombre)}${h.externo ? ' ↗' : ''}<small>${esc(h.modulo)}</small></button>`).join('')
      : `<div style="padding:10px 12px; color:var(--g-suave)">Nada coincide con «${esc(q)}»</div>`;
    caja.classList.add('abierto');
    caja.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); caja.classList.remove('abierto'); $('g-buscar-input').value = ''; $('g-buscar-input').blur(); abrir(b.dataset.ir); }));
  }
  function cerrarDesplegables() {
    document.querySelectorAll('.g-desplegable.abierto, .g-resultados.abierto, .g-sub.abierto').forEach(x => x.classList.remove('abierto'));
  }

  // ── Pestañas del módulo (nivel 2) ──
  function pintarPestanas(mod) {
    const cont = $('g-pestanas');
    const subs = mod ? subsVisibles(mod) : [];
    if (!subs.length) { cont.innerHTML = ''; return; }
    const visiblesIds = subs.map(s => s.id);
    let grupos;
    if (PESTANAS[mod.id]) {
      grupos = PESTANAS[mod.id].map(([nombre, ids]) => ({ nombre, ids: ids.filter(id => visiblesIds.includes(id)) })).filter(g => g.ids.length);
      const enGrupo = new Set(grupos.flatMap(g => g.ids));
      subs.filter(s => !enGrupo.has(s.id)).forEach(s => grupos.push({ nombre: quitarFlecha(s.label), ids: [s.id] }));
    } else {
      grupos = subs.map(s => ({ nombre: quitarFlecha(s.label), ids: [s.id] }));
      if (grupos.length > MAX_PESTANAS) {
        const resto = grupos.splice(MAX_PESTANAS - 1);
        grupos.push({ nombre: 'Más', ids: resto.flatMap(g => g.ids) });
      }
    }
    const subPorId = Object.fromEntries(subs.map(s => [s.id, s]));
    cont.innerHTML = grupos.map((g, i) => {
      const activa = g.ids.includes(activoId);
      if (g.ids.length === 1) {
        const s = subPorId[g.ids[0]];
        return `<button type="button" class="g-pestana${activa ? ' activa' : ''}" data-ir="${s.id}">${esc(g.nombre)}${s.especial ? ' ↗' : ''}</button>`;
      }
      const nombreActivo = activa ? ' · ' + esc(quitarFlecha(subPorId[activoId].label)) : '';
      return `<div class="g-pestana-grupo" style="position:relative">
        <button type="button" class="g-pestana${activa ? ' activa' : ''}" data-grupo="${i}">${esc(g.nombre)}${nombreActivo} ${ICO.abajo}</button>
        <div class="g-sub g-vidrio" id="g-sub-${i}">${g.ids.map(id => `<button type="button" class="g-resultado${id === activoId ? ' activo' : ''}" data-ir="${id}">${esc(quitarFlecha(subPorId[id].label))}${subPorId[id].especial ? ' ↗' : ''}</button>`).join('')}</div>
      </div>`;
    }).join('');
    cont.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); cerrarDesplegables(); abrir(b.dataset.ir); }));
    cont.querySelectorAll('[data-grupo]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const sub = $('g-sub-' + b.dataset.grupo);
      const a = !sub.classList.contains('abierto');
      cerrarDesplegables();
      sub.classList.toggle('abierto', a);
    }));
  }

  // ── Cada vez que el panel cambia de pantalla ──
  function alCambiarPantalla(idCompleto) {
    const id = String(idCompleto || '').replace(/^menu-item-/, '');
    if (!id) return;
    activoId = id;
    const mod = moduloDe(id);
    ponerMigas();
    colocarSelector();
    pintarPestanas(mod && mod.submenu ? mod : null);
    const foto = FOTO_MODULO[mod ? mod.id : id] || 'mesa';
    document.querySelectorAll('.g-foto').forEach(f => f.classList.toggle('visible', f.dataset.foto === foto));
    const hash = '#/' + id;
    if (location.hash !== hash) {
      if (desdeHistorial || !history.state || !history.state.glass) history.replaceState({ glass: true }, '', hash);
      else history.pushState({ glass: true }, '', hash);
    }
    if (!history.state || !history.state.glass) history.replaceState({ glass: true }, '', hash);
    // Animación de entrada del contenido
    ['content-body'].forEach(i => { const el = $(i); if (el) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; } });
  }
  function idDeHash() { const m = location.hash.match(/^#\/([a-z0-9-]+)$/); return m ? m[1] : null; }

  // ── Contadores del menú de siempre → menú nuevo y campana ──
  function sincronizarContadores() {
    const leer = (idMenu, clase) => { const el = document.querySelector(`#menu-item-${idMenu} .${clase}`); return el ? el.textContent.trim() : ''; };
    const pon = (idMod, n) => { const chip = document.querySelector(`[data-chip="${idMod}"]`); if (!chip) return; chip.textContent = n; chip.hidden = !n; };
    pon('incidencias', leer('incidencias', 'inc-pastilla'));
    pon('vehiculos', leer('vehiculos', 'veh-pastilla'));
    pon('recuperacion', leer('recuperacion', 'recup-pastilla'));
    const n = leer('incidencias', 'inc-pastilla');
    const campana = $('g-campana-n');
    if (campana) { campana.textContent = n; campana.hidden = !n; }
  }

  // ── Arranque: lo llama mostrarApp() después de montar el panel de siempre ──
  window.iniciarInterfazGlass = async function () {
    if (!usuarioActual || !INTERFAZ_GLASS_USUARIOS.includes(String(usuarioActual.usuario || '').toLowerCase())) return false;
    await leerPrefs();
    if (tienePref('clasica')) return false;
    const original = window.marcarMenuActivo;
    window.marcarMenuActivo = function (id) { original(id); try { alCambiarPantalla(id); } catch (e) { console.error('Interfaz glass:', e); } };
    montar();
    // Pantalla de la dirección (#/id) si la hay y el usuario la puede abrir; si no, la de inicio que ya cargó el panel.
    const pedida = idDeHash();
    const inicial = document.querySelector('#nav-container .nav-item.active, #nav-container .nav-subitem[style*="f3ead9"]');
    if (pedida && (accesosDisponibles()[pedida] || moduloDe(pedida))) { desdeHistorial = true; abrir(pedida); desdeHistorial = false; }
    else alCambiarPantalla(inicial ? inicial.id : 'menu-item-resumen');
    return true;
  };
  // Desde el diseño clásico: volver a la interfaz nueva (opción del menú de siempre)
  window.volverInterfazGlass = async function () { await leerPrefs(); ponerPref('clasica', false); await guardarPrefs(); location.reload(); };
})();
