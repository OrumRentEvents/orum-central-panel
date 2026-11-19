// ================================================================
// PRUEBA DE MODELO PARA LEER FACTURAS (19 nov 2026)
// ================================================================
// Compara otro modelo (p. ej. Haiku) con el de siempre (Opus) leyendo facturas
// YA CONTABILIZADAS, cuyos datos revisó una persona (la «verdad»). No cambia
// ninguna factura: solo guarda el resultado en la tabla pruebas_modelo.
// Se pide insertando una fila en pruebas_modelo con estado 'pedida'; el
// servidor la ejecuta al arrancar (ver server.js). La mitad fotos y la mitad
// PDF, de proveedores distintos.
// ================================================================

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const normNum = s => String(s || '').toUpperCase().replace(/[IL]/g, '1').replace(/O/g, '0').replace(/[^A-Z0-9]/g, '').replace(/^0+/, '');
const isoDeDMY = f => { const p = String(f || '').split('/'); if (p.length !== 3) return null; const a = p[2].length === 2 ? '20' + p[2] : p[2]; return a + '-' + p[1].padStart(2, '0') + '-' + p[0].padStart(2, '0'); };
const normMat = s => String(s || '').toUpperCase().replace(/[\s-]+/g, '');
// Precios $/millón de tokens (entrada, salida), para estimar el coste
const PRECIOS = { 'claude-haiku-5-5': [0.10, 0.50], 'claude-opus-5-5': [4, 20] };

// Datos que se comparan: lectura de un modelo frente a la verdad
function comparar(ex, verdad) {
  const sumaBase = (ex.lineas_iva || []).reduce((s, l) => s + Number(l.base || 0), 0);
  const sumaIva = (ex.lineas_iva || []).reduce((s, l) => s + Number(l.cuota || 0), 0);
  const res = {
    nif: !verdad.nif || String(ex.emisor_nif || '').toUpperCase().replace(/[\s.\-\/]/g, '').replace(/^ES(?=[0-9A-Z]{9}$)/, '') === verdad.nif,
    numero: normNum(ex.numero) === normNum(verdad.numero),
    fecha: String(ex.fecha || '') === verdad.fecha,
    base: Math.abs(r2(sumaBase) - verdad.base) <= 0.02,
    iva: Math.abs(r2(sumaIva) - verdad.iva) <= 0.02,
    total: Math.abs(r2(ex.total) - verdad.total) <= 0.02
  };
  if (verdad.matricula) res.matricula = normMat(ex.matricula) === normMat(verdad.matricula);
  if (verdad.gasto_vehiculo) res.tipo_gasto = ex.gasto_vehiculo === verdad.gasto_vehiculo;
  return res;
}

