// ================================================================
// ORUM CENTRAL — Panel de administración con login por roles
// server.js
// ================================================================

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fetch = require('node-fetch');
const path = require('path');
const { llamarOrumCentralSupabase, obtenerMaterialDeProyecto, obtenerDetalleProyecto, obtenerEstadisticasRutas, obtenerEstadisticasMaterial, obtenerParadasParaEvolucion, ACCIONES: ACCIONES_SUPABASE, supabase } = require('./lib/supabaseSource');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
// FIX (28 ago 2026): Express genera un ETag por defecto en toda respuesta.
// Si el navegador repite una petición GET con el mismo contenido (ej.
// recargar la misma pantalla dos veces seguidas), Express responde 304 sin
// cuerpo - y el fetch() del frontend intenta parsear ese cuerpo vacío como
// JSON y explota ("Error de conexión"), aunque el backend funcione bien.
// Esta app es un panel de datos en vivo (nunca queremos servir una
// respuesta cacheada), así que se desactiva el ETag entero.
app.set('etag', false);

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'PEGA_AQUI_LA_URL_DEL_DOGET';
const APPS_SCRIPT_TOKEN = process.env.APPS_SCRIPT_TOKEN || 'ORUMx2026CentralData9Q';

// ── URL del Apps Script de RUTAS (para conductores) ──
// Añade en Railway la variable: RUTAS_SCRIPT_URL = URL del doGet de Rutas ORUM 2026
const RUTAS_SCRIPT_URL = process.env.RUTAS_SCRIPT_URL || '';
const RUTAS_SCRIPT_TOKEN = 'ORUMx2026#Rutas$Stats';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'orum-central-secret-cambiar-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 12,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  }
}));

// Caché en memoria de las respuestas de ORUM CENTRAL (Apps Script). Apps
// Script tarda varios segundos en leer hojas grandes (PROYECTOS ya tiene
// 1750+ filas) — con esto, cualquier petición repetida en los siguientes
// segundos (cambiar de pestaña, otro usuario pidiendo lo mismo) se sirve
// al instante en vez de releer la hoja entera cada vez.
const CACHE_ORUM_CENTRAL = new Map(); // action -> { data, timestamp }
const CACHE_TTL_MS = 45 * 1000;

async function llamarOrumCentral(action, extraParams = {}) {
  // Solo cacheamos llamadas simples (sin parámetros extra) y nunca 'usuarios'
  // (login/contraseñas: siempre al día, coste bajo por ser poco frecuente).
  const cacheable = Object.keys(extraParams).length === 0 && action !== 'usuarios';
  if (cacheable) {
    const cacheado = CACHE_ORUM_CENTRAL.get(action);
    if (cacheado && (Date.now() - cacheado.timestamp) < CACHE_TTL_MS) {
      // Copia superficial: varias rutas hacen "resultado.data = resultado.data.filter(...)"
      // — sin esto, esa reasignación mutaría el objeto cacheado para todo el mundo.
      return { ...cacheado.data };
    }
  }

  // Fuente principal: Supabase (rápido, sincronizado en tiempo real + cron
  // cada 15 min como red de seguridad). Solo para acciones sin parámetros
  // extra - las que llevan extraParams siguen yendo a Apps Script tal cual.
  if (ACCIONES_SUPABASE[action] && Object.keys(extraParams).length === 0) {
    const data = await llamarOrumCentralSupabase(action);
    if (cacheable && !data.error) CACHE_ORUM_CENTRAL.set(action, { data, timestamp: Date.now() });
    return data;
  }

  const params = new URLSearchParams({ token: APPS_SCRIPT_TOKEN, action, ...extraParams });
  const url = `${APPS_SCRIPT_URL}?${params.toString()}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Apps Script respondió con status ${resp.status}`);
  const data = await resp.json();
  if (cacheable && !data.error) CACHE_ORUM_CENTRAL.set(action, { data, timestamp: Date.now() });
  return data;
}

async function llamarOrumCentralPost(body) {
  const resp = await fetch(APPS_SCRIPT_URL.replace('/exec', '/exec'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, token: 'ORUMx2026RutasWrite' })
  });
  if (!resp.ok) throw new Error('Apps Script POST error ' + resp.status);
  return resp.json();
}

// ── Helper: llamar al Apps Script de RUTAS (para conductores) ──
async function llamarRutasScript(action, extraParams = {}, method = 'GET', body = null) {
  if (!RUTAS_SCRIPT_URL) throw new Error('RUTAS_SCRIPT_URL no configurada en Railway');
  if (method === 'GET') {
    const params = new URLSearchParams({ token: RUTAS_SCRIPT_TOKEN, action, ...extraParams });
    const resp = await fetch(`${RUTAS_SCRIPT_URL}?${params.toString()}`);
    return resp.json();
  } else {
    // El POST usa el token de RutasPublic, no el de Stats
    const resp = await fetch(RUTAS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'ORUMx2026RutasPublic', action, ...body })
    });
    return resp.json();
  }
}

function requiereLogin(req, res, next) {
  if (!req.session.usuario) return res.status(401).json({ error: 'No autenticado' });
  next();
}

// El rol Comercial solo puede ver su propio apartado (Proyectos, ya filtrado por
// comercial_filtro). Cualquier otro endpoint de datos queda bloqueado en el
// backend, no solo escondido en el menú — así una llamada directa a la URL
// tampoco expone datos de otros departamentos. Usar tras requiereLogin.
function bloquearComercial(req, res, next) {
  if (req.session.usuario.rol === 'Comercial') return res.status(403).json({ error: 'No autorizado para este apartado' });
  next();
}

// Servicios Isabella (VMS Horeca, Isabella Mobiliario, Isabella al Carbón,
// Isabella Mobil Home): los responsables de Logística dan de alta los
// servicios prestados pero no ven coste real/margen; Dirección y
// Contabilidad ven todo, igual que en Facturas Proveedores.
const ROLES_ISABELLA_LECTURA = ['Logistica', 'Direccion', 'Contabilidad'];
const ROLES_ISABELLA_ADMIN = ['Direccion', 'Contabilidad'];
function permiteIsabella(req, res, next) {
  if (!ROLES_ISABELLA_LECTURA.includes(req.session.usuario.rol)) return res.status(403).json({ error: 'No autorizado para este apartado' });
  next();
}
function soloIsabellaAdmin(req, res, next) {
  if (!ROLES_ISABELLA_ADMIN.includes(req.session.usuario.rol)) return res.status(403).json({ error: 'No autorizado para este apartado' });
  next();
}

// ── Auditoría de Rutas: registra quién hizo qué en la pestaña HISTORIAL_RUTAS ──
// Fire-and-forget: nunca bloquea ni rompe la respuesta al frontend si falla.
function logHistorialRutas(usuario, accion, detalle) {
  if (!RUTAS_SCRIPT_URL) return;
  fetch(RUTAS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'ORUMx2026RutasPublic', action: 'log_historial', usuario: usuario || 'Desconocido', accion, detalle: JSON.stringify(detalle || {}) })
  }).catch(() => {});
}

// ================================================================
// RUTAS DE AUTENTICACIÓN
// ================================================================

app.post('/api/login', async (req, res) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

    const resultado = await llamarOrumCentral('usuarios');
    if (resultado.error) return res.status(500).json({ error: 'Error leyendo usuarios: ' + resultado.error });

    const usuarioEncontrado = resultado.data.find(
      u => String(u.usuario).toLowerCase() === String(usuario).toLowerCase()
    );

    if (!usuarioEncontrado) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    const passwordValida = bcrypt.compareSync(password, usuarioEncontrado.password_hash);
    if (!passwordValida) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    req.session.usuario = {
      usuario: usuarioEncontrado.usuario,
      nombre: usuarioEncontrado.nombre,
      rol: usuarioEncontrado.rol,
      comercial_filtro: usuarioEncontrado.comercial_filtro || null
    };

    res.json({ ok: true, usuario: req.session.usuario });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error interno al iniciar sesión' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/sesion', (req, res) => {
  if (!req.session.usuario) return res.status(401).json({ error: 'No autenticado' });
  res.json({ usuario: req.session.usuario });
});

// ================================================================
// ESTADO DE SINCRONIZACIÓN — panel de salud de Supabase
// ================================================================

const TABLAS_ESTADO = [
  { tabla: 'proyectos', etiqueta: 'Proyectos' },
  { tabla: 'facturas', etiqueta: 'Facturas' },
  { tabla: 'pagos', etiqueta: 'Pagos' },
  { tabla: 'presupuestos', etiqueta: 'Presupuestos' },
  { tabla: 'servicios', etiqueta: 'Servicios' },
  { tabla: 'equipment', etiqueta: 'Equipment' },
  { tabla: 'leads', etiqueta: 'Leads' },
  { tabla: 'usuarios', etiqueta: 'Usuarios' },
  { tabla: 'caja', etiqueta: 'Caja' },
  { tabla: 'rutas', etiqueta: 'Rutas' },
];

