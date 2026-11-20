// Asignar en Caja la forma de pago de un cobro de Rentman desde ORUM Central
// (20 nov 2026, pedido por el usuario): Financiero → Holded → Ventas, para no
// tener que abrir la app de Caja. Escribe en caja_registros igual que Caja
// (REPOSITORIO CAJA ORUM GITHUB, lib/caja.js guardarRegistroOficial: borra lo
// de ese pago_id y lo reescribe) y deja constancia en caja_historial.
// Solo un método por cobro: un pago partido en varias formas se hace en Caja.
// Mismas reglas que Caja: solo Sergio (admin) y María (caja); no se toca
// efectivo que Contabilidad ya marcó recibido ni un cobro ya enviado a Holded.

// Mismos métodos que Caja (public/index.html, METODOS).
const METODOS_CAJA = [
  { id: 'efectivo-marbella', nombre: 'Efectivo Marbella', ubicacion: 'marbella', tipo: 'efectivo' },
  { id: 'tpv-marbella', nombre: 'TPV Marbella', ubicacion: 'marbella', tipo: 'tpv' },
  { id: 'efectivo-monda', nombre: 'Efectivo Monda', ubicacion: 'monda', tipo: 'efectivo' },
  { id: 'tpv-monda', nombre: 'TPV Monda', ubicacion: 'monda', tipo: 'tpv' },
  { id: 'transferencia', nombre: 'Transferencia', ubicacion: null, tipo: 'transferencia' },
  { id: 'factura0', nombre: 'Factura 0 €', ubicacion: null, tipo: 'otro' },
  { id: 'rectificativa', nombre: 'Rectificativa', ubicacion: null, tipo: 'otro' },
  { id: 'fianza-efectivo-marbella', nombre: 'Fianza Efectivo Marbella', ubicacion: 'marbella', tipo: 'efectivo' },
  { id: 'fianza-efectivo-monda', nombre: 'Fianza Efectivo Monda', ubicacion: 'monda', tipo: 'efectivo' },
  { id: 'fianza-transferencia', nombre: 'Fianza Transferencia', ubicacion: null, tipo: 'transferencia' }
];
// Usuarios de ORUM Central con permiso de Caja para cambiar formas de pago.
const PUEDEN_ASIGNAR = ['sergio', 'maria'];
const puedeAsignar = u => PUEDEN_ASIGNAR.includes(String((u && u.usuario) || '').toLowerCase());

class ErrorCaja extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }

function crear(supabase) {
  const comprobar = (r, que) => { if (r.error) throw new Error(`${que}: ${r.error.message}`); return r.data; };

  async function asignar({ pagoId, metodo }, usuario) {
    if (!puedeAsignar(usuario)) throw new ErrorCaja('Solo María y Sergio pueden cambiar formas de pago de Caja', 403);
    const m = METODOS_CAJA.find(x => x.id === metodo);
    if (!m) throw new ErrorCaja('Forma de pago no válida');
    const id = Number(pagoId);
    if (!id) throw new ErrorCaja('Falta el cobro');
    const pago = comprobar(await supabase.from('pagos').select('pago_id,factura_id,numero_factura,importe,fecha_pago_raw').eq('pago_id', id).maybeSingle(), 'cobro');
    if (!pago) throw new ErrorCaja('Ese cobro no está en Rentman', 404);
    const actuales = comprobar(await supabase.from('caja_registros').select('pago_id,split_idx,metodo_pago,es_abrebotellas').eq('pago_id', id), 'registro actual') || [];
    if (actuales.length > 1) throw new ErrorCaja('Este cobro está partido en varias formas de pago: cámbialo en Caja', 409);
    const enviado = comprobar(await supabase.from('holded_sync_cobros').select('estado').eq('pago_id', id).eq('estado', 'enviado').limit(1), 'cobro en Holded');
    if (enviado && enviado.length) throw new ErrorCaja('Este cobro ya está en Holded: si hay que cambiarlo, corrígelo en Holded y en Caja', 409);
    if (actuales.length) {
      const rec = comprobar(await supabase.from('caja_efectivo_recibido').select('recibido_por').eq('clave', String(id)).limit(1), 'efectivo recibido');
      if (rec && rec.length) throw new ErrorCaja(`${rec[0].recibido_por || 'Contabilidad'} ya marcó este efectivo como recibido: no se puede cambiar`, 409);
    }
    const { data: fac } = await supabase.from('facturas').select('cliente').eq('numero', pago.numero_factura).limit(1);
    const cliente = (fac && fac[0] && fac[0].cliente) || null;
    const nombre = (usuario && (usuario.nombre || usuario.usuario)) || null;
    const ahora = new Date().toISOString();
    comprobar(await supabase.from('caja_registros').delete().eq('pago_id', id), 'borrar registro');
    comprobar(await supabase.from('caja_registros').insert({
      factura_id: String(pago.factura_id), pago_id: id, split_idx: 1, metodo_pago: m.id, ubicacion: m.ubicacion, tipo: m.tipo,
      importe: pago.importe, cliente, numero: pago.numero_factura, es_abrebotellas: false, usuario: nombre, num_operacion: '',
      fecha_pago_raw: pago.fecha_pago_raw || null, updated_raw: ahora, updated_ts: ahora, sincronizado_en: ahora
    }), 'guardar registro');
    const { error } = await supabase.from('caja_historial').insert({ accion: 'asignar_metodo', usuario: nombre, datos: {
      factura_id: String(pago.factura_id), pago_id: id, numero: pago.numero_factura, cliente, importe: pago.importe, metodo_pago: m.id,
      anterior: actuales[0] ? actuales[0].metodo_pago : null, origen: 'ORUM Central · Holded' } });
    if (error) console.error('[Caja historial desde Holded]', error.message);
    return { ok: true, metodo: m.id, anterior: actuales[0] ? actuales[0].metodo_pago : null };
  }
  return { asignar };
}

module.exports = { crear, METODOS_CAJA, puedeAsignar, ErrorCaja };
