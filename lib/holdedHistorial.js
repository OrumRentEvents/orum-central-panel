// Historial de lo volcado a Holded (20 nov 2026, interfaz glass → Holded →
// Historial): gastos aprobados (holded_sync_compras), facturas de venta
// (holded_sync_facturas) y cobros (holded_sync_cobros). Solo lectura; los
// filtros (fechas, cuenta, cliente…) se aplican en la pantalla.
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

function crear(supabase) {
  async function todas(tabla, columnas, filtro) {
    const filas = [];
    for (let desde = 0; ; desde += 1000) {
      let q = supabase.from(tabla).select(columnas);
      if (filtro) q = filtro(q);
      const { data, error } = await q.range(desde, desde + 999);
      if (error) throw new Error(`${tabla}: ${error.message}`);
      filas.push(...(data || []));
      if (!data || data.length < 1000) return filas;
    }
  }

  async function historial() {
    const [compras, facturas, cobros, rentman] = await Promise.all([
      todas('holded_sync_compras', 'file_id,proveedor,numero,fecha,total,cuenta_gasto,reparto,estado,error,aprobado_por,aprobado_en,forma_pago,pago_fecha,pago_tesoreria,sin_pagar,extraccion', q => q.not('holded_purchase_id', 'is', null)),
      todas('holded_sync_facturas', 'rentman_invoice_id,numero,holded_invoice_id,estado,error,fecha_factura,tipo,total_enviado,total_holded,actualizado_en,pdf_adjunto', q => q.in('estado', ['aprobada', 'borrador'])),
      todas('holded_sync_cobros', 'pago_id,split_idx,numero_factura,metodo_pago,importe,fecha,estado,actualizado_en', q => q.eq('estado', 'enviado')),
      todas('facturas', 'numero,cliente')
    ]);
    const cliente = {};
    rentman.forEach(f => { cliente[String(f.numero)] = f.cliente || ''; });
    return {
      gastos: compras.map(c => ({
        file_id: c.file_id, proveedor: c.proveedor, numero: c.numero, fecha: c.fecha, total: r2(c.total), cuenta: c.cuenta_gasto,
        reparto: Array.isArray(c.reparto) && c.reparto.length > 1 ? c.reparto : null, estado: c.estado, aviso: c.error || null,
        aprobado_por: c.aprobado_por, aprobado_en: c.aprobado_en, forma_pago: c.forma_pago, pago_fecha: c.pago_fecha,
        sin_pagar: !!c.sin_pagar && !c.pago_fecha, es_abono: !!(c.extraccion && c.extraccion.es_rectificativa),
        pdf_url: `/api/facturas-proveedores/${encodeURIComponent(c.file_id)}/archivo`
      })).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))),
      facturas: facturas.map(f => ({
        numero: f.numero, fecha: f.fecha_factura, tipo: f.tipo, cliente: cliente[String(f.numero)] || '', total: r2(f.total_enviado),
        total_holded: f.total_holded == null ? null : r2(f.total_holded), estado: f.estado, aviso: f.error || null, enviado_en: f.actualizado_en, pdf_adjunto: !!f.pdf_adjunto
      })).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))),
      cobros: cobros.map(c => ({
        pago_id: c.pago_id, split_idx: c.split_idx, numero_factura: c.numero_factura, cliente: cliente[String(c.numero_factura)] || '',
        metodo: c.metodo_pago, importe: r2(c.importe), fecha: c.fecha, enviado_en: c.actualizado_en
      })).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
    };
  }
  return { historial };
}

module.exports = { crear };
