// Archivos (PDF o foto) de las facturas de proveedores en Supabase Storage
// (oct 2026). Antes vivían en la carpeta de Google Drive y se leían a través
// del Apps Script; ahora se suben desde el panel ("Subir facturas") y los de
// Drive se copian una vez (copiarDesdeDrive). Bucket privado
// "facturas-proveedores"; tabla facturas_proveedores_archivos.
// SQL: sql/facturas_proveedores_archivos.sql

const BUCKET = 'facturas-proveedores';
const MIMES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// Nombre de carpeta seguro para la ruta del bucket (sin tildes ni símbolos)
const carpeta = s => String(s || 'SIN PROVEEDOR').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'SIN_PROVEEDOR';

function crearArchivos(supabase) {
  const comprobar = (r, que) => { if (r.error) throw new Error(que + ': ' + r.error.message); return r.data; };

  async function guardar({ fileId, nombreArchivo, mime, base64, proveedor, usuario, origen = 'panel', anio }) {
    const ext = MIMES[mime];
    if (!ext) throw new Error('Tipo de archivo no admitido (solo PDF, JPG, PNG o WebP)');
    const buf = Buffer.from(base64, 'base64');
    const ruta = `${anio || new Date().getFullYear()}/${carpeta(proveedor)}/${fileId}.${ext}`;
    comprobar(await supabase.storage.from(BUCKET).upload(ruta, buf, { contentType: mime, upsert: true }), 'subir archivo');
    comprobar(await supabase.from('facturas_proveedores_archivos').upsert({
      file_id: String(fileId), ruta, nombre_archivo: nombreArchivo || null, mime, tamano: buf.length, origen,
      subido_por: usuario || null, subido_en: new Date().toISOString()
    }, { onConflict: 'file_id' }), 'guardar archivo');
    return ruta;
  }

  async function info(fileId) {
    return comprobar(await supabase.from('facturas_proveedores_archivos').select('*').eq('file_id', String(fileId)).maybeSingle(), 'archivo');
  }

  // { base64, mime, nombreArchivo } del archivo guardado, o null si no está en Supabase.
  async function leer(fileId) {
    const a = await info(fileId);
    if (!a) return null;
    const blob = comprobar(await supabase.storage.from(BUCKET).download(a.ruta), 'descargar archivo');
    return { base64: Buffer.from(await blob.arrayBuffer()).toString('base64'), mime: a.mime, nombreArchivo: a.nombre_archivo };
  }

  // Enlace temporal (1 minuto) para abrirlo en el navegador.
  async function urlFirmada(fileId) {
    const a = await info(fileId);
    if (!a) return null;
    const d = comprobar(await supabase.storage.from(BUCKET).createSignedUrl(a.ruta, 60), 'enlace');
    return d && d.signedUrl;
  }

  async function borrar(fileId) {
    const a = await info(fileId);
    if (!a) return;
    await supabase.storage.from(BUCKET).remove([a.ruta]);
    await supabase.from('facturas_proveedores_archivos').delete().eq('file_id', String(fileId));
  }

  // Copia a Supabase los PDF que solo están en Drive (una vez). descargarDrive(fileId)
  // → { base64, nombreArchivo }. progreso: objeto que se va rellenando para consultarlo.
  async function copiarDesdeDrive(descargarDrive, progreso) {
    const todas = async (tabla, cols) => {
      let out = [];
      for (let i = 0; ; i += 1000) {
        const d = comprobar(await supabase.from(tabla).select(cols).range(i, i + 999), tabla);
        out = out.concat(d || []);
        if (!d || d.length < 1000) break;
      }
      return out;
    };
    const [lineas, lecturas, ya] = await Promise.all([
      todas('facturas_proveedores_lineas', 'file_id,proveedor,nombre_archivo,anio'),
      todas('facturas_proveedores', 'file_id,proveedor,nombre_archivo,fecha'),
      todas('facturas_proveedores_archivos', 'file_id')
    ]);
    const hecho = new Set(ya.map(a => String(a.file_id)));
    const porId = new Map();
    lineas.forEach(l => { if (!porId.has(String(l.file_id))) porId.set(String(l.file_id), { proveedor: l.proveedor, nombre: l.nombre_archivo, anio: l.anio }); });
    lecturas.forEach(l => { if (!porId.has(String(l.file_id))) porId.set(String(l.file_id), { proveedor: l.proveedor, nombre: l.nombre_archivo, anio: l.fecha ? Number(String(l.fecha).slice(0, 4)) : null }); });
    const pendientes = [...porId.entries()].filter(([id]) => !hecho.has(id) && !id.startsWith('SUP_'));
    Object.assign(progreso, { total: pendientes.length, copiados: 0, errores: [], terminado: false, inicio: new Date().toISOString() });
    const CONC = 3;
    for (let i = 0; i < pendientes.length; i += CONC) {
      await Promise.all(pendientes.slice(i, i + CONC).map(async ([id, d]) => {
        for (let intento = 1; intento <= 3; intento++) {
          try {
            const r = await descargarDrive(id);
            if (!r || !r.base64) throw new Error((r && r.error) || 'sin contenido');
            await guardar({ fileId: id, nombreArchivo: r.nombreArchivo || d.nombre, mime: 'application/pdf', base64: r.base64, proveedor: d.proveedor, origen: 'drive', anio: d.anio });
            progreso.copiados++;
            return;
          } catch (e) {
            if (intento === 3) progreso.errores.push({ fileId: id, proveedor: d.proveedor, nombreArchivo: d.nombre, error: e.message });
            else await new Promise(r => setTimeout(r, 2000 * intento));
          }
        }
      }));
    }
    progreso.terminado = true;
    progreso.fin = new Date().toISOString();
    return progreso;
  }

  return { guardar, info, leer, urlFirmada, borrar, copiarDesdeDrive, MIMES };
}

module.exports = { crearArchivos, _test: { carpeta } };
