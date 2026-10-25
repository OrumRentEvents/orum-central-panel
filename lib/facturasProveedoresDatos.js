// Facturas de proveedores sin la Sheet (oct 2026). Hasta ahora el listado,
// el reparto por departamento, el historial y los errores vivían en la hoja
// "FACTURAS_LOG" del Apps Script de facturas, y cada pantalla esperaba a
// Google. Este módulo hace lo mismo que esas acciones del Apps Script
// (listadoFacturas_, obtenerReparto_, guardarReparto_, actualizarCampoFactura_,
// historialFactura_, doPost de guardado, registrarErrores_, erroresRecientes_)
// pero en Supabase, devolviendo la misma forma de datos, para que server.js,
// lib/holdedCompras.js y el panel no noten el cambio. "fila" pasa a ser el id
// de la línea. En Google solo queda Drive (listar la carpeta y descargar PDFs).
// SQL: sql/facturas_proveedores_supabase.sql

const r2 = n => (n === '' || n == null || isNaN(Number(n)) ? null : Math.round(Number(n) * 100) / 100);

// "DD/MM/YYYY" (o "DD/MM/YY") → { mes, anio }, igual que extraerMesAnio_ del Apps Script
function mesAnio(fecha) {
  const p = String(fecha || '').trim().split('/');
  if (p.length !== 3) return { mes: null, anio: null };
  const mes = parseInt(p[1], 10);
  let anio = parseInt(p[2], 10);
  if (!isFinite(mes) || !isFinite(anio)) return { mes: null, anio: null };
  if (anio < 100) anio += 2000;
  return { mes, anio };
}

// Fila de la tabla → objeto con los nombres que devolvía listadoFacturas_
function aListado(l) {
  return {
    fila: l.id, fileId: l.file_id, proveedor: l.proveedor || '', nombreArchivo: l.nombre_archivo || '',
    numeroFactura: l.numero_factura || '', fecha: l.fecha || '',
    importeBase: l.importe_base == null ? '' : Number(l.importe_base), iva: l.iva == null ? '' : Number(l.iva),
    importeTotal: l.importe_total == null ? '' : Number(l.importe_total), confianza: l.confianza || '',
    procesadoEn: l.procesado_en, formaPago: l.forma_pago || '', contabilizada: !!l.contabilizada,
    digitalizada: !!l.digitalizada, matricula: l.matricula || '', mes: l.mes || null, anio: l.anio || null
  };
}

// Campo del panel → columna de la tabla
const COLUMNAS = {
  proveedor: 'proveedor', numeroFactura: 'numero_factura', fecha: 'fecha', importeBase: 'importe_base', iva: 'iva',
  importeTotal: 'importe_total', formaPago: 'forma_pago', contabilizada: 'contabilizada', digitalizada: 'digitalizada', matricula: 'matricula'
};
const NUMERICOS = ['importeBase', 'iva', 'importeTotal'];
const BOOLEANOS = ['contabilizada', 'digitalizada'];

