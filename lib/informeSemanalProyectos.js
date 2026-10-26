// ================================================================
// Informe semanal de ventas (No Confirmados / Resto) en PDF
// ================================================================
// Sustituye al Apps Script "ORUM Informe Semanal", que cada lunes recorría
// todos los proyectos de Rentman uno a uno para escribir una hoja de Google
// con dos pestañas. Aquí se genera lo mismo, con el mismo formato, pero
// leyendo de Supabase (ninguna llamada a Rentman) y en un PDF.
//
// Lo genera Isabel (Contabilidad) los lunes desde Financiero → Informe semanal
// para mandárselo a Alberto. Cada semana se genera una sola vez y el PDF queda
// guardado (bucket "informes-semanales", tabla informes_semanales): después
// siempre se ve ese mismo PDF, con las cifras del día en que se generó.
// SQL: sql/informe_semanal_proyectos.sql
//
// Criterios, iguales a los del script original:
//   - Semana = lunes a domingo anteriores, por fecha de inicio del evento.
//   - Se excluyen los proyectos Pendiente, Cancelado, Consulta y Concepto.
//   - "No Confirmados" = proyectos con el artículo abrebotellas (es_abrebotellas).
//   - Importe con IVA = neto × 1,21. Pagado = suma de lo cobrado en sus facturas.

const PDFDocument = require('pdfkit');
const { supabase } = require('./supabaseSource');

const IVA = 0.21;
const ESTADOS_EXCLUIDOS = ['pending', 'canceled', 'inquiry', 'concept'];
// Supabase guarda el nombre interno de Rentman; el informe usa el que se ve en pantalla.
const NOMBRE_ESTADO = { 'confirmed': 'Confirmado', 'on location': 'En localización', 'returned': 'Retornado' };

const COL_NEGRO = '#1a1a1a', COL_ROJO = '#c0392b', COL_CABECERA = '#333333', COL_GRIS1 = '#f5f5f5', COL_GRIS2 = '#dddddd';
const MS_DIA = 86400000;

