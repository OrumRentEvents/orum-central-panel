// Bolsa de horas (nov 2026), idea de Leo: horas, días de festivo, días de descanso
// y vacaciones de cada trabajador. Cargado por index.html; API en lib/bolsa.js.
// No genera pagos ni pasa por aprobación (eso es Registrar extras).

let bolsa = { datos: null, busca: '', area: '', soloPendientes: false, menu: 'per-bolsa' };
let blDesdeHistorial = null; // trabajador cuyo historial está abierto, para volver a él al guardar

(function estilosBolsa() {
  const el = document.createElement('style');
  el.textContent = `
    .bl-resumen { display:flex; gap:40px; flex-wrap:wrap; background:#fff; border:1px solid #e2e2de; border-radius:10px; padding:14px 20px; margin-bottom:14px; }
    .bl-et { font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:#6b6a64; white-space:nowrap; }
    .bl-num { font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:21px; line-height:1.35; }
    .bl-num.debes { color:#945A0B; } .bl-num.debe { color:#2F6280; }
    .bl-filtros { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px; }
    .bl-filtros input, .bl-filtros select { font-size:14px; padding:9px 12px; border:1px solid #d9d7cf; border-radius:8px; background:#fff; font-family:inherit; box-sizing:border-box; }
    .bl-filtros input { flex:1 1 220px; min-width:0; }
    .bl-btn { font-size:13px; font-weight:600; padding:7px 11px; border:1px solid #c9c7bf; border-radius:8px; background:#fff; color:#1a1a18; cursor:pointer; font-family:inherit; white-space:nowrap; }
    .bl-btn:hover { background:#f7f6f2; }
    .bl-btn.prim { background:#1a1a18; border-color:#1a1a18; color:#fff; }
    .bl-btn.prim:hover { background:#33332f; }
    .bl-btn.on { background:#E8F0F6; border-color:#3D7C9E; color:#2F6280; }
    .bl-btn.texto { border-color:transparent; background:none; color:#6b6a64; font-weight:500; }
    .bl-btn.texto:hover { color:#1a1a18; text-decoration:underline; }
    .bl-btn.mini { font-size:12px; padding:3px 8px; font-weight:500; }
    .bl-btn.peligro { color:#A32D2D; }
    .bl-card { background:#fff; border:1px solid #e2e2de; border-radius:10px; padding:14px 18px; margin-bottom:10px; }
    .bl-card-top { display:flex; justify-content:space-between; gap:14px; flex-wrap:wrap; margin-bottom:10px; }
    .bl-nombre { font-size:16.5px; font-weight:600; }
    .bl-area { font-size:12.5px; color:#6b6a64; margin-top:2px; }
    .bl-saldos { display:flex; gap:24px; flex-wrap:wrap; }
    .bl-saldo { min-width:92px; }
    .bl-pill { display:inline-block; font-size:11.5px; font-weight:600; padding:2px 9px; border-radius:10px; white-space:nowrap; }
    .bl-pill.debes { background:#FBE9CF; color:#854F0B; }
    .bl-pill.debe { background:#DCE9F5; color:#2F6280; }
    .bl-pill.ok { background:#DFF0E4; color:#1E6B34; }
    .bl-acciones { display:flex; gap:7px; flex-wrap:wrap; align-items:center; }
    .bl-fondo { position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:1000; display:flex; align-items:flex-start; justify-content:center; padding:6vh 16px 16px; overflow:auto; }
    .bl-modal { background:#fff; border-radius:12px; padding:18px 20px; width:100%; max-width:420px; box-sizing:border-box; }
    .bl-modal.ancho { max-width:720px; }
    .bl-modal h3 { font-size:16px; margin:0 0 2px; }
    .bl-modal .sub { font-size:12.5px; color:#6b6a64; margin:0 0 12px; }
    .bl-campo { margin-bottom:10px; }
    .bl-campo label { display:block; font-size:12px; color:#6b6a64; margin-bottom:3px; }
    .bl-campo input, .bl-campo select { width:100%; box-sizing:border-box; font-size:15px; padding:8px 10px; border:1px solid #d9d7cf; border-radius:8px; font-family:inherit; background:#fff; }
    .bl-dos { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .bl-pie { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
    .bl-err { color:#A32D2D; font-size:13px; min-height:0; margin-top:6px; }
    .bl-sec { font-size:13px; font-weight:600; margin:16px 0 6px; display:flex; justify-content:space-between; align-items:center; gap:8px; }
    .bl-fila { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:7px 0; border-top:0.5px solid #efeee9; font-size:13.5px; }
    .bl-fila small { display:block; color:#6b6a64; font-size:11.5px; }
    .bl-fila.anulado > div:first-child { text-decoration:line-through; color:#9a988f; }
    .bl-vacio { font-size:13px; color:#9a988f; padding:4px 0; }
    @media (max-width: 600px) { .bl-resumen { gap:14px 28px; } .bl-saldos { gap:14px; width:100%; justify-content:space-between; } .bl-saldo { min-width:0; } .bl-et { font-size:10px; } }`;
  document.head.appendChild(el);
})();