function crearPruebaModelo({ supabase, facturasArchivos, lecturaFacturas }) {
  async function elegirFacturas(n) {
    const [{ data: lineas }, { data: archivos }, { data: lecturas }] = await Promise.all([
      supabase.from('facturas_proveedores_lineas').select('file_id,proveedor,numero_factura,fecha,importe_base,iva,importe_total,matricula,gasto_vehiculo,contabilizada,procesado_en').eq('contabilizada', true).order('id', { ascending: false }).limit(1000),
      supabase.from('facturas_proveedores_archivos').select('file_id,mime').limit(2000),
      supabase.from('facturas_proveedores').select('*').limit(2000)
    ]);
    const mime = Object.fromEntries((archivos || []).map(a => [String(a.file_id), a.mime]));
    const lect = Object.fromEntries((lecturas || []).map(l => [String(l.file_id), l]));
    const porFactura = {};
    (lineas || []).forEach(l => {
      const k = String(l.file_id);
      if (!mime[k] || !lect[k]) return;
      const f = porFactura[k] = porFactura[k] || { file_id: k, proveedor: l.proveedor, mime: mime[k], lineas: [] };
      f.lineas.push(l);
    });
    // Una por proveedor, la mitad fotos y la mitad PDF
    const vistos = new Set(), fotos = [], pdfs = [];
    Object.values(porFactura).forEach(f => {
      if (vistos.has(f.proveedor)) return;
      const esFoto = /^image\//.test(f.mime);
      const lista = esFoto ? fotos : pdfs;
      if (lista.length >= Math.ceil(n / 2)) return;
      vistos.add(f.proveedor); lista.push(f);
    });
    return fotos.concat(pdfs).slice(0, n).map(f => {
      const l0 = f.lineas[0], L = lect[f.file_id];
      return {
        ...f, opus: L,
        verdad: {
          nif: L.nif || '', numero: l0.numero_factura, fecha: isoDeDMY(l0.fecha) || '',
          base: r2(f.lineas.reduce((s, x) => s + Number(x.importe_base || 0), 0)),
          iva: r2(f.lineas.reduce((s, x) => s + Number(x.iva || 0), 0)),
          total: r2(f.lineas.reduce((s, x) => s + Number(x.importe_total || 0), 0)),
          matricula: l0.matricula || '', gasto_vehiculo: l0.gasto_vehiculo || ''
        }
      };
    });
  }

  async function ejecutar(prueba) {
    const facturas = await elegirFacturas(prueba.n || 20);
    const filas = [];
    for (const f of facturas) {
      const fila = { file_id: f.file_id, proveedor: f.proveedor, tipo: /^image\//.test(f.mime) ? 'foto' : 'pdf', verdad: f.verdad };
      // Lo que leyó Opus en su día (la lectura guardada), contra la verdad
      fila.opus = comparar({ ...f.opus, emisor_nif: f.opus.nif, matricula: f.verdad.matricula && f.opus.matricula_leida, gasto_vehiculo: f.opus.gasto_vehiculo }, f.verdad);
      // Matrícula y tipo de gasto no se guardaban antes en la lectura de Opus: no se puntúan para él
      delete fila.opus.matricula; if (!f.opus.gasto_vehiculo) delete fila.opus.tipo_gasto;
      try {
        const arch = await facturasArchivos.leer(f.file_id);
        const r = await lecturaFacturas.leerConModelo(arch.base64, f.proveedor, arch.nombreArchivo, arch.mime, prueba.modelo);
        fila.nuevo = comparar(r.ex, f.verdad);
        fila.leido = { nif: r.ex.emisor_nif, numero: r.ex.numero, fecha: r.ex.fecha, total: r.ex.total, matricula: r.ex.matricula, gasto_vehiculo: r.ex.gasto_vehiculo, confianza: r.ex.confianza };
        fila.uso = { entrada: r.usage.input_tokens, salida: r.usage.output_tokens, ms: r.ms };
      } catch (e) { fila.error = e.message; }
      filas.push(fila);
      console.log('[Prueba modelo] ' + filas.length + '/' + facturas.length + ' ' + f.proveedor + (fila.error ? ' ERROR ' + fila.error : ''));
    }
    // Resumen: % de aciertos por dato, para cada modelo
    const campos = ['nif', 'numero', 'fecha', 'base', 'iva', 'total', 'matricula', 'tipo_gasto'];
    const pct = (lado, c) => { const v = filas.filter(x => x[lado] && x[lado][c] !== undefined).map(x => x[lado][c]); return v.length ? { aciertos: v.filter(Boolean).length, de: v.length } : null; };
    const resumen = { modelo: prueba.modelo, facturas: filas.length, errores: filas.filter(x => x.error).length, por_dato: {} };
    campos.forEach(c => { resumen.por_dato[c] = { nuevo: pct('nuevo', c), opus: pct('opus', c) }; });
    const perfectas = lado => filas.filter(x => x[lado] && Object.values(x[lado]).every(Boolean)).length;
    resumen.facturas_perfectas = { nuevo: perfectas('nuevo'), opus: perfectas('opus') };
    const conUso = filas.filter(x => x.uso);
    if (conUso.length) {
      const ent = conUso.reduce((s, x) => s + x.uso.entrada, 0), sal = conUso.reduce((s, x) => s + x.uso.salida, 0);
      const [pe, ps] = PRECIOS[prueba.modelo] || [0, 0];
      resumen.tokens = { entrada: ent, salida: sal, ms_medio: Math.round(conUso.reduce((s, x) => s + x.uso.ms, 0) / conUso.length) };
      resumen.coste_por_factura_usd = (ent * pe + sal * ps) / 1e6 / conUso.length;
    }
    return { resumen, filas };
  }

  // Al arrancar: ejecuta la prueba pedida más antigua, si la hay
  async function ejecutarPendiente() {
    const { data } = await supabase.from('pruebas_modelo').select('*').eq('estado', 'pedida').order('id').limit(1);
    const prueba = data && data[0];
    if (!prueba) return;
    const { data: tomada } = await supabase.from('pruebas_modelo').update({ estado: 'en_curso' }).eq('id', prueba.id).eq('estado', 'pedida').select();
    if (!tomada || !tomada.length) return; // otra instancia la tomó
    console.log('[Prueba modelo] Empieza la prueba ' + prueba.id + ' con ' + prueba.modelo);
    try {
      const resultado = await ejecutar(prueba);
      await supabase.from('pruebas_modelo').update({ estado: 'hecha', resultado, terminado_en: new Date().toISOString() }).eq('id', prueba.id);
      console.log('[Prueba modelo] Hecha: ' + JSON.stringify(resultado.resumen));
    } catch (e) {
      console.error('[Prueba modelo] Error:', e);
      await supabase.from('pruebas_modelo').update({ estado: 'error', resultado: { error: e.message }, terminado_en: new Date().toISOString() }).eq('id', prueba.id);
    }
  }

  return { ejecutarPendiente, _test: { comparar } };
}

module.exports = { crearPruebaModelo, _test: { comparar, normNum } };
