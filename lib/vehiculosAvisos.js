// Módulo Vehículos — fase 2: avisos por email de vencimientos.
// Solo se envía cuando un vencimiento CAMBIA de estado (pasa a "aviso" o a
// "vencido"), nunca un email diario fijo (decisión del usuario). La
// comprobación corre una vez al día a las 8:00 Madrid; un registro por día en
// vehiculos_avisos_envios hace de cerrojo contra envíos dobles.
// Ver docs/superpowers/specs/2026-10-20-modulo-vehiculos-design.md §6.1

const TZ = 'Europe/Madrid';
const HORA = 8;
const ORDEN = { ok: 0, aviso: 1, vencido: 2 };
const NOMBRE_VENC = { itv: 'ITV', seguro: 'Seguro', ivtm: 'IVTM (circulación)', revision: 'Revisión', tacografo: 'Tacógrafo', fin_renting: 'Fin de renting', otro: 'Otro' };

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const miles = n => Number(n).toLocaleString('es-ES');

// Qué vencimientos hay que avisar y cómo queda su estado_notificado.
// Empeorar (ok→aviso, aviso→vencido, ok→vencido) = email. Mejorar (p. ej. tras
// renovarlo) solo actualiza la marca, sin email, para que vuelva a avisar
// cuando toque de nuevo.
function cambiosDeAviso(vencimientos) {
  const enviar = [], actualizar = [];
  vencimientos.forEach(x => {
    const nuevo = x.estado === 'ok' ? null : x.estado;
    const previo = x.estado_notificado || null;
    if (nuevo === previo) return;
    actualizar.push({ id: x.id, estado_notificado: nuevo });
    if (nuevo && ORDEN[nuevo] > ORDEN[previo || 'ok']) enviar.push(x);
  });
  return { enviar, actualizar };
}

function textoPlazo(x) {
  const partes = [];
  if (x.dias_restantes !== null && x.dias_restantes !== undefined) {
    const d = x.dias_restantes;
    partes.push(d < 0 ? 'vencido hace ' + (-d) + (d === -1 ? ' día' : ' días') : d === 0 ? 'vence hoy' : 'vence en ' + d + (d === 1 ? ' día' : ' días'));
  }
  if (x.km_restantes !== null && x.km_restantes !== undefined) {
    const k = x.km_restantes;
    partes.push(k <= 0 ? 'pasado ' + miles(-k) + ' km' : 'faltan ' + miles(k) + ' km');
  }
  return partes.join(' · ');
}

const fechaES = f => (f ? String(f).slice(8, 10) + '/' + String(f).slice(5, 7) + '/' + String(f).slice(0, 4) : '—');

function construirEmailAvisos(lista, urlPanel) {
  const vencidos = lista.filter(x => x.estado === 'vencido').length;
  const proximos = lista.length - vencidos;
  const partes = [];
  if (vencidos) partes.push(vencidos + (vencidos === 1 ? ' vencido' : ' vencidos'));
  if (proximos) partes.push(proximos + (proximos === 1 ? ' próximo' : ' próximos'));
  const asunto = 'Vehículos: ' + partes.join(', ');
  const ordenados = [...lista].sort((a, b) => ORDEN[b.estado] - ORDEN[a.estado] || (a.dias_restantes ?? 99999) - (b.dias_restantes ?? 99999));
  const filas = ordenados.map(x => {
    const color = x.estado === 'vencido' ? '#c0392b' : '#c0620a';
    const v = x.vehiculo || {};
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee;"><b>${esc(v.matricula || 'Sin matrícula')}</b><br><span style="color:#888;font-size:12px;">${esc([v.marca, v.modelo].filter(Boolean).join(' '))}</span></td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${esc(NOMBRE_VENC[x.tipo] || x.tipo)}${x.descripcion ? '<br><span style="color:#888;font-size:12px;">' + esc(x.descripcion) + '</span>' : ''}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${fechaES(x.fecha_limite)}${x.km_limite != null ? '<br>' + miles(x.km_limite) + ' km' : ''}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;color:${color};font-weight:600;">${esc(textoPlazo(x))}</td>
    </tr>`;
  }).join('');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;max-width:680px;">
    <h2 style="font-size:18px;margin:0 0 6px;">Avisos de vehículos</h2>
    <p style="margin:0 0 14px;color:#555;">Estos vencimientos acaban de pasar a próximos o vencidos.</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead><tr style="background:#f2f0ec;text-align:left;"><th style="padding:8px;">Vehículo</th><th style="padding:8px;">Qué vence</th><th style="padding:8px;">Límite</th><th style="padding:8px;">Plazo</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
    <p style="margin:16px 0 0;color:#555;">Revísalo en ORUM Central → Vehículos → Vencimientos${urlPanel ? `: <a href="${esc(urlPanel)}">${esc(urlPanel)}</a>` : '.'}</p>
  </div>`;
  return { asunto, html };
}

const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
function msHastaHoraMadrid(hora) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date());
  const g = t => Number(p.find(x => x.type === t).value) % 24;
  let seg = hora * 3600 - (g('hour') * 3600 + g('minute') * 60 + g('second'));
  if (seg <= 0) seg += 86400;
  return seg * 1000;
}
const horaMadridActual = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).formatToParts(new Date()).find(x => x.type === 'hour').value) % 24;