const isoAMs = iso => Date.parse(iso + 'T00:00:00Z');
const sumarDias = (iso, n) => new Date(isoAMs(iso) + n * MS_DIA).toISOString().slice(0, 10);
const lunesDe = iso => sumarDias(iso, -(((new Date(isoAMs(iso)).getUTCDay()) || 7) - 1));
function semanaIso(iso) {
  const d = new Date(isoAMs(iso));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / MS_DIA + 1) / 7);
}
function isoDeRaw(raw) {
  const m = String(raw || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
const ddmm = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const ddmmaaaa = iso => ddmm(iso) + '/' + iso.slice(0, 4);
function euros(n) {
  const [ent, dec] = Math.abs(Number(n) || 0).toFixed(2).split('.');
  return (n < -0.004 ? '-' : '') + ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec + ' €';
}

async function paginar(tabla, columnas) {
  let todas = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase.from(tabla).select(columnas).range(off, off + 999);
    if (error) throw error;
    todas = todas.concat(data);
    if (data.length < 1000) break;
  }
  return todas;
}

// lunes = "YYYY-MM-DD" del lunes de la semana a informar.
async function cargarSemana(lunes) {
  const domingo = sumarDias(lunes, 6);
  const [proyectos, facturas] = await Promise.all([
    paginar('proyectos', 'id,numero,cliente,estado,cancelado,valor,es_abrebotellas,evento_inicio_raw'),
    paginar('facturas', 'proyecto_id,total_pagado')
  ]);
  const pagadoPorProyecto = new Map();
  facturas.forEach(f => {
    const k = String(f.proyecto_id);
    pagadoPorProyecto.set(k, (pagadoPorProyecto.get(k) || 0) + (Number(f.total_pagado) || 0));
  });

  const noConfirmados = [], resto = [];
  proyectos.forEach(p => {
    const fecha = isoDeRaw(p.evento_inicio_raw);
    if (!fecha || fecha < lunes || fecha > domingo) return;
    const estado = String(p.estado || '').trim();
    if (p.cancelado || ESTADOS_EXCLUIDOS.includes(estado.toLowerCase())) return;
    const neto = Number(p.valor) || 0;
    const conIva = neto * (1 + IVA);
    const pagado = pagadoPorProyecto.get(String(p.id)) || 0;
    (p.es_abrebotellas ? noConfirmados : resto).push({
      numero: p.numero || p.id, fecha, cliente: String(p.cliente || '').replace(/\s+/g, ' ').trim() || 'Sin cliente',
      estado: NOMBRE_ESTADO[estado.toLowerCase()] || estado || '—',
      neto, conIva, pagado, pendiente: conIva - pagado
    });
  });
  const orden = (a, b) => a.fecha.localeCompare(b.fecha) || (Number(a.numero) - Number(b.numero));
  noConfirmados.sort(orden); resto.sort(orden);
  return { lunes, domingo, semana: semanaIso(lunes), noConfirmados, resto };
}

const totales = lista => lista.reduce((t, p) => ({
  neto: t.neto + p.neto, conIva: t.conIva + p.conIva, pagado: t.pagado + p.pagado, pendiente: t.pendiente + p.pendiente
}), { neto: 0, conIva: 0, pagado: 0, pendiente: 0 });

// ── PDF ──
// Mismas 8 columnas y mismos colores que la hoja de Google original.
const COLUMNAS = [
  { titulo: 'Nº Proyecto', ancho: 78, alin: 'center', valor: p => String(p.numero) },
  { titulo: 'Fecha uso', ancho: 78, alin: 'center', valor: p => ddmmaaaa(p.fecha) },
  { titulo: 'Cliente', ancho: 232, alin: 'left', valor: p => p.cliente },
  { titulo: 'Estado', ancho: 100, alin: 'center', valor: p => p.estado },
  { titulo: 'Importe neto', ancho: 80, alin: 'right', valor: p => euros(p.neto) },
  { titulo: 'Importe con IVA', ancho: 88, alin: 'right', valor: p => euros(p.conIva) },
  { titulo: 'Pagado', ancho: 72, alin: 'right', valor: p => euros(p.pagado) },
  { titulo: 'Pendiente', ancho: 72, alin: 'right', valor: p => euros(p.pendiente) }
]; // suma 800 pt (A4 horizontal = 842 pt de ancho)

function generarPdf(datos) {
  return new Promise((resolve, reject) => {
    const MARGEN = 14;
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGEN, info: { Title: `ORUM Informe semanal — Semana ${datos.semana}`, Author: 'ORUM Central' } });
    const trozos = [];
    doc.on('data', t => trozos.push(t));
    doc.on('end', () => resolve(Buffer.concat(trozos)));
    doc.on('error', reject);

    const anchoTotal = COLUMNAS.reduce((s, c) => s + c.ancho, 0);
    const x0 = (doc.page.width - anchoTotal) / 2;
    const limiteY = doc.page.height - 26;
    const rango = `${ddmm(datos.lunes)} – ${ddmm(datos.domingo)}`;
    let y;

    // Texto recortado a una línea dentro de su celda
    const celda = (texto, x, ancho, alto, alin, tam, negrita, color) => {
      doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(tam).fillColor(color);
      const pad = 4;
      doc.text(texto, x + pad, y + (alto - tam) / 2 + 0.5, { width: ancho - pad * 2, align: alin, lineBreak: false, ellipsis: true, height: tam + 2 });
    };
    const filaCeldas = (valores, alto, fondo, color, negrita, tam) => {
      doc.rect(x0, y, anchoTotal, alto).fill(fondo);
      let x = x0;
      COLUMNAS.forEach((c, i) => { if (valores[i] != null) celda(valores[i], x, c.ancho, alto, negrita && i < 4 ? 'center' : c.alin, tam, negrita, color); x += c.ancho; });
      y += alto;
    };
    const cabeceras = (subtitulo, color, continua) => {
      doc.rect(x0, y, anchoTotal, 30).fill(color);
      celda(`ORUM Rent & Events  ·  ${subtitulo}  ·  Semana ${datos.semana}  ·  ${rango}${continua ? '  (cont.)' : ''}`, x0, anchoTotal, 30, 'center', 12, true, '#ffffff');
      y += 30;
      filaCeldas(COLUMNAS.map(c => c.titulo), 21, COL_CABECERA, '#ffffff', true, 9);
    };

    const seccion = (subtitulo, lista, color, primera) => {
      if (!primera) doc.addPage();
      y = MARGEN + 10;
      cabeceras(subtitulo, color, false);
      if (!lista.length) {
        doc.rect(x0, y, anchoTotal, 22).fill('#ffffff');
        doc.font('Helvetica-Oblique').fontSize(10).fillColor('#999999').text('No hay proyectos para esta semana.', x0, y + 7, { width: anchoTotal, align: 'center' });
        return;
      }
      lista.forEach((p, i) => {
        if (y + 18 > limiteY) { doc.addPage(); y = MARGEN + 10; cabeceras(subtitulo, color, true); }
        filaCeldas(COLUMNAS.map(c => c.valor(p)), 18, i % 2 === 0 ? COL_GRIS1 : '#ffffff', '#1a1a1a', false, 9);
      });
      if (y + 26 > limiteY) { doc.addPage(); y = MARGEN + 10; cabeceras(subtitulo, color, true); }
      doc.rect(x0, y, anchoTotal, 2).fill(COL_GRIS2); y += 2;
      const t = totales(lista);
      const anchoEtiqueta = COLUMNAS.slice(0, 4).reduce((s, c) => s + c.ancho, 0);
      doc.rect(x0, y, anchoTotal, 22).fill(color);
      celda(`TOTAL  —  ${lista.length} proyecto${lista.length !== 1 ? 's' : ''}`, x0, anchoEtiqueta, 22, 'right', 10, true, '#ffffff');
      let x = x0 + anchoEtiqueta;
      [t.neto, t.conIva, t.pagado, t.pendiente].forEach((v, i) => { const c = COLUMNAS[4 + i]; celda(euros(v), x, c.ancho, 22, 'right', 9.5, true, '#ffffff'); x += c.ancho; });
      y += 22;
    };

    seccion('Proyectos No Confirmados', datos.noConfirmados, COL_ROJO, true);
    seccion('Resto de proyectos', datos.resto, COL_NEGRO, false);
    doc.end();
  });
}


