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
  // Orden definitivo de la barra lateral (16 nov 2026). Solo módulos principales;
  // sus apartados van en la barra horizontal del módulo.
  const AREAS = [
    { nombre: 'Principal', ids: ['resumen', 'proyectos'] },
    { nombre: 'Gestión', ids: ['fin', 'per', 'comercial', 'analisis'] },
    { nombre: 'Operaciones', ids: ['log', 'vehiculos', 'mantenimiento', 'recuperacion', 'incidencias'] },
    { nombre: 'Sistema', ids: ['config'] }
  ];
  const AL_PIE = [];
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

  // ── Fotografías por módulo (configuración central) ──
  // Fondo general: public/img/modulos/fondos/<archivo>.webp (cambia solo al cambiar de módulo,
  // no entre sus apartados). Tarjeta del Resumen: public/img/modulos/botones/<archivo>.webp.
  const FOTO_MODULO = { resumen: 'resumen', proyectos: 'proyectos', fin: 'financiero', per: 'personal', comercial: 'comercial',
    analisis: 'analisis', log: 'logistica', vehiculos: 'vehiculos', mantenimiento: 'mantenimiento', recuperacion: 'material_recuperado',
    incidencias: 'incidencias', config: 'configuracion', calendario: 'resumen', chat: 'resumen', ayuda: 'resumen' };
  const urlFondo = archivo => `/img/modulos/fondos/${archivo}.webp`;
  const urlBoton = archivo => `/img/modulos/botones/${archivo}.webp`;
  const precargadas = new Set();
  function precargar(url) {
    if (precargadas.has(url)) return Promise.resolve();
    return new Promise(ok => { const im = new Image(); im.onload = im.onerror = () => { precargadas.add(url); ok(); }; im.src = url; });
  }
  // Fundido entre dos capas: la nueva se pinta encima solo cuando su foto ya está cargada (sin parpadeo).
  let fondoActual = null, capaVisible = 0, turnoFondo = 0;
  async function cambiarFondo(archivo) {
    if (!archivo || archivo === fondoActual) return;
    fondoActual = archivo;
    const turno = ++turnoFondo;
    const url = urlFondo(archivo);
    await precargar(url);
    if (turno !== turnoFondo) return; // ya se pidió otro módulo
    const capas = document.querySelectorAll('.g-foto');
    if (capas.length < 2) return;
    const siguiente = capas[1 - capaVisible];
    siguiente.style.backgroundImage = `url(${url})`;
    siguiente.classList.add('visible');
    capas[capaVisible].classList.remove('visible');
    capaVisible = 1 - capaVisible;
  }

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
    abajo: '<span class="g-flecha">▾</span>',
    destello: SVG('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.5 2.5M15.2 15.2l2.5 2.5M6.3 17.7l2.5-2.5M15.2 8.8l2.5-2.5"/>')
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);
  const RENOMBRAR = {}; // nombres alternativos en el menú lateral (ninguno por ahora)
  const quitarFlecha = s => String(s || '').replace(/\s*↗\s*$/, '');
  const nombreModulo = it => RENOMBRAR[quitarFlecha(it.label)] && !it.submenu ? RENOMBRAR[quitarFlecha(it.label)] : quitarFlecha(it.label);

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
    fondo.innerHTML = '<div class="g-foto"></div><div class="g-foto"></div>';
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
    cab.className = 'g-cabecera';
    main.prepend(cab);
    const pest = document.createElement('div');
    pest.className = 'g-pestanas g-vidrio';
    pest.id = 'g-pestanas';
    cab.after(pest);

    pintarMenu();
    pintarCabecera();
    const precargarResto = () => itemsVisibles().forEach(i => FOTO_MODULO[i.id] && precargar(urlFondo(FOTO_MODULO[i.id])));
    setTimeout(() => (window.requestIdleCallback || (f => f()))(precargarResto), 2500);
    sincronizarContadores();
    new MutationObserver(sincronizarContadores).observe($('nav-container'), { childList: true, subtree: true, characterData: true });
    setInterval(sincronizarContadores, 15000); // no leídos del chat (los pone el globo de siempre, ahora oculto)
    [1500, 4000, 8000].forEach(ms => setTimeout(sincronizarContadores, ms)); // el globo del chat se crea un poco después
    setInterval(() => { if (activoId === 'resumen') actualizarBienvenida(); }, 5 * 60 * 1000); // cambio de día o franja

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
      return `<button type="button" class="g-op" data-mod="${id}" aria-label="${esc(quitarFlecha(it.label))}">${iconoMenuHtml(it.icon)}<span class="g-et" style="flex:1">${esc(nombreModulo(it))}</span><span class="g-chip" data-chip="${id}" hidden></span><span class="g-tip">${esc(nombreModulo(it))}</span></button>`;
    };
    menu.innerHTML = `
      <div class="g-marca" data-mod="resumen" title="Inicio">
        <div class="g-logo"><img src="/logo-orum-crown.png" alt="ORUM"></div>
        <span class="g-central g-et">CENTRAL</span>
      </div>
      <div class="g-lista" id="g-lista"><span class="g-sel" id="g-sel" style="opacity:0"></span>
        ${areas.map(a => `${a.nombre ? `<div class="g-grupo">${esc(a.nombre)}</div>` : ''}${a.ids.map(op).join('')}`).join('')}
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
    cab.innerHTML = `
      <button type="button" class="g-pildora g-redondo g-hamburguesa" id="g-hamburguesa" aria-label="Abrir menú">${ICO.menu}</button>
      <div class="g-titular"><span class="g-modulo" id="g-modulo">Resumen</span><span id="g-seccion" hidden></span><span id="g-titular-ico" hidden></span></div>
      <button type="button" class="g-pildora g-redondo g-buscar-boton" id="g-buscar-boton" aria-label="Buscar herramienta">${ICO.buscar}</button>
      <label class="g-pildora g-buscar">${ICO.buscar}<input id="g-buscar-input" type="text" placeholder="Buscar herramienta… (p. ej. morosidad)" aria-label="Buscar herramienta" autocomplete="off"><kbd>Ctrl K</kbd>
        <div class="g-resultados g-vidrio" id="g-resultados"></div></label>
      ${visibles.includes('calendario') ? `<button type="button" class="g-pildora g-redondo" data-abrir="calendario" title="Calendario" aria-label="Calendario">${iconoMenuHtml('calendario')}</button>` : ''}
      ${visibles.includes('chat') ? `<button type="button" class="g-pildora g-redondo" id="g-chat" title="Chat" aria-label="Chat">${iconoMenuHtml('chat')}<span class="g-num" id="g-chat-n" hidden></span></button>` : ''}
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
    if ($('g-chat')) $('g-chat').onclick = () => { const globo = document.getElementById('chat-globo'); if (globo) globo.click(); else abrir('chat'); };
    $('g-buscar-boton').onclick = () => { const c = document.querySelector('.g-cabecera'); c.classList.toggle('buscando'); if (c.classList.contains('buscando')) $('g-buscar-input').focus(); };
    $('g-hamburguesa').onclick = () => { if (window.matchMedia('(max-width: 980px)').matches) abrirMenuMovil(true); else $('g-plegar').click(); };
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
    const idMod = mod ? mod.id : activoId;
    $('g-modulo').textContent = mod ? nombreModulo(mod) : etiqueta(activoId);
    $('g-seccion').textContent = DESCRIPCION[idMod] || (mod && mod.submenu ? etiqueta(activoId) : '');
    const it = MENU.find(i => i.id === idMod);
    $('g-titular-ico').innerHTML = it ? iconoMenuHtml(it.icon) : '';
    
  }

  // ── Buscador de herramientas (nivel global) ──
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function herramientas() {
    const lista = [];
    itemsVisibles().forEach(item => {
      const subs = subsVisibles(item);
      if (subs.length) subs.forEach(s => lista.push({ id: s.id, nombre: quitarFlecha(s.label), modulo: quitarFlecha(item.label), externo: !!s.especial }));
      else lista.push({ id: item.id, nombre: nombreModulo(item), modulo: '', externo: !!item.especial });
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
    document.querySelector('.main-content').classList.toggle('g-es-inicio', id === 'resumen');
    colocarSelector();
    pintarPestanas(mod && mod.submenu ? mod : null);
    cambiarFondo(FOTO_MODULO[mod ? mod.id : id] || 'resumen');
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
    const chatN = ((document.querySelector('#chat-globo .chat-globo-badge') || {}).textContent || '').trim();
    const chat = $('g-chat-n');
    if (chat) { chat.textContent = chatN; chat.hidden = !chatN || chatN === '0'; }
    const n = leer('incidencias', 'inc-pastilla');
    const campana = $('g-campana-n');
    if (campana) { campana.textContent = n; campana.hidden = !n; }
  }

  // ================================================================
  // INICIO (diseño aprobado): saludo, indicadores, tarjetas de módulos con
  // foto, agenda de hoy, facturación y alertas. Datos: /api/nueva/inicio.
  // Solo datos reales; cada tarjeta o cifra lleva a su pantalla.
  // ================================================================
  const DESCRIPCION = {
    resumen: 'Lo importante de hoy de un vistazo',
    proyectos: 'Eventos, estados y material de cada proyecto',
    fin: 'Cobros, contabilidad, tesorería e informes',
    per: 'Nóminas, horas, extras y análisis del personal',
    comercial: 'Presupuestos, leads y seguimiento comercial',
    analisis: 'Material, rutas, conductores e informe mensual',
    log: 'Preparación, rutas, servicios y salidas de almacén',
    mantenimiento: 'Revisión y cuidado del material',
    vehiculos: 'Flota, vencimientos, uso y repostajes',
    recuperacion: 'Material perdido que vuelve al almacén',
    incidencias: 'Avisos, responsables y seguimiento',
    config: 'Usuarios, permisos y ajustes del panel',
    calendario: 'Reuniones, vacaciones, turnos y taller',
    chat: 'Mensajes por departamento',
    ayuda: 'Manual de tu puesto y dudas'
  };
  const MODULOS_INICIO = {
    proyectos: 'Eventos, estados y material',
    fin: 'Cobros, contabilidad y caja',
    per: 'Nóminas, horas y extras',
    comercial: 'Presupuestos y leads',
    analisis: 'Material, rutas e informes',
    log: 'Preparación, rutas y servicios',
    vehiculos: 'Flota, vencimientos y repostajes',
    mantenimiento: 'Revisión del material',
    recuperacion: 'Material que vuelve',
    incidencias: 'Avisos y seguimiento'
  };
  const num = n => Math.round(n || 0).toLocaleString('es-ES');
  const euros = n => num(n) + ' €';
  const visible = id => itemsVisibles().some(i => i.id === id);
  const irA = (...ids) => ids.find(id => accesosDisponibles()[id] || visible(id)) || null;
  function saludo() { const h = Number(new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false })); return h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches'; }
  function contar(el, fin, f) { if (!el) return; const t0 = performance.now(); const paso = t => { const p = Math.min(1, (t - t0) / 1100); el.textContent = f(fin * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(paso); }; requestAnimationFrame(paso); }

  function fechaLarga() {
    const f = new Date().toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return f.charAt(0).toUpperCase() + f.slice(1);
  }
  // Al cambiar de día (o de franja horaria) sin recargar: saludo, fecha y frase al día
  function actualizarBienvenida() {
    const nombre = (usuarioActual.nombre || '').trim().split(/\s+/)[0];
    if ($('g-saludo-h')) $('g-saludo-h').textContent = saludo() + (nombre ? ', ' + nombre : '');
    if ($('g-fecha-larga')) $('g-fecha-larga').textContent = fechaLarga();
    if ($('g-frase-txt') && window.fraseDelDia) $('g-frase-txt').textContent = window.fraseDelDia();
  }
  async function pintarInicio() {
    const body = $('content-body');
    const nombre = (usuarioActual.nombre || '').trim().split(/\s+/)[0];
    body.innerHTML = `<div class="g-inicio">
      <div class="g-bienvenida">
        <div class="g-saludo-txt"><h2 id="g-saludo-h">${saludo()}${nombre ? ', ' + esc(nombre) : ''}</h2><span class="g-fecha-larga" id="g-fecha-larga">${esc(fechaLarga())}</span></div>
        ${window.fraseDelDia ? `<div class="g-frase"><span class="g-frase-cab">${ICO.destello} Frase del día</span><p id="g-frase-txt">${esc(window.fraseDelDia())}</p></div>` : ''}
      </div>
      <div class="g-kpis" id="g-kpis">${'<div class="g-kpi g-vidrio g-cargando"></div>'.repeat(5)}</div>
      <div class="g-modulos" id="g-modulos"></div>
      <div class="g-widgets" id="g-widgets">${'<div class="g-widget g-vidrio g-cargando"></div>'.repeat(3)}</div>
    </div>`;
    pintarModulos();
    let d;
    try {
      const r = await fetch('/api/nueva/inicio');
      d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || 'Error ' + r.status);
    } catch (e) {
      $('g-kpis').innerHTML = `<div class="g-widget g-vidrio" style="grid-column:1/-1">No se han podido cargar los datos: ${esc(e.message)}</div>`;
      $('g-widgets').innerHTML = '';
      return;
    }
    if (activoId !== 'resumen') return; // ya se ha cambiado de pantalla
    pintarKpisInicio(d);
    pintarWidgets(d);
  }

  function pintarKpisInicio(d) {
    const k = d.kpis;
    const lista = [
      { id: 'activos', ico: 'folder', valor: k.proyectos_activos, f: num, txt: 'Proyectos activos', ir: irA('proyectos') },
      { id: 'entregas', ico: 'truck', valor: k.entregas_hoy, f: num, txt: 'Entregas hoy', ir: irA('log-resumen') },
      { id: 'recogidas', ico: 'box', valor: k.recogidas_hoy, f: num, txt: 'Recogidas hoy', ir: irA('log-resumen') },
      { id: 'factura', ico: 'euro', valor: k.facturacion_mes, f: euros, txt: 'Facturación del mes', ir: irA('fin-resumen'), delta: k.facturacion_variacion },
      { id: 'incid', ico: 'alert', valor: k.incidencias_abiertas, f: num, txt: 'Incidencias', ir: irA('incidencias'), alerta: true }
    ];
    $('g-kpis').innerHTML = lista.map((x, i) => `<button type="button" class="g-kpi g-vidrio${x.alerta && x.valor ? ' g-kpi-alerta' : ''}" ${x.ir ? `data-ir="${x.ir}"` : 'disabled'} style="animation-delay:${i * 0.05}s">
      <span class="g-kpi-cab"><span class="g-kpi-ico g-kpi-ico-${x.id}">${iconoMenuHtml(x.ico)}</span>${x.delta == null ? '' : `<span class="g-delta${x.delta < 0 ? ' baja' : ''}" title="Respecto al mismo periodo del año pasado">${x.delta < 0 ? '↘' : '↗'} ${x.delta > 0 ? '+' : ''}${x.delta}%</span>`}</span>
      <span class="g-kpi-valor" data-k="${x.id}">0</span><span class="g-kpi-txt">${x.txt}</span></button>`).join('');
    lista.forEach(x => contar(document.querySelector(`[data-k="${x.id}"]`), x.valor || 0, x.f));
    $('g-kpis').querySelectorAll('[data-ir]').forEach(b => b.onclick = () => abrir(b.dataset.ir));
  }

  function pintarModulos() {
    const mods = Object.keys(MODULOS_INICIO).filter(visible).slice(0, 8);
    $('g-modulos').innerHTML = mods.map((id, i) => {
      const it = itemsVisibles().find(x => x.id === id);
      return `<button type="button" class="g-modulo-tarjeta" data-ir="${id}" style="animation-delay:${0.1 + i * 0.04}s">
        <span class="g-modulo-foto" style="background-image:url(${urlBoton(FOTO_MODULO[id])})"></span><span class="g-modulo-reflejo"></span>
        <span class="g-modulo-ico">${iconoMenuHtml(it.icon)}</span>
        <span class="g-modulo-texto"><b>${esc(quitarFlecha(it.label))}</b><small>${esc(MODULOS_INICIO[id])}</small></span>
        <span class="g-modulo-flecha">→</span></button>`;
    }).join('');
    $('g-modulos').querySelectorAll('[data-ir]').forEach(b => b.onclick = () => abrir(b.dataset.ir));
  }

  function graficaFacturacion(meses) {
    const max = Math.max(1, ...meses.map(m => m.total));
    const tope = Math.ceil(max / 20000) * 20000 || 20000;
    const W = 520, H = 190, x0 = 64, x1 = 505, y0 = 12, y1 = 160;
    const X = i => x0 + i * (x1 - x0) / Math.max(1, meses.length - 1);
    const Y = v => y1 - v / tope * (y1 - y0);
    const pts = meses.map((m, i) => [X(i), Y(m.total)]);
    const linea = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    // El último mes es el actual y aún no ha terminado: su tramo va discontinuo
    const cerrados = pts.slice(0, -1).map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const penult = pts[pts.length - 2], ult = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Facturación de los últimos 6 meses">
      <defs><linearGradient id="g-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3E86C9" stop-opacity=".18"/><stop offset="1" stop-color="#3E86C9" stop-opacity=".02"/></linearGradient></defs>
      ${[0, .5, 1].map(f => `<line x1="${x0 - 6}" x2="${x1 + 6}" y1="${Y(tope * f)}" y2="${Y(tope * f)}" stroke="currentColor" stroke-opacity=".07" stroke-dasharray="2 4"/><text x="${x0 - 12}" y="${Y(tope * f) + 4}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".55">${num(tope * f)} €</text>`).join('')}
      <path class="g-g-area" d="${linea} L${X(meses.length - 1)} ${y1} L${x0} ${y1} Z" fill="url(#g-area)" opacity="0"/>
      <path class="g-g-linea" d="${cerrados}" fill="none" stroke="#3E86C9" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>
      ${penult ? `<path class="g-g-encurso" d="M${penult[0].toFixed(1)} ${penult[1].toFixed(1)} L${ult[0].toFixed(1)} ${ult[1].toFixed(1)}" fill="none" stroke="#3E86C9" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="5 5" opacity="0"/>` : ''}
      ${pts.map((p, i) => { const actual = i === pts.length - 1; return `<circle class="g-g-punto" cx="${p[0]}" cy="${p[1]}" r="0" data-r="${actual ? 5 : 4}" fill="${actual ? '#EAF2FA' : '#fff'}" stroke="#3E86C9" stroke-width="2.4" ${actual ? 'stroke-dasharray="3 2"' : ''} style="transition-delay:${0.3 + i * 0.2}s"><title>${esc(meses[i].etiqueta)}${actual ? ' (en curso)' : ''}: ${euros(meses[i].total)}</title></circle>
        <text x="${p[0]}" y="${H - 6}" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity="${actual ? '.85' : '.6'}" ${actual ? 'font-weight="600"' : ''}>${esc(meses[i].etiqueta.split(' ')[0])}${actual ? ' · en curso' : ''}</text>`; }).join('')}
    </svg>`;
  }

  function pintarWidgets(d) {
    const k = d.kpis;
    const TIPO = { Entrega: 'g-tipo-entrega', Evento: 'g-tipo-montaje', Recogida: 'g-tipo-recogida' };
    const agenda = d.agenda_hoy || [];
    const vehiculos = (document.querySelector('#menu-item-vehiculos .veh-pastilla') || {}).textContent || '';
    const alertas = [];
    if (k.facturas_vencidas) alertas.push({ nivel: 'urgente', ico: 'euro', txt: `${k.facturas_vencidas} facturas vencidas · ${euros(k.importe_vencido)}`, ir: irA('fin-vencidas') });
    if (k.cobros_pendientes) alertas.push({ nivel: 'info', ico: 'euro', txt: `${euros(k.cobros_pendientes)} pendientes de cobro`, ir: irA('fin-control-pagos') });
    if (vehiculos) alertas.push({ nivel: 'aviso', ico: 'truck', txt: `${vehiculos} vencimientos de vehículos`, ir: irA('veh-vencimientos') });
    if (k.incidencias_abiertas) alertas.push({ nivel: 'aviso', ico: 'alert', txt: `${k.incidencias_abiertas} incidencias abiertas`, ir: irA('incidencias') });
    if (d.sincronizacion && d.sincronizacion.fallo) alertas.push({ nivel: 'urgente', ico: 'refresh', txt: 'Revisar la sincronización con Rentman', url: '/sync-status' });
    const ult = d.facturacion_meses[d.facturacion_meses.length - 1] || { total: 0 };
    const delta = k.facturacion_variacion;

    $('g-widgets').innerHTML = `
      <section class="g-widget g-vidrio">
        <div class="g-widget-cab">${iconoMenuHtml('calendario')}<h3>Agenda de hoy</h3>${visible('calendario') ? '<button type="button" class="g-enlace" data-ir="calendario">Ver calendario →</button>' : ''}</div>
        ${agenda.length ? agenda.slice(0, 6).map(a => `<div class="g-fila"><span class="g-hora">${a.hora ? esc(a.hora) : '<small>Todo el día</small>'}</span><span class="g-fila-txt"><b>${esc(a.nombre || 'Proyecto ' + a.numero)}</b><small>${esc([a.cliente, a.localizacion].filter(Boolean).join(' · '))}</small></span><span class="g-tipo ${TIPO[a.tipo]}">${a.tipo}</span></div>`).join('')
          + (agenda.length > 6 ? `<div class="g-mas">y ${agenda.length - 6} más</div>` : '')
          : '<div class="g-vacio">Hoy no hay entregas, eventos ni recogidas.</div>'}
      </section>
      <section class="g-widget g-vidrio">
        <div class="g-widget-cab">${iconoMenuHtml('euro')}<h3>Facturación<small>Últimos 6 meses · sin IVA</small></h3><b class="g-total">${euros(ult.total)}</b>${delta == null ? '' : `<span class="g-delta${delta < 0 ? ' baja' : ''}">${delta < 0 ? '↘' : '↗'} ${delta > 0 ? '+' : ''}${delta}%</span>`}</div>
        ${graficaFacturacion(d.facturacion_meses)}
      </section>
      <section class="g-widget g-vidrio">
        <div class="g-widget-cab">${ICO.campana}<h3>Alertas</h3><span class="g-suave">${alertas.length} pendientes</span></div>
        ${alertas.length ? alertas.map(a => `<button type="button" class="g-fila g-fila-boton g-alerta-${a.nivel}" ${a.ir ? `data-ir="${a.ir}"` : ''} ${a.url ? `data-url="${a.url}"` : ''}><span class="g-alerta-ico">${iconoMenuHtml(a.ico)}</span><span class="g-fila-txt">${esc(a.txt)}</span><span class="g-suave">›</span></button>`).join('')
          : '<div class="g-vacio">Todo en orden.</div>'}
      </section>`;
    const w = $('g-widgets');
    w.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => abrir(b.dataset.ir));
    w.querySelectorAll('[data-url]').forEach(b => b.onclick = () => window.open(b.dataset.url, '_blank'));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      w.querySelectorAll('.g-g-linea').forEach(p => p.style.strokeDashoffset = 0);
      w.querySelectorAll('.g-g-area').forEach(p => p.setAttribute('opacity', 1));
      w.querySelectorAll('.g-g-encurso').forEach(p => p.setAttribute('opacity', 1));
      w.querySelectorAll('.g-g-punto').forEach(c => c.setAttribute('r', c.dataset.r));
    }));
  }

  // ── Arranque: lo llama mostrarApp() después de montar el panel de siempre ──
  // pantallaYaAbierta: el panel ya abrió una pantalla concreta (p. ej. Calendario al volver de Google).
  window.iniciarInterfazGlass = async function (pantallaYaAbierta) {
    if (!usuarioActual || !INTERFAZ_GLASS_USUARIOS.includes(String(usuarioActual.usuario || '').toLowerCase())) return false;
    await leerPrefs();
    if (tienePref('clasica')) return false;
    const original = window.marcarMenuActivo;
    window.marcarMenuActivo = function (id) { original(id); try { alCambiarPantalla(id); } catch (e) { console.error('Interfaz glass:', e); } };
    // El Resumen general pasa a ser el Inicio nuevo (el de siempre queda en el diseño clásico).
    const resumenClasico = window.cargarResumenGeneral;
    window.cargarResumenGeneral = function () {
      if (!document.documentElement.classList.contains('glass')) return resumenClasico();
      $('content-title').textContent = 'Inicio';
      return pintarInicio();
    };
    montar();
    // Algunas pantallas viven en scripts aparte (vehiculos.js, bolsa.js…): esperar a que estén cargados.
    if (document.readyState !== 'complete') await new Promise(r => window.addEventListener('load', r, { once: true }));
    // Pantalla de la dirección (#/id) si la hay y el usuario la puede abrir; si no, la de inicio que ya cargó el panel.
    const pedida = idDeHash();
    const inicial = document.querySelector('#nav-container .nav-item.active, #nav-container .nav-subitem[style*="f3ead9"]');
    if (pantallaYaAbierta) alCambiarPantalla(inicial ? inicial.id : 'menu-item-resumen');
    else if (pedida && (accesosDisponibles()[pedida] || moduloDe(pedida))) { desdeHistorial = true; abrir(pedida); desdeHistorial = false; }
    else { desdeHistorial = true; abrir('resumen'); desdeHistorial = false; }
    return true;
  };
  // Desde el diseño clásico: volver a la interfaz nueva (opción del menú de siempre)
  window.volverInterfazGlass = async function () { await leerPrefs(); ponerPref('clasica', false); await guardarPrefs(); location.reload(); };
})();