// cargarVencimientos(): vencimientos activos de vehículos activos, con estado
// y vehiculo (lo da vehiculosRutas). enviarCorreo(para, asunto, html) es el de
// lib/informeComerciales.js (mismo transporte que el informe de las 8:00).
function crearAvisos({ supabase, cargarVencimientos, enviarCorreo }) {
  async function destinatarios() {
    const { data, error } = await supabase.from('vehiculos_avisos_destinatarios').select('email').eq('activo', true);
    if (error) throw error;
    return data.map(d => d.email);
  }

  async function ejecutar() {
    const hoy = hoyMadrid();
    // Cerrojo: si ya hay fila de hoy (otra instancia o un reinicio), no se repite.
    const { error: errLock } = await supabase.from('vehiculos_avisos_envios').insert({ fecha: hoy });
    if (errLock) { console.log('[Vehículos] Avisos de hoy ya ejecutados (' + hoy + ').'); return { ok: true, omitido: true }; }
    try {
      const { enviar, actualizar } = cambiosDeAviso(await cargarVencimientos());
      let envio = { ok: true, motivo: 'sin cambios' };
      if (enviar.length) {
        const para = await destinatarios();
        const { asunto, html } = construirEmailAvisos(enviar, process.env.PANEL_URL);
        envio = para.length ? await enviarCorreo(para, asunto, html) : { ok: false, motivo: 'sin destinatarios' };
      }
      // Solo se marcan como avisados si el email salió (o no hacía falta): si
      // falla, mañana se vuelve a intentar.
      if (envio.ok) {
        for (const u of actualizar) await supabase.from('vehiculos_vencimientos').update({ estado_notificado: u.estado_notificado }).eq('id', u.id);
      }
      const resultado = { avisados: enviar.map(x => x.id), envio };
      await supabase.from('vehiculos_avisos_envios').update({ resultado }).eq('fecha', hoy);
      console.log('[Vehículos] Avisos: ' + enviar.length + ' cambios · ' + JSON.stringify(envio));
      return resultado;
    } catch (err) {
      console.error('[Vehículos] Error en los avisos:', err);
      await supabase.from('vehiculos_avisos_envios').delete().eq('fecha', hoy); // permite reintentar
      throw err;
    }
  }

  function programar() {
    const delay = msHastaHoraMadrid(HORA);
    setTimeout(async () => {
      try { await ejecutar(); } catch (e) { /* ya registrado */ } finally { programar(); }
    }, delay).unref();
    console.log(`[Vehículos] Próxima comprobación de avisos en ${Math.round(delay / 60000)} min (${HORA}:00 Madrid).`);
    // Reinicio justo a esa hora: recupera la comprobación del día (hasta las 11:00).
    const h = horaMadridActual();
    if (h >= HORA && h < 11) setTimeout(() => ejecutar().catch(() => {}), 60 * 1000).unref();
  }

  // Prueba: manda la situación ACTUAL (todo lo próximo o vencido) solo a la
  // dirección indicada, sin marcar nada como avisado.
  async function enviarPrueba(para) {
    const lista = (await cargarVencimientos()).filter(x => x.estado !== 'ok');
    if (!lista.length) return { ok: false, motivo: 'No hay vencimientos próximos ni vencidos ahora mismo' };
    const { asunto, html } = construirEmailAvisos(lista, process.env.PANEL_URL);
    return enviarCorreo([para], '[PRUEBA] ' + asunto, html);
  }

  return { ejecutar, programar, enviarPrueba, destinatarios };
}

module.exports = { cambiosDeAviso, construirEmailAvisos, crearAvisos };