// ── Guardado y rutas ──

const BUCKET = 'informes-semanales';
const ROLES = ['Direccion', 'Contabilidad'];
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
// Lunes de la última semana completa respecto a "hoy" (YYYY-MM-DD).
const lunesSemanaAnterior = hoy => sumarDias(lunesDe(hoy), -7);
const nombrePdf = (lunes, semana) => {
  const dom = sumarDias(lunes, 6);
  return `ORUM_Informe_Semanal_Sem${semana}_${ddmm(lunes).replace('/', '-')}_${ddmm(dom).replace('/', '-')}.pdf`;
};
const resumir = lista => ({ proyectos: lista.length, ...totales(lista) });

function registrarRutas(app, { supabase: sb, requiereLogin }) {
  const permitido = (req, res, next) => {
    if (!ROLES.includes(req.session.usuario.rol)) return res.status(403).json({ error: 'No autorizado para este apartado' });
    next();
  };
  const comprobar = (r, que) => { if (r.error) throw new Error(que + ': ' + r.error.message); return r.data; };

  // Informes guardados + semanas completas que aún no tienen informe (las 8 últimas).
  app.get('/api/informe-semanal', requiereLogin, permitido, async (req, res) => {
    try {
      const informes = comprobar(await sb.from('informes_semanales').select('*').order('lunes', { ascending: false }), 'informes');
      const hechos = new Set(informes.map(i => i.lunes));
      const pendientes = [];
      for (let l = lunesSemanaAnterior(hoyMadrid()), n = 0; n < 8; n++, l = sumarDias(l, -7)) {
        if (!hechos.has(l)) pendientes.push({ lunes: l, domingo: sumarDias(l, 6), semana: semanaIso(l) });
      }
      res.json({ informes, pendientes, sugerido: lunesSemanaAnterior(hoyMadrid()) });
    } catch (err) {
      console.error('Error listando informes semanales:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Genera y guarda el informe de una semana ya terminada. Si ya existe no se rehace.
  app.post('/api/informe-semanal/generar', requiereLogin, permitido, async (req, res) => {
    try {
      const pedido = String((req.body && req.body.lunes) || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pedido)) return res.status(400).json({ error: 'Falta la semana' });
      const lunes = lunesDe(pedido);
      if (sumarDias(lunes, 6) >= hoyMadrid()) return res.status(400).json({ error: 'Esa semana aún no ha terminado' });
      const existe = comprobar(await sb.from('informes_semanales').select('lunes').eq('lunes', lunes).maybeSingle(), 'informe');
      if (existe) return res.status(409).json({ error: 'El informe de esa semana ya está generado' });

      const datos = await cargarSemana(lunes);
      const pdf = await generarPdf(datos);
      const ruta = `${lunes.slice(0, 4)}/${nombrePdf(lunes, datos.semana)}`;
      comprobar(await sb.storage.from(BUCKET).upload(ruta, pdf, { contentType: 'application/pdf', upsert: false }), 'subir PDF');
      const fila = {
        lunes, semana: datos.semana, ruta,
        resumen: { noConfirmados: resumir(datos.noConfirmados), resto: resumir(datos.resto) },
        generado_por: req.session.usuario.nombre || req.session.usuario.usuario
      };
      const ins = await sb.from('informes_semanales').insert(fila).select().single();
      if (ins.error) { await sb.storage.from(BUCKET).remove([ruta]); throw new Error('guardar informe: ' + ins.error.message); }
      res.json({ informe: ins.data });
    } catch (err) {
      console.error('Error generando el informe semanal:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // El PDF guardado: /api/informe-semanal/pdf?lunes=2026-10-19  (&descargar=1 para bajarlo)
  app.get('/api/informe-semanal/pdf', requiereLogin, permitido, async (req, res) => {
    try {
      const inf = comprobar(await sb.from('informes_semanales').select('*').eq('lunes', String(req.query.lunes || '')).maybeSingle(), 'informe');
      if (!inf) return res.status(404).json({ error: 'No hay informe guardado de esa semana' });
      const blob = comprobar(await sb.storage.from(BUCKET).download(inf.ruta), 'descargar PDF');
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${req.query.descargar ? 'attachment' : 'inline'}; filename="${nombrePdf(inf.lunes, inf.semana)}"`
      }).send(Buffer.from(await blob.arrayBuffer()));
    } catch (err) {
      console.error('Error leyendo el PDF del informe semanal:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registrarRutas, _test: { cargarSemana, generarPdf, euros, lunesSemanaAnterior } };
