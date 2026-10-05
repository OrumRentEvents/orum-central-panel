// ================================================================
// LECTURA ÚNICA DE FACTURAS DE PROVEEDORES (5 oct 2026)
// ================================================================
// Cada PDF de proveedor se lee UNA vez con Claude y la lectura completa se
// guarda en Supabase (facturas_proveedores). De ahí salen:
//   - las filas de la Sheet FACTURAS_LOG (una por periodo, como antes),
//     ver sincronizarFacturasProveedoresInterno() en server.js;
//   - el volcado a Holded como compra en borrador (lib/holdedCompras.js).
// Solo se vuelve a leer si alguien pulsa "Releer".
// ================================================================

const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./supabaseSource');

const anthropic = new Anthropic(); // ANTHROPIC_API_KEY de Railway
const MODELO = 'claude-opus-5-5';
const EMPRESA = 'Servicios y Alquiler para Eventos SL';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

function normalizarNif(nif) {
  let s = String(nif || '').toUpperCase().replace(/[\s.\-\/]/g, '');
  if (/^ES[0-9A-Z]{9}$/.test(s)) s = s.slice(2);
  return s;
}

const ESQUEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['emisor_nombre', 'emisor_nif', 'numero', 'fecha', 'vencimiento', 'es_rectificativa', 'concepto', 'lineas_iva', 'periodos', 'retencion_porcentaje', 'retencion_importe', 'total', 'moneda', 'confianza', 'dudas'],
  properties: {
    emisor_nombre: { type: 'string', description: 'Razón social del proveedor que EMITE la factura' },
    emisor_nif: { type: 'string', description: 'NIF/CIF/VAT del emisor (no el del cliente)' },
    numero: { type: 'string' },
    fecha: { type: 'string', description: 'Fecha de expedición, YYYY-MM-DD' },
    vencimiento: { type: 'string', description: 'Fecha de vencimiento YYYY-MM-DD, o cadena vacía si no aparece' },
    es_rectificativa: { type: 'boolean', description: 'true si es una factura rectificativa o abono a nuestro favor' },
    concepto: { type: 'string', description: 'Descripción muy breve de lo facturado (máx. 60 caracteres)' },
    lineas_iva: {
      type: 'array',
      description: 'Cuadro de impuestos: una entrada por tipo de IVA con base y cuota totales de ese tipo (las partes exentas o sin IVA con tipo 0)',
      items: {
        type: 'object', additionalProperties: false, required: ['tipo', 'base', 'cuota'],
        properties: { tipo: { type: 'number', description: 'Porcentaje de IVA: 21, 10, 4, 0…' }, base: { type: 'number' }, cuota: { type: 'number' } }
      }
    },
    periodos: {
      type: 'array',
      description: 'Si la factura cobra varios periodos o meses con su propia fecha (p. ej. una línea por mes), una entrada por periodo; si no, una sola entrada con la fecha y los importes de toda la factura',
      items: {
        type: 'object', additionalProperties: false, required: ['fecha', 'base', 'iva', 'total'],
        properties: { fecha: { type: 'string', description: 'YYYY-MM-DD' }, base: { type: 'number' }, iva: { type: 'number' }, total: { type: 'number', description: 'base + iva del periodo' } }
      }
    },
    retencion_porcentaje: { type: 'number', description: 'Porcentaje de retención de IRPF, 0 si no hay' },
    retencion_importe: { type: 'number', description: 'Importe retenido (positivo), 0 si no hay' },
    total: { type: 'number', description: 'Total a pagar de la factura' },
    moneda: { type: 'string', description: 'Código ISO, p. ej. EUR' },
    confianza: { type: 'string', enum: ['alta', 'media', 'baja'], description: 'Lo clara y legible que está la factura' },
    dudas: { type: 'string', description: 'Cualquier cosa ilegible o ambigua, o cadena vacía' }
  }
};

async function leerConClaude(base64, proveedor, nombreArchivo) {
  const response = await anthropic.beta.messages.create({
    model: MODELO,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: ESQUEMA } },
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
      { type: 'text', text: `Factura de gasto recibida por ${EMPRESA} (somos el cliente: nuestro NIF y nombre NO son los del emisor). Carpeta del proveedor: "${proveedor}", archivo: ${nombreArchivo}.
Extrae los datos para contabilizarla. Importes siempre en positivo, también en un abono (márcalo con es_rectificativa).` }
    ]}]
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude no ha podido leer la factura (refusal)');
  const texto = (response.content || []).find(b => b.type === 'text');
  if (!texto) throw new Error('Respuesta de Claude sin texto');
  return JSON.parse(texto.text);
}

// Lee el PDF y guarda la lectura. Devuelve la fila guardada.
async function leerYGuardar({ fileId, proveedor, nombreArchivo, base64 }) {
  const ex = await leerConClaude(base64, proveedor, nombreArchivo);
  const fila = {
    file_id: String(fileId), proveedor, nombre_archivo: nombreArchivo,
    emisor_nombre: ex.emisor_nombre, nif: normalizarNif(ex.emisor_nif), numero: ex.numero,
    fecha: ex.fecha || null, vencimiento: ex.vencimiento || null, es_rectificativa: !!ex.es_rectificativa,
    concepto: ex.concepto, lineas_iva: ex.lineas_iva || [], periodos: ex.periodos || [],
    retencion_porcentaje: r2(ex.retencion_porcentaje), retencion_importe: r2(ex.retencion_importe),
    total: r2(ex.total), moneda: (ex.moneda || 'EUR').toUpperCase(), confianza: ex.confianza, dudas: ex.dudas || null,
    modelo: MODELO, leido_en: new Date().toISOString()
  };
  const { error } = await supabase.from('facturas_proveedores').upsert(fila);
  if (error) throw new Error('Guardando la lectura en Supabase: ' + error.message);
  return fila;
}

async function lecturaGuardada(fileId) {
  const { data } = await supabase.from('facturas_proveedores').select('*').eq('file_id', String(fileId)).maybeSingle();
  return data || null;
}

// Filas para la Sheet FACTURAS_LOG (mismo formato que antes: una por periodo).
function lineasSheet(lectura) {
  const ddmm = iso => iso ? iso.split('-').reverse().join('/') : '';
  const periodos = (lectura.periodos && lectura.periodos.length) ? lectura.periodos
    : [{ fecha: lectura.fecha, base: (lectura.lineas_iva || []).reduce((s, l) => s + Number(l.base || 0), 0), iva: (lectura.lineas_iva || []).reduce((s, l) => s + Number(l.cuota || 0), 0) }];
  return periodos.map(p => ({
    numeroFactura: lectura.numero || '',
    fecha: ddmm(p.fecha || lectura.fecha),
    importeBase: r2(p.base),
    iva: r2(p.iva),
    importeTotal: r2(Number(p.base || 0) + Number(p.iva || 0)),
    confianza: lectura.confianza || ''
  }));
}

module.exports = { leerYGuardar, lecturaGuardada, lineasSheet, normalizarNif };