// ── Utilidades ──
const blEsc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const blNum = n => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 });
const blFecha = f => (f ? String(f).slice(8, 10) + '/' + String(f).slice(5, 7) + '/' + String(f).slice(0, 4) : '');
// "AGUILERA MARTIN, JESUS" → "Aguilera Martin, Jesus"
const blNombre = n => String(n || '').toLowerCase().replace(/\s+,/g, ',').replace(/(^|[\s,.-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
function blEstadoHoras(h) {
  if (h > 0) return { txt: 'Le debes', cls: 'debes' };
  if (h < 0) return { txt: 'Te debe', cls: 'debe' };
  return { txt: 'Al día', cls: 'ok' };
}
async function blApi(url, opciones) {
  const o = opciones || {};
  const init = { method: o.method || 'GET' };
  if (o.body) { init.body = JSON.stringify(o.body); init.headers = { 'Content-Type': 'application/json' }; }
  const resp = await fetch(url, init);
  const json = await resp.json().catch(() => ({ error: 'Respuesta no válida del servidor' }));
  if (!resp.ok || json.error) throw new Error(json.error || ('Error ' + resp.status));
  return json;
}
const blEmp = clave => bolsa.datos.empleados.find(e => e.clave === clave);

// ── Lista ──
async function cargarBolsaHoras(menu) {
  if (menu) bolsa.menu = menu;
  document.getElementById('content-title').textContent = 'Bolsa de horas';
  marcarMenuActivo('menu-item-' + bolsa.menu);
  const body = document.getElementById('content-body');
  if (!bolsa.datos) body.innerHTML = '<p class="loading-text">Cargando...</p>';
  try {
    bolsa.datos = await blApi('/api/bolsa');
    pintarBolsa();
  } catch (err) {
    body.innerHTML = '<p class="loading-text">Error: ' + blEsc(err.message) + '</p>';
  }
}
function pintarBolsa() {
  const E = bolsa.datos.empleados;
  const areas = [...new Set(E.map(e => e.area))].sort((a, b) => a.localeCompare(b, 'es'));
  const debes = E.reduce((s, e) => s + Math.max(0, e.horas), 0);
  const festivos = E.reduce((s, e) => s + e.festivos, 0);
  const descanso = E.reduce((s, e) => s + Math.max(0, e.descanso), 0);
  document.getElementById('content-body').innerHTML = `
    <div style="max-width:880px;">
      <p style="font-size:13.5px; color:#6b6a64; margin:0 0 12px;">Horas y días de descanso que debes a tu plantilla. No genera pagos: lo que se paga va en Registrar extras.</p>
      <div class="bl-resumen">
        <div><div class="bl-et">Empleados</div><div class="bl-num">${E.length}</div></div>
        <div><div class="bl-et">Horas que debes</div><div class="bl-num debes">${blNum(debes)} h</div></div>
        <div><div class="bl-et">Días de festivo</div><div class="bl-num debes">${blNum(festivos)}</div></div>
        <div><div class="bl-et">Días de descanso</div><div class="bl-num debes">${blNum(descanso)}</div></div>
      </div>
      <div class="bl-filtros">
        <input type="text" id="bl-busca" placeholder="Buscar empleado" value="${blEsc(bolsa.busca)}" oninput="bolsa.busca = this.value; pintarListaBolsa()">
        <select onchange="bolsa.area = this.value; pintarListaBolsa()"><option value="">Todas las áreas</option>${areas.map(a => `<option ${a === bolsa.area ? 'selected' : ''}>${blEsc(a)}</option>`).join('')}</select>
        <button id="bl-pend" class="bl-btn ${bolsa.soloPendientes ? 'on' : ''}" onclick="bolsa.soloPendientes = !bolsa.soloPendientes; this.classList.toggle('on', bolsa.soloPendientes); pintarListaBolsa()">Solo con pendientes</button>
        <button class="bl-btn prim" onclick="blAnadirEmpleado()">Añadir empleado</button>
      </div>
      <div id="bl-lista"></div>
    </div>`;
  pintarListaBolsa();
}
function pintarListaBolsa() {
  const q = bolsa.busca.trim().toLowerCase();
  const lista = bolsa.datos.empleados.filter(e =>
    (!q || String(e.nombre).toLowerCase().includes(q)) &&
    (!bolsa.area || e.area === bolsa.area) &&
    (!bolsa.soloPendientes || e.horas !== 0 || e.festivos !== 0 || e.descanso !== 0));
  document.getElementById('bl-lista').innerHTML = lista.map(blTarjeta).join('') || '<p class="bl-vacio">Nadie coincide con la búsqueda.</p>';
}
function blTarjeta(e) {
  const h = blEstadoHoras(e.horas), c = blEsc(JSON.stringify(e.clave));
  const dias = (n, pend) => `<div class="bl-num ${n > 0 ? 'debes' : n < 0 ? 'debe' : ''}">${blNum(n)}</div><span class="bl-pill ${n > 0 ? 'debes' : n < 0 ? 'debe' : 'ok'}">${n > 0 ? pend : n < 0 ? 'Te debe' : 'Sin pendientes'}</span>`;
  return `<div class="bl-card">
    <div class="bl-card-top">
      <div><div class="bl-nombre">${blEsc(blNombre(e.nombre))}</div><div class="bl-area">${blEsc(e.area)}${e.estado === 'baja' ? ' · baja' : e.estado === 'discontinuo' ? ' · fijo discontinuo' : ''}</div></div>
      <div class="bl-saldos">
        <div class="bl-saldo"><div class="bl-et">Horas</div><div class="bl-num ${h.cls === 'ok' ? '' : h.cls}">${blNum(Math.abs(e.horas))} h</div><span class="bl-pill ${h.cls}">${h.txt}</span></div>
        <div class="bl-saldo"><div class="bl-et">Días de festivo</div>${dias(e.festivos, 'Pendientes')}</div>
        <div class="bl-saldo"><div class="bl-et">Días de descanso</div>${dias(e.descanso, 'Pendientes')}</div>
      </div>
    </div>
    <div class="bl-acciones">
      <button class="bl-btn" onclick='blFormHoras(${c}, "sumar")'>+ Sumar horas</button>
      <button class="bl-btn" onclick='blFormHoras(${c}, "quitar")'>− Quitar horas</button>
      <button class="bl-btn" onclick='blFormFestivo(${c})'>+ Día de festivo</button>
      <button class="bl-btn" onclick='blFormDescanso(${c})'>± Días de descanso</button>
      <button class="bl-btn" onclick='blFormVacaciones(${c})'>+ Vacaciones</button>
      <button class="bl-btn texto" onclick='blHistorial(${c})'>Historial y ajustes</button>
    </div>
  </div>`;
}

// ── Ventanas ──
// Cerrar a mano olvida el historial del que se venía; pasar de una ventana a otra, no
function blCerrar() { blDesdeHistorial = null; blQuitarVentana(); }
function blQuitarVentana() { const f = document.getElementById('bl-fondo'); if (f) f.remove(); }
function blVentana(html, ancho) {
  blQuitarVentana();
  const f = document.createElement('div');
  f.id = 'bl-fondo'; f.className = 'bl-fondo';
  f.innerHTML = `<div class="bl-modal ${ancho ? 'ancho' : ''}">${html}</div>`;
  f.addEventListener('mousedown', e => { if (e.target === f) blCerrar(); });
  document.body.appendChild(f);
  const primero = f.querySelector('[data-foco]');
  if (primero) primero.focus();
}
const blPie = (fn, txt) => `<div class="bl-err" id="bl-err"></div><div class="bl-pie"><button class="bl-btn" onclick="blCerrar()">Cancelar</button><button class="bl-btn prim" id="bl-ok" onclick="${fn}">${txt || 'Guardar'}</button></div>`;
const blVal = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
// Guarda, refresca la lista y, si venía del historial, vuelve a él
async function blGuardar(url, body, clave) {
  const btn = document.getElementById('bl-ok');
  if (btn) btn.disabled = true;
  try {
    await blApi(url, { method: 'POST', body });
    blQuitarVentana();
    await cargarBolsaHoras();
    if (clave) blHistorial(clave);
  } catch (err) {
    if (btn) btn.disabled = false;
    const e = document.getElementById('bl-err');
    if (e) e.textContent = err.message;
  }
}
const blHoy = () => bolsa.datos.hoy;

function blFormHoras(clave, sentido) {
  const e = blEmp(clave);
  bolsa.form = { clave, sentido };
  blVentana(`<h3>${sentido === 'sumar' ? 'Sumar horas' : 'Quitar horas'}</h3><p class="sub">${blEsc(blNombre(e.nombre))}</p>
    <div class="bl-dos">
      <div class="bl-campo"><label>Horas</label><input id="bl-cant" data-foco type="text" autocomplete="off" placeholder="1,5 · 1:30 · 1h30"></div>
      <div class="bl-campo"><label>Fecha</label><input id="bl-fecha" type="date" value="${blHoy()}"></div>
    </div>
    ${sentido === 'quitar' ? `<div class="bl-campo"><label>Motivo</label><select id="bl-motivo"><option value="compensadas">Compensadas con tiempo libre</option><option value="pagadas">Pagadas</option></select></div>` : ''}
    <div class="bl-campo"><label>Nota (opcional)</label><input id="bl-nota" type="text"></div>
    ${blPie('blEnviarHoras()')}`);
}
function blEnviarHoras() {
  const f = bolsa.form;
  blGuardar('/api/bolsa/movimientos', { clave: f.clave, tipo: 'horas', sentido: f.sentido, cantidad: blVal('bl-cant'), fecha: blVal('bl-fecha'), motivo: blVal('bl-motivo'), nota: blVal('bl-nota') }, blDesdeHistorial);
}
function blFormFestivo(clave) {
  const e = blEmp(clave);
  bolsa.form = { clave };
  blVentana(`<h3>Día de festivo trabajado</h3><p class="sub">${blEsc(blNombre(e.nombre))}</p>
    <div class="bl-campo"><label>Festivo trabajado</label><input id="bl-fecha" data-foco type="date" value="${blHoy()}"></div>
    <div class="bl-campo"><label>Nota (opcional)</label><input id="bl-nota" type="text"></div>
    ${blPie('blEnviarFestivo()')}`);
}
function blEnviarFestivo() {
  blGuardar('/api/bolsa/movimientos', { clave: bolsa.form.clave, tipo: 'festivo', fecha: blVal('bl-fecha'), nota: blVal('bl-nota') }, blDesdeHistorial);
}
function blFormDescanso(clave) {
  const e = blEmp(clave);
  bolsa.form = { clave };
  blVentana(`<h3>Días de descanso</h3><p class="sub">${blEsc(blNombre(e.nombre))}</p>
    <div class="bl-campo"><label>¿Qué quieres hacer?</label><select id="bl-sentido" data-foco><option value="sumar">Sumar: se le debe un descanso</option><option value="quitar">Restar: ya lo ha disfrutado</option></select></div>
    <div class="bl-dos">
      <div class="bl-campo"><label>Días</label><input id="bl-cant" type="text" inputmode="decimal" autocomplete="off" value="1" placeholder="1 · 0,5 · 1,5"></div>
      <div class="bl-campo"><label>Fecha</label><input id="bl-fecha" type="date" value="${blHoy()}"></div>
    </div>
    <div class="bl-campo"><label>Nota (opcional)</label><input id="bl-nota" type="text"></div>
    ${blPie('blEnviarDescanso()')}`);
}
function blEnviarDescanso() {
  blGuardar('/api/bolsa/movimientos', { clave: bolsa.form.clave, tipo: 'descanso', sentido: blVal('bl-sentido'), cantidad: blVal('bl-cant'), fecha: blVal('bl-fecha'), nota: blVal('bl-nota') }, blDesdeHistorial);
}
function blFormVacaciones(clave) {
  const e = blEmp(clave);
  bolsa.form = { clave };
  blVentana(`<h3>Vacaciones</h3><p class="sub">${blEsc(blNombre(e.nombre))}</p>
    <div class="bl-dos">
      <div class="bl-campo"><label>Desde</label><input id="bl-ini" data-foco type="date" oninput="blDiasVacaciones()"></div>
      <div class="bl-campo"><label>Hasta</label><input id="bl-fin" type="date" oninput="blDiasVacaciones()"></div>
    </div>
    <p class="sub" id="bl-dias" style="margin:0 0 10px;"></p>
    <div class="bl-campo"><label>Nota (opcional)</label><input id="bl-nota" type="text"></div>
    ${blPie('blEnviarVacaciones()')}`);
}
function blDiasVacaciones() {
  const i = blVal('bl-ini'), f = blVal('bl-fin'), el = document.getElementById('bl-dias');
  if (!i || !f) { el.textContent = ''; return; }
  const n = Math.round((new Date(f + 'T00:00:00Z') - new Date(i + 'T00:00:00Z')) / 86400000) + 1;
  el.textContent = n > 0 ? n + (n === 1 ? ' día natural' : ' días naturales') : 'La fecha de fin es anterior a la de inicio';
}
function blEnviarVacaciones() {
  blGuardar('/api/bolsa/vacaciones', { clave: bolsa.form.clave, fecha_inicio: blVal('bl-ini'), fecha_fin: blVal('bl-fin'), nota: blVal('bl-nota') }, blDesdeHistorial);
}
function blAnadirEmpleado() {
  const areas = [...new Set(bolsa.datos.empleados.map(e => e.area))].sort((a, b) => a.localeCompare(b, 'es'));
  blVentana(`<h3>Añadir empleado</h3><p class="sub">Para quien no está en nómina. El resto ya sale de Personal.</p>
    <div class="bl-campo"><label>Nombre</label><input id="bl-nombre" data-foco type="text" placeholder="Apellidos, Nombre"></div>
    <div class="bl-campo"><label>Área</label><input id="bl-area" type="text" list="bl-areas"><datalist id="bl-areas">${areas.map(a => `<option value="${blEsc(a)}">`).join('')}</datalist></div>
    ${blPie('blEnviarEmpleado()', 'Añadir')}`);
}
function blEnviarEmpleado() {
  blGuardar('/api/bolsa/empleados', { nombre: blVal('bl-nombre'), area: blVal('bl-area') });
}

// ── Historial y ajustes ──
const BL_TIPO = { horas: 'Horas', festivo: 'Festivo trabajado', descanso: 'Días de descanso' };
function blTextoMov(m) {
  const n = Number(m.cantidad);
  if (m.tipo === 'festivo') return 'Festivo trabajado el ' + blFecha(m.fecha);
  const signo = n > 0 ? '+' : '−';
  if (m.tipo === 'horas') return signo + blNum(Math.abs(n)) + ' h' + (m.motivo === 'pagadas' ? ' · pagadas' : m.motivo === 'compensadas' ? ' · compensadas' : '');
  return signo + blNum(Math.abs(n)) + (Math.abs(n) === 1 ? ' día de descanso' : ' días de descanso');
}
function blSub(x, fecha) {
  return [fecha, x.nota, x.registrado_por ? 'apuntó ' + x.registrado_por : '', x.anulado_en ? 'anulado por ' + (x.anulado_por || '') : ''].filter(Boolean).map(blEsc).join(' · ');
}
let blPeticionHistorial = 0;
async function blHistorial(clave) {
  blDesdeHistorial = clave;
  const e = blEmp(clave), esta = ++blPeticionHistorial;
  blVentana('<p class="loading-text">Cargando...</p>', true);
  try {
    const d = await blApi('/api/bolsa/empleado?clave=' + encodeURIComponent(clave));
    // Solo pinta la última petición, y solo si no se ha cerrado la ventana mientras tanto
    if (esta !== blPeticionHistorial || blDesdeHistorial !== clave) return;
    const c = blEsc(JSON.stringify(clave));
    const fest = d.movimientos.filter(m => m.tipo === 'festivo' && !m.disfrutado_fecha && !m.anulado_en);
    const h = blEstadoHoras(e.horas);
    blVentana(`
      <div style="display:flex; justify-content:space-between; gap:10px;"><div><h3>${blEsc(blNombre(e.nombre))}</h3><p class="sub">${blEsc(e.area)} · Horas: ${blNum(Math.abs(e.horas))} h (${h.txt.toLowerCase()}) · Festivos: ${blNum(e.festivos)} · Descanso: ${blNum(e.descanso)} · Vacaciones ${bolsa.datos.anio}: ${blNum(e.vacaciones)} días</p></div><button class="bl-btn" style="align-self:flex-start;" onclick="blCerrar()">Cerrar</button></div>
      <div class="bl-sec">Festivos por disfrutar</div>
      ${fest.map(m => `<div class="bl-fila"><div>${blFecha(m.fecha)}<small>${blSub(m, '')}</small></div><button class="bl-btn mini" onclick='blDisfrutado(${m.id}, ${c})'>Disfrutado</button></div>`).join('') || '<div class="bl-vacio">Ninguno.</div>'}
      <div class="bl-sec"><span>Vacaciones</span><button class="bl-btn mini" onclick='blFormVacaciones(${c})'>+ Añadir</button></div>
      ${d.vacaciones.map(v => `<div class="bl-fila ${v.anulado_en ? 'anulado' : ''}"><div>${blFecha(v.fecha_inicio)} → ${blFecha(v.fecha_fin)} · ${v.dias} ${v.dias === 1 ? 'día' : 'días'}<small>${blSub(v, '')}</small></div>${v.anulado_en ? '' : `<button class="bl-btn mini peligro" onclick='blAnular("vacaciones", ${v.id}, ${c})'>Anular</button>`}</div>`).join('') || '<div class="bl-vacio">Sin vacaciones apuntadas.</div>'}
      <div class="bl-sec">Historial</div>
      ${d.movimientos.map(m => `<div class="bl-fila ${m.anulado_en ? 'anulado' : ''}"><div>${blEsc(blTextoMov(m))}${m.disfrutado_fecha ? ' · disfrutado' : ''}<small>${blSub(m, blFecha(m.fecha))}</small></div><span style="display:flex; gap:6px;">${m.disfrutado_fecha && !m.anulado_en ? `<button class="bl-btn mini" onclick='blDisfrutado(${m.id}, ${c}, true)'>Deshacer</button>` : ''}${m.anulado_en ? '' : `<button class="bl-btn mini peligro" onclick='blAnular("movimientos", ${m.id}, ${c})'>Anular</button>`}</span></div>`).join('') || '<div class="bl-vacio">Todavía no hay movimientos.</div>'}`, true);
  } catch (err) {
    blVentana('<p class="bl-err">Error: ' + blEsc(err.message) + '</p><div class="bl-pie"><button class="bl-btn" onclick="blCerrar()">Cerrar</button></div>');
  }
}
async function blDisfrutado(id, clave, deshacer) {
  try {
    await blApi('/api/bolsa/movimientos/' + id + '/disfrutado', { method: 'POST', body: { fecha: deshacer ? null : blHoy() } });
    await cargarBolsaHoras();
    blHistorial(clave);
  } catch (err) { alert('No se ha podido guardar: ' + err.message); }
}
async function blAnular(tabla, id, clave) {
  if (!confirm('¿Anular este apunte? Dejará de contar, pero seguirá en el historial.')) return;
  try {
    await blApi('/api/bolsa/' + tabla + '/' + id, { method: 'DELETE' });
    await cargarBolsaHoras();
    blHistorial(clave);
  } catch (err) { alert('No se ha podido anular: ' + err.message); }
}
