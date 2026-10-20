// Resumen semanal de fianzas pendientes de devolver (viernes 8:00 Madrid).
// Sustituye a emailViernes() del Apps Script "ORUM Fianzas 2026" (20 oct
// 2026): ahora las solicitudes viven en Supabase (fianza_solicitudes, las
// gestiona la app Caja) y el correo sale por el mismo transporte que el
// informe de comerciales. Destinatarios en fianza_email_destinatarios
// (editable sin tocar código); un registro por día en fianza_email_envios
// hace de cerrojo contra envíos dobles y guarda el resultado.
// SQL: sql/fianza_solicitudes.sql

const TZ = 'Europe/Madrid';
const HORA = 8;
const VIERNES = 5;

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Separador de miles a mano: toLocaleString('es-ES') no lo pone en números de 4 cifras
const eur = n => {
  const [ent, dec] = (Math.round((Number(n) || 0) * 100) / 100).toFixed(2).split('.');
  return ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec + ' €';
};
const fechaES = iso => {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m && String(iso).length === 10) return `${m[3]}/${m[2]}/${m[1]}`;
  return new Date(iso).toLocaleDateString('es-ES', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
};

const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const diaSemana = fecha => new Date(fecha + 'T12:00:00Z').getUTCDay();
function msHastaHoraMadrid(hora) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date());
  const g = t => Number(p.find(x => x.type === t).value) % 24;
  let seg = hora * 3600 - (g('hour') * 3600 + g('minute') * 60 + g('second'));
  if (seg <= 0) seg += 86400;
  return seg * 1000;
}
const horaMadridActual = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).formatToParts(new Date()).find(x => x.type === 'hour').value) % 24;

// Avisos que conviene que Ana vea antes de transferir
function avisos(s, p) {
  const a = [];
  if (!p || !(Number(p.importe_fianza) > 0) || !['1', '2'].includes(String(p.estado_fianza_id))) a.push('En Rentman ya no figura como fianza cobrada');
  else {
    if (String(p.estado_fianza_id) === '2') a.push('Rentman ya la marca devuelta');
    if (Number(s.importe) > Number(p.importe_fianza) + 0.005) a.push('Devuelve más que la fianza (' + eur(p.importe_fianza) + ')');
  }
  return a;
}