app.get('/api/sync-status', requiereLogin, async (req, res) => {
  try {
    // Últimas ~200 filas de sync_log (de sobra para cubrir al menos una
    // pasada completa de las 10 tablas) y nos quedamos con la más
    // reciente de cada una.
    const { data: logRows, error } = await supabase
      .from('sync_log')
      .select('tabla,exito,resumen,duracion_ms,terminado_en')
      .order('terminado_en', { ascending: false })
      .limit(200);
    if (error) throw error;

    const ultimaPorTabla = {};
    (logRows || []).forEach((r) => {
      if (!ultimaPorTabla[r.tabla]) ultimaPorTabla[r.tabla] = r;
    });

    const ahora = Date.now();
    const cron = TABLAS_ESTADO.map(({ tabla, etiqueta }) => {
      const r = ultimaPorTabla[tabla];
      return {
        tabla,
        etiqueta,
        exito: r ? r.exito : null,
        resumen: r ? r.resumen : null,
        terminado_en: r ? r.terminado_en : null,
        hace_minutos: r ? Math.round((ahora - new Date(r.terminado_en).getTime()) / 60000) : null,
      };
    });

    // Conteos rápidos de las tablas principales, para ver de un vistazo
    // que no se han quedado a cero por accidente.
    const tablasConteo = ['proyectos', 'facturas', 'pagos', 'presupuestos', 'equipment', 'rutas_paradas', 'caja_registros'];
    const conteos = {};
    await Promise.all(tablasConteo.map(async (t) => {
      const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
      conteos[t] = count;
    }));

    res.json({ ok: true, generado_en: new Date().toISOString(), cron, conteos });
  } catch (err) {
    console.error('Error en /api/sync-status:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// RUTAS DE DATOS (requieren login)
// ================================================================

app.get('/api/proyectos', requiereLogin, async (req, res) => {
  try {
    const resultado = await llamarOrumCentral('proyectos');
    const { rol, comercial_filtro } = req.session.usuario;
    if (rol === 'Comercial' && comercial_filtro) {
      resultado.data = resultado.data.filter(p => p.comercial === comercial_filtro);
    }
    res.json(resultado);
  } catch (err) {
    console.error('Error obteniendo proyectos:', err);
    res.status(500).json({ error: 'Error al obtener proyectos desde ORUM CENTRAL' });
  }
});

app.get('/api/presupuestos', requiereLogin, async (req, res) => {
  try {
    const [resultado, proyectosResp] = await Promise.all([
      llamarOrumCentral('presupuestos'),
      llamarOrumCentral('proyectos')
    ]);
    // La hoja PRESUPUESTOS no guarda la fecha del evento (solo vive en
    // PROYECTOS) - se cruza aquí por proyecto_id para no duplicar el dato.
    const eventoPorProyecto = {};
    (proyectosResp.data || []).forEach(pr => { eventoPorProyecto[String(pr.id)] = pr.evento_inicio; });
    const { rol, comercial_filtro } = req.session.usuario;
    if (rol === 'Comercial' && comercial_filtro) {
      resultado.data = resultado.data.filter(p => p.comercial === comercial_filtro);
    }
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    resultado.data = resultado.data.map(p => {
      const fechaCaducidad = parsearFechaDDMMYYYY(p.fecha_caducidad);
      let diasRestantes = null;
      let semaforo = 'gris';
      // "Todavía sin decidir" = mismos 3 estados que ya usa Financiero
      // (ESTADOS_PIPELINE_NOMBRE). Cualquier otro estado (Confirmed,
      // Canceled, y las fases logísticas post-confirmación: Returned,
      // Cargado, On location, Controlado, Preparado...) ya está resuelto
      // y no debe seguir marcado como "caducado sin confirmar".
      const enPipeline = ESTADOS_PIPELINE_NOMBRE.includes(normalizarTexto(p.estado));
      if (fechaCaducidad) {
        diasRestantes = Math.round((fechaCaducidad - hoy) / (1000 * 60 * 60 * 24));
        if (!enPipeline) semaforo = normalizarTexto(p.estado) === 'canceled' ? 'perdido' : 'ganado';
        else if (diasRestantes < 0) semaforo = 'negro';
        else if (diasRestantes <= 3) semaforo = 'rojo';
        else if (diasRestantes <= 7) semaforo = 'amarillo';
        else semaforo = 'verde';
      }
      return { ...p, dias_restantes: diasRestantes, semaforo, en_pipeline: enPipeline, evento_inicio: eventoPorProyecto[String(p.proyecto_id)] || '' };
    });
    res.json(resultado);
  } catch (err) {
    console.error('Error obteniendo presupuestos:', err);
    res.status(500).json({ error: 'Error al obtener presupuestos desde ORUM CENTRAL' });
  }
});

// Leads: sin filtro por comercial_filtro (la hoja de marketing no asigna
// comercial por fila) — visibles para cualquier usuario logueado, incluido
// rol Comercial, ya que forman parte de su propio apartado.
app.get('/api/leads', requiereLogin, async (req, res) => {
  try {
    const resultado = await llamarOrumCentral('leads');
    res.json(resultado);
  } catch (err) {
    console.error('Error obteniendo leads:', err);
    res.status(500).json({ error: 'Error al obtener leads desde ORUM CENTRAL' });
  }
});

// ── DETALLE DE UN PROYECTO: material + servicios adicionales ──
// Botón 📦 en Proyectos/Presupuestos (mismo dato que ya se ve en Rutas, con
// el desglose de transporte/personal-montaje/seguro/otros/venta añadido).
app.get('/api/proyecto/detalle-material', requiereLogin, async (req, res) => {
  try {
    const proyectoId = String(req.query.proyecto_id || '');
    if (!proyectoId) return res.status(400).json({ error: 'Falta proyecto_id' });
    const detalle = await obtenerDetalleProyecto(proyectoId);
    res.json({ ok: true, ...detalle });
  } catch (err) {
    console.error('Error en GET /api/proyecto/detalle-material:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/financiero', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const [proyectosResp, facturasResp, cajaResp] = await Promise.all([
      llamarOrumCentral('proyectos'),
      llamarOrumCentral('facturas'),
      llamarOrumCentral('caja')
    ]);

    const proyectos = proyectosResp.data || [];
    const facturas = facturasResp.data || [];
    const registros = cajaResp.registros || [];
    const ncConfirmaciones = cajaResp.nc_confirmaciones || [];
    const ncFormulario = cajaResp.nc_formulario || [];

    const proyectoPorId = {};
    proyectos.forEach(p => { proyectoPorId[String(p.id)] = p; });

    const facturaPorNumero = {};
    facturas.forEach(f => { facturaPorNumero[String(f.numero)] = f; });

    const registrosPorNumeroFactura = {};
    registros.forEach(r => {
      const num = String(r.numero);
      if (!registrosPorNumeroFactura[num]) registrosPorNumeroFactura[num] = [];
      registrosPorNumeroFactura[num].push(r);
    });

    const ncPorNumeroProyecto = {};
    ncFormulario.forEach(r => {
      const num = String(r['Nº Proyecto']);
      if (!ncPorNumeroProyecto[num]) ncPorNumeroProyecto[num] = [];
      ncPorNumeroProyecto[num].push(r);
    });

    // Incluye las variantes "fianza-..." (1 sep 2026, caja-orum): fianza
    // aplicada al pago en vez de devuelta - cuenta como dinero real en Caja
    // igual que su equivalente normal, mismo tipo/ubicación de origen.
    const FORMAS_PAGO_REALES = ['transferencia', 'efectivo-marbella', 'efectivo-monda', 'tpv-marbella', 'tpv-monda', 'fianza-efectivo-marbella', 'fianza-efectivo-monda', 'fianza-transferencia'];
    const cruceFacturas = facturas.map(f => {
      const proyecto = proyectoPorId[String(f.proyecto_id)] || null;
      const pagosCaja = registrosPorNumeroFactura[String(f.numero)] || [];
      const primerPago = pagosCaja[0] || null;
      const esRectificativaACero = primerPago && primerPago.metodo_pago === 'factura0';
      const importeFactura = Math.round((parseFloat(f.importe_con_iva) || 0) * 100) / 100;
      const importeCobradoReal = Math.round(pagosCaja.reduce((sum, p) => sum + (parseFloat(p.importe) || 0), 0) * 100) / 100;
      const difFacturaCobro = Math.round((importeFactura - importeCobradoReal) * 100) / 100;

      let diasRetraso = null;
      if (f.esta_pagada !== 'SI' && f.fecha_vencimiento) {
        const partes = f.fecha_vencimiento.split('/');
        if (partes.length === 3) {
          const vencimiento = new Date(partes[2], partes[1] - 1, partes[0]);
          const hoyLocal = new Date();
          hoyLocal.setHours(0, 0, 0, 0);
          diasRetraso = Math.floor((hoyLocal - vencimiento) / (1000 * 60 * 60 * 24));
        }
      }

      return {
        factura_id: f.factura_id, numero_factura: f.numero, proyecto_id: f.proyecto_id,
        proyecto_numero: proyecto ? proyecto.numero : null, cliente: f.cliente,
        comercial: proyecto ? proyecto.comercial : null, estado_proyecto: proyecto ? proyecto.estado : null,
        fecha_entrega: proyecto ? proyecto.entrega_fecha : null, fecha_emision: f.fecha_emision,
        fecha_vencimiento: f.fecha_vencimiento, dias_retraso: diasRetraso,
        importe_con_iva: importeFactura, importe_cobrado_real: importeCobradoReal,
        diferencia_factura_cobro: difFacturaCobro, cuadra_con_cobro: Math.abs(difFacturaCobro) < 0.05,
        esta_pagada: f.esta_pagada, pendiente_cobro: f.pendiente_cobro, pagos_caja: pagosCaja,
        forma_pago: primerPago ? primerPago.metodo_pago : null, es_rectificativa_a_cero: esRectificativaACero,
        forma_pago_real: primerPago && FORMAS_PAGO_REALES.includes(primerPago.metodo_pago) ? primerPago.metodo_pago : null,
        sin_registro_caja: pagosCaja.length === 0 && f.esta_pagada === 'SI'
      };
    });

    const proyectosPNC = proyectos.filter(p => p.es_abrebotellas === 'SI' || p.es_abrebotellas === true);
    const crucePNC = proyectosPNC.map(p => {
      const cobros = ncPorNumeroProyecto[String(p.numero)] || [];
      const totalCobrado = cobros.reduce((sum, c) => sum + (parseFloat(c['Importe']) || 0), 0);
      const valorEsperado = parseFloat(p.valor) || 0;
      const diferencia = Math.round((valorEsperado - totalCobrado) * 100) / 100;
      return {
        numero: p.numero, cliente: p.cliente, comercial: p.comercial, estado: p.estado,
        fecha_entrega: p.entrega_fecha, valor_esperado: valorEsperado,
        total_cobrado_formulario: Math.round(totalCobrado * 100) / 100,
        diferencia, cuadra: Math.abs(diferencia) < 0.05, cobros_formulario: cobros
      };
    });

    const IVA = 1.21;
    const facturasPorProyectoId = {};
    cruceFacturas.forEach(cf => {
      const pid = String(cf.proyecto_id);
      if (!facturasPorProyectoId[pid]) facturasPorProyectoId[pid] = [];
      facturasPorProyectoId[pid].push(cf);
    });

    const cruceProyectos = proyectos.map(p => {
      const esPNC = p.es_abrebotellas === 'SI' || p.es_abrebotellas === true;
      const valorSinIva = Math.round((parseFloat(p.valor) || 0) * 100) / 100;
      if (esPNC) {
        const cobros = ncPorNumeroProyecto[String(p.numero)] || [];
        const totalCobrado = Math.round(cobros.reduce((sum, c) => sum + (parseFloat(c['Importe']) || 0), 0) * 100) / 100;
        const formasPagoPNC = [...new Set(cobros.map(c => c['Método']).filter(Boolean))];
        return {
          id: p.id, numero: p.numero, cliente: p.cliente, comercial: p.comercial,
          estado: p.estado, fecha_entrega: p.entrega_fecha, es_pnc: true,
          valor_proyecto_sin_iva: valorSinIva, valor_proyecto: valorSinIva,
          total_facturado: 0, total_cobrado: totalCobrado, pendiente_facturar: 0,
          pendiente_cobrar: Math.round((valorSinIva - totalCobrado) * 100) / 100, formas_pago: formasPagoPNC
        };
      } else {
        const valorConIva = Math.round(valorSinIva * IVA * 100) / 100;
        const facturasDelProyecto = facturasPorProyectoId[String(p.id)] || [];
        const totalFacturado = Math.round(facturasDelProyecto.reduce((sum, f) => sum + (parseFloat(f.importe_con_iva) || 0), 0) * 100) / 100;
        const totalCobrado = Math.round(facturasDelProyecto.reduce((sum, f) => sum + (parseFloat(f.importe_cobrado_real) || 0), 0) * 100) / 100;
        const formasPagoNormales = [...new Set(facturasDelProyecto.map(f => f.sin_registro_caja ? 'Sin registro' : (f.es_rectificativa_a_cero ? 'Rectificativa' : f.forma_pago)).filter(Boolean))];
        return {
          id: p.id, numero: p.numero, cliente: p.cliente, comercial: p.comercial,
          estado: p.estado, fecha_entrega: p.entrega_fecha, es_pnc: false,
          valor_proyecto_sin_iva: valorSinIva, valor_proyecto: valorConIva,
          total_facturado: totalFacturado, total_cobrado: totalCobrado,
          pendiente_facturar: Math.round((valorConIva - totalFacturado) * 100) / 100,
          pendiente_cobrar: Math.round((totalFacturado - totalCobrado) * 100) / 100,
          formas_pago: formasPagoNormales
        };
      }
    });

    const hoy = new Date();
    let totalFacturado = 0, totalCobrado = 0, totalPendiente = 0, totalVencidas = 0;
    const desglosePorFormaPago = {};
    facturas.forEach(f => {
      const importe = parseFloat(f.importe_con_iva) || 0;
      totalFacturado += importe;
      if (f.esta_pagada === 'SI') {
        totalCobrado += importe;
      } else {
        totalPendiente += parseFloat(f.pendiente_cobro) || 0;
        const vencimiento = f.fecha_vencimiento ? new Date(f.fecha_vencimiento.split('/').reverse().join('-')) : null;
        if (vencimiento && vencimiento < hoy) totalVencidas += parseFloat(f.pendiente_cobro) || 0;
      }
    });
    cruceFacturas.forEach(cf => {
      if (cf.forma_pago_real) {
        const pago = cf.pagos_caja[0];
        const importe = Math.abs(parseFloat(pago.importe) || 0);
        desglosePorFormaPago[cf.forma_pago_real] = (desglosePorFormaPago[cf.forma_pago_real] || 0) + importe;
      }
    });

    const kpis = {
      total_facturado: Math.round(totalFacturado * 100) / 100,
      total_cobrado: Math.round(totalCobrado * 100) / 100,
      total_pendiente: Math.round(totalPendiente * 100) / 100,
      total_vencidas: Math.round(totalVencidas * 100) / 100,
      desglose_forma_pago: Object.keys(desglosePorFormaPago).map(k => ({ forma_pago: k, total: Math.round(desglosePorFormaPago[k] * 100) / 100 }))
    };

    const facturadoPorComercial = {};
    cruceFacturas.forEach(cf => {
      if (!cf.comercial) return;
      facturadoPorComercial[cf.comercial] = (facturadoPorComercial[cf.comercial] || 0) + (parseFloat(cf.importe_con_iva) || 0);
    });
    const desgloseComercial = Object.keys(facturadoPorComercial)
      .map(c => ({ comercial: c, total: Math.round(facturadoPorComercial[c] * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    const pendientePorCliente = {};
    cruceProyectos.forEach(p => {
      if (p.pendiente_cobrar <= 0.05) return;
      const clave = p.cliente || 'Sin cliente';
      if (!pendientePorCliente[clave]) pendientePorCliente[clave] = { cliente: clave, comercial: p.comercial, pendiente: 0, proyectos: [] };
      pendientePorCliente[clave].pendiente += p.pendiente_cobrar;
      pendientePorCliente[clave].proyectos.push(p.numero);
    });
    const topClientesPendientes = Object.values(pendientePorCliente)
      .map(c => ({ ...c, pendiente: Math.round(c.pendiente * 100) / 100 }))
      .sort((a, b) => b.pendiente - a.pendiente).slice(0, 20);

    const pncCuadran = crucePNC.filter(p => p.cuadra).length;
    const proyectosPendientesFacturar = cruceProyectos.filter(p => !p.es_pnc && Math.abs(p.pendiente_facturar) >= 0.05).length;
    const facturasVencidas = cruceFacturas.filter(f => f.dias_retraso !== null && f.dias_retraso > 0).sort((a, b) => b.dias_retraso - a.dias_retraso);
    const auditoria = {
      facturas_sin_registro: cruceFacturas.filter(f => f.sin_registro_caja),
      pnc_no_cuadran: crucePNC.filter(p => !p.cuadra),
      proyectos_pendientes_facturar: cruceProyectos.filter(p => !p.es_pnc && Math.abs(p.pendiente_facturar) >= 0.05)
    };

    res.json({
      kpis, desglose_comercial: desgloseComercial, top_clientes_pendientes: topClientesPendientes,
      total_proyectos: proyectos.length, total_facturas: facturas.length,
      total_proyectos_pnc: proyectosPNC.length, pnc_cuadran: pncCuadran,
      total_registros_caja: registros.length, total_nc_formulario: ncFormulario.length,
      total_nc_confirmaciones: ncConfirmaciones.length,
      facturas_sin_registro_caja: cruceFacturas.filter(f => f.sin_registro_caja).length,
      pnc_que_no_cuadran: crucePNC.filter(p => !p.cuadra).length,
      proyectos_pendientes_facturar: proyectosPendientesFacturar,
      facturas_vencidas: facturasVencidas, auditoria,
      cruce_proyectos: cruceProyectos, cruce_facturas: cruceFacturas,
      cruce_pnc: crucePNC, nc_confirmaciones: ncConfirmaciones
    });
  } catch (err) {
    console.error('Error en /api/financiero:', err);
    res.status(500).json({ error: 'Error al cruzar datos financieros: ' + err.message });
  }
});

// ================================================================
// PREPARACIÓN — Lavandería / Office / Almacén
// ================================================================

const ESTADOS_EXCLUIR_NOMBRE = ['pending', 'concept', 'inquiry', 'cancelado', 'canceled'].map(normalizarTexto);
const ESTADOS_LISTO_NOMBRE = ['returned', 'cargado', 'marbella', 'on location', 'controlado', 'preparado'].map(normalizarTexto);

function normalizarTexto(str) {
  return (str || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const FAMILIAS_LAVANDERIA = ['manteleria'].map(normalizarTexto);
const FAMILIAS_OFFICE = ['cuberteria', 'cristaleria', 'buffet', 'vajilla', 'catering'].map(normalizarTexto);

function familiaPerteneceA(familia, listaNormalizada) {
  const f = normalizarTexto(familia);
  return listaNormalizada.some(x => f.indexOf(x) !== -1 || x.indexOf(f) !== -1);
}

function parsearFechaDDMMYYYY(str) {
  if (!str) return null;
  const partes = String(str).split('/');
  if (partes.length !== 3) return null;
  return new Date(partes[2], partes[1] - 1, partes[0]);
}

function inicioDelDia(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function lunesDeLaSemana(d) {
  const x = inicioDelDia(d);
  const dia = x.getDay() || 7;
  x.setDate(x.getDate() - dia + 1);
  return x;
}

function clasificarPeriodo(fechaEntrega, modo) {
  if (!fechaEntrega) return null;
  const hoy = inicioDelDia(new Date());
  const fecha = inicioDelDia(fechaEntrega);
  const diffDias = Math.round((fecha - hoy) / 86400000);
  if (modo === 'semanas') {
    if (diffDias === 0) return 'HOY';
    if (diffDias === 1) return 'MAÑANA';
    const lunesEstaSemana = lunesDeLaSemana(hoy);
    const lunesProxima = new Date(lunesEstaSemana); lunesProxima.setDate(lunesProxima.getDate() + 7);
    const lunesSiguiente = new Date(lunesProxima); lunesSiguiente.setDate(lunesSiguiente.getDate() + 7);
    if (fecha >= lunesEstaSemana && fecha < lunesProxima) return 'ESTA SEMANA';
    if (fecha >= lunesProxima && fecha < lunesSiguiente) return 'PRÓXIMA SEMANA';
    return null;
  } else {
    if (diffDias === 0) return 'HOY';
    if (diffDias === 1) return 'MAÑANA';
    if (diffDias === 2) return 'PASADO MAÑANA';
    if (diffDias >= 3 && diffDias <= 7) return 'PRÓXIMOS 5 DÍAS';
    return null;
  }
}

const ORDEN_PERIODOS_SEMANAS = ['HOY', 'MAÑANA', 'ESTA SEMANA', 'PRÓXIMA SEMANA'];
const ORDEN_PERIODOS_DIAS = ['HOY', 'MAÑANA', 'PASADO MAÑANA', 'PRÓXIMOS 5 DÍAS'];

// Función reutilizable para construir la respuesta de preparación
async function construirRespuestaPreparacion(vista) {
  const modo = vista === 'almacen' ? 'dias' : 'semanas';
  const ordenPeriodos = modo === 'dias' ? ORDEN_PERIODOS_DIAS : ORDEN_PERIODOS_SEMANAS;

  const [proyectosResp, equipmentResp] = await Promise.all([
    llamarOrumCentral('proyectos'),
    llamarOrumCentral('equipment')
  ]);

  const proyectos = (proyectosResp.data || []).filter(p => p.cancelado !== 'SI');
  const proyectosConfirmados = proyectos.filter(p => !ESTADOS_EXCLUIR_NOMBRE.includes(normalizarTexto(p.estado)));
  const proyectoPorId = {};
  proyectosConfirmados.forEach(p => { proyectoPorId[String(p.id)] = p; });

  const equipment = equipmentResp.data || [];
  let equipmentFiltrado = equipment;
  if (vista === 'lavanderia') equipmentFiltrado = equipment.filter(e => familiaPerteneceA(e.familia, FAMILIAS_LAVANDERIA));
  else if (vista === 'office') equipmentFiltrado = equipment.filter(e => familiaPerteneceA(e.familia, FAMILIAS_OFFICE));
  equipmentFiltrado = equipmentFiltrado.filter(e => proyectoPorId[String(e.proyecto_id)]);

  const idsProyectosConEquipo = new Set(equipmentFiltrado.map(e => String(e.proyecto_id)));
  const proyectosVista = vista === 'almacen'
    ? proyectosConfirmados
    : proyectosConfirmados.filter(p => idsProyectosConEquipo.has(String(p.id)));

  const porProyecto = {};
  ordenPeriodos.forEach(per => { porProyecto[per] = { confirmado: [], preparado: [] }; });
  proyectosVista.forEach(p => {
    const fechaEntrega = parsearFechaDDMMYYYY(p.entrega_fecha);
    const periodo = clasificarPeriodo(fechaEntrega, modo);
    if (!periodo) return;
    const estaListo = ESTADOS_LISTO_NOMBRE.includes(normalizarTexto(p.estado));
    const item = { id: p.id, numero: p.numero, cliente: p.cliente, comercial: p.comercial, estado: p.estado, fecha_entrega: p.entrega_fecha, entrega_hora: p.entrega_hora, localizacion: p.localizacion, es_nuevo_hoy: false };
    if (estaListo) porProyecto[periodo].preparado.push(item);
    else porProyecto[periodo].confirmado.push(item);
  });

  const porMaterial = {};
  equipmentFiltrado.forEach(e => {
    const proyecto = proyectoPorId[String(e.proyecto_id)];
    if (!proyecto) return;
    const fechaEntrega = parsearFechaDDMMYYYY(proyecto.entrega_fecha);
    const periodo = clasificarPeriodo(fechaEntrega, modo);
    if (!periodo) return;
    const familia = e.familia || 'Sin familia';
    const articulo = e.articulo || 'Sin artículo';
    if (!porMaterial[familia]) porMaterial[familia] = {};
    if (!porMaterial[familia][articulo]) porMaterial[familia][articulo] = { total: 0, detalle: [] };
    const cantidad = parseFloat(e.cantidad) || 0;
    porMaterial[familia][articulo].total += cantidad;
    porMaterial[familia][articulo].detalle.push({ proyecto_numero: proyecto.numero, cliente: proyecto.cliente, fecha_entrega: proyecto.entrega_fecha, periodo, cantidad });
  });

  const porMaterialArray = Object.keys(porMaterial).sort().map(familia => ({
    familia,
    articulos: Object.keys(porMaterial[familia]).sort().map(articulo => ({
      articulo,
      total: Math.round(porMaterial[familia][articulo].total * 100) / 100,
      detalle: porMaterial[familia][articulo].detalle.sort((a, b) => ordenPeriodos.indexOf(a.periodo) - ordenPeriodos.indexOf(b.periodo))
    }))
  }));

  const resumenPeriodos = ordenPeriodos.map(per => {
    const confirmado = porProyecto[per].confirmado.length;
    const preparado = porProyecto[per].preparado.length;
    return { periodo: per, listos: preparado, total: confirmado + preparado, pendientes: confirmado };
  });

  const equipmentDetalle = equipmentFiltrado.map(e => ({
    proyecto_id: e.proyecto_id, familia: e.familia || 'Sin familia',
    articulo: e.articulo || '', cantidad: parseFloat(e.cantidad) || 0
  }));

  const respuesta = { vista, modo, orden_periodos: ordenPeriodos, resumen_periodos: resumenPeriodos, por_proyecto: porProyecto, por_material: porMaterialArray, equipment_detalle: equipmentDetalle, ultima_actualizacion: proyectosResp.ultima_actualizacion };

  if (vista === 'almacen') {
    const serviciosResp = await llamarOrumCentral('servicios');
    const servicios = serviciosResp.data || [];
    const hoyMs = inicioDelDia(new Date()).getTime();
    const limite14diasMs = hoyMs + 14 * 86400000;
    const serviciosVentana = servicios.filter(s => {
      const fecha = parsearFechaDDMMYYYY(s.fecha_entrega);
      if (!fecha) return false;
      const fechaMs = inicioDelDia(fecha).getTime();
      return fechaMs >= hoyMs && fechaMs <= limite14diasMs;
    }).map(s => ({ proyecto_numero: s.numero, cliente: (proyectoPorId[String(s.proyecto_id)] || {}).cliente || '', servicio: s.servicio, cantidad: s.cantidad, fecha_entrega: s.fecha_entrega }));

    const porCliente = {};
    serviciosVentana.forEach(s => { const c = s.cliente || 'Sin cliente'; if (!porCliente[c]) porCliente[c] = []; porCliente[c].push(s); });
    const porTipo = {};
    serviciosVentana.forEach(s => { const t = s.servicio || 'Sin especificar'; if (!porTipo[t]) porTipo[t] = []; porTipo[t].push(s); });

    respuesta.servicios = {
      por_cliente: Object.keys(porCliente).sort().map(c => ({ cliente: c, items: porCliente[c].sort((a, b) => (a.fecha_entrega || '').localeCompare(b.fecha_entrega || '')) })),
      por_tipo: Object.keys(porTipo).sort().map(t => ({ tipo: t, items: porTipo[t].sort((a, b) => (a.fecha_entrega || '').localeCompare(b.fecha_entrega || '')) }))
    };

    const idsLavanderia = new Set(equipment.filter(e => familiaPerteneceA(e.familia, FAMILIAS_LAVANDERIA)).map(e => String(e.proyecto_id)));
    const idsOffice = new Set(equipment.filter(e => familiaPerteneceA(e.familia, FAMILIAS_OFFICE)).map(e => String(e.proyecto_id)));
    const proyectosEnVentana = proyectosConfirmados.filter(p => {
      const fecha = parsearFechaDDMMYYYY(p.entrega_fecha);
      if (!fecha) return false;
      const fechaMs = inicioDelDia(fecha).getTime();
      return fechaMs >= hoyMs && fechaMs <= limite14diasMs;
    });
    const mapear = p => ({ id: p.id, numero: p.numero, cliente: p.cliente, fecha_entrega: p.entrega_fecha, estado: p.estado });
    respuesta.logistica = {
      lavanderia: proyectosEnVentana.filter(p => idsLavanderia.has(String(p.id))).map(mapear).sort((a, b) => (a.fecha_entrega || '').localeCompare(b.fecha_entrega || '')),
      office: proyectosEnVentana.filter(p => idsOffice.has(String(p.id))).map(mapear).sort((a, b) => (a.fecha_entrega || '').localeCompare(b.fecha_entrega || ''))
    };
  }

  return respuesta;
}

app.get('/api/preparacion', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const vista = req.query.vista || 'almacen';
    res.json(await construirRespuestaPreparacion(vista));
  } catch (err) {
    console.error('Error en /api/preparacion:', err);
    res.status(500).json({ error: 'Error al construir vista de preparación: ' + err.message });
  }
});

// ── Tokens de acceso por perfil (sin login) ──
const TOKENS_PREPARACION = { 'ORUMx2026Lav': 'lavanderia', 'ORUMx2026Off': 'office', 'ORUMx2026Alm': 'almacen' };

app.get('/api/preparacion-publica', async (req, res) => {
  const token = req.query.token || '';
  const perfil = TOKENS_PREPARACION[token];
  if (!perfil) return res.status(401).json({ error: 'Acceso no autorizado' });
  try {
    const vistasPermitidas = { lavanderia: ['lavanderia'], office: ['office'], almacen: ['almacen', 'lavanderia', 'office'] };
    const vistaParam = req.query.vista || perfil;
    const vista = (vistasPermitidas[perfil] || []).includes(vistaParam) ? vistaParam : perfil;
    res.json(await construirRespuestaPreparacion(vista));
  } catch (err) {
    console.error('Error en /api/preparacion-publica:', err);
    res.status(500).json({ error: 'Error al construir vista: ' + err.message });
  }
});

app.get('/preparacion', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'preparacion.html'));
});

app.get('/sync-status', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sync-status.html'));
});

// ================================================================
// RUTAS — endpoints
// ================================================================

app.get('/api/rutas', async (req, res) => {
  if (req.query.token !== 'ORUMx2026RutasPublic' && !req.session.usuario) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const { desde, hasta } = req.query;
    // Antes: llamaba a Apps Script en directo (10+ s). Ahora: Supabase,
    // con las asignaciones/paradas manuales ya sincronizadas en tiempo
    // real (ver parche de rutasSetAsignacion/rutasAddParadaManual/etc.
    // en OrumCentral.gs), así que no hay pérdida de frescura.
    const data = await llamarOrumCentralSupabase('rutas', { desde, hasta });
    res.json(data);
  } catch (err) {
    console.error('Error en /api/rutas:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rutas/manual', async (req, res) => {
  if (req.body.clientToken !== 'ORUMx2026RutasPublic' && !req.session.usuario) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const usuario = req.session.usuario ? (req.session.usuario.nombre || req.session.usuario.usuario) : (req.body.usuario || 'Logistica');
    const body = { ...req.body, token: 'ORUMx2026RutasWrite', usuario };
    const resp = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await resp.json();
    logHistorialRutas(usuario, req.body.action || 'set_asignacion', {
      clave: req.body.clave, id: req.body.id, proyecto_id: req.body.proyecto_id, tipo: req.body.tipo,
      fecha: req.body.fecha, vehiculo: req.body.vehiculo, vuelta: req.body.vuelta, notas: req.body.notas,
      descripcion: req.body.descripcion, direccion: req.body.direccion, numero: req.body.numero
    });
    res.json(data);
  } catch (err) {
    console.error('Error en /api/rutas/manual:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rutas/backup-hoy', async (req, res) => {
  if (req.body.clientToken !== 'ORUMx2026RutasPublic' && !req.session.usuario) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const usuario = req.session.usuario ? (req.session.usuario.nombre || req.session.usuario.usuario) : (req.body.usuario || 'Logistica');
    const body = { token: 'ORUMx2026RutasWrite', action: 'generar_backup_hoy', fecha: req.body.fecha || '', usuario };
    const resp = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await resp.json();
    logHistorialRutas(usuario, 'generar_backup_hoy', { fecha: req.body.fecha || '' });
    res.json(data);
  } catch (err) {
    console.error('Error en /api/rutas/backup-hoy:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── CONDUCTORES: asignación por vehículo+vuelta+día ──
// GET /api/rutas/conductores?desde=2026-07-13&hasta=2026-07-13
app.get('/api/rutas/conductores', async (req, res) => {
  if (req.query.token !== 'ORUMx2026RutasPublic' && !req.session.usuario) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const { desde, hasta } = req.query;
    if (!RUTAS_SCRIPT_URL) {
      // Si no está configurada la URL, devolver vacío en vez de error
      return res.json({ ok: true, asignaciones: [], choferes: [] });
    }
    const data = await llamarRutasScript('get_conductores', { desde: desde || '', hasta: hasta || '' });
    res.json(data);
  } catch (err) {
    console.error('Error en GET /api/rutas/conductores:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rutas/conductores — set_conductores o set_choferes
app.post('/api/rutas/conductores', async (req, res) => {
  if (req.body.token !== 'ORUMx2026RutasPublic' && !req.session.usuario) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const { action, ...resto } = req.body;
    console.log('POST /api/rutas/conductores — action:', action, '| body:', JSON.stringify(req.body));
    if (action !== 'set_conductores' && action !== 'set_choferes') {
      return res.status(400).json({ error: 'Accion no reconocida' });
    }
    if (!RUTAS_SCRIPT_URL) return res.json({ ok: true });
    const payload = { token: 'ORUMx2026RutasPublic', action, ...resto };
    console.log('Enviando a Apps Script:', JSON.stringify(payload));
    const resp = await fetch(RUTAS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    console.log('Respuesta Apps Script:', JSON.stringify(data));
    const usuarioLog = resto.usuario || (req.session.usuario ? (req.session.usuario.nombre || req.session.usuario.usuario) : 'Logistica');
    logHistorialRutas(usuarioLog, action, resto);
    res.json(data);
  } catch (err) {
    console.error('Error en POST /api/rutas/conductores:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── ESTADO DE VEHÍCULO: EN RUTA / FINALIZADO por vehiculo+vuelta+día ──
// GET /api/rutas/estado-vehiculos?desde=2026-07-13&hasta=2026-07-13
app.get('/api/rutas/estado-vehiculos', async (req, res) => {
  if (req.query.token !== 'ORUMx2026RutasPublic' && !req.session.usuario) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const { desde, hasta } = req.query;
    if (!RUTAS_SCRIPT_URL) return res.json({ ok: true, estados: [] });
    const params = new URLSearchParams({ token: RUTAS_SCRIPT_TOKEN, action: 'get_estado_vehiculos', desde: desde || '', hasta: hasta || '' });
    const resp = await fetch(`${RUTAS_SCRIPT_URL}?${params.toString()}`);
    res.json(await resp.json());
  } catch (err) {
    console.error('Error en GET /api/rutas/estado-vehiculos:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rutas/estado-vehiculos — el frontend solo lo llama con un PIN de rol logistica
app.post('/api/rutas/estado-vehiculos', async (req, res) => {
  if (req.body.token !== 'ORUMx2026RutasPublic' && !req.session.usuario) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const usuario = req.session.usuario ? (req.session.usuario.nombre || req.session.usuario.usuario) : (req.body.usuario || 'Logistica');
    if (!RUTAS_SCRIPT_URL) return res.json({ ok: true });
    const payload = { token: 'ORUMx2026RutasPublic', action: 'set_estado_vehiculo', fecha: req.body.fecha, vehiculo: req.body.vehiculo, vuelta: req.body.vuelta, estado: req.body.estado, usuario };
    const resp = await fetch(RUTAS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await resp.json();
    logHistorialRutas(usuario, 'set_estado_vehiculo', { fecha: req.body.fecha, vehiculo: req.body.vehiculo, vuelta: req.body.vuelta, estado: req.body.estado });
    res.json(data);
  } catch (err) {
    console.error('Error en POST /api/rutas/estado-vehiculos:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── ESTADOS DE PARADA: preparado / cargado / incidencia ──
app.get('/api/rutas/estados-parada', async (req, res) => {
  if (req.query.token !== 'ORUMx2026RutasPublic' && !req.session.usuario) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    if (!RUTAS_SCRIPT_URL) return res.json({ ok: true, estados: [] });
    const params = new URLSearchParams({ token: RUTAS_SCRIPT_TOKEN, action: 'get_estados_parada' });
    const resp = await fetch(`${RUTAS_SCRIPT_URL}?${params.toString()}`);
    res.json(await resp.json());
  } catch (err) {
    console.error('Error en GET /api/rutas/estados-parada:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── HISTORIAL DE CAMBIOS — solo lectura, usado por la pestaña "Historial" (Sergio) ──
app.get('/api/rutas/historial', async (req, res) => {
  if (req.query.token !== 'ORUMx2026RutasPublic' && !req.session.usuario) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    if (!RUTAS_SCRIPT_URL) return res.json({ ok: true, historial: [] });
    const params = new URLSearchParams({ token: RUTAS_SCRIPT_TOKEN, action: 'get_historial_rutas', limit: req.query.limit || '200' });
    const resp = await fetch(`${RUTAS_SCRIPT_URL}?${params.toString()}`);
    res.json(await resp.json());
  } catch (err) {
    console.error('Error en GET /api/rutas/historial:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rutas/estados-parada', async (req, res) => {
  if (req.body.token !== 'ORUMx2026RutasPublic' && !req.session.usuario) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const usuario = req.session.usuario ? (req.session.usuario.nombre || req.session.usuario.usuario) : (req.body.usuario || 'Logistica');
    if (!RUTAS_SCRIPT_URL) return res.json({ ok: true });
    const payload = { token: 'ORUMx2026RutasPublic', action: 'set_estado_parada', clave: req.body.clave, preparado: req.body.preparado, cargado: req.body.cargado, incidencia: req.body.incidencia, incidencia_texto: req.body.incidencia_texto, usuario };
    const resp = await fetch(RUTAS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await resp.json();
    logHistorialRutas(usuario, 'set_estado_parada', { clave: req.body.clave, preparado: req.body.preparado, cargado: req.body.cargado, incidencia: req.body.incidencia, incidencia_texto: req.body.incidencia_texto });
    res.json(data);
  } catch (err) {
    console.error('Error en POST /api/rutas/estados-parada:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── MATERIAL DE UN PROYECTO (para el detalle en Rutas) ──
// GET /api/rutas/material?proyecto_id=1234
app.get('/api/rutas/material', async (req, res) => {
  if (req.query.token !== 'ORUMx2026RutasPublic' && !req.session.usuario) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const proyectoId = String(req.query.proyecto_id || '');
    if (!proyectoId) return res.status(400).json({ error: 'Falta proyecto_id' });
    // Antes: traía las 11.000+ filas de Equipment enteras y filtraba en
    // memoria. Ahora: consulta indexada por proyecto_id directo en Supabase.
    const equipment = await obtenerMaterialDeProyecto(proyectoId);
    res.json({ ok: true, material: equipment });
  } catch (err) {
    console.error('Error en GET /api/rutas/material:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── ESTADÍSTICAS DE RUTAS & CONDUCTORES ──
// GET /api/rutas/estadisticas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Entregas/recogidas por conductor y por vehículo en un rango de fechas.
app.get('/api/rutas/estadisticas', requiereLogin, async (req, res) => {
  try {
    const { desde, hasta, nave } = req.query;
    const data = await obtenerEstadisticasRutas(desde || null, hasta || null, nave || null);
    res.json(data);
  } catch (err) {
    console.error('Error en GET /api/rutas/estadisticas:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── EVOLUCIÓN MENSUAL DE RUTAS (para la gráfica comparativa) ──
// Cada semana cuenta entera en el mes que tenga más días de esa semana -
// misma regla que usa el Informe Mensual, para que "mes" signifique lo
// mismo en todo el panel.
app.get('/api/rutas/evolucion-mensual', requiereLogin, async (req, res) => {
  try {
    const paradas = await obtenerParadasParaEvolucion();
    const porMes = {};
    paradas.forEach(r => {
      if (!r.fecha) return;
      const [y, m, d] = r.fecha.split('-').map(Number);
      const fecha = new Date(y, m - 1, d);
      const lunes = lunesDeLaSemana(fecha);
      const pertenece = mesConMasDias(lunes);
      const key = pertenece.anio + '-' + String(pertenece.mes).padStart(2, '0');
      if (!porMes[key]) porMes[key] = { anio: pertenece.anio, mes: pertenece.mes, entregas: 0, recogidas: 0, total: 0 };
      porMes[key].total++;
      if (r.tipo === 'ENTREGA') porMes[key].entregas++;
      else if (r.tipo === 'RECOGIDA') porMes[key].recogidas++;
    });
    const MESES_ES = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const meses = Object.keys(porMes).sort().map(k => {
      const m = porMes[k];
      return { label: MESES_ES[m.mes] + ' ' + m.anio, anio: m.anio, mes: m.mes, entregas: m.entregas, recogidas: m.recogidas, total: m.total };
    });
    res.json({ ok: true, meses });
  } catch (err) {
    console.error('Error en GET /api/rutas/evolucion-mensual:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── ESTADÍSTICAS DE MATERIAL ──
// Más/menos alquilado, lo que más ingresa por artículo/familia, y roturas.
app.get('/api/material/estadisticas', requiereLogin, async (req, res) => {
  try {
    const data = await obtenerEstadisticasMaterial();
    res.json(data);
  } catch (err) {
    console.error('Error en GET /api/material/estadisticas:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// FACTURAS PROVEEDORES
// ================================================================

const APPS_SCRIPT_FACTURAS_URL = process.env.APPS_SCRIPT_FACTURAS_URL || 'PEGA_AQUI_LA_URL_DEL_SCRIPT_DE_FACTURAS';
const APPS_SCRIPT_FACTURAS_TOKEN = 'ORUMx2026#Facturas$Sync';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

async function extraerDatosFactura(base64Pdf, nombreArchivo, proveedor) {
  const prompt = `Esta es una factura del proveedor "${proveedor}" (archivo: ${nombreArchivo}).
Extrae exactamente estos datos y responde SOLO con un JSON válido, sin texto adicional ni markdown:
{
  "numeroFactura": "número de factura tal como aparece",
  "fecha": "fecha de la factura en formato DD/MM/YYYY",
  "importeBase": número base imponible de la factura (SIN IVA), como número decimal sin símbolo de moneda,
  "iva": importe del IVA aplicado, como número decimal,
  "importeTotal": número total de la factura CON IVA incluido, como número decimal,
  "confianza": "alta" o "media" o "baja" según lo clara/legible que esté la factura
}
Si la factura no desglosa IVA (por ejemplo recargo de equivalencia, régimen especial, o un proveedor exento), pon "iva": 0 y "importeBase" igual a "importeTotal".`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
        { type: 'text', text: prompt }
      ]}]
    })
  });

  const data = await response.json();
  const textoRespuesta = (data.content || []).find(b => b.type === 'text');
  if (!textoRespuesta) throw new Error('Respuesta de Claude sin texto: ' + JSON.stringify(data));

  const limpio = textoRespuesta.text.replace(/```json|```/g, '').trim();
  const extraido = JSON.parse(limpio);
  const base = parseFloat(extraido.importeBase) || 0;
  const iva = parseFloat(extraido.iva) || 0;
  extraido.importeBase = Math.round(base * 100) / 100;
  extraido.iva = Math.round(iva * 100) / 100;
  extraido.importeTotal = Math.round((base + iva) * 100) / 100;
  return extraido;
}

// Sacado a función aparte (28 ago 2026) para poder llamarla tanto desde el
// botón manual como desde la sincronización automática diaria de abajo.
async function sincronizarFacturasProveedoresInterno(anio) {
  const paramsLista = new URLSearchParams({ token: APPS_SCRIPT_FACTURAS_TOKEN, action: 'listaPendientes', anio });
  const respLista = await fetch(`${APPS_SCRIPT_FACTURAS_URL}?${paramsLista.toString()}`);
  const dataLista = await respLista.json();
  if (dataLista.error) throw new Error('Error listando pendientes: ' + dataLista.error);

  const pendientes = dataLista.pendientes || [];
  const resultados = [], errores = [];

  for (const item of pendientes) {
    try {
      const paramsDescarga = new URLSearchParams({ token: APPS_SCRIPT_FACTURAS_TOKEN, action: 'descargarArchivo', fileId: item.fileId });
      const respDescarga = await fetch(`${APPS_SCRIPT_FACTURAS_URL}?${paramsDescarga.toString()}`);
      const dataDescarga = await respDescarga.json();
      if (dataDescarga.error) { errores.push({ fileId: item.fileId, nombreArchivo: item.nombreArchivo, error: dataDescarga.error }); continue; }

      const extraido = await extraerDatosFactura(dataDescarga.base64, item.nombreArchivo, item.proveedor);
      await fetch(APPS_SCRIPT_FACTURAS_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: APPS_SCRIPT_FACTURAS_TOKEN, fileId: item.fileId, proveedor: item.proveedor, nombreArchivo: item.nombreArchivo, numeroFactura: extraido.numeroFactura, fecha: extraido.fecha, importeBase: extraido.importeBase, iva: extraido.iva, importeTotal: extraido.importeTotal, confianza: extraido.confianza })
      });
      resultados.push({ ...item, ...extraido });
    } catch (errItem) {
      errores.push({ fileId: item.fileId, nombreArchivo: item.nombreArchivo, error: errItem.message });
    }
  }

  return { total_pendientes: pendientes.length, procesadas: resultados.length, con_error: errores.length, resultados, errores };
}

app.post('/api/facturas-proveedores/sincronizar', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const anio = req.query.anio || String(new Date().getFullYear());
    const resultado = await sincronizarFacturasProveedoresInterno(anio);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    console.error('Error en /api/facturas-proveedores/sincronizar:', err);
    res.status(500).json({ error: 'Error al sincronizar facturas: ' + err.message });
  }
});

// ── Sincronización automática diaria a las 6:00 (hora de Madrid) ──
// Pedido explícito del usuario: que siempre esté al día sin tener que
// acordarse de pulsar el botón. El botón manual se deja tal cual, por si
// hace falta forzarla antes de las 6:00 de un día concreto.
function msHastaProximaHoraMadrid(horaObjetivo) {
  const ahoraMadrid = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Madrid' }));
  const objetivo = new Date(ahoraMadrid);
  objetivo.setHours(horaObjetivo, 0, 0, 0);
  if (objetivo <= ahoraMadrid) objetivo.setDate(objetivo.getDate() + 1);
  return objetivo.getTime() - ahoraMadrid.getTime();
}
function programarSincronizacionDiariaFacturas() {
  const delay = msHastaProximaHoraMadrid(6);
  setTimeout(async () => {
    try {
      console.log('[Facturas Proveedores] Sincronización automática (06:00 Madrid) iniciando...');
      const anio = String(new Date().getFullYear());
      const resultado = await sincronizarFacturasProveedoresInterno(anio);
      console.log(`[Facturas Proveedores] Sincronización automática completada: ${resultado.procesadas} nuevas, ${resultado.con_error} con error (de ${resultado.total_pendientes} pendientes).`);
    } catch (err) {
      console.error('[Facturas Proveedores] Error en sincronización automática:', err.message);
    } finally {
      programarSincronizacionDiariaFacturas(); // se reprograma sola para el día siguiente
    }
  }, delay);
  console.log(`[Facturas Proveedores] Próxima sincronización automática en ${Math.round(delay / 60000)} min.`);
}
if (APPS_SCRIPT_FACTURAS_URL && APPS_SCRIPT_FACTURAS_URL !== 'PEGA_AQUI_LA_URL_DEL_SCRIPT_DE_FACTURAS') {
  programarSincronizacionDiariaFacturas();
}

app.get('/api/facturas-proveedores', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const paramsListado = new URLSearchParams({ token: APPS_SCRIPT_FACTURAS_TOKEN, action: 'listado' });
    const paramsReparto = new URLSearchParams({ token: APPS_SCRIPT_FACTURAS_TOKEN, action: 'reparto' });
    const [respListado, respReparto] = await Promise.all([fetch(`${APPS_SCRIPT_FACTURAS_URL}?${paramsListado.toString()}`), fetch(`${APPS_SCRIPT_FACTURAS_URL}?${paramsReparto.toString()}`)]);
    const dataListado = await respListado.json();
    const dataReparto = await respReparto.json();
    if (dataListado.error) return res.status(500).json({ error: dataListado.error });
    if (dataReparto.error) return res.status(500).json({ error: dataReparto.error });

    const facturas = dataListado.facturas || [];
    const reparto = dataReparto.reparto || [];
    const repartoPorProveedor = {};
    reparto.forEach(r => {
      const prov = String(r.proveedor);
      if (!repartoPorProveedor[prov]) repartoPorProveedor[prov] = [];
      repartoPorProveedor[prov].push({ departamento: r.departamento, porcentaje: parseFloat(r.porcentaje) || 0 });
    });

    const facturasEnriquecidas = facturas.map(f => {
      const base = parseFloat(f.importeBase) || 0;
      const reglas = repartoPorProveedor[String(f.proveedor)] || null;
      const desglose = reglas
        ? reglas.map(r => ({ departamento: r.departamento, porcentaje: r.porcentaje, importe: Math.round(base * (r.porcentaje / 100) * 100) / 100 }))
        : [{ departamento: 'Sin clasificar', porcentaje: 100, importe: base }];
      return { ...f, desglose_departamentos: desglose };
    });

    const totalesPorDepartamento = {};
    facturasEnriquecidas.forEach(f => f.desglose_departamentos.forEach(d => { totalesPorDepartamento[d.departamento] = (totalesPorDepartamento[d.departamento] || 0) + d.importe; }));
    const resumenDepartamentos = Object.keys(totalesPorDepartamento).map(dep => ({ departamento: dep, total: Math.round(totalesPorDepartamento[dep] * 100) / 100 })).sort((a, b) => b.total - a.total);

    res.json({ ok: true, facturas: facturasEnriquecidas, resumen_departamentos: resumenDepartamentos, proveedores_sin_clasificar: [...new Set(facturasEnriquecidas.filter(f => !repartoPorProveedor[String(f.proveedor)]).map(f => f.proveedor))] });
  } catch (err) {
    console.error('Error en /api/facturas-proveedores:', err);
    res.status(500).json({ error: 'Error al obtener facturas: ' + err.message });
  }
});

app.get('/api/facturas-proveedores/proveedores', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const params = new URLSearchParams({ token: APPS_SCRIPT_FACTURAS_TOKEN, action: 'proveedores' });
    const resp = await fetch(`${APPS_SCRIPT_FACTURAS_URL}?${params.toString()}`);
    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/facturas-proveedores/reparto', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const params = new URLSearchParams({ token: APPS_SCRIPT_FACTURAS_TOKEN, action: 'reparto' });
    const resp = await fetch(`${APPS_SCRIPT_FACTURAS_URL}?${params.toString()}`);
    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/facturas-proveedores/reparto', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const reparto = req.body.reparto || [];
    const resp = await fetch(APPS_SCRIPT_FACTURAS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: APPS_SCRIPT_FACTURAS_TOKEN, accion: 'guardarReparto', reparto }) });
    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// NUEVO (28 ago 2026): gestión de las 4 columnas manuales (Forma de Pago,
// Contabilizada, Digitalizada, Matrícula) desde el propio panel, para que
// contabilidad no tenga que tocar la Sheet directamente.
const CAMPOS_FACTURA_EDITABLES = ['proveedor', 'numeroFactura', 'fecha', 'importeBase', 'iva', 'importeTotal', 'formaPago', 'contabilizada', 'digitalizada', 'matricula'];
app.post('/api/facturas-proveedores/actualizar', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const { fileId, campo, valor } = req.body;
    if (!fileId) return res.status(400).json({ error: 'fileId requerido' });
    if (!CAMPOS_FACTURA_EDITABLES.includes(campo)) return res.status(400).json({ error: 'Campo no editable: ' + campo });
    const usuario = req.session.usuario.nombre || req.session.usuario.usuario;
    const resp = await fetch(APPS_SCRIPT_FACTURAS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: APPS_SCRIPT_FACTURAS_TOKEN, accion: 'actualizarCampo', fileId, campo, valor, usuario }) });
    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/facturas-proveedores/:fileId/historial', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const params = new URLSearchParams({ token: APPS_SCRIPT_FACTURAS_TOKEN, action: 'historialFactura', fileId: req.params.fileId });
    const resp = await fetch(`${APPS_SCRIPT_FACTURAS_URL}?${params.toString()}`);
    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// SERVICIOS ISABELLA — apoyo logístico/de personal de ORUM al grupo
// Isabella (VMS Horeca, Isabella Mobiliario, Isabella al Carbón, Isabella
// Mobil Home). Migrado desde el Apps Script standalone original a Supabase
// (tablas isabella_servicios / isabella_config) — ver memoria
// isabella-servicios-orum-central para el contexto completo.
// ================================================================

const ISABELLA_VEH_CONSUMO_KEY = { 1: 'consumo1', 2: 'consumo2', 3: 'consumo3' };

async function obtenerConfigIsabella() {
  const { data, error } = await supabase.from('isabella_config').select('key,value');
  if (error) throw error;
  const cfg = {};
  data.forEach(r => { cfg[r.key] = parseFloat(r.value); });
  return cfg;
}

// Mismo cálculo que calcEstimate() del Apps Script original: vehTipo
// 1=Camión Azul, 2=Camión 3.500Kg, 3=Furgoneta, 0="sin vehículo" (solo
// mano de obra, para montaje de mobil homes, lavandería, etc.).
function calcularCosteIsabella(cfg, vehTipo, km, horas, personas) {
  const p = Number(personas) || 1;
  let combustible = 0, desgaste = 0;
  if (Number(vehTipo) > 0) {
    const consumo = cfg[ISABELLA_VEH_CONSUMO_KEY[vehTipo]] || cfg.consumo2;
    combustible = (Number(km) / 100) * consumo * cfg.fuelPrice;
    desgaste = Number(km) * cfg.wear;
  }
  const manoObra = Number(horas) * p * cfg.labor;
  const costeNOE = combustible + desgaste + manoObra;
  const importe = costeNOE * (1 + cfg.marginPct / 100);
  const beneficio = importe - costeNOE;
  return { combustible, desgaste, manoObra, costeNOE, importe, beneficio };
}
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Calculadora de coste estimado (antes de registrar el servicio). Logística
// solo recibe el importe a facturar; Dirección/Contabilidad ven también el
// desglose de coste real.
app.post('/api/isabella/calcular', requiereLogin, permiteIsabella, async (req, res) => {
  try {
    const cfg = await obtenerConfigIsabella();
    const { vehTipo, km, horas, personas } = req.body;
    const r = calcularCosteIsabella(cfg, vehTipo, km, horas, personas);
    const esAdmin = ROLES_ISABELLA_ADMIN.includes(req.session.usuario.rol);
    res.json({
      ok: true, importe: r2(r.importe),
      ...(esAdmin ? { combustible: r2(r.combustible), desgaste: r2(r.desgaste), manoObra: r2(r.manoObra), costeNOE: r2(r.costeNOE) } : {})
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/isabella/servicios', requiereLogin, permiteIsabella, async (req, res) => {
  try {
    let query = supabase.from('isabella_servicios').select('*').order('fecha', { ascending: false }).order('id', { ascending: false });
    if (req.query.empresa) query = query.eq('empresa', req.query.empresa);
    const { data, error } = await query;
    if (error) throw error;
    let rows = data || [];
    if (req.query.mes) rows = rows.filter(r => String(r.fecha).slice(0, 7) === req.query.mes);
    const esAdmin = ROLES_ISABELLA_ADMIN.includes(req.session.usuario.rol);
    const mapeado = rows.map(r => ({
      id: r.id, fecha: r.fecha, empresa: r.empresa, pedido: r.pedido || '', vehNombre: r.veh_nombre || '',
      vehTipo: r.veh_tipo, personal: r.personal || '', personas: r.personas, km: r.km, horas: r.horas,
      desc: r.descripcion || '', importe: r.importe, creadoPor: r.creado_por || '',
      ...(esAdmin ? { costeNOE: r.coste_noe, beneficio: r.beneficio } : {})
    }));
    res.json({ ok: true, data: mapeado });
  } catch (err) {
    console.error('Error en /api/isabella/servicios:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/isabella/servicios', requiereLogin, permiteIsabella, async (req, res) => {
  try {
    const b = req.body;
    if (!b.fecha || !b.empresa) return res.status(400).json({ error: 'Fecha y empresa son obligatorios' });
    const cfg = await obtenerConfigIsabella();
    const vehTipo = Number(b.vehTipo) || 0;
    const personas = Number(b.personas) || 1;
    const r = calcularCosteIsabella(cfg, vehTipo, Number(b.km) || 0, Number(b.horas) || 0, personas);
    const usuario = req.session.usuario.nombre || req.session.usuario.usuario;
    const { data, error } = await supabase.from('isabella_servicios').insert({
      fecha: b.fecha, empresa: b.empresa, pedido: b.pedido || '', veh_nombre: b.vehNombre || '',
      veh_tipo: vehTipo, personal: b.personal || '', personas, km: Number(b.km) || 0, horas: Number(b.horas) || 0,
      descripcion: b.desc || '', combustible: r2(r.combustible), desgaste: r2(r.desgaste), mano_obra: r2(r.manoObra),
      coste_noe: r2(r.costeNOE), importe: r2(r.importe), beneficio: r2(r.beneficio), creado_por: usuario
    }).select().single();
    if (error) throw error;
    res.json({ ok: true, servicio: data });
  } catch (err) {
    console.error('Error en POST /api/isabella/servicios:', err);
    res.status(500).json({ error: err.message });
  }
});

// Borrar un servicio: solo Dirección/Contabilidad (igual que el modo admin del Apps Script original)
app.delete('/api/isabella/servicios/:id', requiereLogin, soloIsabellaAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('isabella_servicios').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Comparativa coste real vs. facturado, por empresa y por mes — solo Dirección/Contabilidad
app.get('/api/isabella/comparativa', requiereLogin, soloIsabellaAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase.from('isabella_servicios').select('empresa,fecha,importe,coste_noe');
    if (error) throw error;
    const porEmpresa = {}, porMes = {};
    let totalIngresos = 0, totalGastos = 0;
    (data || []).forEach(r => {
      const importe = Number(r.importe) || 0, coste = Number(r.coste_noe) || 0;
      totalIngresos += importe; totalGastos += coste;
      porEmpresa[r.empresa] = porEmpresa[r.empresa] || { servicios: 0, ingresos: 0, gastos: 0 };
      porEmpresa[r.empresa].servicios++; porEmpresa[r.empresa].ingresos += importe; porEmpresa[r.empresa].gastos += coste;
      const mes = String(r.fecha).slice(0, 7);
      porMes[mes] = porMes[mes] || { servicios: 0, ingresos: 0, gastos: 0 };
      porMes[mes].servicios++; porMes[mes].ingresos += importe; porMes[mes].gastos += coste;
    });
    res.json({ ok: true, totalIngresos: r2(totalIngresos), totalGastos: r2(totalGastos), porEmpresa, porMes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Tarifas de cálculo (combustible, consumos, desgaste, mano de obra, margen) — solo Dirección/Contabilidad
app.get('/api/isabella/tarifas', requiereLogin, soloIsabellaAdmin, async (req, res) => {
  try { res.json({ ok: true, config: await obtenerConfigIsabella() }); } catch (err) { res.status(500).json({ error: err.message }); }
});
const ISABELLA_CAMPOS_TARIFA = ['fuelPrice', 'consumo1', 'consumo2', 'consumo3', 'wear', 'labor', 'marginPct'];
app.post('/api/isabella/tarifas', requiereLogin, soloIsabellaAdmin, async (req, res) => {
  try {
    const updates = ISABELLA_CAMPOS_TARIFA.filter(k => req.body[k] !== undefined && req.body[k] !== '');
    for (const k of updates) {
      const { error } = await supabase.from('isabella_config').update({ value: Number(req.body[k]) }).eq('key', k);
      if (error) throw error;
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ================================================================
// INFORME MENSUAL — ventas por semana ISO, real vs 2025, objetivo +20%
// ================================================================

// Ventas reales semanales de 2025 (semana ISO -> € facturados), usadas como base del objetivo 2026 (+20%)
const VENTAS_2025_SEMANAL = {
  1: 1558.94, 2: 2570.28, 3: 6221.8, 4: 6977.33, 5: 5412.8, 6: 4705.14, 7: 4070.7, 8: 2221.95,
  9: 2875.5, 10: 9890.0, 11: 2166.05, 12: 13783.16, 13: 14708.33, 14: 24337.35, 15: 5455.0, 16: 25400.77,
  17: 27792.95, 18: 36785.05, 19: 50888.39, 20: 45380.61, 21: 59440.08, 22: 55878.79, 23: 57477.44,
  24: 43258.23, 25: 57017.17, 26: 43041.15, 27: 51025.71, 28: 47679.71, 29: 31976.47, 30: 47509.53,
  31: 44264.3, 32: 35956.07, 33: 38735.9, 34: 33600.6, 35: 31724.23, 36: 59414.68, 37: 43971.66,
  38: 56860.26, 39: 82401.57, 40: 49584.61, 41: 42001.45, 42: 34606.64, 43: 12685.05, 44: 6773.78,
  45: 20416.86, 46: 11236.66, 47: 39931.67, 48: 9662.77, 49: 7195.3, 50: 8233.27, 51: 5127.82,
  52: 11496.28, 53: 46223.27
};
const CRECIMIENTO_OBJETIVO_INFORME = 0.20;
const ESTADOS_PIPELINE_NOMBRE = ['pending', 'concept', 'inquiry'].map(normalizarTexto);
const MESES_ES_INFORME = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function round2(n) { return Math.round((n || 0) * 100) / 100; }

function fechaISO(d) { return new Date(d).toISOString().slice(0, 10); }

function formatRangoFechas(lunes, domingo) {
  const f = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${f(lunes)} – ${f(domingo)}`;
}

function isoWeekNumber(fecha) {
  const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// A qué mes "pertenece" una semana lunes-domingo: el que tenga más días
// dentro de esa semana (nunca hay empate, 7 días es impar).
function mesConMasDias(lunes) {
  const conteo = {};
  const cursor = new Date(lunes);
  for (let i = 0; i < 7; i++) {
    const key = cursor.getFullYear() + '-' + cursor.getMonth();
    conteo[key] = (conteo[key] || 0) + 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  let mejorKey = null, mejorCount = -1;
  Object.keys(conteo).forEach(k => { if (conteo[k] > mejorCount) { mejorCount = conteo[k]; mejorKey = k; } });
  const [anioStr, mesIdxStr] = mejorKey.split('-');
  return { anio: parseInt(anioStr, 10), mes: parseInt(mesIdxStr, 10) + 1 };
}

// Cada semana ISO (lunes-domingo) cuenta entera en UN solo mes: el que tenga
// más días de esa semana. Antes se incluía cualquier semana que tocara el
// mes, así que la semana a caballo entre dos meses aparecía completa en
// AMBOS informes (se pisaban / se contaba dos veces). Ahora se recorre un
// margen de una semana de más por cada lado y se filtra por mayoría.
function isoWeeksInMonth(mes, anio) {
  const primerDia = new Date(anio, mes - 1, 1);
  const ultimoDia = new Date(anio, mes, 0);
  const semanas = [];
  let cursor = lunesDeLaSemana(primerDia);
  cursor.setDate(cursor.getDate() - 7);
  const limite = new Date(ultimoDia); limite.setDate(limite.getDate() + 7);
  while (cursor <= limite) {
    const lunes = new Date(cursor);
    const domingo = new Date(cursor); domingo.setDate(domingo.getDate() + 6);
    const pertenece = mesConMasDias(lunes);
    if (pertenece.anio === anio && pertenece.mes === mes) {
      semanas.push({ isoWeek: isoWeekNumber(lunes), lunes, domingo });
    }
    cursor = new Date(cursor); cursor.setDate(cursor.getDate() + 7);
  }
  return semanas;
}

// Rentabilidad = siempre SIN IVA (el IVA solo se usa para control de pagos,
// en ningún otro informe/KPI). Antes esto sumaba el IVA (×1.21) a las ventas
// "Rentman" normales pero no a las PNC, mezclando criterios en la misma fila
// y comparando contra VENTAS_2025_SEMANAL (que sí está en sin IVA) como si
// fueran lo mismo - ambos tipos van sin IVA ahora, sin excepción.
function valorFinalProyecto(p) {
  return parseFloat(p.valor) || 0;
}

async function construirReporteMes(mes, anio) {
  const proyectosResp = await llamarOrumCentral('proyectos');
  const todos = (proyectosResp.data || []).filter(p => p.cancelado !== 'SI');
  const hoy = inicioDelDia(new Date());
  const semanasDef = isoWeeksInMonth(mes, anio);

  const semanas = semanasDef.map(w => {
    const enSemana = todos.filter(p => {
      const f = parsearFechaDDMMYYYY(p.entrega_fecha);
      return f && f >= w.lunes && f <= w.domingo;
    });
    const confirmados = enSemana.filter(p => !ESTADOS_EXCLUIR_NOMBRE.includes(normalizarTexto(p.estado)));
    const pipeline = enSemana.filter(p => ESTADOS_PIPELINE_NOMBRE.includes(normalizarTexto(p.estado)));

    let rentman = 0, pnc = 0, marina = 0, danilo = 0, lucas = 0, pncMarina = 0, pncDanilo = 0;
    confirmados.forEach(p => {
      const esPNC = p.es_abrebotellas === 'SI' || p.es_abrebotellas === true;
      const valorFinal = valorFinalProyecto(p);
      if (esPNC) pnc += valorFinal; else rentman += valorFinal;
      const com = normalizarTexto(p.comercial || '');
      if (com.indexOf('marina') !== -1) { marina += valorFinal; if (esPNC) pncMarina += valorFinal; }
      else if (com.indexOf('danilo') !== -1) { danilo += valorFinal; if (esPNC) pncDanilo += valorFinal; }
      else if (com.indexOf('lucas') !== -1) { lucas += valorFinal; }
    });
    const pipelineTotal = pipeline.reduce((s, p) => s + valorFinalProyecto(p), 0);
    const total = rentman + pnc;

    return {
      isoWeek: w.isoWeek,
      lunes: fechaISO(w.lunes),
      domingo: fechaISO(w.domingo),
      label2026: formatRangoFechas(w.lunes, w.domingo),
      cerrada: w.domingo < hoy,
      y2025: VENTAS_2025_SEMANAL[w.isoWeek] || 0,
      real: {
        rentman: round2(rentman), pnc: round2(pnc), total: round2(total),
        pipeline: round2(pipelineTotal),
        marina: round2(marina), danilo: round2(danilo), lucas: round2(lucas),
        pncMarina: round2(pncMarina), pncDanilo: round2(pncDanilo)
      }
    };
  });

  return { mes, anio, semanas, generado: new Date().toISOString() };
}

function fmtEuroInforme(v) {
  return (v || 0).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
}
function fmtPctInforme(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + '%';
}

function renderReporteMesHTML(data) {
  const { mes, anio, semanas } = data;
  let totRentman = 0, totPnc = 0, totTotal = 0, totPipeline = 0, totObjetivo = 0;
  let totMarina = 0, totDanilo = 0, totLucas = 0;

  const filas = semanas.map((s, i) => {
    const objetivo = round2(s.y2025 * (1 + CRECIMIENTO_OBJETIVO_INFORME));
    const falta = round2(objetivo - s.real.total);
    const pctObj = objetivo > 0 ? ((s.real.total / objetivo) - 1) * 100 : 0;
    const pct2025 = s.y2025 > 0 ? ((s.real.total / s.y2025) - 1) * 100 : 0;
    totRentman += s.real.rentman; totPnc += s.real.pnc; totTotal += s.real.total;
    totPipeline += s.real.pipeline; totObjetivo += objetivo;
    totMarina += s.real.marina; totDanilo += s.real.danilo; totLucas += s.real.lucas;

    const badgeBg = !s.cerrada ? '#FFF3DC' : (pctObj >= 0 ? '#EAF3DE' : '#FCEBEB');
    const badgeColor = !s.cerrada ? '#7A4A00' : (pctObj >= 0 ? '#2E6B0A' : '#A32D2D');

    return `<tr style="background:${i % 2 === 0 ? '#FAFAF8' : '#FFFFFF'}">
      <td style="padding:10px 14px;font-weight:700">S${s.isoWeek}</td>
      <td style="padding:10px 14px;color:#555;font-size:12px">${s.label2026}</td>
      <td style="padding:10px 14px;text-align:right;color:#555">${s.y2025 > 0 ? fmtEuroInforme(s.y2025) : '—'}</td>
      <td style="padding:10px 14px;text-align:right;color:#555">${objetivo > 0 ? fmtEuroInforme(objetivo) : '—'}</td>
      <td style="padding:10px 14px;text-align:right;font-weight:700">${fmtEuroInforme(s.real.total)}${!s.cerrada ? ' *' : ''}</td>
      <td style="padding:10px 14px;text-align:right;color:#444">${s.real.rentman > 0 ? fmtEuroInforme(s.real.rentman) : '—'}</td>
      <td style="padding:10px 14px;text-align:right;color:#178a5e">${s.real.pnc > 0 ? fmtEuroInforme(s.real.pnc) : '—'}</td>
      <td style="padding:10px 14px;text-align:right;background:#FBF3E4;font-weight:700;color:#8a6d1e">${s.real.pipeline > 0 ? fmtEuroInforme(s.real.pipeline) : '—'}</td>
      <td style="padding:10px 14px;text-align:center"><span style="padding:2px 10px;border-radius:4px;font-size:12px;font-weight:600;background:${badgeBg};color:${badgeColor}">${objetivo > 0 ? fmtPctInforme(pctObj) : '—'}</span></td>
      <td style="padding:10px 14px;text-align:center"><span style="padding:2px 10px;border-radius:4px;font-size:12px;font-weight:600;background:${badgeBg};color:${badgeColor}">${s.y2025 > 0 ? fmtPctInforme(pct2025) : '—'}</span></td>
      <td style="padding:10px 14px;text-align:right;color:${falta > 0 ? '#A32D2D' : '#2E6B0A'}">${objetivo > 0 ? fmtEuroInforme(Math.abs(falta)) : '—'}</td>
      <td style="padding:10px 14px;color:#777;font-size:12px">${s.cerrada ? 'Cerrada' : 'En curso'}</td>
    </tr>`;
  }).join('');

  const filasComercial = semanas.map((s, i) => {
    const otros = round2(s.real.total - s.real.marina - s.real.danilo - s.real.lucas);
    const pctM = s.real.total > 0 ? Math.round(s.real.marina / s.real.total * 100) : 0;
    const pctD = s.real.total > 0 ? Math.round(s.real.danilo / s.real.total * 100) : 0;
    const pctL = s.real.total > 0 ? Math.round(s.real.lucas / s.real.total * 100) : 0;
    return `<tr style="background:${i % 2 === 0 ? '#FAFAF8' : '#FFFFFF'}">
      <td style="padding:10px 14px;font-weight:700">S${s.isoWeek}</td>
      <td style="padding:10px 14px;color:#555;font-size:12px">${s.label2026}</td>
      <td style="padding:10px 14px;text-align:right;color:#2563a8;font-weight:${s.real.marina > 0 ? 700 : 400}">${fmtEuroInforme(s.real.marina)}</td>
      <td style="padding:10px 14px;text-align:right;color:#2e7d52;font-weight:${s.real.danilo > 0 ? 700 : 400}">${fmtEuroInforme(s.real.danilo)}</td>
      <td style="padding:10px 14px;text-align:right;color:#8e44ad;font-weight:${s.real.lucas > 0 ? 700 : 400}">${fmtEuroInforme(s.real.lucas)}</td>
      <td style="padding:10px 14px;text-align:right;color:#999">${otros > 0 ? fmtEuroInforme(otros) : '—'}</td>
      <td style="padding:10px 14px;text-align:right;font-weight:700">${fmtEuroInforme(s.real.total)}</td>
      <td style="padding:10px 14px;text-align:right;color:#2563a8">${pctM}%</td>
      <td style="padding:10px 14px;text-align:right;color:#2e7d52">${pctD}%</td>
      <td style="padding:10px 14px;text-align:right;color:#8e44ad">${pctL}%</td>
    </tr>`;
  }).join('');

  const total2025 = semanas.reduce((s, w) => s + w.y2025, 0);
  const totFalta = round2(totObjetivo - totTotal);
  const pctVsObjetivo = totObjetivo > 0 ? ((totTotal / totObjetivo) - 1) * 100 : 0;
  const pctVs2025Val = total2025 > 0 ? ((totTotal / total2025) - 1) * 100 : 0;
  const enPresupPct = totObjetivo > 0 ? Math.round(totPipeline / totObjetivo * 100) : 0;
  const totalMarinaPct = totTotal > 0 ? Math.round(totMarina / totTotal * 100) : 0;
  const totalDaniloPct = totTotal > 0 ? Math.round(totDanilo / totTotal * 100) : 0;
  const totalLucasPct = totTotal > 0 ? Math.round(totLucas / totTotal * 100) : 0;
  const totalOtros = round2(totTotal - totMarina - totDanilo - totLucas);

  const mesesBtns = MESES_ES_INFORME.slice(1).map((nombre, idx) => {
    const m = idx + 1;
    const activo = m === mes;
    return `<a href="/api/reporte-mes?mes=${m}&a%C3%B1o=${anio}" style="text-decoration:none;padding:6px 16px;border-radius:20px;font-size:13px;font-weight:${activo ? 700 : 400};background:${activo ? '#1a1a1a' : 'transparent'};color:${activo ? '#fff' : '#666'};margin-right:4px;display:inline-block">${nombre}</a>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<title>ORUM Rent &amp; Events · ${MESES_ES_INFORME[mes]} ${anio}</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'DM Sans',-apple-system,Helvetica,Arial,sans-serif; background:#fff; color:#1a1a1a; padding:32px 40px; }
  .btn-print { position:fixed; top:24px; right:32px; background:#1a1a1a; color:#fff; border:none; padding:10px 20px; border-radius:6px; font-size:13px; font-weight:600; cursor:pointer; }
  h1 { font-size:26px; font-weight:700; }
  .subtitle { color:#777; font-size:13px; margin-top:4px; }
  .mesnav { background:#f5f4f1; padding:14px 20px; border-radius:6px; margin:24px 0; display:flex; align-items:center; flex-wrap:wrap; gap:2px; }
  .mesnav-label { font-size:11px; letter-spacing:1px; color:#999; margin-right:10px; }
  .kpis { display:flex; border:1px solid #eee; border-radius:6px; overflow:hidden; margin-bottom:28px; }
  .kpi { flex:1; padding:18px 20px; border-right:1px solid #eee; }
  .kpi:last-child { border-right:none; }
  .kpi.highlight { background:#FBF3E4; }
  .kpi-label { font-size:10px; letter-spacing:1px; color:#999; text-transform:uppercase; }
  .kpi-val { font-size:24px; font-weight:700; margin-top:6px; }
  .kpi-sub { font-size:11px; color:#999; margin-top:4px; }
  table { width:100%; border-collapse:collapse; font-size:13px; margin-bottom:28px; }
  thead tr { background:#1a1a1a; color:#fff; }
  th { padding:10px 14px; text-align:left; font-size:11px; letter-spacing:0.5px; font-weight:600; }
  tfoot tr { background:#eee; font-weight:700; border-top:2px solid #1a1a1a; }
  h2 { font-size:16px; margin-bottom:2px; }
  .h2sub { font-size:12px; color:#999; margin-bottom:12px; }
  .footnote { font-size:11px; color:#999; margin-top:8px; }
  @media print { .btn-print { display:none; } .mesnav { display:none; } }
</style></head>
<body>
  <button class="btn-print" onclick="window.print()">Imprimir / PDF</button>
  <h1>ORUM Rent &amp; Events · ${MESES_ES_INFORME[mes]} ${anio}</h1>
  <div class="subtitle">Real vs 2025 · Objetivo +20% · Desglose por comercial</div>
  <div class="mesnav"><span class="mesnav-label">MES:</span>${mesesBtns}</div>
  <div class="kpis">
    <div class="kpi">
      <div class="kpi-label">Real acumulado</div>
      <div class="kpi-val">${fmtEuroInforme(totTotal)}</div>
      <div class="kpi-sub">Normal: ${fmtEuroInforme(totRentman)} · PNC: ${fmtEuroInforme(totPnc)}</div>
    </div>
    <div class="kpi highlight">
      <div class="kpi-label">En presupuesto</div>
      <div class="kpi-val" style="color:#8a6d1e">${fmtEuroInforme(totPipeline)}</div>
      <div class="kpi-sub">pendiente de cerrar</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Objetivo (+20%)</div>
      <div class="kpi-val">${fmtEuroInforme(totObjetivo)}</div>
      <div class="kpi-sub">vs 2025</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Pendiente objetivo</div>
      <div class="kpi-val" style="color:${totFalta > 0 ? '#A32D2D' : '#2E6B0A'}">${fmtEuroInforme(Math.abs(totFalta))}</div>
      <div class="kpi-sub">pipeline cubre ${enPresupPct}%</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Vs 2025</div>
      <div class="kpi-val" style="color:${pctVs2025Val >= 0 ? '#2E6B0A' : '#A32D2D'}">${fmtPctInforme(pctVs2025Val)}</div>
      <div class="kpi-sub">acumulado cerradas</div>
    </div>
  </div>
  <table>
    <thead><tr>
      <th>SEM</th><th>PERÍODO</th><th style="text-align:right">2025</th><th style="text-align:right">OBJETIVO 2026</th>
      <th style="text-align:right">REAL / PREV.</th><th style="text-align:right;color:#ccc">· Normal</th><th style="text-align:right;color:#8be0bd">· PNC</th><th style="text-align:right;background:#8a6d1e">EN PRESUPUESTO</th>
      <th style="text-align:center">% OBJ.</th><th style="text-align:center">% 2025</th>
      <th style="text-align:right">FALTA</th><th>ESTADO</th>
    </tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr>
      <td colspan="2" style="padding:10px 14px">TOTAL</td>
      <td style="padding:10px 14px;text-align:right">${fmtEuroInforme(total2025)}</td>
      <td style="padding:10px 14px;text-align:right">${fmtEuroInforme(totObjetivo)}</td>
      <td style="padding:10px 14px;text-align:right">${fmtEuroInforme(totTotal)}</td>
      <td style="padding:10px 14px;text-align:right;color:#555">${fmtEuroInforme(totRentman)}</td>
      <td style="padding:10px 14px;text-align:right;color:#178a5e">${fmtEuroInforme(totPnc)}</td>
      <td style="padding:10px 14px;text-align:right">${fmtEuroInforme(totPipeline)}</td>
      <td style="padding:10px 14px;text-align:center">${totObjetivo > 0 ? fmtPctInforme(pctVsObjetivo) : '—'}</td>
      <td style="padding:10px 14px;text-align:center">${total2025 > 0 ? fmtPctInforme(pctVs2025Val) : '—'}</td>
      <td style="padding:10px 14px;text-align:right">${fmtEuroInforme(Math.abs(totFalta))}</td>
      <td></td>
    </tr></tfoot>
  </table>
  <h2>Desglose por comercial</h2>
  <div class="h2sub">Importe neto por semana según gestor asignado en Rentman</div>
  <table>
    <thead><tr>
      <th>SEM</th><th>PERÍODO</th><th style="text-align:right">Marina R.</th><th style="text-align:right">Danilo C.</th>
      <th style="text-align:right">Lucas S.</th><th style="text-align:right">Otros</th><th style="text-align:right">TOTAL</th>
      <th style="text-align:right">% Marina</th><th style="text-align:right">% Danilo</th><th style="text-align:right">% Lucas</th>
    </tr></thead>
    <tbody>${filasComercial}</tbody>
    <tfoot><tr>
      <td colspan="2" style="padding:10px 14px">TOTAL</td>
      <td style="padding:10px 14px;text-align:right;color:#2563a8">${fmtEuroInforme(totMarina)}</td>
      <td style="padding:10px 14px;text-align:right;color:#2e7d52">${fmtEuroInforme(totDanilo)}</td>
      <td style="padding:10px 14px;text-align:right;color:#8e44ad">${fmtEuroInforme(totLucas)}</td>
      <td style="padding:10px 14px;text-align:right;color:#999">${fmtEuroInforme(totalOtros)}</td>
      <td style="padding:10px 14px;text-align:right">${fmtEuroInforme(totTotal)}</td>
      <td style="padding:10px 14px;text-align:right;color:#2563a8">${totalMarinaPct}%</td>
      <td style="padding:10px 14px;text-align:right;color:#2e7d52">${totalDaniloPct}%</td>
      <td style="padding:10px 14px;text-align:right;color:#8e44ad">${totalLucasPct}%</td>
    </tr></tfoot>
  </table>
  <div class="footnote">* Semanas en curso — datos aún sin cerrar, sujetos a cambio · Objetivo = 2025 +20% · Generado: ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}</div>
</body></html>`;
}

app.get('/api/reporte-mes', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const mes = parseInt(req.query.mes, 10) || (new Date().getMonth() + 1);
    const anio = parseInt(req.query['año'] || req.query.anio, 10) || new Date().getFullYear();
    const data = await construirReporteMes(mes, anio);
    if (req.query.json === '1') return res.json(data);
    res.send(renderReporteMesHTML(data));
  } catch (err) {
    console.error('Error en /api/reporte-mes:', err);
    res.status(500).send('<pre>Error generando informe: ' + err.message + '</pre>');
  }
});

// ================================================================
// PÁGINA PRINCIPAL
// ================================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ORUM Central Panel escuchando en puerto ${PORT}`);
});
