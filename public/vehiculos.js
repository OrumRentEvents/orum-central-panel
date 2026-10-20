// Módulo Vehículos (fase 1) — Flota, Ficha y Vencimientos. Cargado por
// index.html; usa sus globales (kpiCard, escHtml, marcarMenuActivo,
// #content-title/#content-body). API en lib/vehiculosRutas.js.
// Ver docs/superpowers/specs/2026-10-20-modulo-vehiculos-design.md

const VEH_TIPOS = { furgoneta: 'Furgoneta', camion: 'Camión', turismo: 'Turismo', otro: 'Otro' };
const VEH_PROPIEDAD = { propio: 'Propio', renting: 'Renting', leasing: 'Leasing', alquilado: 'Alquilado' };
const VEH_VENC = { itv: 'ITV', seguro: 'Seguro', ivtm: 'IVTM (circulación)', revision: 'Revisión', tacografo: 'Tacógrafo', fin_renting: 'Fin de renting', otro: 'Otro' };
const VEH_MANT = { mantenimiento: 'Mantenimiento', revision: 'Revisión', itv: 'ITV', reparacion: 'Reparación', neumaticos: 'Neumáticos', averia: 'Avería', limpieza: 'Limpieza', otro: 'Otro' };
const VEH_DOC = { permiso_circulacion: 'Permiso de circulación', ficha_tecnica: 'Ficha técnica', poliza: 'Póliza de seguro', itv: 'Tarjeta ITV', contrato_renting: 'Contrato de renting', otro: 'Otro' };
const VEH_COLOR = { ok: 'var(--green)', aviso: 'var(--orange)', vencido: 'var(--red)' };
const VEH_ESTADO_TXT = { ok: 'Al día', aviso: 'Próximo', vencido: 'Vencido' };

let vehVerInactivos = false;
let vehFichaActual = null; // última respuesta de GET /api/vehiculos/:id
let vehOrdenMant = { campo: 'fecha', asc: false };
let vehEditandoMant = null; // id del mantenimiento en edición
let vehEditandoDoc = null;  // id del documento en edición

(function estilosVehiculos() {
  const css = `
    .veh-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(250px, 1fr)); gap:12px; }
    .veh-card { background:#fff; border:1px solid var(--border); border-radius:4px; padding:14px; cursor:pointer; border-left:4px solid var(--green); }
    .veh-card:hover { border-color:var(--gray-400); }
    .veh-card.aviso { border-left-color:var(--orange); } .veh-card.vencido { border-left-color:var(--red); }
    .veh-mat { font-size:18px; font-weight:600; letter-spacing:.5px; }
    .veh-sub { font-size:12px; color:var(--text-muted); margin-top:2px; }
    .veh-dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:6px; vertical-align:middle; }
    .veh-seccion { background:#fff; border:1px solid var(--border); border-radius:4px; padding:14px; margin-bottom:14px; }
    .veh-seccion h3 { font-size:14px; font-weight:600; margin:0 0 10px; display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
    .veh-form { display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:10px; }
    .veh-form label { display:block; font-size:11px; color:var(--text-muted); margin-bottom:3px; }
    .veh-form input, .veh-form select, .veh-form textarea { width:100%; box-sizing:border-box; padding:6px 8px; border:1px solid var(--border); border-radius:4px; font-size:13px; font-family:inherit; }
    .veh-btn { padding:6px 12px; border-radius:4px; border:1px solid var(--border); background:#fff; font-size:12.5px; cursor:pointer; }
    .veh-btn.prim { background:var(--black); border-color:var(--black); color:#fff; }
    .veh-btn.peligro { color:var(--red); }
    .veh-btn.mini { padding:2px 8px; font-size:11.5px; }
    .veh-error { color:var(--red); font-size:12px; margin-top:6px; min-height:0; }
    .veh-aviso-rutas { background:#fff7e0; border:1px solid #f0d890; border-radius:4px; padding:8px 12px; font-size:12.5px; margin-bottom:12px; }
    .veh-tabla-wrap { overflow-x:auto; }
    .veh-tabla-wrap table { width:100%; }
    .veh-tabla-wrap tr.vencido td { background:#fdecea; } .veh-tabla-wrap tr.aviso td { background:#fff4e5; }
    .veh-tabla-wrap th.ord { cursor:pointer; user-select:none; }
    .veh-pastilla { background:var(--red); color:#fff; border-radius:9px; font-size:10.5px; font-weight:600; padding:1px 6px; margin-left:6px; }
    @media (max-width: 600px) { .veh-form { grid-template-columns:1fr 1fr; } .veh-mat { font-size:16px; } }`;
  const el = document.createElement('style');
  el.textContent = css;
  document.head.appendChild(el);
})();