function construirEmail(pendientes, proyectosPorId, urlCaja, hoy) {
  const total = pendientes.reduce((t, s) => t + Number(s.importe || 0), 0);
  const n = pendientes.length;
  const asunto = `ORUM - ${n} fianza${n !== 1 ? 's' : ''} pendiente${n !== 1 ? 's' : ''} de devolución - ${fechaES(hoy)}`;
  const fila = s => {
    const p = proyectosPorId.get(Number(s.proyecto_id));
    const av = avisos(s, p);
    const td = 'padding:9px 10px;border-bottom:1px solid #eee;vertical-align:top;';
    return `<tr${av.length ? ' style="background:#fffbeb;"' : ''}>
      <td style="${td}"><b>#${esc(s.numero_proyecto || (p && p.numero) || '')}</b></td>
      <td style="${td}">${esc((p && p.cliente) || (/^\s*\d+\s*$/.test(s.cliente || '') ? '' : s.cliente) || '—')}</td>
      <td style="${td}white-space:nowrap;">${fechaES(s.fecha_evento)}</td>
      <td style="${td}font-weight:700;${Number(s.importe) > 0 ? 'white-space:nowrap;color:#16a34a;">' + eur(s.importe) : 'color:#b45309;">0,00 € · Se retiene toda la fianza'}${av.map(x => `<div style="font-size:11px;color:#b45309;font-weight:600;">⚠ ${esc(x)}</div>`).join('')}</td>
      <td style="${td}color:#6b7280;">${esc(s.metodo || '—')}</td>
      <td style="${td}color:#6b7280;white-space:nowrap;">${esc(s.solicitado_por || '—')}<br><span style="font-size:11px;">${fechaES(s.fecha_solicitud)}</span></td>
      <td style="${td}color:#374151;white-space:pre-wrap;">${esc(s.notas || '—')}</td>
    </tr>`;
  };
  const th = 'padding:9px 10px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;';
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a;max-width:820px;margin:0 auto;">
    <div style="background:#111;padding:22px 28px;border-radius:12px 12px 0 0;">
      <div style="color:#fff;font-size:21px;font-weight:800;">ORUM Rent &amp; Events</div>
      <div style="color:#9ca3af;font-size:13px;margin-top:4px;">Devoluciones de fianzas pendientes</div>
    </div>
    <div style="background:#f9fafb;padding:22px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
      <p style="margin:0 0 14px;color:#374151;">Resumen a fecha <b>${fechaES(hoy)}</b>, de la más antigua a la más reciente:</p>
      <table role="presentation" style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:18px;"><tr><td style="padding:16px 20px;">
        <div style="font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;">Total a devolver</div>
        <div style="font-size:30px;font-weight:800;color:#16a34a;">${eur(total)}</div>
        <div style="font-size:13px;color:#6b7280;">${n} solicitud${n !== 1 ? 'es' : ''} pendiente${n !== 1 ? 's' : ''}</div>
      </td></tr></table>
      <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;font-size:13px;">
        <thead><tr style="background:#f3f4f6;"><th style="${th}">Proyecto</th><th style="${th}">Cliente</th><th style="${th}">Evento</th><th style="${th}">A devolver</th><th style="${th}">Método</th><th style="${th}">Pedida</th><th style="${th}">Notas</th></tr></thead>
        <tbody>${pendientes.map(fila).join('')}</tbody>
      </table>
      <p style="color:#6b7280;font-size:13px;margin:18px 0 0;">Para marcarlas como devueltas: Caja → Fianzas → Solicitudes de devolución pendientes${urlCaja ? ` (<a href="${esc(urlCaja)}">${esc(urlCaja)}</a>)` : ''}.</p>
      <p style="color:#9ca3af;font-size:12px;margin:10px 0 0;">Email automático cada viernes a las 8:00.</p>
    </div>
  </div>`;
  return { asunto, html };
}

// enviarCorreo(para[], asunto, html) es el de lib/informeComerciales.js
function crearEmailFianzas({ supabase, enviarCorreo, hoy: hoyFn = hoyMadrid }) {
  async function cargarPendientes() {
    const { data, error } = await supabase.from('fianza_solicitudes').select('*').eq('estado', 'PENDIENTE').order('fecha_solicitud');
    if (error) throw new Error('fianza_solicitudes: ' + error.message);
    const ids = [...new Set((data || []).map(s => Number(s.proyecto_id)))];
    const proyectosPorId = new Map();
    for (let i = 0; i < ids.length; i += 200) {
      const r = await supabase.from('proyectos').select('id,numero,cliente,importe_fianza,estado_fianza_id').in('id', ids.slice(i, i + 200));
      if (r.error) throw new Error('proyectos: ' + r.error.message);
      (r.data || []).forEach(p => proyectosPorId.set(Number(p.id), p));
    }
    return { pendientes: data || [], proyectosPorId };
  }

  async function destinatarios() {
    const { data, error } = await supabase.from('fianza_email_destinatarios').select('email,tipo').eq('activo', true);
    if (error) throw error;
    // El relé de correo (Apps Script) no admite CC todavía: "para" y "cc"
    // reciben el mismo correo como destinatarios.
    return (data || []).sort((a, b) => (a.tipo === 'para' ? 0 : 1) - (b.tipo === 'para' ? 0 : 1)).map(d => d.email);
  }

  async function construir() {
    const { pendientes, proyectosPorId } = await cargarPendientes();
    return { n: pendientes.length, ...construirEmail(pendientes, proyectosPorId, process.env.CAJA_URL, hoyFn()) };
  }

  async function ejecutar() {
    const hoy = hoyFn();
    if (diaSemana(hoy) !== VIERNES) return { ok: true, omitido: 'no es viernes' };
    const { error: errLock } = await supabase.from('fianza_email_envios').insert({ fecha: hoy });
    if (errLock) { console.log('[Fianzas] Email de hoy ya ejecutado (' + hoy + ').'); return { ok: true, omitido: 'ya enviado' }; }
    try {
      const e = await construir();
      let envio = { ok: true, motivo: 'no hay solicitudes pendientes' };
      if (e.n) {
        const para = await destinatarios();
        envio = para.length ? await enviarCorreo(para, e.asunto, e.html) : { ok: false, motivo: 'sin destinatarios' };
      }
      const resultado = { pendientes: e.n, envio };
      await supabase.from('fianza_email_envios').update({ resultado }).eq('fecha', hoy);
      console.log('[Fianzas] Email semanal: ' + e.n + ' pendientes · ' + JSON.stringify(envio));
      return resultado;
    } catch (err) {
      console.error('[Fianzas] Error en el email semanal:', err);
      await supabase.from('fianza_email_envios').delete().eq('fecha', hoy); // permite reintentar
      throw err;
    }
  }

  function programar() {
    const delay = msHastaHoraMadrid(HORA);
    setTimeout(async () => {
      try { await ejecutar(); } catch (e) { /* ya registrado */ } finally { programar(); }
    }, delay).unref();
    // Reinicio justo a esa hora: recupera el envío del día (hasta las 11:00).
    const h = horaMadridActual();
    if (h >= HORA && h < 11) setTimeout(() => ejecutar().catch(() => {}), 60 * 1000).unref();
  }

  // Prueba: manda la situación actual solo a la dirección indicada.
  async function enviarPrueba(para) {
    const e = await construir();
    if (!e.n) return { ok: false, motivo: 'No hay solicitudes pendientes ahora mismo' };
    return enviarCorreo([para], '[PRUEBA] ' + e.asunto, e.html);
  }

  function registrarRutas(app, requiereLogin) {
    const soloDireccion = (req, res, next) => {
      if (req.session.usuario.rol !== 'Direccion') return res.status(403).json({ error: 'No autorizado' });
      next();
    };
    // Vista previa del correo con los datos de ahora: /api/fianzas-email/preview
    app.get('/api/fianzas-email/preview', requiereLogin, soloDireccion, async (req, res) => {
      try { const e = await construir(); res.send(`<p style="font-family:Arial;color:#666">Asunto: <b>${esc(e.asunto)}</b> · Para: ${esc((await destinatarios()).join(', '))}</p>` + e.html); }
      catch (err) { res.status(500).send('Error: ' + esc(err.message)); }
    });
    // Prueba: POST {"para":"x@y.com"}
    app.post('/api/fianzas-email/prueba', requiereLogin, soloDireccion, async (req, res) => {
      const para = String((req.body || {}).para || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) return res.status(400).json({ ok: false, motivo: 'Falta un email válido en "para"' });
      try { res.json(await enviarPrueba(para)); }
      catch (err) { res.status(500).json({ ok: false, motivo: err.message }); }
    });
  }

  return { ejecutar, programar, enviarPrueba, construir, destinatarios, registrarRutas };
}

module.exports = { crearEmailFianzas, construirEmail, avisos, eur, diaSemana };