function crearDatos(supabase) {
  const comprobar = (r, que) => { if (r.error) throw new Error(que + ': ' + r.error.message); return r.data; };
  async function todas(tabla, columnas, filtrar) {
    let out = [];
    for (let i = 0; ; i += 1000) {
      let q = supabase.from(tabla).select(columnas);
      if (filtrar) q = filtrar(q);
      const d = comprobar(await q.range(i, i + 999), tabla);
      out = out.concat(d || []);
      if (!d || d.length < 1000) break;
    }
    return out;
  }

  async function listado() {
    return (await todas('facturas_proveedores_lineas', '*', q => q.order('id'))).map(aListado);
  }

  async function idsProcesados() {
    return new Set((await todas('facturas_proveedores_lineas', 'file_id')).map(l => String(l.file_id)));
  }

  async function proveedores() {
    return [...new Set((await todas('facturas_proveedores_lineas', 'proveedor')).map(l => l.proveedor).filter(Boolean).map(String))].sort();
  }

  async function reparto() {
    return (await todas('facturas_proveedores_reparto', 'proveedor,departamento,porcentaje', q => q.order('id')))
      .map(r => ({ proveedor: r.proveedor, departamento: r.departamento, porcentaje: Number(r.porcentaje) }));
  }

  // Igual que guardarReparto_: sustituye el reparto entero por el que llega.
  async function guardarReparto(filas) {
    const limpias = (filas || []).filter(f => f && String(f.proveedor || '').trim() && String(f.departamento || '').trim())
      .map(f => ({ proveedor: String(f.proveedor).trim(), departamento: String(f.departamento).trim(), porcentaje: Number(f.porcentaje) || 0 }));
    comprobar(await supabase.from('facturas_proveedores_reparto').delete().gte('id', 0), 'borrar reparto');
    if (limpias.length) comprobar(await supabase.from('facturas_proveedores_reparto').insert(limpias), 'guardar reparto');
    return { ok: true, guardadas: limpias.length };
  }

  async function historial(entrada) {
    const { error } = await supabase.from('facturas_proveedores_historial').insert(entrada);
    if (error) console.error('[Facturas historial]', error.message);
  }

  // Igual que actualizarCampoFactura_ (incluida la confianza "alta" al marcar Contabilizada).
  async function actualizarCampo(fila, campo, valor, usuario) {
    const col = COLUMNAS[campo];
    if (!col) return { error: 'Campo no editable: ' + campo };
    const id = parseInt(fila, 10);
    if (!id) return { error: 'Fila inválida: ' + fila };
    const l = comprobar(await supabase.from('facturas_proveedores_lineas').select('*').eq('id', id).maybeSingle(), 'factura');
    if (!l) return { error: 'Factura no encontrada en la fila ' + fila };

    let nuevo = valor;
    if (NUMERICOS.includes(campo)) nuevo = r2(valor);
    else if (BOOLEANOS.includes(campo)) nuevo = valor === true || valor === 'true';
    else nuevo = valor == null ? '' : String(valor);
    const anterior = l[col];
    if (String(anterior ?? '') === String(nuevo ?? '')) return { ok: true, sinCambios: true };

    const cambios = { [col]: nuevo };
    if (campo === 'fecha') Object.assign(cambios, mesAnio(nuevo));
    const subirConfianza = campo === 'contabilizada' && nuevo === true && String(l.confianza || '').toLowerCase() !== 'alta';
    if (subirConfianza) cambios.confianza = 'alta';
    comprobar(await supabase.from('facturas_proveedores_lineas').update(cambios).eq('id', id), 'guardar campo');

    const etiqueta = l.fecha ? ' [' + l.fecha + ']' : '';
    const base = { file_id: l.file_id, linea_id: id, nombre_archivo: l.nombre_archivo, proveedor: l.proveedor };
    await historial({ ...base, campo: campo + etiqueta, valor_anterior: anterior == null ? '' : String(anterior), valor_nuevo: String(nuevo ?? ''), usuario: usuario || '' });
    if (subirConfianza) await historial({ ...base, campo: 'confianza' + etiqueta, valor_anterior: String(l.confianza || ''), valor_nuevo: 'alta', usuario: (usuario || '') + ' (automático al contabilizar)' });
    return { ok: true };
  }

  async function historialFactura(fileId) {
    const d = await todas('facturas_proveedores_historial', 'fecha,campo,valor_anterior,valor_nuevo,usuario', q => q.eq('file_id', String(fileId)).order('fecha', { ascending: false }));
    return { ok: true, historial: d };
  }

  // Igual que el doPost de guardado: una fila por periodo, sin repetir las que
  // ya existan con el mismo proveedor + número + fecha; la factura viene de la
  // carpeta de Drive, así que queda marcada como digitalizada.
  async function guardarLineas({ fileId, proveedor, nombreArchivo, lineas }) {
    const lista = Array.isArray(lineas) && lineas.length ? lineas : [];
    const existentes = new Set((await todas('facturas_proveedores_lineas', 'proveedor,numero_factura,fecha', q => q.eq('proveedor', proveedor)))
      .map(l => `${l.proveedor}|${l.numero_factura || ''}|${l.fecha || ''}`));
    const nuevas = [];
    let duplicadas = 0;
    lista.forEach(li => {
      const clave = `${proveedor}|${li.numeroFactura || ''}|${li.fecha || ''}`;
      if (li.numeroFactura && li.fecha && existentes.has(clave)) { duplicadas++; return; }
      existentes.add(clave);
      nuevas.push({
        file_id: String(fileId), proveedor, nombre_archivo: nombreArchivo, numero_factura: li.numeroFactura ? String(li.numeroFactura) : '',
        fecha: li.fecha || '', importe_base: r2(li.importeBase), iva: r2(li.iva), importe_total: r2(li.importeTotal),
        confianza: li.confianza || '', digitalizada: true, ...mesAnio(li.fecha)
      });
    });
    if (nuevas.length) comprobar(await supabase.from('facturas_proveedores_lineas').insert(nuevas), 'guardar factura');
    return { ok: true, duplicado: nuevas.length === 0, lineas_guardadas: nuevas.length, lineas_duplicadas: duplicadas };
  }

  async function registrarErrores(errores) {
    const filas = (errores || []).map(e => ({ file_id: e.fileId || '', proveedor: e.proveedor || '', nombre_archivo: e.nombreArchivo || '', error: String(e.error || '') }));
    if (filas.length) comprobar(await supabase.from('facturas_proveedores_errores').insert(filas), 'registrar errores');
    return { ok: true, registrados: filas.length };
  }

  async function erroresRecientes(limite) {
    const n = Math.min(parseInt(limite, 10) || 200, 5000);
    const d = comprobar(await supabase.from('facturas_proveedores_errores').select('fecha,file_id,proveedor,nombre_archivo,error').order('fecha', { ascending: false }).limit(n), 'errores');
    return { ok: true, errores: (d || []).map(e => ({ fecha: e.fecha, fileId: e.file_id, proveedor: e.proveedor, nombreArchivo: e.nombre_archivo, error: e.error })) };
  }

  // Importación desde la hoja (una vez, al pasar a Supabase). leerHoja(action,
  // extra) llama al Apps Script. Se puede repetir: solo añade lo que falta.
  async function importarDesdeHoja(leerHoja) {
    const res = {};
    const { facturas } = await leerHoja('listado');
    const ya = new Set((await todas('facturas_proveedores_lineas', 'fila_hoja', q => q.not('fila_hoja', 'is', null))).map(l => l.fila_hoja));
    const lineas = (facturas || []).filter(f => f.fileId && f.fila && !ya.has(f.fila)).map(f => {
      const fecha = String(f.fecha || '');
      const ma = (f.mes && f.anio) ? { mes: parseInt(f.mes) || null, anio: parseInt(f.anio) || null } : mesAnio(fecha);
      return {
        file_id: String(f.fileId), proveedor: f.proveedor ? String(f.proveedor) : '', nombre_archivo: f.nombreArchivo || '',
        numero_factura: f.numeroFactura == null ? '' : String(f.numeroFactura).replace(/\.0+$/, ''), fecha,
        importe_base: r2(f.importeBase), iva: r2(f.iva), importe_total: r2(f.importeTotal), confianza: f.confianza || '',
        procesado_en: f.procesadoEn ? new Date(f.procesadoEn).toISOString() : new Date().toISOString(),
        forma_pago: f.formaPago || '', contabilizada: !!f.contabilizada, digitalizada: !!f.digitalizada,
        matricula: f.matricula ? String(f.matricula) : '', ...ma, fila_hoja: f.fila
      };
    });
    for (let i = 0; i < lineas.length; i += 500) comprobar(await supabase.from('facturas_proveedores_lineas').insert(lineas.slice(i, i + 500)), 'importar facturas');
    res.facturas_hoja = (facturas || []).length;
    res.lineas_importadas = lineas.length;

    // Reparto: solo si en Supabase todavía no hay ninguno (luego manda el panel).
    const { count: nRep } = await supabase.from('facturas_proveedores_reparto').select('id', { count: 'exact', head: true });
    if (!nRep) {
      const { reparto: rep } = await leerHoja('reparto');
      res.reparto_importado = (await guardarReparto(rep || [])).guardadas;
    } else res.reparto_importado = 0;

    // Errores (todos los de la hoja), si aún no se importaron.
    const { count: nErr } = await supabase.from('facturas_proveedores_errores').select('id', { count: 'exact', head: true }).eq('importado_de_hoja', true);
    if (!nErr) {
      const { errores } = await leerHoja('erroresRecientes', { limite: '100000' });
      const filas = (errores || []).map(e => ({ fecha: e.fecha ? new Date(e.fecha).toISOString() : new Date().toISOString(), file_id: e.fileId || '', proveedor: e.proveedor || '', nombre_archivo: e.nombreArchivo || '', error: String(e.error || ''), importado_de_hoja: true }));
      for (let i = 0; i < filas.length; i += 500) comprobar(await supabase.from('facturas_proveedores_errores').insert(filas.slice(i, i + 500)), 'importar errores');
      res.errores_importados = filas.length;
    } else res.errores_importados = 0;

    // Historial: el Apps Script solo lo da por factura, así que se pide uno a uno.
    const { count: nHist } = await supabase.from('facturas_proveedores_historial').select('id', { count: 'exact', head: true }).eq('importado_de_hoja', true);
    if (!nHist) {
      const ids = [...new Set((facturas || []).map(f => String(f.fileId)).filter(Boolean))];
      const filas = [];
      for (let i = 0; i < ids.length; i += 6) {
        const bloque = await Promise.all(ids.slice(i, i + 6).map(async id => {
          try { return { id, h: (await leerHoja('historialFactura', { fileId: id })).historial || [] }; }
          catch (e) { return { id, h: [] }; }
        }));
        bloque.forEach(({ id, h }) => {
          const f = (facturas || []).find(x => String(x.fileId) === id) || {};
          h.forEach(x => filas.push({
            fecha: x.fecha ? new Date(x.fecha).toISOString() : new Date().toISOString(), file_id: id, nombre_archivo: f.nombreArchivo || '',
            proveedor: f.proveedor || '', campo: x.campo || '', valor_anterior: x.valor_anterior == null ? '' : String(x.valor_anterior),
            valor_nuevo: x.valor_nuevo == null ? '' : String(x.valor_nuevo), usuario: x.usuario || '', importado_de_hoja: true
          }));
        });
      }
      for (let i = 0; i < filas.length; i += 500) comprobar(await supabase.from('facturas_proveedores_historial').insert(filas.slice(i, i + 500)), 'importar historial');
      res.historial_importado = filas.length;
    } else res.historial_importado = 0;
    return res;
  }

  return { listado, idsProcesados, proveedores, reparto, guardarReparto, actualizarCampo, historialFactura, guardarLineas, registrarErrores, erroresRecientes, importarDesdeHoja };
}

module.exports = { crearDatos, _test: { mesAnio, aListado } };