// ── Utilidades ──
const vehEsc = s => (typeof escHtml === 'function' ? escHtml(s == null ? '' : String(s)) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const vehNum = n => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('es-ES'));
const vehEuros = n => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €');
const vehFecha = f => (f ? String(f).slice(8, 10) + '/' + String(f).slice(5, 7) + '/' + String(f).slice(0, 4) : '—');
const vehOpts = (mapa, sel, vacio) => (vacio ? '<option value="">' + vacio + '</option>' : '') +
  Object.entries(mapa).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${v}</option>`).join('');
const vehNombre = v => [v.marca, v.modelo].filter(Boolean).join(' ') || 'Sin modelo';

async function vehApi(url, opciones) {
  const o = opciones || {};
  const init = { method: o.method || 'GET' };
  if (o.form) init.body = o.form;
  else if (o.body) { init.body = JSON.stringify(o.body); init.headers = { 'Content-Type': 'application/json' }; }
  const resp = await fetch(url, init);
  const json = await resp.json().catch(() => ({ error: 'Respuesta no válida del servidor' }));
  if (!resp.ok || json.error) throw new Error(json.error || ('Error ' + resp.status));
  return json;
}

// "ITV · vence en 12 días", "Revisión · faltan 800 km", "Seguro · vencido hace 3 días"
function vehTextoPlazo(x) {
  const partes = [];
  if (x.dias_restantes !== null && x.dias_restantes !== undefined) {
    const d = x.dias_restantes;
    partes.push(d < 0 ? 'vencido hace ' + (-d) + (d === -1 ? ' día' : ' días') : d === 0 ? 'vence hoy' : 'vence en ' + d + (d === 1 ? ' día' : ' días'));
  }
  if (x.km_restantes !== null && x.km_restantes !== undefined) {
    const k = x.km_restantes;
    partes.push(k <= 0 ? 'pasado ' + vehNum(-k) + ' km' : 'faltan ' + vehNum(k) + ' km');
  }
  return partes.join(' · ') || 'sin km actuales';
}

// "📅 Cita: 28/10/2026 · ITV Marbella" (en rojo si la fecha ya pasó y sigue sin renovarse)
function vehCitaHtml(x) {
  if (!x.cita_pedida || !x.cita_fecha) return '';
  const pasada = x.estado_cita === 'pasada';
  return `<div style="font-size:11.5px; margin-top:3px; color:${pasada ? 'var(--red)' : 'var(--green)'};">📅 Cita: ${vehFecha(x.cita_fecha)}${x.cita_lugar ? ' · ' + vehEsc(x.cita_lugar) : ''}${pasada ? ' (cita pasada, revisar)' : ''}</div>`;
}

function vehError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg || '';
}

// ── Contador del menú ──
async function actualizarContadorVehiculos() {
  try {
    const json = await vehApi('/api/vehiculos/vencimientos');
    const item = document.getElementById('menu-item-vehiculos');
    if (!item) return;
    let pastilla = item.querySelector('.veh-pastilla');
    if (!json.contador) { if (pastilla) pastilla.remove(); return; }
    if (!pastilla) {
      pastilla = document.createElement('span');
      pastilla.className = 'veh-pastilla';
      const etiqueta = item.querySelector('span > span:not(.nav-icon)') || item;
      etiqueta.appendChild(pastilla);
    }
    pastilla.textContent = json.contador;
    pastilla.title = json.contador + ' vencimientos vencidos o próximos';
  } catch (e) { /* sin contador si falla: no molesta al resto del panel */ }
}

// ── Flota ──
async function cargarVehiculos() {
  document.getElementById('content-title').textContent = 'Vehículos · Flota';
  marcarMenuActivo('menu-item-veh-flota');
  const body = document.getElementById('content-body');
  body.innerHTML = '<p class="loading-text">Cargando flota...</p>';
  try {
    pintarFlota(await vehApi('/api/vehiculos' + (vehVerInactivos ? '?inactivos=1' : '')));
  } catch (err) {
    body.innerHTML = '<p class="loading-text">Error: ' + vehEsc(err.message) + '</p>';
  }
}

function pintarFlota(json) {
  const k = json.kpis;
  const sinFicha = json.rutas_sin_asignar || [];
  const tarjetas = json.vehiculos.map(v => {
    const p = v.proximo;
    const linea = p ? `<span class="veh-dot" style="background:${VEH_COLOR[p.estado]}"></span>${vehEsc(VEH_VENC[p.tipo] || p.tipo)} · ${vehTextoPlazo(p)}`
      : '<span style="color:var(--text-muted)">Sin vencimientos</span>';
    return `<div class="veh-card ${v.estado}" onclick="abrirFichaVehiculo(${v.id})">
      <div class="veh-mat">${vehEsc(v.matricula || 'Sin matrícula')}</div>
      <div class="veh-sub">${vehEsc(vehNombre(v))}${v.nombre_rutas ? ' · Rutas: ' + vehEsc(v.nombre_rutas) : ''}${v.propiedad !== 'propio' ? ' · ' + VEH_PROPIEDAD[v.propiedad] : ''}</div>
      <div style="font-size:12.5px; margin-top:10px;">${v.km_actuales !== null ? vehNum(v.km_actuales) + ' km' : '<span style="color:var(--text-muted)">Km sin registrar</span>'}</div>
      <div style="font-size:12.5px; margin-top:4px;">${linea}</div>
    </div>`;
  }).join('');
  document.getElementById('content-body').innerHTML = `
    <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:1rem;">
      ${kpiCard('Vehículos activos', k.activos)}
      ${kpiCard('Vencidos', `<span style="color:${k.vencidos ? 'var(--red)' : 'inherit'}">${k.vencidos}</span>`)}
      ${kpiCard('Vencen en 30 días', `<span style="color:${k.en_aviso ? 'var(--orange)' : 'inherit'}">${k.en_aviso}</span>`)}
      ${kpiCard('Mantenimientos del mes', k.mant_mes_n + ' · ' + vehEuros(k.mant_mes_importe))}
    </div>
    ${sinFicha.length ? `<div class="veh-aviso-rutas">En Rutas hay vehículos sin ficha: <b>${sinFicha.map(vehEsc).join(', ')}</b>. Crea su ficha o asígnalos en el campo "Nombre en Rutas".</div>` : ''}
    <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px; flex-wrap:wrap;">
      <select onchange="vehVerInactivos = this.value === '1'; cargarVehiculos();" style="padding:6px 8px; border:1px solid var(--border); border-radius:4px;">
        <option value="0" ${vehVerInactivos ? '' : 'selected'}>Activos</option>
        <option value="1" ${vehVerInactivos ? 'selected' : ''}>Dados de baja</option>
      </select>
      <button class="veh-btn prim" style="margin-left:auto;" onclick="abrirFichaVehiculo(null)">+ Nuevo vehículo</button>
    </div>
    ${json.vehiculos.length ? `<div class="veh-grid">${tarjetas}</div>` : '<p class="loading-text">No hay vehículos ' + (vehVerInactivos ? 'dados de baja.' : 'activos.') + '</p>'}`;
}

// ── Ficha ──
async function abrirFichaVehiculo(id) {
  const body = document.getElementById('content-body');
  if (id === null) {
    vehFichaActual = null;
    document.getElementById('content-title').textContent = 'Vehículos · Nuevo vehículo';
    body.innerHTML = vehVolver() + `<div class="veh-seccion"><h3>Datos del vehículo</h3>${vehFormDatos({ tipo: 'furgoneta', propiedad: 'propio', activo: true })}</div>`;
    return;
  }
  body.innerHTML = '<p class="loading-text">Cargando ficha...</p>';
  try {
    vehFichaActual = await vehApi('/api/vehiculos/' + id);
    vehEditandoMant = null; vehEditandoDoc = null;
    pintarFicha();
  } catch (err) {
    body.innerHTML = vehVolver() + '<p class="loading-text">Error: ' + vehEsc(err.message) + '</p>';
  }
}

const vehVolver = () => '<div style="margin-bottom:12px;"><button class="veh-btn" onclick="cargarVehiculos()">← Flota</button></div>';

function pintarFicha() {
  const f = vehFichaActual, v = f.vehiculo;
  document.getElementById('content-title').textContent = 'Vehículos · ' + (v.matricula || 'Sin matrícula') + ' · ' + vehNombre(v);
  document.getElementById('content-body').innerHTML = vehVolver() + `
    <div class="veh-seccion"><h3><span>Datos ${v.activo === false ? '<span style="color:var(--red); font-weight:500;">· Dado de baja el ' + vehFecha(v.fecha_baja) + '</span>' : ''}</span>
      <span style="font-size:12.5px; font-weight:500;">Km actuales: ${f.km_actuales !== null ? vehNum(f.km_actuales) : '—'}</span></h3>${vehFormDatos(v)}</div>
    <div class="veh-seccion" id="veh-sec-venc">${vehSeccionVencimientos()}</div>
    <div class="veh-seccion" id="veh-sec-mant">${vehSeccionMantenimientos()}</div>
    <div class="veh-seccion" id="veh-sec-docs">${vehSeccionDocumentos()}</div>`;
}

function vehFormDatos(v) {
  const campo = (id, etiqueta, valor, tipo) => `<div><label>${etiqueta}</label><input id="vf-${id}" type="${tipo || 'text'}" value="${vehEsc(valor == null ? '' : valor)}"></div>`;
  return `<div class="veh-form">
      ${campo('matricula', 'Matrícula', v.matricula)}
      ${campo('marca', 'Marca', v.marca)}
      ${campo('modelo', 'Modelo', v.modelo)}
      <div><label>Tipo</label><select id="vf-tipo">${vehOpts(VEH_TIPOS, v.tipo)}</select></div>
      <div><label>Propiedad</label><select id="vf-propiedad">${vehOpts(VEH_PROPIEDAD, v.propiedad)}</select></div>
      ${campo('nombre_rutas', 'Nombre en Rutas', v.nombre_rutas)}
      ${campo('nombre_localizador', 'Nombre en el localizador', v.nombre_localizador)}
      ${campo('fecha_alta', 'Fecha de alta', v.fecha_alta, 'date')}
      ${campo('km_base', 'Lectura cuentakilómetros (km)', v.km_base, 'number')}
      ${campo('km_base_fecha', 'Fecha de la lectura', v.km_base_fecha, 'date')}
    </div>
    <div class="veh-form" style="grid-template-columns:1fr; margin-top:10px;"><div><label>Notas</label><textarea id="vf-notas" rows="2">${vehEsc(v.notas || '')}</textarea></div></div>
    <div class="veh-error" id="vf-error"></div>
    <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
      <button class="veh-btn prim" onclick="guardarDatosVehiculo()">Guardar</button>
      ${v.id ? (v.activo === false ? '<button class="veh-btn" onclick="cambiarAltaVehiculo(true)">Reactivar</button>'
        : '<button class="veh-btn peligro" onclick="cambiarAltaVehiculo(false)">Dar de baja</button>') : ''}
    </div>`;
}

async function guardarDatosVehiculo() {
  const val = id => document.getElementById('vf-' + id).value.trim();
  const datos = {};
  ['matricula', 'marca', 'modelo', 'tipo', 'propiedad', 'nombre_rutas', 'nombre_localizador', 'fecha_alta', 'km_base', 'km_base_fecha', 'notas'].forEach(c => { datos[c] = val(c); });
  vehError('vf-error', '');
  try {
    const id = vehFichaActual && vehFichaActual.vehiculo.id;
    const r = await vehApi('/api/vehiculos' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: datos });
    await abrirFichaVehiculo(r.vehiculo.id);
    actualizarContadorVehiculos();
  } catch (err) { vehError('vf-error', err.message); }
}

async function cambiarAltaVehiculo(activo) {
  if (!activo && !confirm('¿Dar de baja este vehículo? Se conserva todo su histórico y deja de avisar.')) return;
  try {
    await vehApi('/api/vehiculos/' + vehFichaActual.vehiculo.id, { method: 'PUT', body: { activo } });
    await abrirFichaVehiculo(vehFichaActual.vehiculo.id);
    actualizarContadorVehiculos();
  } catch (err) { vehError('vf-error', err.message); }
}

// ── Vencimientos (dentro de la ficha) ──
function vehSeccionVencimientos(editandoId) {
  const lista = vehFichaActual.vencimientos;
  const filas = lista.map(x => editandoId === x.id ? `<tr><td colspan="7">${vehFormVencimiento(x)}</td></tr>` : `
    <tr class="${x.estado === 'ok' ? '' : x.estado}">
      <td>${VEH_VENC[x.tipo] || x.tipo}</td><td>${vehEsc(x.descripcion || '')}</td>
      <td>${vehFecha(x.fecha_limite)}</td><td>${x.km_limite !== null ? vehNum(x.km_limite) : '—'}</td>
      <td>${vehTextoPlazo(x)}${vehCitaHtml(x)}</td>
      <td><span class="veh-dot" style="background:${VEH_COLOR[x.estado]}"></span>${VEH_ESTADO_TXT[x.estado]}</td>
      <td style="white-space:nowrap;"><button class="veh-btn mini" onclick="editarVencimiento(${x.id})">Editar</button>
        <button class="veh-btn mini peligro" onclick="borrarVencimiento(${x.id})">Borrar</button></td>
    </tr>`).join('');
  return `<h3><span>Vencimientos</span><button class="veh-btn" onclick="nuevoVencimiento()">+ Añadir vencimiento</button></h3>
    <div id="veh-venc-nuevo"></div>
    ${lista.length ? `<div class="veh-tabla-wrap"><table><thead><tr><th>Tipo</th><th>Descripción</th><th>Fecha límite</th><th>Km límite</th><th>Faltan</th><th>Estado</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`
      : '<p style="font-size:12.5px; color:var(--text-muted); margin:0;">Sin vencimientos. Añade la ITV, el seguro, el IVTM y las revisiones para que avisen.</p>'}`;
}

function vehFormVencimiento(x) {
  const id = x.id || 'nuevo';
  const c = (campo, etiqueta, tipo, valor) => `<div><label>${etiqueta}</label><input id="vv-${id}-${campo}" type="${tipo}" value="${vehEsc(valor == null ? '' : valor)}"></div>`;
  return `<div class="veh-form" style="margin:6px 0;">
      <div><label>Tipo</label><select id="vv-${id}-tipo">${vehOpts(VEH_VENC, x.tipo || 'itv')}</select></div>
      ${c('descripcion', 'Descripción', 'text', x.descripcion)}
      ${c('fecha_limite', 'Fecha límite', 'date', x.fecha_limite)}
      ${c('km_limite', 'Km límite', 'number', x.km_limite)}
      ${c('aviso_dias', 'Avisar con (días)', 'number', x.aviso_dias ?? 30)}
      ${c('aviso_km', 'Avisar con (km)', 'number', x.aviso_km ?? 1000)}
      ${c('periodicidad_meses', 'Se renueva cada (meses)', 'number', x.periodicidad_meses)}
      ${c('periodicidad_km', 'Se renueva cada (km)', 'number', x.periodicidad_km)}
    </div>
    <div class="veh-form" style="margin:6px 0; align-items:end;">
      <div><label style="display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--text-primary); cursor:pointer;">
        <input id="vv-${id}-cita_pedida" type="checkbox" style="width:auto;" ${x.cita_pedida ? 'checked' : ''}
          onchange="document.getElementById('vv-${id}-cita-campos').style.display = this.checked ? 'contents' : 'none'"> Cita pedida (taller / ITV)</label></div>
      <div id="vv-${id}-cita-campos" style="display:${x.cita_pedida ? 'contents' : 'none'};">
        ${c('cita_fecha', 'Fecha de la cita', 'date', x.cita_fecha)}
        ${c('cita_lugar', 'Lugar', 'text', x.cita_lugar)}
      </div>
    </div>
    <div class="veh-error" id="vv-${id}-error"></div>
    <div style="display:flex; gap:8px; margin:6px 0 10px;"><button class="veh-btn prim" onclick="guardarVencimiento(${x.id || 'null'})">Guardar</button>
      <button class="veh-btn" onclick="cancelarVencimiento()">Cancelar</button></div>`;
}

function nuevoVencimiento() { document.getElementById('veh-venc-nuevo').innerHTML = vehFormVencimiento({}); }
function editarVencimiento(id) { document.getElementById('veh-sec-venc').innerHTML = vehSeccionVencimientos(id); }
function cancelarVencimiento() { document.getElementById('veh-sec-venc').innerHTML = vehSeccionVencimientos(); }

async function guardarVencimiento(id) {
  const k = id || 'nuevo';
  const val = c => document.getElementById('vv-' + k + '-' + c).value.trim();
  const datos = {};
  ['tipo', 'descripcion', 'fecha_limite', 'km_limite', 'aviso_dias', 'aviso_km', 'periodicidad_meses', 'periodicidad_km', 'cita_fecha', 'cita_lugar'].forEach(c => { datos[c] = val(c); });
  datos.cita_pedida = document.getElementById('vv-' + k + '-cita_pedida').checked;
  const vid = vehFichaActual.vehiculo.id;
  try {
    await vehApi('/api/vehiculos/' + vid + '/vencimientos' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: datos });
    await abrirFichaVehiculo(vid);
    actualizarContadorVehiculos();
  } catch (err) { vehError('vv-' + k + '-error', err.message); }
}

async function borrarVencimiento(id) {
  if (!confirm('¿Borrar este vencimiento?')) return;
  const vid = vehFichaActual.vehiculo.id;
  try {
    await vehApi('/api/vehiculos/' + vid + '/vencimientos/' + id, { method: 'DELETE' });
    await abrirFichaVehiculo(vid);
    actualizarContadorVehiculos();
  } catch (err) { alert(err.message); }
}

// ── Mantenimientos ──
function vehSeccionMantenimientos() {
  const o = vehOrdenMant;
  // Fechas ISO: se ordenan como texto (ordenarLista espera DD/MM/YYYY).
  const lista = [...vehFichaActual.mantenimientos].sort((a, b) => {
    let va = a[o.campo], vb = b[o.campo];
    if (o.campo === 'km' || o.campo === 'importe') { va = Number(va) || 0; vb = Number(vb) || 0; } else { va = String(va || '').toLowerCase(); vb = String(vb || '').toLowerCase(); }
    return (va < vb ? -1 : va > vb ? 1 : 0) * (o.asc ? 1 : -1);
  });
  const anio = new Date().getFullYear().toString();
  const totalAnio = vehFichaActual.mantenimientos.filter(m => String(m.fecha).startsWith(anio)).reduce((s, m) => s + (Number(m.importe) || 0), 0);
  const th = (campo, txt) => `<th class="ord" onclick="ordenarMantenimientos('${campo}')">${txt}${o.campo === campo ? (o.asc ? ' ▲' : ' ▼') : ''}</th>`;
  const vencPorId = {};
  vehFichaActual.vencimientos.forEach(x => { vencPorId[x.id] = x; });
  const filas = lista.map(m => vehEditandoMant === m.id ? `<tr><td colspan="8">${vehFormMantenimiento(m)}</td></tr>` : `<tr>
      <td>${vehFecha(m.fecha)}</td><td>${VEH_MANT[m.tipo] || m.tipo}</td><td>${vehEsc(m.descripcion || '')}</td><td>${vehEsc(m.taller || '')}</td>
      <td>${m.km !== null ? vehNum(m.km) : '—'}</td><td style="text-align:right;">${vehEuros(m.importe)}</td>
      <td>${m.vencimiento_id && vencPorId[m.vencimiento_id] ? 'Renovó ' + (VEH_VENC[vencPorId[m.vencimiento_id].tipo] || '') : ''}</td>
      <td style="white-space:nowrap;"><button class="veh-btn mini" onclick="editarMantenimiento(${m.id})">Editar</button>
        <button class="veh-btn mini peligro" onclick="borrarMantenimiento(${m.id})">Borrar</button></td></tr>`).join('');
  return `<h3><span>Mantenimientos · ${anio}: ${vehEuros(totalAnio)}</span><button class="veh-btn" onclick="nuevoMantenimiento()">+ Registrar mantenimiento</button></h3>
    <div id="veh-mant-nuevo"></div>
    ${lista.length ? `<div class="veh-tabla-wrap"><table><thead><tr>${th('fecha', 'Fecha')}${th('tipo', 'Tipo')}${th('descripcion', 'Descripción')}${th('taller', 'Taller')}${th('km', 'Km')}${th('importe', 'Importe (sin IVA)')}<th></th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`
      : '<p style="font-size:12.5px; color:var(--text-muted); margin:0;">Sin mantenimientos registrados.</p>'}`;
}

function ordenarMantenimientos(campo) {
  vehOrdenMant = { campo, asc: vehOrdenMant.campo === campo ? !vehOrdenMant.asc : campo !== 'fecha' };
  document.getElementById('veh-sec-mant').innerHTML = vehSeccionMantenimientos();
}

// Mismo formulario para registrar (m vacío) y editar (m = mantenimiento).
function vehFormMantenimiento(m) {
  const k = m.id || 'nuevo';
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const vencs = vehFichaActual.vencimientos.map(x => `<option value="${x.id}" ${String(x.id) === String(m.vencimiento_id || '') ? 'selected' : ''}>${VEH_VENC[x.tipo] || x.tipo}${x.descripcion ? ' · ' + vehEsc(x.descripcion) : ''}</option>`).join('');
  const c = (campo, etiqueta, tipo, valor, extra) => `<div><label>${etiqueta}</label><input id="vm-${k}-${campo}" type="${tipo}" value="${vehEsc(valor == null ? '' : valor)}" ${extra || ''}></div>`;
  return `<div class="veh-form" style="margin:6px 0;">
      ${c('fecha', 'Fecha', 'date', m.fecha || hoy)}
      <div><label>Tipo</label><select id="vm-${k}-tipo">${vehOpts(VEH_MANT, m.tipo || 'mantenimiento')}</select></div>
      ${c('descripcion', 'Descripción', 'text', m.descripcion, 'placeholder="Cambio de aceite y filtros..."')}
      ${c('taller', 'Taller', 'text', m.taller)}
      ${c('km', 'Km del vehículo', 'number', m.km)}
      ${c('importe', 'Importe sin IVA (€)', 'number', m.importe, 'step="0.01"')}
      <div><label>Renueva el vencimiento</label><select id="vm-${k}-vencimiento_id"><option value="">— Ninguno —</option>${vencs}</select></div>
    </div>
    <div class="veh-error" id="vm-${k}-error"></div>
    <div style="display:flex; gap:8px; margin:6px 0 10px;"><button class="veh-btn prim" onclick="guardarMantenimiento(${m.id || 'null'})">Guardar</button>
      <button class="veh-btn" onclick="cancelarMantenimiento()">Cancelar</button></div>`;
}

function nuevoMantenimiento() { document.getElementById('veh-mant-nuevo').innerHTML = vehFormMantenimiento({}); }
function editarMantenimiento(id) { vehEditandoMant = id; document.getElementById('veh-sec-mant').innerHTML = vehSeccionMantenimientos(); }
function cancelarMantenimiento() { vehEditandoMant = null; document.getElementById('veh-sec-mant').innerHTML = vehSeccionMantenimientos(); }

async function guardarMantenimiento(id) {
  const k = id || 'nuevo';
  const datos = {};
  ['fecha', 'tipo', 'descripcion', 'taller', 'km', 'importe', 'vencimiento_id'].forEach(c => { datos[c] = document.getElementById('vm-' + k + '-' + c).value.trim(); });
  const vid = vehFichaActual.vehiculo.id;
  try {
    await vehApi('/api/vehiculos/' + vid + '/mantenimientos' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: datos });
    vehEditandoMant = null;
    await abrirFichaVehiculo(vid);
    actualizarContadorVehiculos();
  } catch (err) { vehError('vm-' + k + '-error', err.message); }
}

async function borrarMantenimiento(id) {
  const m = vehFichaActual.mantenimientos.find(x => x.id === id);
  if (!confirm('¿Borrar este mantenimiento?' + (m && m.renovacion ? ' El vencimiento que renovó vuelve a su límite anterior.' : ''))) return;
  const vid = vehFichaActual.vehiculo.id;
  try {
    await vehApi('/api/vehiculos/' + vid + '/mantenimientos/' + id, { method: 'DELETE' });
    await abrirFichaVehiculo(vid);
  } catch (err) { alert(err.message); }
}

// ── Documentos ──
function vehSeccionDocumentos() {
  const docs = vehFichaActual.documentos;
  const filas = docs.map(d => vehEditandoDoc === d.id ? `<tr><td colspan="5">
      <div class="veh-form" style="margin:6px 0; align-items:end;">
        <div><label>Tipo</label><select id="vde-tipo">${vehOpts(VEH_DOC, d.tipo)}</select></div>
        <div><label>Caduca</label><input id="vde-fecha" type="date" value="${vehEsc(d.fecha_caducidad || '')}"></div>
        <div style="display:flex; gap:8px;"><button class="veh-btn prim" onclick="guardarDocumentoVehiculo(${d.id})">Guardar</button>
          <button class="veh-btn" onclick="editarDocumentoVehiculo(null)">Cancelar</button></div>
      </div></td></tr>` : `<tr><td>${VEH_DOC[d.tipo] || d.tipo}</td><td>${vehEsc(d.nombre_archivo)}</td><td>${vehFecha(d.fecha_caducidad)}</td>
      <td>${vehFecha(String(d.subido_en || '').slice(0, 10))} · ${vehEsc(d.subido_por || '')}</td>
      <td style="white-space:nowrap;"><button class="veh-btn mini" onclick="descargarDocumentoVehiculo(${d.id})">Descargar</button>
        <button class="veh-btn mini" onclick="editarDocumentoVehiculo(${d.id})">Editar</button>
        <button class="veh-btn mini peligro" onclick="borrarDocumentoVehiculo(${d.id})">Borrar</button></td></tr>`).join('');
  return `<h3><span>Documentos</span></h3>
    <div class="veh-form" style="margin-bottom:10px; align-items:end;">
      <div><label>Tipo</label><select id="vd-tipo">${vehOpts(VEH_DOC, 'permiso_circulacion')}</select></div>
      <div><label>Caduca (opcional)</label><input id="vd-fecha" type="date"></div>
      <div><label>Archivo (PDF, JPG o PNG, máx. 10 MB)</label><input id="vd-archivo" type="file" accept=".pdf,.jpg,.jpeg,.png"></div>
      <div><button class="veh-btn prim" onclick="subirDocumentoVehiculo()">Subir</button></div>
    </div>
    <div class="veh-error" id="vd-error"></div>
    ${docs.length ? `<div class="veh-tabla-wrap"><table><thead><tr><th>Tipo</th><th>Archivo</th><th>Caduca</th><th>Subido</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`
      : '<p style="font-size:12.5px; color:var(--text-muted); margin:0;">Sin documentos.</p>'}`;
}

async function subirDocumentoVehiculo() {
  const archivo = document.getElementById('vd-archivo').files[0];
  if (!archivo) return vehError('vd-error', 'Elige un archivo');
  if (archivo.size > 10 * 1024 * 1024) return vehError('vd-error', 'El archivo supera los 10 MB');
  const form = new FormData();
  form.append('tipo', document.getElementById('vd-tipo').value);
  form.append('fecha_caducidad', document.getElementById('vd-fecha').value);
  form.append('archivo', archivo);
  const vid = vehFichaActual.vehiculo.id;
  vehError('vd-error', 'Subiendo...');
  try {
    await vehApi('/api/vehiculos/' + vid + '/documentos', { method: 'POST', form });
    await abrirFichaVehiculo(vid);
  } catch (err) { vehError('vd-error', err.message); }
}

function editarDocumentoVehiculo(id) { vehEditandoDoc = id; document.getElementById('veh-sec-docs').innerHTML = vehSeccionDocumentos(); }

async function guardarDocumentoVehiculo(id) {
  const vid = vehFichaActual.vehiculo.id;
  try {
    await vehApi('/api/vehiculos/' + vid + '/documentos/' + id, { method: 'PUT', body: { tipo: document.getElementById('vde-tipo').value, fecha_caducidad: document.getElementById('vde-fecha').value } });
    vehEditandoDoc = null;
    await abrirFichaVehiculo(vid);
  } catch (err) { vehError('vd-error', err.message); }
}

async function descargarDocumentoVehiculo(id) {
  try {
    const r = await vehApi('/api/vehiculos/' + vehFichaActual.vehiculo.id + '/documentos/' + id);
    window.open(r.url, '_blank');
  } catch (err) { vehError('vd-error', err.message); }
}

async function borrarDocumentoVehiculo(id) {
  if (!confirm('¿Borrar este documento?')) return;
  const vid = vehFichaActual.vehiculo.id;
  try {
    await vehApi('/api/vehiculos/' + vid + '/documentos/' + id, { method: 'DELETE' });
    await abrirFichaVehiculo(vid);
  } catch (err) { vehError('vd-error', err.message); }
}

// ── Vista global de vencimientos ──
async function cargarVencimientosVehiculos() {
  document.getElementById('content-title').textContent = 'Vehículos · Vencimientos';
  marcarMenuActivo('menu-item-veh-vencimientos');
  const body = document.getElementById('content-body');
  body.innerHTML = '<p class="loading-text">Cargando vencimientos...</p>';
  try {
    const json = await vehApi('/api/vehiculos/vencimientos');
    const filas = json.vencimientos.map(x => `<tr class="${x.estado === 'ok' ? '' : x.estado}" style="cursor:pointer;" onclick="abrirFichaVehiculo(${x.vehiculo.id})">
        <td><b>${vehEsc(x.vehiculo.matricula || 'Sin matrícula')}</b> <span style="color:var(--text-muted)">${vehEsc(vehNombre(x.vehiculo))}</span></td>
        <td>${VEH_VENC[x.tipo] || x.tipo}</td><td>${vehEsc(x.descripcion || '')}</td>
        <td>${vehFecha(x.fecha_limite)}</td><td>${x.km_limite !== null ? vehNum(x.km_limite) : '—'}</td>
        <td>${vehTextoPlazo(x)}${vehCitaHtml(x)}</td><td><span class="veh-dot" style="background:${VEH_COLOR[x.estado]}"></span>${VEH_ESTADO_TXT[x.estado]}</td></tr>`).join('');
    body.innerHTML = json.vencimientos.length
      ? `<p style="font-size:12.5px; color:var(--text-muted); margin:0 0 10px;">${json.contador} vencidos o próximos · pulsa una fila para abrir la ficha.</p>
         <div class="veh-tabla-wrap"><table><thead><tr><th>Vehículo</th><th>Tipo</th><th>Descripción</th><th>Fecha límite</th><th>Km límite</th><th>Faltan</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table></div>`
      : '<p class="loading-text">No hay vencimientos registrados. Añádelos desde la ficha de cada vehículo.</p>';
    body.insertAdjacentHTML('beforeend', `<div class="veh-seccion" style="margin-top:16px;">
      <h3><span>Avisos por email</span></h3>
      <p style="font-size:12.5px; color:var(--text-muted); margin:0 0 8px;">Los lunes a las 8:00 llega un resumen con todo lo pendiente (si hay algo); el resto de días, un email solo si algún vencimiento acaba de pasar a próximo (30 días o 1.000 km antes) o a vencido. Destinatarios: <span id="veh-avisos-dest">…</span></p>
      <div class="veh-form" style="align-items:end;">
        <div><label>Enviar prueba a</label><input id="veh-avisos-para" type="email" value="logistica@orumevents.com"></div>
        <div><button class="veh-btn" onclick="enviarPruebaAvisos()">Enviar prueba</button></div>
      </div>
      <div class="veh-error" id="veh-avisos-msg"></div>
    </div>`);
    vehApi('/api/vehiculos/avisos/destinatarios').then(r => { document.getElementById('veh-avisos-dest').textContent = r.destinatarios.join(', ') || 'ninguno'; }).catch(() => {});
    actualizarContadorVehiculos();
  } catch (err) {
    body.innerHTML = '<p class="loading-text">Error: ' + vehEsc(err.message) + '</p>';
  }
}

async function enviarPruebaAvisos() {
  const msg = document.getElementById('veh-avisos-msg');
  msg.style.color = 'var(--text-muted)';
  msg.textContent = 'Enviando...';
  try {
    const r = await vehApi('/api/vehiculos/avisos/prueba', { method: 'POST', body: { para: document.getElementById('veh-avisos-para').value.trim() } });
    msg.style.color = 'var(--green)';
    msg.textContent = 'Prueba enviada a ' + r.enviado_a + ' con la situación actual (no cuenta como aviso real).';
  } catch (err) { msg.style.color = 'var(--red)'; msg.textContent = err.message; }
}

// ── Uso (fase 3): localizador GPS + conductores de Rutas ──
let vehUsoMes = null;
let vehUsoTab = 'vehiculos';
let vehUsoDatos = null;
let vehUsoAbierto = null; // vehiculo_id con el detalle diario desplegado

const vehHoras = seg => { const m = Math.round((Number(seg) || 0) / 60); return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ' h'; };
const vehMatriculaDe = id => { const v = (vehUsoDatos.vehiculos || []).find(x => x.id === id); return v ? (v.matricula || vehNombre(v)) : '#' + id; };
const vehConductorTxt = c => (c === null ? '<span style="color:var(--text-muted)">Sin determinar</span>' : vehEsc(c));

async function cargarUsoVehiculos(mes) {
  document.getElementById('content-title').textContent = 'Vehículos · Uso';
  marcarMenuActivo('menu-item-veh-uso');
  const body = document.getElementById('content-body');
  body.innerHTML = '<p class="loading-text">Cargando uso...</p>';
  try {
    const elegido = mes || vehUsoMes;
    vehUsoDatos = await vehApi('/api/vehiculos/uso' + (elegido ? '?mes=' + elegido : ''));
    // Sin mes elegido y sin datos este mes: salta al último mes importado.
    if (!elegido && !vehUsoDatos.porVehiculo.length && vehUsoDatos.ultimo_dia_importado) {
      vehUsoDatos = await vehApi('/api/vehiculos/uso?mes=' + vehUsoDatos.ultimo_dia_importado.slice(0, 7));
    }
    vehUsoMes = vehUsoDatos.mes;
    pintarUso();
  } catch (err) {
    body.innerHTML = '<p class="loading-text">Error: ' + vehEsc(err.message) + '</p>';
  }
}

function pintarUso() {
  const d = vehUsoDatos;
  const kmTotal = d.porVehiculo.reduce((s, v) => s + v.km, 0);
  const kmSin = d.sinConductor.reduce((s, x) => s + x.km, 0);
  const tab = (id, txt) => `<button class="veh-btn ${vehUsoTab === id ? 'prim' : ''}" onclick="vehUsoTab='${id}'; pintarUso();">${txt}</button>`;
  const contenido = vehUsoTab === 'conductores' ? vehUsoConductores() : vehUsoTab === 'revisar' ? vehUsoRevisar() : vehUsoTab === 'sin' ? vehUsoSin() : vehUsoVehiculos();
  document.getElementById('content-body').innerHTML = `
    <div style="display:flex; gap:8px; align-items:end; flex-wrap:wrap; margin-bottom:12px;">
      <div class="veh-form" style="grid-template-columns:auto;"><div><label>Mes</label><input type="month" value="${vehUsoMes}" onchange="vehUsoMes=this.value; cargarUsoVehiculos(this.value)"></div></div>
      <span style="font-size:12px; color:var(--text-muted); padding-bottom:8px;">${d.ultimo_dia_importado ? 'Importado hasta el ' + vehFecha(d.ultimo_dia_importado) : 'Aún no hay datos del localizador'}</span>
      <button class="veh-btn prim" style="margin-left:auto;" onclick="mostrarImportarLocalizador()">Importar localizador</button>
    </div>
    <div id="veh-import"></div>
    <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:1rem;">
      ${kpiCard('Km del mes', vehNum(Math.round(kmTotal)))}
      ${kpiCard('Vehículos con uso', d.porVehiculo.length)}
      ${kpiCard('Días a revisar', `<span style="color:${d.revisar.length ? 'var(--orange)' : 'inherit'}">${d.revisar.length}</span>`)}
      ${kpiCard('Km sin conductor en Rutas', vehNum(Math.round(kmSin)))}
    </div>
    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">
      ${tab('vehiculos', 'Por vehículo')}${tab('conductores', 'Por conductor')}${tab('revisar', 'A revisar (' + d.revisar.length + ')')}${tab('sin', 'Sin conductor (' + d.sinConductor.length + ')')}
    </div>
    <div class="veh-seccion">${contenido}</div>`;
}

function vehUsoVehiculos() {
  const d = vehUsoDatos;
  if (!d.porVehiculo.length) return '<p style="margin:0; font-size:12.5px; color:var(--text-muted);">Sin trayectos este mes. Importa el informe del localizador.</p>';
  const filas = [...d.porVehiculo].sort((a, b) => b.km - a.km).map(v => {
    const abierto = vehUsoAbierto === v.vehiculo_id;
    const detalle = abierto ? `<tr><td colspan="7" style="background:var(--gray-100);"><table style="width:100%;">
      <thead><tr><th>Día</th><th>Km</th><th>Trayectos</th><th>Parado con motor</th><th>Vueltas y conductor</th></tr></thead><tbody>${v.detalle.map(dia => `<tr>
        <td>${vehFecha(dia.fecha)}</td><td>${vehNum(dia.km)}</td><td>${dia.trayectos}</td><td>${vehHoras(dia.seg_paradas)}</td>
        <td>${dia.sin_rutas ? '<span style="color:var(--orange)">Sin conductor en Rutas</span>'
          : dia.revisar ? '<span style="color:var(--orange)">A revisar: las vueltas no cuadran</span>'
          : dia.vueltas.map(x => `V${x.vuelta} · ${x.sin_rutas ? '<span style="color:var(--orange)">sin apuntar en Rutas</span>' : vehConductorTxt(x.conductor)} · ${vehNum(x.km)} km`).join('<br>')}</td></tr>`).join('')}</tbody></table></td></tr>` : '';
    return `<tr style="cursor:pointer;" onclick="vehUsoAbierto = vehUsoAbierto === ${v.vehiculo_id} ? null : ${v.vehiculo_id}; pintarUso();">
      <td><b>${vehEsc(vehMatriculaDe(v.vehiculo_id))}</b> ${abierto ? '▾' : '▸'}</td><td>${vehNum(Math.round(v.km))}</td><td>${v.dias}</td>
      <td>${v.trayectos}</td><td>${vehHoras(v.seg_conduccion)}</td><td>${vehHoras(v.seg_paradas)}</td><td>${vehNum(Math.round(v.km / Math.max(v.dias, 1)))}</td></tr>${detalle}`;
  }).join('');
  return `<div class="veh-tabla-wrap"><table><thead><tr><th>Vehículo</th><th>Km</th><th>Días</th><th>Trayectos</th><th>Conducción</th><th>Parado con motor</th><th>Km/día</th></tr></thead><tbody>${filas}</tbody></table></div>
    <p style="font-size:12px; color:var(--text-muted); margin:8px 0 0;">Pulsa un vehículo para ver el detalle por día.</p>`;
}

function vehUsoConductores() {
  const l = vehUsoDatos.porConductor;
  if (!l.length) return '<p style="margin:0; font-size:12.5px; color:var(--text-muted);">Sin datos.</p>';
  return `<div class="veh-tabla-wrap"><table><thead><tr><th>Conductor</th><th>Km</th><th>Conducción</th><th>Parado con motor</th><th>Días</th><th>Vueltas</th></tr></thead><tbody>
    ${l.map(c => `<tr><td>${vehConductorTxt(c.conductor)}</td><td>${vehNum(Math.round(c.km))}</td><td>${vehHoras(c.seg_conduccion)}</td><td>${vehHoras(c.seg_paradas)}</td><td>${c.dias}</td><td>${c.vueltas}</td></tr>`).join('')}
    </tbody></table></div>
    <p style="font-size:12px; color:var(--text-muted); margin:8px 0 0;">"Sin determinar": vueltas con varias personas en Rutas sin marcar quién conduce (márcalo en Rutas, sale con 🚐). No cuentan para nadie.</p>`;
}

function vehUsoRevisar() {
  const l = vehUsoDatos.revisar;
  if (!l.length) return '<p style="margin:0; font-size:12.5px; color:var(--text-muted);">Nada que revisar: todos los días se han repartido solos.</p>';
  return `<p style="font-size:12.5px; color:var(--text-muted); margin:0 0 10px;">Las vueltas de Rutas no coinciden con las salidas desde la nave de Monda. Indica a qué hora empieza cada vuelta a partir de la segunda (p. ej. "13:30" o "11:00, 16:00").</p>` +
    l.map(r => {
      const k = r.vehiculo_id + '_' + r.fecha;
      return `<div style="border-top:1px solid var(--border); padding:10px 0;">
        <b>${vehEsc(vehMatriculaDe(r.vehiculo_id))}</b> · ${vehFecha(r.fecha)} · Rutas: ${r.vueltas} vueltas · localizador: ${r.salidas} salidas · ${vehNum(r.km)} km
        ${r.cortes_invalidos ? `<div style="font-size:12px; color:var(--red); margin-top:4px;">Las horas de corte guardadas (${r.cortes.map(vehEsc).join(', ')}) ya no cuadran con las vueltas de Rutas: pon ${r.vueltas - 1}.</div>` : ''}
        <div style="font-size:12px; color:var(--text-secondary); margin:6px 0;">${r.trayectos.map(t => `${t.inicio} · ${vehNum(t.km)} km → ${vehEsc(t.destino || '')}${t.loc_destino ? ' (' + vehEsc(t.loc_destino) + ')' : ''}`).join('<br>')}</div>
        <div class="veh-form" style="grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); align-items:end;">
          <div><label>Horas de corte (${r.vueltas - 1})</label><input id="vc-${k}" type="text" placeholder="13:30" value="${vehEsc((r.cortes || []).join(', '))}"></div>
          <div><button class="veh-btn prim" onclick="guardarCortesVuelta(${r.vehiculo_id}, '${r.fecha}')">Guardar</button></div>
        </div>
        <div class="veh-error" id="vc-${k}-error"></div>
      </div>`;
    }).join('');
}

async function guardarCortesVuelta(vehiculoId, fecha) {
  const k = vehiculoId + '_' + fecha;
  const cortes = document.getElementById('vc-' + k).value.split(/[,\s]+/).filter(Boolean);
  try {
    await vehApi('/api/vehiculos/uso/cortes', { method: 'PUT', body: { vehiculo_id: vehiculoId, fecha, cortes } });
    await cargarUsoVehiculos(vehUsoMes);
  } catch (err) { vehError('vc-' + k + '-error', err.message); }
}

function vehUsoSin() {
  const l = vehUsoDatos.sinConductor;
  if (!l.length) return '<p style="margin:0; font-size:12.5px; color:var(--text-muted);">Todos los días con movimiento tienen conductor en Rutas.</p>';
  return `<p style="font-size:12.5px; color:var(--text-muted); margin:0 0 10px;">Días en que el localizador registra movimiento pero en Rutas no hay nadie asignado a ese vehículo.</p>
    <div class="veh-tabla-wrap"><table><thead><tr><th>Vehículo</th><th>Día</th><th>Vuelta</th><th>Km</th><th>Trayectos</th></tr></thead><tbody>
    ${[...l].sort((a, b) => b.km - a.km).map(s => `<tr><td>${vehEsc(vehMatriculaDe(s.vehiculo_id))}</td><td>${vehFecha(s.fecha)}</td><td>${s.vuelta ? s.vuelta + 'ª sin apuntar' : 'todo el día'}</td><td>${vehNum(s.km)}</td><td>${s.trayectos}</td></tr>`).join('')}
    </tbody></table></div>`;
}

// Importación: primero vista previa (nada se guarda), luego confirmar.
// Admite varios archivos a la vez y los dos informes del localizador.
function mostrarImportarLocalizador() {
  document.getElementById('veh-import').innerHTML = `<div class="veh-seccion">
    <h3><span>Importar informes del localizador</span></h3>
    <p style="font-size:12.5px; color:var(--text-muted); margin:0 0 8px;">"Informe detallado" (mejor: trae velocidades y consumo) o "Detalle de trayectos". Puedes elegir varios archivos a la vez; lo ya importado no se duplica.</p>
    <div class="veh-form" style="align-items:end;">
      <div><label>Archivos Excel (.xlsx)</label><input id="vi-archivo" type="file" accept=".xlsx,.xls" multiple></div>
      <div><button class="veh-btn prim" onclick="importarLocalizador(false)">Revisar</button></div>
    </div>
    <div id="vi-resumen" style="font-size:12.5px; margin-top:10px;"></div>
    <div class="veh-error" id="vi-error"></div></div>`;
}

async function importarLocalizador(confirmar) {
  const archivos = [...document.getElementById('vi-archivo').files];
  if (!archivos.length) return vehError('vi-error', 'Elige al menos un archivo');
  const form = new FormData();
  archivos.forEach(a => form.append('archivos', a));
  vehError('vi-error', confirmar ? 'Guardando...' : 'Leyendo...');
  try {
    const r = await vehApi('/api/vehiculos/localizador' + (confirmar ? '?confirmar=1' : ''), { method: 'POST', form });
    vehError('vi-error', '');
    const s = r.resumen;
    if (r.guardado) { vehUsoMes = s.hasta.slice(0, 7); await cargarUsoVehiculos(vehUsoMes); actualizarContadorVehiculos(); return; }
    const conError = s.archivos.filter(a => a.error);
    document.getElementById('vi-resumen').innerHTML = `
      <p style="margin:0 0 6px;"><b>${vehFecha(s.desde)} – ${vehFecha(s.hasta)}</b> · ${s.archivos.length} archivo${s.archivos.length === 1 ? '' : 's'} · ${s.total} trayectos</p>
      <ul style="margin:0 0 8px; padding-left:18px;">
        ${s.archivos.length > 1 ? s.archivos.map(a => `<li style="color:${a.error ? 'var(--red)' : 'var(--text-muted)'}">${vehEsc(a.nombre)}: ${a.error ? vehEsc(a.error) : (a.formato === 'detalle' ? 'Detalle de trayectos' : 'Informe detallado') + ' · ' + a.trayectos + ' trayectos'}</li>`).join('') : (conError.length ? `<li style="color:var(--red)">${vehEsc(conError[0].error)}</li>` : '')}
        <li><b>${s.nuevos}</b> nuevos (${vehNum(s.km_nuevos)} km) · ${s.existentes} ya importados (se actualizan, no se duplican)</li>
        ${s.sin_velocidades ? `<li style="color:var(--text-muted)">${s.sin_velocidades} trayectos vienen del "Detalle de trayectos": sin velocidades ni consumo.</li>` : ''}
        ${s.descartados_detalle ? `<li style="color:var(--text-muted)">${s.descartados_detalle} tramos del "Detalle de trayectos" no se usan porque esos días ya están en el "Informe detallado".</li>` : ''}
        ${s.ignorados.map(x => `<li style="color:var(--text-muted)">${vehEsc(x.nombre)}: ${x.trayectos} trayectos ignorados (${vehEsc(x.motivo)})</li>`).join('')}
        ${s.desconocidos.map(x => `<li style="color:var(--orange)">${vehEsc(x.nombre)}: ${x.trayectos} trayectos de un vehículo que no está en la flota (no se guardan). Si es nuestro, dalo de alta con su matrícula y vuelve a importar.</li>`).join('')}
      </ul>
      ${s.validos && !conError.length ? '<button class="veh-btn prim" onclick="importarLocalizador(true)">Confirmar importación</button>' : ''}`;
  } catch (err) { vehError('vi-error', err.message); }
}
