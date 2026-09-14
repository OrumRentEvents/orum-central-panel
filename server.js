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
const multer = require('multer');
const XLSX = require('xlsx');
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

// ── Hoja de Sheets "HORAS EXTRAS 2026" (Financiero → Personal → Extras) ──
// Compartida por el usuario como "Cualquiera con el enlace, Lector" (11 sep
// 2026) — se lee en vivo vía el endpoint público de Google Visualization
// (gviz), sin necesidad de OAuth ni Apps Script, pidiendo la pestaña
// "PAGOS <MES> <AÑO>" por nombre. Ver sincronizarExtrasDelMes() más abajo.
const EXTRAS_SHEET_ID = process.env.EXTRAS_SHEET_ID || '1CSit6DHHhpiCT63791dPu_SvgPsjohKQJhtfHCdWlbs';

// ── Fianzas (9 sep 2026, v2) ────────────────────────────────────
// El estado de la fianza vive en Rentman (campos personalizados del
// proyecto, panel "FIANZA" en la UI). /api/fianzas ya NO lo lee en vivo -
// desde el v2 lo lee de Supabase (proyectos.importe_fianza y compañía),
// volcado por OrumCentral.gs en cada webhook de proyecto + un backfill de
// un solo uso para el histórico (ver [[orum-caja-sistema]]). RENTMAN_TOKEN
// solo se usa aquí para el botón manual "recargar desde Rentman"
// (/api/fianzas/recargar) - añade en Railway la variable RENTMAN_TOKEN
// (mismo valor que ya usa caja-orum en su .env/Railway).
const RENTMAN_TOKEN = process.env.RENTMAN_TOKEN || 'PEGA_AQUI_EL_TOKEN_DE_RENTMAN';
const RENTMAN_URL = 'https://api.rentman.net';
// Campos personalizados del proyecto en Rentman (id del extrainputfield =
// sufijo "custom_N"). Verificado en vivo el 9 sep 2026 - si algún día se
// añade/quita un campo del panel FIANZA en Rentman, comprobar de nuevo con
// GET /extrainputfields antes de tocar estos números.
//   custom_3  = Importe Fianza
//   custom_4  = Forma de pago Fianza (enum)
//   custom_5  = Estado Fianza (enum)
//   custom_6  = Importe Devuelto Fianza
//   custom_9  = 4 últimos dígitos CC
//   custom_10 = Número operación TPV (cobro)
//   custom_15 = Número operación TPV (devolución) - campo añadido por el
//               usuario el 9 sep 2026, específicamente para poder localizar
//               una devolución de fianza por su nº de operación, distinto
//               del nº de operación del cobro original.
// Mapeo custom_4 → forma de pago (idéntico al ya usado en caja-orum/server.js,
// verificado cruzando caja_registros.metodo_pago='fianza-transferencia' de
// Supabase contra el custom_4 real del proyecto correspondiente en Rentman).
const FIANZA_METODOS = {
  '0': 'Transferencia Bancaria',
  '3': 'Efectivo Marbella',
  '4': 'Efectivo Monda',
  '5': 'TPV',
  '6': 'TPV Marbella',
  '7': 'TPV Monda'
};
// Mismo mapeo que caja-orum. '3' ("Sin Fianza", 4ª opción vista en el
// desplegable de Rentman) no está confirmado con un caso real todavía - si
// aparece, se muestra el código crudo en vez de una etiqueta inventada.
const FIANZA_ESTADOS = { '0': 'Pendiente', '1': 'Pagada', '2': 'Devuelta' };

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

// Financiero · Personal (nóminas): datos de sueldos, más sensible que el
// resto de Financiero — se restringe a Dirección y Contabilidad, no al
// resto de roles que sí ven Facturas Proveedores/Cierre Mensual.
const ROLES_PERSONAL = ['Direccion', 'Contabilidad'];
function soloPersonal(req, res, next) {
  if (!ROLES_PERSONAL.includes(req.session.usuario.rol)) return res.status(403).json({ error: 'No autorizado para este apartado' });
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
      // FIX (3 sep 2026): una factura puede tener varios pagos de Rentman
      // (split), cada uno con su propio método - antes solo se miraba el
      // primer pago (primerPago.metodo_pago) tanto para mostrar "Forma de
      // pago" como para el desglose por método, perdiendo en silencio
      // cualquier pago posterior con un método distinto (o incluso igual,
      // pero contado solo una vez en el desglose). Ahora se listan todos los
      // métodos DISTINTOS realmente usados en esa factura - si son todos
      // iguales sigue apareciendo uno solo, si son distintos aparecen todos.
      const metodosDistintos = [...new Set(pagosCaja.map(p => p.metodo_pago).filter(Boolean))];
      const metodosRealesDistintos = metodosDistintos.filter(m => FORMAS_PAGO_REALES.includes(m));

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
        // Compat: forma_pago sigue siendo un único valor (el primer método) -
        // lo que cambia es formas_pago (array con TODOS los métodos distintos
        // de esta factura), que es lo que ahora usa el frontend para pintar.
        forma_pago: primerPago ? primerPago.metodo_pago : null, es_rectificativa_a_cero: esRectificativaACero,
        formas_pago: metodosDistintos,
        forma_pago_real: primerPago && FORMAS_PAGO_REALES.includes(primerPago.metodo_pago) ? primerPago.metodo_pago : null,
        formas_pago_reales: metodosRealesDistintos,
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
    // FIX (3 sep 2026): antes solo sumaba el importe del PRIMER pago de cada
    // factura al método de ESE primer pago - una factura partida en 2+ pagos
    // (normal desde la migración de Caja del 1 sep) perdía en silencio el
    // resto. Ahora se recorren TODOS los pagos de TODAS las facturas y cada
    // uno suma a su propio método, sea el mismo que sus hermanos o distinto.
    cruceFacturas.forEach(cf => {
      (cf.pagos_caja || []).forEach(pago => {
        const metodo = pago.metodo_pago;
        if (!metodo || !FORMAS_PAGO_REALES.includes(metodo)) return;
        const importe = Math.abs(parseFloat(pago.importe) || 0);
        desglosePorFormaPago[metodo] = (desglosePorFormaPago[metodo] || 0) + importe;
      });
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

    // NUEVO (3 sep 2026): pestaña Financiero → Clientes - salud financiera
    // basada en lo que dice RENTMAN (esta_pagada/pendiente_cobro), NO en lo
    // registrado en Caja como topClientesPendientes de arriba - esa otra
    // tabla se ha visto varias veces hoy con cifras desactualizadas cuando
    // Rentman ya daba una factura por pagada pero nadie había registrado
    // todavía el cobro en Caja. Aquí se usa la misma fuente fiable que ya
    // usa Vencidas y morosidad.
    const LIMITE_CREDITO_CLIENTE = 5000;
    const clientesMap = {};
    cruceFacturas.forEach(cf => {
      const clave = cf.cliente || 'Sin cliente';
      if (!clientesMap[clave]) {
        clientesMap[clave] = {
          cliente: clave, comercial: cf.comercial,
          total_facturado: 0, total_pendiente: 0, total_rectificativas: 0,
          n_facturas: 0, n_pendientes: 0, n_vencidas: 0,
          dias_retraso_max: 0, fecha_vencimiento_mas_antigua: null, proyectos: []
        };
      }
      const c = clientesMap[clave];
      c.n_facturas++;
      c.total_facturado += parseFloat(cf.importe_con_iva) || 0;
      const pendiente = parseFloat(cf.pendiente_cobro) || 0;
      if (pendiente < -0.01) {
        // Rectificativa/nota de abono - no es deuda del cliente, aparte.
        c.total_rectificativas += pendiente;
        return;
      }
      if (pendiente <= 0.05) return;
      c.total_pendiente += pendiente;
      c.n_pendientes++;
      if (cf.proyecto_numero != null && !c.proyectos.includes(cf.proyecto_numero)) c.proyectos.push(cf.proyecto_numero);
      if (cf.dias_retraso !== null && cf.dias_retraso > 0) {
        c.n_vencidas++;
        if (cf.dias_retraso > c.dias_retraso_max) c.dias_retraso_max = cf.dias_retraso;
        if (cf.fecha_vencimiento) {
          const actual = new Date(cf.fecha_vencimiento.split('/').reverse().join('-'));
          const previa = c.fecha_vencimiento_mas_antigua ? new Date(c.fecha_vencimiento_mas_antigua.split('/').reverse().join('-')) : null;
          if (!previa || actual < previa) c.fecha_vencimiento_mas_antigua = cf.fecha_vencimiento;
        }
      }
    });
    const clientesLista = Object.values(clientesMap).map(c => ({
      ...c,
      total_facturado: Math.round(c.total_facturado * 100) / 100,
      total_pendiente: Math.round(c.total_pendiente * 100) / 100,
      total_rectificativas: Math.round(c.total_rectificativas * 100) / 100,
      salud: c.n_vencidas > 0 ? 'moroso' : (c.total_pendiente > 0.05 ? 'pendiente' : 'al_dia'),
      supera_limite_credito: c.total_pendiente > LIMITE_CREDITO_CLIENTE,
      limite_credito: LIMITE_CREDITO_CLIENTE
    }));

    // FIX (10 sep 2026): "Top clientes con pendiente de cobro" vivía antes de
    // cruceProyectos (valor de proyecto, incluía PNC/abrebotellas calculados
    // sobre "valor esperado" en vez de facturas reales - clientes como
    // abrebotellas aparecían con pendiente que no era deuda de factura de
    // verdad). Ahora se construye desde clientesLista: solo facturas reales,
    // mismo pendiente_cobro de Rentman que ya usa Vencidas y morosidad -
    // misma fuente fiable, sin mezclar valor de proyecto.
    const topClientesPendientes = clientesLista
      .filter(c => c.total_pendiente > 0.05)
      .map(c => ({ cliente: c.cliente, comercial: c.comercial, proyectos: c.proyectos, pendiente: c.total_pendiente }))
      .sort((a, b) => b.pendiente - a.pendiente)
      .slice(0, 20);

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
// FIANZAS (v2, 9 sep 2026) — lee de Supabase (proyectos.importe_fianza y
// compañía), no de Rentman en directo. Esos campos los vuelca OrumCentral.gs
// en cada webhook de proyecto (procesarProyectoCompleto → sincronizarProyecto
// ASupabase_) y el backfillFianzas() de un solo uso para el histórico - ver
// [[orum-caja-sistema]]. "Recargar desde Rentman" sigue disponible como
// botón manual para el caso raro de necesitar el dato al segundo, antes de
// que llegue el webhook (normalmente 30s-1min).
// ================================================================
const PIPELINE_COMERCIAL_FIANZAS = ['pending', 'concept', 'inquiry']; // mismo criterio que el resto de Financiero
function filasFianzasDesdeProyectos(proyectosData) {
  return (proyectosData || [])
    .filter(p => (parseFloat(p.importe_fianza) || 0) > 0)
    .filter(p => {
      const est = String(p.estado || '').toLowerCase();
      if (PIPELINE_COMERCIAL_FIANZAS.includes(est)) return false;
      if (p.cancelado === true) return false;
      if (p.es_abrebotellas === true) return false;
      return true;
    })
    .map(p => {
      const c4 = p.forma_pago_fianza_id != null ? String(p.forma_pago_fianza_id) : '0';
      const c5 = p.estado_fianza_id != null ? String(p.estado_fianza_id) : '0';
      const importeFianza = Math.round((parseFloat(p.importe_fianza) || 0) * 100) / 100;
      const importeDevuelto = Math.round((parseFloat(p.importe_devuelto_fianza) || 0) * 100) / 100;
      return {
        proyecto_id: p.id,
        numero_proyecto: p.numero,
        cliente: p.cliente,
        comercial: p.comercial,
        estado_proyecto: p.estado,
        fecha_evento: p.entrega_fecha_raw || null,
        estado_fianza: FIANZA_ESTADOS[c5] || c5,
        estado_fianza_id: c5,
        importe_fianza: importeFianza,
        importe_devuelto: importeDevuelto,
        pendiente_devolver: c5 === '1' ? Math.round((importeFianza - importeDevuelto) * 100) / 100 : 0,
        forma_pago: FIANZA_METODOS[c4] || c4,
        forma_pago_id: c4,
        num_operacion_tpv_cobro: p.num_operacion_tpv_cobro || null,
        num_operacion_tpv_devolucion: p.num_operacion_tpv_devolucion || null
      };
    });
}
function kpisFianzas(fianzas) {
  const kpis = {
    total_pendientes_cobro: fianzas.filter(f => f.estado_fianza_id === '0').reduce((s, f) => s + f.importe_fianza, 0),
    n_pendientes_cobro: fianzas.filter(f => f.estado_fianza_id === '0').length,
    total_pagadas_sin_devolver: fianzas.filter(f => f.estado_fianza_id === '1').reduce((s, f) => s + f.pendiente_devolver, 0),
    n_pagadas_sin_devolver: fianzas.filter(f => f.estado_fianza_id === '1').length,
    total_devuelto: fianzas.filter(f => f.estado_fianza_id === '2').reduce((s, f) => s + f.importe_devuelto, 0),
    n_devueltas: fianzas.filter(f => f.estado_fianza_id === '2').length
  };
  Object.keys(kpis).forEach(k => { if (typeof kpis[k] === 'number') kpis[k] = Math.round(kpis[k] * 100) / 100; });
  return kpis;
}
app.get('/api/fianzas', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase no configurado' });
    const { data, error } = await supabase
      .from('proyectos')
      .select('id,numero,cliente,comercial,estado,cancelado,es_abrebotellas,entrega_fecha_raw,importe_fianza,forma_pago_fianza_id,estado_fianza_id,importe_devuelto_fianza,num_operacion_tpv_cobro,num_operacion_tpv_devolucion,updated_raw')
      .gt('importe_fianza', 0);
    if (error) throw error;
    const fianzas = filasFianzasDesdeProyectos(data);
    const ultimaAct = (data || []).reduce((max, p) => (p.updated_raw && p.updated_raw > max ? p.updated_raw : max), '');
    res.json({ ok: true, data: fianzas, kpis: kpisFianzas(fianzas), ultima_actualizacion: ultimaAct || null });
  } catch (err) {
    console.error('Error en /api/fianzas:', err);
    res.status(500).json({ error: 'Error al leer fianzas: ' + err.message });
  }
});
// Fuerza una relectura en vivo de Rentman (todos los proyectos, paginado) y
// vuelca solo los campos de fianza a Supabase - mismo cálculo que
// backfillFianzas() en OrumCentral.gs, aquí para poder pulsar un botón desde
// el panel sin esperar al webhook. No usa RENTMAN_TOKEN salvo aquí.
app.post('/api/fianzas/recargar', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase no configurado' });
    let all = [];
    let offset = 0;
    const limit = 300;
    while (true) {
      const r = await fetch(`${RENTMAN_URL}/projects?limit=${limit}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${RENTMAN_TOKEN}` }
      });
      if (!r.ok) throw new Error(`Rentman /projects devolvió ${r.status}`);
      const data = await r.json();
      const items = data.data || [];
      all = all.concat(items);
      if (items.length < limit) break;
      offset += limit;
    }
    const conFianza = all.filter(p => (parseFloat((p.custom || {}).custom_3) || 0) > 0);

    // Solo tocamos proyectos que YA existen en Supabase - descubierto en vivo
    // (9 sep 2026): un upsert parcial exige igualmente todas las columnas
    // NOT NULL aunque la fila ya exista (PostgREST no fusiona de verdad en
    // esta instancia), así que hace falta un UPDATE real por fila, no un
    // upsert por lotes. Un proyecto nunca sincronizado recibirá su fianza en
    // su próxima sincronización normal por webhook.
    let idsConocidos = new Set();
    {
      let off = 0;
      while (true) {
        const { data, error } = await supabase.from('proyectos').select('id').range(off, off + 999);
        if (error) throw error;
        (data || []).forEach(r => idsConocidos.add(r.id));
        if (!data || data.length < 1000) break;
        off += 1000;
      }
    }
    const filas = conFianza
      .filter(p => idsConocidos.has(p.id))
      .map(p => {
        const c = p.custom || {};
        return {
          id: p.id,
          importe_fianza: parseFloat(c.custom_3) || 0,
          forma_pago_fianza_id: c.custom_4 != null ? String(c.custom_4) : null,
          estado_fianza_id: c.custom_5 != null ? String(c.custom_5) : null,
          importe_devuelto_fianza: parseFloat(c.custom_6) || 0,
          num_operacion_tpv_cobro: c.custom_10 || null,
          num_operacion_tpv_devolucion: c.custom_15 || null,
          updated_raw: new Date().toISOString()
        };
      });
    const CONCURRENCIA = 20;
    let errores = 0;
    for (let i = 0; i < filas.length; i += CONCURRENCIA) {
      const tanda = filas.slice(i, i + CONCURRENCIA);
      const resultados = await Promise.all(tanda.map(({ id, ...campos }) =>
        supabase.from('proyectos').update(campos).eq('id', id)
      ));
      resultados.forEach(({ error }) => { if (error) { errores++; console.error('Error actualizando fianza:', error.message); } });
    }
    res.json({ ok: true, revisados: all.length, con_fianza: filas.length, errores, omitidos_sin_sync: conFianza.length - filas.length });
  } catch (err) {
    console.error('Error en /api/fianzas/recargar:', err);
    res.status(500).json({ error: 'Error al recargar desde Rentman: ' + err.message });
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
  // Algunos campos _raw de Supabase (confirmado en la tabla "servicios": 1313/1313
  // filas) llegan como "15/05/2026 00:00" en vez de solo "15/05/2026" — la hora
  // pegada rompía el split por '/' (el trozo del año quedaba "2026 00:00", que
  // Number() no puede convertir) y toda fecha con hora se descartaba en
  // silencio. Nos quedamos solo con la parte de fecha, antes del espacio.
  const soloFecha = String(str).trim().split(' ')[0];
  const partes = soloFecha.split('/');
  if (partes.length !== 3) return null;
  const anio = Number(partes[2]), mes = Number(partes[1]), dia = Number(partes[0]);
  if (!Number.isFinite(anio) || !Number.isFinite(mes) || !Number.isFinite(dia)) return null;
  const d = new Date(anio, mes - 1, dia);
  // new Date(NaN, NaN, NaN) no devuelve null, devuelve un objeto Date "Invalid
  // Date" — sigue siendo truthy en JS, así que sin este chequeo se cuela por
  // cualquier "if (!fecha) return" de quien llame a esta función y explota
  // más tarde (p.ej. RangeError: Invalid time value al hacer toISOString()).
  if (isNaN(d.getTime())) return null;
  return d;
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
      // Ordena primero por periodo (HOY antes que PRÓXIMOS 5 DÍAS) y, dentro
      // del mismo periodo, por fecha real - así la columna "Fecha entrega"
      // que ahora se muestra en el panel tiene un orden cronológico con sentido.
      detalle: porMaterial[familia][articulo].detalle.sort((a, b) => {
        const porPeriodo = ordenPeriodos.indexOf(a.periodo) - ordenPeriodos.indexOf(b.periodo);
        if (porPeriodo !== 0) return porPeriodo;
        const fa = parsearFechaDDMMYYYY(a.fecha_entrega), fb = parsearFechaDDMMYYYY(b.fecha_entrega);
        return (fa ? fa.getTime() : 0) - (fb ? fb.getTime() : 0);
      })
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

// ================================================================
// MANTENIMIENTO — Fase 1: aviso de material de "especial cuidado"
// ================================================================
// Rentman no tiene ninguna marca de "especial cuidado" en el material (sin
// tags, sin categoría dedicada) - cada categoría de abajo se detecta
// buscando que TODAS sus palabras (normalizadas, sin acentos) aparezcan en
// el nombre del artículo, en cualquier orden - así "sombrilla" encuentra
// todos los modelos de sombrilla, y "mesa vintage" no confunde con otras
// mesas. Las categorías con más palabras van primero (p.ej. "Mesa Ola
// Vintage" antes que "Mesa Vintage") para que un artículo que cumple ambas
// caiga en la más específica. Lista abierta: se amplía a mano según lo
// vaya pidiendo Logística.
const CATEGORIAS_ESPECIAL_CUIDADO = [
  { etiqueta: 'Nevera torre', palabras: ['nevera', 'torre'] },
  { etiqueta: 'Nevera botellero', palabras: ['nevera', 'botellero'] },
  { etiqueta: 'Paellera', palabras: ['paellera'] },
  { etiqueta: 'Fogón', palabras: ['fogon'] },
  { etiqueta: 'Microondas', palabras: ['microondas'] },
  { etiqueta: 'Freidora', palabras: ['freidora'] },
  { etiqueta: 'Congelador', palabras: ['congelador'] },
  { etiqueta: 'Barbacoa', palabras: ['barbacoa'] },
  { etiqueta: 'Armario caliente', palabras: ['armario', 'caliente'] },
  { etiqueta: 'Horno', palabras: ['horno'] },
  { etiqueta: 'Placa de inducción', palabras: ['induccion'] },
  { etiqueta: 'Estufa', palabras: ['estufa'] },
  { etiqueta: 'Sombrilla', palabras: ['sombrilla'] },
  { etiqueta: 'Sofá', palabras: ['sofa'] },
  { etiqueta: 'Puff', palabras: ['puff'] },
  { etiqueta: 'Mesa Ola Vintage', palabras: ['mesa', 'ola', 'vintage'] },
  { etiqueta: 'Mesa Vintage', palabras: ['mesa', 'vintage'] },
  { etiqueta: 'Mesa Isabel', palabras: ['mesa', 'isabel'] },
  { etiqueta: 'Mesa Teka', palabras: ['mesa', 'teka'] },
  { etiqueta: 'Sillón Emmanuel', palabras: ['sillon', 'emmanuel'] },
  { etiqueta: 'Mesa Bambú', palabras: ['mesa', 'bambu'] },
  { etiqueta: 'Mesa Tijera', palabras: ['mesa', 'tijera'] },
  { etiqueta: 'Mesa Donut', palabras: ['mesa', 'donut'] },
  { etiqueta: 'Barra', palabras: ['barra'] },
].map(c => ({ etiqueta: c.etiqueta, palabras: c.palabras.map(normalizarTexto) }));

function categoriaEspecialCuidado(articulo) {
  const a = normalizarTexto(articulo);
  return CATEGORIAS_ESPECIAL_CUIDADO.find(c => c.palabras.every(palabra => a.indexOf(palabra) !== -1)) || null;
}

app.get('/api/mantenimiento', requiereLogin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase no configurado' });
    const [proyectosResp, equipmentResp, checksResp] = await Promise.all([
      llamarOrumCentral('proyectos'),
      llamarOrumCentral('equipment'),
      supabase.from('mantenimiento_checks').select('*')
    ]);
    if (checksResp.error) throw checksResp.error;

    const proyectosConfirmados = (proyectosResp.data || []).filter(p => p.cancelado !== 'SI' && !ESTADOS_EXCLUIR_NOMBRE.includes(normalizarTexto(p.estado)));
    const proyectoPorId = {};
    proyectosConfirmados.forEach(p => { proyectoPorId[String(p.id)] = p; });

    const checksPorClave = {};
    (checksResp.data || []).forEach(c => { checksPorClave[c.clave] = c; });

    // Ventana de 14 días (2 semanas) desde hoy, pedida explícitamente.
    const hoy = inicioDelDia(new Date());
    const limite = new Date(hoy); limite.setDate(limite.getDate() + 14);

    // Un mismo artículo "especial" suele venir partido en varias líneas de
    // Rentman (p.ej. sombrilla + pie + protector, las 3 con la palabra
    // "sombrilla" y la MISMA cantidad) - se agrupan aquí por proyecto +
    // categoría en una sola salida, con la cantidad máxima vista (evita
    // sumar 3 veces lo que es 1 unidad física) y la lista de artículos
    // reales como detalle.
    const gruposPorProyectoYCategoria = {};
    (equipmentResp.data || []).forEach(e => {
      const categoria = categoriaEspecialCuidado(e.articulo);
      if (!categoria) return;
      const proyecto = proyectoPorId[String(e.proyecto_id)];
      if (!proyecto) return;
      const fecha = parsearFechaDDMMYYYY(proyecto.entrega_fecha);
      if (!fecha) return;
      const fechaDia = inicioDelDia(fecha);
      if (fechaDia < hoy || fechaDia > limite) return;
      const key = String(e.proyecto_id) + '::' + categoria.etiqueta;
      if (!gruposPorProyectoYCategoria[key]) {
        gruposPorProyectoYCategoria[key] = { proyecto, categoria: categoria.etiqueta, cantidad: 0, articulos: new Set() };
      }
      const grupo = gruposPorProyectoYCategoria[key];
      const cantidad = parseFloat(e.cantidad) || 0;
      if (cantidad > grupo.cantidad) grupo.cantidad = cantidad;
      grupo.articulos.add(e.articulo);
    });

    // Agrupado por tipo de material (categoría) - dentro de cada tipo, una
    // fila por salida (proyecto), ordenadas por fecha.
    const tiposPorEtiqueta = {};
    Object.values(gruposPorProyectoYCategoria).forEach(g => {
      if (!tiposPorEtiqueta[g.categoria]) tiposPorEtiqueta[g.categoria] = { tipo: g.categoria, total_unidades: 0, pendientes: 0, salidas: [] };
      const tipo = tiposPorEtiqueta[g.categoria];
      // Clave = proyecto + categoría: identifica ESA salida concreta. Si el
      // mismo tipo de material vuelve a salir en otro proyecto más
      // adelante, es una clave distinta y aparece sin marcar - revisión
      // "por salida concreta", no permanente.
      const clave = String(g.proyecto.id) + '::' + g.categoria;
      const check = checksPorClave[clave];
      const revisado = !!(check && check.revisado);
      tipo.total_unidades += g.cantidad;
      if (!revisado) tipo.pendientes++;
      tipo.salidas.push({
        clave,
        proyecto_id: g.proyecto.id,
        proyecto_numero: g.proyecto.numero,
        cliente: g.proyecto.cliente,
        localizacion: g.proyecto.localizacion,
        google_maps_url: g.proyecto.google_maps_url || null,
        fecha_entrega: g.proyecto.entrega_fecha,
        cantidad: g.cantidad,
        articulos: Array.from(g.articulos),
        revisado,
        revisado_por: check ? check.revisado_por : null
      });
    });

    const tipos = Object.values(tiposPorEtiqueta).sort((a, b) => a.tipo.localeCompare(b.tipo));
    tipos.forEach(t => t.salidas.sort((a, b) => parsearFechaDDMMYYYY(a.fecha_entrega) - parsearFechaDDMMYYYY(b.fecha_entrega)));

    res.json({ ok: true, tipos, ultima_actualizacion: proyectosResp.ultima_actualizacion });
  } catch (err) {
    console.error('Error en /api/mantenimiento:', err);
    res.status(500).json({ error: 'Error al leer mantenimiento: ' + err.message });
  }
});

// Marca/desmarca la revisión de mantenimiento de una salida concreta
// (proyecto + tipo de material). Sin fila en la tabla = no revisado; con
// fila y revisado=true = comprobado por mantenimiento para ESA salida.
app.post('/api/mantenimiento/check', requiereLogin, async (req, res) => {
  try {
    if (!supabase) return res.status(500).json({ error: 'Supabase no configurado' });
    const { clave, proyecto_id, tipo, revisado } = req.body || {};
    if (!clave || !proyecto_id || !tipo) return res.status(400).json({ error: 'Faltan datos' });
    if (revisado) {
      const { error } = await supabase.from('mantenimiento_checks').upsert({
        clave, proyecto_id: String(proyecto_id), articulo: tipo,
        revisado: true,
        revisado_por: req.session.usuario.nombre || req.session.usuario.usuario,
        revisado_ts: new Date().toISOString(),
        updated_raw: new Date().toISOString()
      });
      if (error) throw error;
    } else {
      const { error } = await supabase.from('mantenimiento_checks').delete().eq('clave', clave);
      if (error) throw error;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('Error en /api/mantenimiento/check:', err);
    res.status(500).json({ error: 'Error al guardar la revisión: ' + err.message });
  }
});

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

// ================================================================
// SERVICIOS EXTRA — próximos 15 días (Logística). Engloba los servicios
// adicionales que contratan los clientes (desplazamiento, montaje,
// nocturnidad, domingo, etc. — lo que sea que traiga Rentman en la tabla
// "servicios") agrupados por día, para tenerlos en cuenta de cara a la ruta.
// Misma tabla Supabase que ya usa la pestaña "Servicios" de Preparación
// (Almacén), pero aquí en ventana de 15 días y agrupado día a día en vez
// de solo "próximos 14 días" sin fecha exacta.
// ================================================================

// Festivos puntuales entregados a mano por el usuario ("Días importantes"),
// formato dd-mm-yyyy tal cual. Lista concreta, no recurrente — si el usuario
// quiere que cubra más años hay que ampliarla (los festivos locales de
// Marbella, p.ej., no siguen ninguna fórmula, no se pueden calcular).
const FESTIVOS_FIJOS = [
  '25-12-2024', '06-12-2025', '08-12-2025', '24-12-2025', '01-01-2026', '06-01-2026',
  '28-02-2026', '01-05-2026', '11-06-2026', '15-08-2026', '12-10-2026', '19-10-2026',
  '01-11-2026', '31-12-2026'
];
// Jueves y Viernes Santo cambian cada año (dependen de la Pascua) — se
// calculan con el algoritmo de Meeus/Jones/Butcher (calendario gregoriano)
// en vez de tenerlos a mano, para no tener que acordarse de actualizarlos.
function calcularDomingoPascua(anio) {
  const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(anio, mes - 1, dia);
}
function festivosSemanaSanta(anio) {
  const pascua = calcularDomingoPascua(anio);
  const viernesSanto = new Date(pascua); viernesSanto.setDate(pascua.getDate() - 2);
  const juevesSanto = new Date(pascua); juevesSanto.setDate(pascua.getDate() - 3);
  return [juevesSanto, viernesSanto];
}
function fechaAIso_(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function construirSetFestivos() {
  const anioActual = new Date().getFullYear();
  const fechas = new Set();
  FESTIVOS_FIJOS.forEach(f => {
    const [d, m, y] = f.split('-');
    fechas.add(y + '-' + m.padStart(2, '0') + '-' + d.padStart(2, '0'));
  });
  for (let y = anioActual - 1; y <= anioActual + 2; y++) {
    festivosSemanaSanta(y).forEach(dt => fechas.add(fechaAIso_(dt)));
  }
  return fechas;
}
const FESTIVOS_SET = construirSetFestivos();
function esFechaFestiva(d) { return !!d && FESTIVOS_SET.has(fechaAIso_(d)); }

// Confirmado con datos reales de Rentman (/projectfunctions): "TRANSPORTE"
// aparece en casi todos los proyectos (no es una "extra" real, es la base) y
// "RECOGIDA DIA SIGUIENTE" tampoco cuenta como extra a efectos de ruta —
// "MATERIAL OPCIONAL BARRA" tampoco (pedido explícito del usuario). El resto
// (montaje/desmontaje, nocturno, domingo, desplazamiento...) sí interesa.
const SERVICIOS_EXTRA_EXCLUIR = ['transporte', 'recogida dia siguiente', 'material opcional barra'];
function esServicioExtraRelevante(nombre) {
  const n = normalizarTexto(nombre);
  return !SERVICIOS_EXTRA_EXCLUIR.some(ex => n.indexOf(ex) !== -1);
}
// La tabla "servicios" solo guarda UNA fecha por línea (la de entrega del
// proyecto — así la escribe el sync en OrumCentral.gs), pero varios tipos de
// servicio en realidad corresponden a otro día del proyecto. Corregido según
// lo pedido explícitamente por el usuario, usando entrega_fecha/recogida_fecha
// del propio proyecto:
//  - MONTAJE (no DESMONTAJE)  → día de entrega
//  - DESMONTAJE               → día de recogida
//  - DOMINGO/FESTIVO          → el que de los dos (entrega o recogida) caiga
//                               en domingo O en la lista FESTIVOS_SET (fija +
//                               Jueves/Viernes Santo calculados). Si ninguno
//                               coincide, se deja en el día de entrega.
//  - DESPLAZAMIENTO           → sale EN AMBOS días (entrega y recogida, si
//                               son distintos) para que no se olvide en
//                               ninguno de los dos viajes.
//  - cualquier otro (nocturno, material...) → se queda en el día de entrega
//    tal cual venía — no hay forma de saber a qué noche concreta se refiere.
// Devuelve un array de fechas (normalmente 1, dos para desplazamiento).
function fechasEfectivasServicio(servicioNombre, proyecto, fechaOriginal) {
  const n = normalizarTexto(servicioNombre);
  const entrega = parsearFechaDDMMYYYY(proyecto.entrega_fecha) || fechaOriginal;
  const recogida = parsearFechaDDMMYYYY(proyecto.recogida_fecha);

  if (n.indexOf('desmontaje') !== -1) return [recogida || entrega];
  if (n.indexOf('montaje') !== -1) return [entrega];
  if (n.indexOf('desplaz') !== -1) {
    const out = entrega ? [entrega] : [];
    if (recogida && (!entrega || recogida.getTime() !== entrega.getTime())) out.push(recogida);
    return out.length ? out : [fechaOriginal];
  }
  if (n.indexOf('doming') !== -1 || n.indexOf('festivo') !== -1) {
    if (entrega && (entrega.getDay() === 0 || esFechaFestiva(entrega))) return [entrega];
    if (recogida && (recogida.getDay() === 0 || esFechaFestiva(recogida))) return [recogida];
    return [entrega];
  }
  return [fechaOriginal || entrega];
}
async function construirServiciosExtra() {
  const [serviciosResp, proyectosResp] = await Promise.all([
    llamarOrumCentral('servicios'),
    llamarOrumCentral('proyectos')
  ]);
  // Solo fase confirmada: fuera cancelados y fuera todavía-en-comercial
  // (Pending/Concept/Inquiry — mismo criterio "todavía sin decidir" que ya
  // usan Financiero y Presupuestos, ESTADOS_PIPELINE_NOMBRE).
  const proyectos = (proyectosResp.data || []).filter(p =>
    p.cancelado !== 'SI' && !ESTADOS_PIPELINE_NOMBRE.includes(normalizarTexto(p.estado))
  );
  const proyectoPorId = {};
  proyectos.forEach(p => { proyectoPorId[String(p.id)] = p; });

  const hoy = inicioDelDia(new Date());
  const hoyMs = hoy.getTime();
  const limiteMs = hoyMs + 15 * 86400000;

  const items = [];
  (serviciosResp.data || []).forEach(s => {
    if (!esServicioExtraRelevante(s.servicio)) return;
    const proyecto = proyectoPorId[String(s.proyecto_id)] || {};
    const fechaOriginal = parsearFechaDDMMYYYY(s.fecha_entrega);
    const fechas = fechasEfectivasServicio(s.servicio, proyecto, fechaOriginal);
    fechas.forEach(fecha => {
      if (!fecha) return;
      const fechaDia = inicioDelDia(fecha);
      const fechaMs = fechaDia.getTime();
      if (fechaMs < hoyMs || fechaMs > limiteMs) return;
      items.push({
        fecha_ms: fechaMs, fecha_iso: fechaDia.toISOString().slice(0, 10),
        proyecto_id: s.proyecto_id, proyecto_numero: s.numero || proyecto.numero || null,
        proyecto_nombre: proyecto.nombre || '', cliente: proyecto.cliente || '', comercial: proyecto.comercial || '',
        estado: proyecto.estado || '', localizacion: proyecto.localizacion || '', google_maps_url: proyecto.google_maps_url || '',
        entrega_hora: proyecto.entrega_hora || '', recogida_fecha: proyecto.recogida_fecha || '', recogida_hora: proyecto.recogida_hora || '',
        servicio: s.servicio || 'Sin especificar', cantidad: s.cantidad, importe: s.importe
      });
    });
  });
  items.sort((a, b) => a.fecha_ms - b.fecha_ms || String(a.cliente).localeCompare(String(b.cliente)));

  // Agrupado día → proyecto: si un proyecto tiene varios servicios extra el
  // mismo día (p.ej. NOCTURNO + DOMINGO/FESTIVO + DESPLAZAMIENTO), sale en
  // una sola tarjeta con varios badges, no una tarjeta por servicio.
  const porDiaMap = {};
  items.forEach(it => {
    if (!porDiaMap[it.fecha_iso]) {
      porDiaMap[it.fecha_iso] = { fecha_iso: it.fecha_iso, dias_desde_hoy: Math.round((it.fecha_ms - hoyMs) / 86400000), proyectos: {} };
    }
    const dia = porDiaMap[it.fecha_iso];
    const clave = String(it.proyecto_id);
    if (!dia.proyectos[clave]) {
      dia.proyectos[clave] = {
        proyecto_id: it.proyecto_id, proyecto_numero: it.proyecto_numero, proyecto_nombre: it.proyecto_nombre,
        cliente: it.cliente, comercial: it.comercial, estado: it.estado, localizacion: it.localizacion,
        google_maps_url: it.google_maps_url, entrega_hora: it.entrega_hora, recogida_fecha: it.recogida_fecha, recogida_hora: it.recogida_hora,
        servicios: []
      };
    }
    dia.proyectos[clave].servicios.push({ servicio: it.servicio, cantidad: it.cantidad, importe: it.importe });
  });
  const porDia = Object.keys(porDiaMap).sort().map(k => {
    const d = porDiaMap[k];
    const proyectos = Object.keys(d.proyectos).map(pk => d.proyectos[pk])
      .sort((a, b) => String(a.cliente).localeCompare(String(b.cliente)));
    return { fecha_iso: d.fecha_iso, dias_desde_hoy: d.dias_desde_hoy, proyectos };
  });
  const tipos = [...new Set(items.map(it => it.servicio))].sort();

  // Alerta: entrega o recogida que cae en domingo/festivo pero el proyecto
  // NO tiene ningún servicio "Domingo/Festivo" dado de alta — para pillar el
  // despiste antes de que llegue el día (pedido explícito del usuario).
  const proyectoIdsConDomingoFestivo = new Set();
  (serviciosResp.data || []).forEach(s => {
    const n = normalizarTexto(s.servicio);
    if (n.indexOf('doming') !== -1 || n.indexOf('festivo') !== -1) proyectoIdsConDomingoFestivo.add(String(s.proyecto_id));
  });
  const alertas = [];
  proyectos.forEach(p => {
    [['entrega', p.entrega_fecha], ['recogida', p.recogida_fecha]].forEach(([tipoFecha, fechaStr]) => {
      const fecha = parsearFechaDDMMYYYY(fechaStr);
      if (!fecha) return;
      const fechaDia = inicioDelDia(fecha);
      const fechaMs = fechaDia.getTime();
      if (fechaMs < hoyMs || fechaMs > limiteMs) return;
      const esDomingo = fechaDia.getDay() === 0;
      const esFestivo = esFechaFestiva(fechaDia);
      if (!esDomingo && !esFestivo) return;
      if (proyectoIdsConDomingoFestivo.has(String(p.id))) return; // ya contemplado
      alertas.push({
        proyecto_id: p.id, proyecto_numero: p.numero, cliente: p.cliente,
        tipo_fecha: tipoFecha, fecha_iso: fechaAIso_(fechaDia), motivo: esDomingo ? 'domingo' : 'festivo'
      });
    });
  });
  alertas.sort((a, b) => a.fecha_iso.localeCompare(b.fecha_iso));

  // ultima_actualizacion real (de la tabla "proyectos" en Supabase) — antes
  // esta pantalla no lo devolvía y el reloj "Actualizado" de arriba se
  // quedaba con la hora de la última página que sí lo pintaba, dando la
  // falsa impresión de que los datos estaban desactualizados.
  return { ok: true, total: items.length, tipos, por_dia: porDia, alertas, ultima_actualizacion: proyectosResp.ultima_actualizacion || null };
}

app.get('/api/logistica/servicios-extra', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    res.json(await construirServiciosExtra());
  } catch (err) {
    console.error('Error en /api/logistica/servicios-extra:', err);
    res.status(500).json({ error: 'Error al construir servicios extra: ' + err.message });
  }
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

// ── ESTADO DE PAGO + SERVICIOS EXTRA por proyecto (App de Rutas) ──
// Pedido por el usuario (11 sep 2026): que Leo, al organizar la ruta, vea
// si el proyecto está pagado antes de sacarlo de almacén, y si tiene
// servicios extra de personal contratados (montaje, desplazamiento,
// domingo/festivo...).
// Semáforo (mismo criterio que /api/financiero):
//   rojo     → no hay factura emitida (PNC: nada confirmado en Caja)
//   amarillo → factura emitida pero no cobrada del todo (PNC: confirmado parcial)
//   verde    → factura emitida y cobrada del todo (PNC: importe esperado ya confirmado en Caja)
//   azul     → cliente con condición de pago a 30 días (pendiente: el
//              usuario aún no ha decidido cómo identificar a estos
//              clientes — la lista de abajo queda vacía a propósito hasta
//              que la defina; el resto del semáforo ya funciona igual).
const CLIENTES_PAGO_30_DIAS = []; // TODO: rellenar cuando el usuario decida cómo identificarlos (ver conversación 11 sep 2026)
app.get('/api/rutas/estado-pago', async (req, res) => {
  if (req.query.token !== 'ORUMx2026RutasPublic' && !req.session.usuario) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const [proyectosResp, facturasResp, cajaResp, serviciosResp] = await Promise.all([
      llamarOrumCentral('proyectos'),
      llamarOrumCentral('facturas'),
      llamarOrumCentral('caja'),
      llamarOrumCentral('servicios')
    ]);
    const proyectos = (proyectosResp.data || []).filter(p => p.cancelado !== 'SI');
    const facturas = facturasResp.data || [];
    const ncConfirmaciones = cajaResp.nc_confirmaciones || [];
    const servicios = serviciosResp.data || [];

    const facturasPorProyectoId = {};
    facturas.forEach(f => {
      const pid = String(f.proyecto_id);
      if (!facturasPorProyectoId[pid]) facturasPorProyectoId[pid] = [];
      facturasPorProyectoId[pid].push(f);
    });
    // Solo cuenta lo que Contabilidad ya confirmó como recibido en Caja
    // (caja_nc_confirmaciones), no el formulario en bruto de cobro.
    const ncConfirmadoPorNumero = {};
    ncConfirmaciones.forEach(c => {
      if (c.confirmado !== true && c.confirmado !== 'SI') return;
      const num = String(c.numero);
      ncConfirmadoPorNumero[num] = (ncConfirmadoPorNumero[num] || 0) + (parseFloat(c.importe) || 0);
    });
    const serviciosPorProyectoId = {};
    servicios.forEach(s => {
      if (!esServicioExtraRelevante(s.servicio)) return;
      const pid = String(s.proyecto_id);
      if (!serviciosPorProyectoId[pid]) serviciosPorProyectoId[pid] = [];
      serviciosPorProyectoId[pid].push({ servicio: s.servicio, cantidad: s.cantidad, importe: s.importe });
    });

    const resultado = {};
    proyectos.forEach(p => {
      const esPNC = p.es_abrebotellas === 'SI' || p.es_abrebotellas === true;
      let estadoPago, detallePago;
      if (CLIENTES_PAGO_30_DIAS.some(c => normalizarTexto(c) === normalizarTexto(p.cliente || ''))) {
        estadoPago = 'azul';
        detallePago = { motivo: 'Cliente con pago a 30 días — confirmar con Administración antes de sacar el proyecto' };
      } else if (esPNC) {
        const valorEsperado = parseFloat(p.valor) || 0;
        const confirmado = ncConfirmadoPorNumero[String(p.numero)] || 0;
        if (confirmado <= 0) estadoPago = 'rojo';
        else if (confirmado + 0.05 < valorEsperado) estadoPago = 'amarillo';
        else estadoPago = 'verde';
        detallePago = { es_pnc: true, valor_esperado: Math.round(valorEsperado * 100) / 100, confirmado_en_caja: Math.round(confirmado * 100) / 100 };
      } else {
        const facturasProyecto = facturasPorProyectoId[String(p.id)] || [];
        if (facturasProyecto.length === 0) {
          estadoPago = 'rojo';
          detallePago = { es_pnc: false, total_facturado: 0, pendiente_cobro: 0 };
        } else {
          const totalFacturado = facturasProyecto.reduce((s, f) => s + (parseFloat(f.importe_con_iva) || 0), 0);
          const pendiente = facturasProyecto.reduce((s, f) => s + (parseFloat(f.pendiente_cobro) || 0), 0);
          estadoPago = pendiente > 0.05 ? 'amarillo' : 'verde';
          detallePago = { es_pnc: false, total_facturado: Math.round(totalFacturado * 100) / 100, pendiente_cobro: Math.round(pendiente * 100) / 100 };
        }
      }
      const serviciosExtra = serviciosPorProyectoId[String(p.id)] || [];
      resultado[String(p.id)] = { estado_pago: estadoPago, detalle_pago: detallePago, servicios_extra: serviciosExtra };
    });

    res.json({ ok: true, estado_pago: resultado });
  } catch (err) {
    console.error('Error en GET /api/rutas/estado-pago:', err);
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

const MESES_ES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

// Sacado a función aparte (10 sep 2026) para poder reutilizarla también desde
// /api/cierre-mensual (Gastos del cierre = mismas facturas de proveedores ya
// clasificadas por departamento, agregadas por mes en vez de listadas suelta).
async function obtenerFacturasProveedoresEnriquecidas() {
  const paramsListado = new URLSearchParams({ token: APPS_SCRIPT_FACTURAS_TOKEN, action: 'listado' });
  const paramsReparto = new URLSearchParams({ token: APPS_SCRIPT_FACTURAS_TOKEN, action: 'reparto' });
  const [respListado, respReparto] = await Promise.all([fetch(`${APPS_SCRIPT_FACTURAS_URL}?${paramsListado.toString()}`), fetch(`${APPS_SCRIPT_FACTURAS_URL}?${paramsReparto.toString()}`)]);
  const dataListado = await respListado.json();
  const dataReparto = await respReparto.json();
  if (dataListado.error) throw new Error(dataListado.error);
  if (dataReparto.error) throw new Error(dataReparto.error);

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

  return { facturasEnriquecidas, repartoPorProveedor };
}

app.get('/api/facturas-proveedores', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const { facturasEnriquecidas, repartoPorProveedor } = await obtenerFacturasProveedoresEnriquecidas();

    const totalesPorDepartamento = {};
    facturasEnriquecidas.forEach(f => f.desglose_departamentos.forEach(d => { totalesPorDepartamento[d.departamento] = (totalesPorDepartamento[d.departamento] || 0) + d.importe; }));
    const resumenDepartamentos = Object.keys(totalesPorDepartamento).map(dep => ({ departamento: dep, total: Math.round(totalesPorDepartamento[dep] * 100) / 100 })).sort((a, b) => b.total - a.total);

    res.json({ ok: true, facturas: facturasEnriquecidas, resumen_departamentos: resumenDepartamentos, proveedores_sin_clasificar: [...new Set(facturasEnriquecidas.filter(f => !repartoPorProveedor[String(f.proveedor)]).map(f => f.proveedor))] });
  } catch (err) {
    console.error('Error en /api/facturas-proveedores:', err);
    res.status(500).json({ error: 'Error al obtener facturas: ' + err.message });
  }
});

// ================================================================
// GASTOS ANUALES (10 sep 2026) — Financiero → Config. Pagos Anuales.
// Partidas que se pagan de golpe una vez al año (seguros de vehículos,
// impuestos, IBI, IAE...) pero que Cierre Mensual reparte a partes iguales
// entre los 12 meses del año — mismo criterio que ya hacía a mano el
// Excel (columna "(ANUAL X€)" dividida entre 12).
//
// Tabla Supabase nueva - crear UNA VEZ desde el SQL editor de Supabase:
//   create table gastos_anuales (
//     id bigint generated always as identity primary key,
//     concepto text not null,
//     categoria text not null,
//     importe_anual numeric not null default 0,
//     anio integer not null,
//     notas text,
//     creado_por text,
//     created_at timestamptz not null default now()
//   );
// ================================================================
const CATEGORIAS_GASTO_ANUAL = ['Impuestos', 'Seguros Vehículos', 'Seguros Propiedades', 'Suministros', 'Financiación', 'Alquiler / Renting', 'Otros'];

app.get('/api/gastos-anuales', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const { data, error } = await supabase.from('gastos_anuales').select('*').eq('anio', anio).order('categoria').order('concepto');
    if (error) throw error;
    res.json({
      ok: true, categorias: CATEGORIAS_GASTO_ANUAL,
      data: (data || []).map(r => ({ ...r, importe_mensual: Math.round((parseFloat(r.importe_anual) || 0) / 12 * 100) / 100 }))
    });
  } catch (err) {
    console.error('Error en /api/gastos-anuales:', err);
    res.status(500).json({ error: 'Error al leer gastos anuales: ' + err.message });
  }
});

app.post('/api/gastos-anuales', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const b = req.body;
    if (!b.concepto || !b.categoria || b.importe_anual === undefined || b.importe_anual === '') {
      return res.status(400).json({ error: 'Concepto, categoría e importe anual son obligatorios' });
    }
    const usuario = req.session.usuario.nombre || req.session.usuario.usuario;
    const { data, error } = await supabase.from('gastos_anuales').insert({
      concepto: b.concepto, categoria: b.categoria, importe_anual: Number(b.importe_anual) || 0,
      anio: parseInt(b.anio) || new Date().getFullYear(), notas: b.notas || null, creado_por: usuario
    }).select().single();
    if (error) throw error;
    res.json({ ok: true, gasto: data });
  } catch (err) {
    console.error('Error en POST /api/gastos-anuales:', err);
    res.status(500).json({ error: 'Error al guardar: ' + err.message });
  }
});

app.put('/api/gastos-anuales/:id', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const b = req.body;
    const campos = {};
    if (b.concepto !== undefined) campos.concepto = b.concepto;
    if (b.categoria !== undefined) campos.categoria = b.categoria;
    if (b.importe_anual !== undefined) campos.importe_anual = Number(b.importe_anual) || 0;
    if (b.anio !== undefined) campos.anio = parseInt(b.anio) || new Date().getFullYear();
    if (b.notas !== undefined) campos.notas = b.notas || null;
    const { error } = await supabase.from('gastos_anuales').update(campos).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('Error en PUT /api/gastos-anuales:', err);
    res.status(500).json({ error: 'Error al actualizar: ' + err.message });
  }
});

app.delete('/api/gastos-anuales/:id', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const { error } = await supabase.from('gastos_anuales').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar: ' + err.message });
  }
});

// ================================================================
// GASTOS DE PERSONAL — NÓMINAS (11 sep 2026) — Financiero → Personal.
// Cada mes se sube el .xls que da la gestoría (una fila por trabajador con
// su coste total, IRPF, SS empresa...) y se guarda el detalle completo de
// cada trabajador (decidido así con el usuario en vez de guardar solo el
// total del mes, para poder informar por trabajador más adelante). El coste
// de cada trabajador se reparte a un único departamento fijo (tabla
// empleados_departamento, se rellena sola con "sin clasificar" al subir una
// nómina con trabajadores nuevos) — a diferencia del reparto en % que usa
// Facturas Proveedores, aquí cada trabajador pertenece a un solo depto.
// "Extras" (segundo gasto de Personal, hoy en una hoja de Sheets aparte)
// queda pendiente de enganchar - falta el enlace de esa hoja.
//
// Tablas Supabase nuevas - crear UNA VEZ desde el SQL editor de Supabase:
//   create table nominas_detalle (
//     id bigint generated always as identity primary key,
//     anio integer not null,
//     mes integer not null,
//     empresa_nif text not null,
//     empresa_nombre text not null,
//     formato_origen text not null default 'nominas_gestoria',
//     num_empleado integer not null,
//     nombre text not null,
//     bruto numeric not null default 0,
//     dcto_irpf numeric not null default 0,
//     otros_desc numeric not null default 0,
//     total_desctos numeric not null default 0,
//     neto numeric not null default 0,
//     bonificacion numeric not null default 0,
//     prestac_it numeric not null default 0,
//     ss_empresa numeric not null default 0,
//     total_ss numeric not null default 0,
//     coste_total numeric not null default 0,
//     subido_por text,
//     created_at timestamptz not null default now(),
//     updated_at timestamptz not null default now(),
//     unique (anio, mes, empresa_nif, formato_origen, num_empleado)
//   );
//   create table empleados_departamento (
//     id bigint generated always as identity primary key,
//     empresa_nif text not null,
//     empresa_nombre text not null,
//     formato_origen text not null default 'nominas_gestoria',
//     num_empleado integer not null,
//     nombre text not null,
//     departamento text,
//     updated_at timestamptz not null default now(),
//     unique (empresa_nif, formato_origen, num_empleado)
//   );
//   -- "Fusiona" un trabajador de un formato antiguo (ej. Resumen Contable
//   -- 2025, código propio de esa gestoría) con su equivalente en el
//   -- formato actual, para poder comparar a la misma persona entre años en
//   -- el Informe. Solo afecta a la vista "por trabajador" - el reparto por
//   -- departamento (Cierre Mensual) NO depende de esto, ya funciona bien
//   -- con formato_origen en la clave de empleados_departamento.
//   create table empleados_alias (
//     empresa_nif text not null,
//     formato_origen text not null,
//     num_empleado integer not null,
//     num_empleado_canonico integer,
//     updated_at timestamptz not null default now(),
//     primary key (empresa_nif, formato_origen, num_empleado)
//   );
//
//   -- MIGRACIÓN si nominas_detalle/empleados_departamento ya existían de
//   -- antes (11 sep 2026, antes de añadir formato_origen) - ejecutar UNA
//   -- VEZ, sustituye a los "create table" de arriba para esas 2 tablas:
//   alter table nominas_detalle add column if not exists formato_origen text not null default 'nominas_gestoria';
//   alter table nominas_detalle drop constraint if exists nominas_detalle_anio_mes_empresa_nif_num_empleado_key;
//   alter table nominas_detalle add constraint nominas_detalle_anio_mes_empresa_nif_formato_num_key unique (anio, mes, empresa_nif, formato_origen, num_empleado);
//   alter table empleados_departamento add column if not exists formato_origen text not null default 'nominas_gestoria';
//   alter table empleados_departamento drop constraint if exists empleados_departamento_empresa_nif_num_empleado_key;
//   alter table empleados_departamento add constraint empleados_departamento_empresa_nif_formato_origen_num_empleado_key unique (empresa_nif, formato_origen, num_empleado);
// ================================================================
const uploadNomina = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function normalizarCabeceraNomina(v) {
  // NFD + quitar diacríticos ANTES de tirar lo no alfanumérico, si no "Cód."
  // quedaría "CD" en vez de "COD" (mismo motivo que en el matching de
  // nombres del frontend, ver normalizarTokensPersona en index.html).
  return String(v == null ? '' : v).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '');
}

// Parsea el .xls de nóminas (formato fijo de la gestoría, ver memoria del
// proyecto): cabecera con periodo ("DEL dd/mm/aaaa AL dd/mm/aaaa") y línea
// "Empresa: <nombre> NIF: <nif>", seguido de una fila de títulos de columna
// (con "TRABAJADOR" como ancla) y una fila por trabajador debajo.
function parsearNominaXLS(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null });

  const rePeriodo = /DEL\s+(\d{2})\/(\d{2})\/(\d{4})\s+AL\s+(\d{2})\/(\d{2})\/(\d{4})/i;
  const reEmpresa = /Empresa:\s*(.+?)\s*NIF:\s*([A-Z0-9]+)/i;
  let mes = null, anio = null, empresaNombre = null, empresaNif = null, filaCabecera = -1;

  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i] || [];
    for (const celda of fila) {
      if (celda == null) continue;
      const texto = String(celda);
      if (!mes) {
        const m = texto.match(rePeriodo);
        if (m) { mes = parseInt(m[5]); anio = parseInt(m[6]); }
      }
      if (!empresaNif) {
        const m = texto.match(reEmpresa);
        if (m) { empresaNombre = m[1].trim(); empresaNif = m[2].trim(); }
      }
      if (normalizarCabeceraNomina(celda) === 'TRABAJADOR') filaCabecera = i;
    }
    if (filaCabecera >= 0) break;
  }

  if (filaCabecera < 0) throw new Error('No se encontró la columna "TRABAJADOR" — revisa que el archivo tenga el formato habitual de la gestoría.');
  if (!mes || !anio) throw new Error('No se encontró el periodo ("DEL .../.../... AL .../.../...") en el archivo.');
  if (!empresaNif) throw new Error('No se encontró la línea "Empresa: ... NIF: ..." en el archivo.');

  const col = {};
  (filas[filaCabecera] || []).forEach((celda, idx) => {
    const n = normalizarCabeceraNomina(celda);
    if (n === 'TRABAJADOR') { col.nombre = idx; col.numero = idx - 1; }
    else if (n === 'BRUTO') col.bruto = idx;
    else if (n === 'DCTOIRPF') col.dcto_irpf = idx;
    else if (n === 'OTROSDESC') col.otros_desc = idx;
    else if (n === 'TDESCTOS') col.total_desctos = idx;
    else if (n === 'NETO') col.neto = idx;
    else if (n.startsWith('BONIFIC')) col.bonificacion = idx;
    else if (n.startsWith('PRESTAC')) col.prestac_it = idx;
    else if (n === 'SSEMPRESA') col.ss_empresa = idx;
    else if (n === 'TOTALSS') col.total_ss = idx;
    else if (n.startsWith('COSTETOT')) col.coste_total = idx;
  });
  ['nombre', 'numero', 'bruto', 'coste_total'].forEach(k => {
    if (col[k] === undefined) throw new Error('No se reconoce el formato del archivo: falta la columna "' + k + '".');
  });

  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : Math.round(n * 100) / 100; };
  const empleados = [];
  for (let i = filaCabecera + 1; i < filas.length; i++) {
    const fila = filas[i] || [];
    const numero = fila[col.numero];
    const nombre = fila[col.nombre];
    if (numero == null || nombre == null || String(nombre).trim() === '') continue;
    const numeroInt = parseInt(numero);
    if (isNaN(numeroInt)) continue;
    empleados.push({
      num_empleado: numeroInt, nombre: String(nombre).trim(),
      bruto: num(fila[col.bruto]), dcto_irpf: num(fila[col.dcto_irpf]), otros_desc: num(fila[col.otros_desc]),
      total_desctos: num(fila[col.total_desctos]), neto: num(fila[col.neto]), bonificacion: num(fila[col.bonificacion]),
      prestac_it: num(fila[col.prestac_it]), ss_empresa: num(fila[col.ss_empresa]), total_ss: num(fila[col.total_ss]),
      coste_total: num(fila[col.coste_total])
    });
  }
  if (empleados.length === 0) throw new Error('No se encontró ninguna fila de trabajador con datos en el archivo.');

  return { anio, mes, empresaNombre, empresaNif, empleados, formatoOrigen: 'nominas_gestoria' };
}

const MESES_ES_MAYUS = MESES_ES.map(m => m ? m.toUpperCase() : m);

// Segundo formato, usado antes del cambio de gestoría (2025 - abril 2026,
// ver memoria del proyecto): "Resumen Contable" en vez de listado de
// nóminas. Cabecera "Empresa: <nombre> ... Cif: <nif>" (con Cif, no NIF) y
// "Período" con el mes en texto ("Enero del 2025" / "OCTUBRE del Ejercicio
// 2025" - la redacción varía según el mes exportado). Columnas: Cód.,
// Nombre, Centro, Departamento (siempre vacía en la práctica), Tipo, Días,
// Base C.C., Base C.P., Retribuc., Costes Trab., Valor Esp., Deducción,
// Costes Emp., Base IRPF, Ret. IRPF, Otras Ret., Líquido.
//
// OJO — los códigos ("Cód.") de este formato NO son los mismos que los del
// formato nuevo (parsearNominaXLS) para la misma persona: cambiaron de
// sistema de nóminas en algún punto entre abril y agosto de 2026 y
// reasignaron numeración desde cero. Ej.: Jesús Aguilera Martín es código
// 3044 aquí pero 1 en el formato nuevo — y peor, un código puede
// corresponder a una persona distinta en cada formato (código 6 = Arrocha
// Melgar aquí, pero = Calero Valero en el formato nuevo). Por eso
// nominas_detalle y empleados_departamento llevan formato_origen como parte
// de la clave — nunca tratar num_empleado como único sin también mirar
// formato_origen. La fusión "es la misma persona" entre formatos se hace
// aparte y a mano en empleados_alias (Config · Personal), nunca automática.
//
// No trae columna de coste total explícita — se calcula como
// Retribuc. + Costes Emp. (confirmado con el usuario 11 sep 2026,
// cuadrando contra la fila "Total de la cuenta" de varios meses).
function parsearResumenContableXLS(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const hoja = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: null });

  const rePeriodo = new RegExp('(' + MESES_ES_MAYUS.filter(Boolean).join('|') + ')\\s+del\\s+(?:Ejercicio\\s+)?(\\d{4})', 'i');
  // "Empresa: ..." y "Cif: ..." van en celdas SEPARADAS de la misma fila
  // (no en un único texto como en parsearNominaXLS) — se busca cada trozo
  // por su cuenta y se combinan si aparecen en la misma fila.
  const reEmpresaNombre = /Empresa:\s*(.+)/i;
  const reEmpresaCif = /Cif:\s*([A-Z0-9]+)/i;
  let mes = null, anio = null, empresaNombre = null, empresaNif = null, filaCabecera = -1;

  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i] || [];
    let tieneCod = false, tieneNombre = false, nombreEnFila = null, cifEnFila = null;
    for (const celda of fila) {
      if (celda == null) continue;
      const texto = String(celda);
      if (!mes) {
        const m = texto.match(rePeriodo);
        if (m) { mes = MESES_ES_MAYUS.indexOf(m[1].toUpperCase()); anio = parseInt(m[2]); }
      }
      const mNombre = texto.match(reEmpresaNombre);
      if (mNombre) nombreEnFila = mNombre[1].trim();
      const mCif = texto.match(reEmpresaCif);
      if (mCif) cifEnFila = mCif[1].trim();
      const n = normalizarCabeceraNomina(celda);
      if (n === 'COD') tieneCod = true;
      if (n === 'NOMBRE') tieneNombre = true;
    }
    if (!empresaNif && nombreEnFila && cifEnFila) { empresaNombre = nombreEnFila; empresaNif = cifEnFila; }
    if (tieneCod && tieneNombre) { filaCabecera = i; break; }
  }

  if (filaCabecera < 0) throw new Error('No se encontró la cabecera "Cód. / Nombre" — no tiene pinta de "Resumen Contable".');
  if (!mes || !anio) throw new Error('No se encontró el periodo ("<Mes> del <Año>") en el archivo.');
  if (!empresaNif) throw new Error('No se encontró la línea "Empresa: ... Cif: ..." en el archivo.');

  const col = {};
  (filas[filaCabecera] || []).forEach((celda, idx) => {
    const n = normalizarCabeceraNomina(celda);
    if (n === 'COD') col.numero = idx;
    else if (n === 'NOMBRE') col.nombre = idx;
    else if (n === 'RETRIBUC') col.retribuc = idx;
    else if (n === 'COSTESTRAB') col.costes_trab = idx;
    else if (n === 'VALORESP') col.valor_esp = idx;
    else if (n === 'COSTESEMP') col.costes_emp = idx;
    else if (n === 'RETIRPF') col.ret_irpf = idx;
    else if (n === 'OTRASRET') col.otras_ret = idx;
    else if (n === 'LIQUIDO') col.liquido = idx;
  });
  ['numero', 'nombre', 'retribuc', 'costes_emp', 'liquido'].forEach(k => {
    if (col[k] === undefined) throw new Error('No se reconoce el formato "Resumen Contable": falta la columna "' + k + '".');
  });

  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : Math.round(n * 100) / 100; };
  const empleados = [];
  for (let i = filaCabecera + 2; i < filas.length; i++) { // +2: se salta la fila en blanco tras la cabecera
    const fila = filas[i] || [];
    const numero = fila[col.numero];
    const nombre = fila[col.nombre];
    if (numero == null || nombre == null || String(nombre).trim() === '' || /^total/i.test(String(nombre).trim())) continue;
    const numeroInt = parseInt(numero);
    if (isNaN(numeroInt)) continue;
    const retribuc = num(fila[col.retribuc]), costesEmp = num(fila[col.costes_emp]), liquido = num(fila[col.liquido]);
    empleados.push({
      num_empleado: numeroInt, nombre: String(nombre).trim(),
      bruto: retribuc,
      dcto_irpf: -num(fila[col.ret_irpf]), otros_desc: -num(fila[col.otras_ret]),
      total_desctos: Math.round((liquido - retribuc) * 100) / 100, // negativo: Líquido - Retribuc.
      neto: liquido, bonificacion: num(fila[col.valor_esp]),
      prestac_it: 0, ss_empresa: costesEmp, total_ss: Math.round((costesEmp + num(fila[col.costes_trab])) * 100) / 100,
      coste_total: Math.round((retribuc + costesEmp) * 100) / 100
    });
  }
  if (empleados.length === 0) throw new Error('No se encontró ninguna fila de trabajador con datos en el archivo.');

  return { anio, mes, empresaNombre, empresaNif, empleados, formatoOrigen: 'resumen_contable' };
}

// Prueba un formato y, si no cuadra ("no tiene pinta de..."), el otro —
// así el usuario puede seleccionar de golpe archivos de ambos formatos (el
// histórico 2025/2026 mezcla los dos) sin tener que separarlos a mano.
function parsearArchivoNomina(buffer) {
  try {
    return parsearNominaXLS(buffer);
  } catch (errNominas) {
    try {
      return parsearResumenContableXLS(buffer);
    } catch (errResumen) {
      throw new Error('No coincide con ningún formato conocido. Como nóminas: ' + errNominas.message + ' Como Resumen Contable: ' + errResumen.message);
    }
  }
}

// GET del año completo de TODO Personal (nóminas + extras) + las 2 listas
// de departamentos. El frontend construye desde aquí el histórico de
// nóminas/extras, el informe (por depto/trabajador, meses seleccionables) y
// las 2 config de departamentos, sin más idas y vueltas al servidor.
app.get('/api/nominas/anio', requiereLogin, soloPersonal, async (req, res) => {
  try {
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const [detalleResp, deptoResp, extrasResp, extrasDeptoResp, extrasAliasResp, empleadosAliasResp] = await Promise.all([
      supabase.from('nominas_detalle').select('*').eq('anio', anio).order('mes').order('empresa_nombre').order('nombre'),
      supabase.from('empleados_departamento').select('*').order('empresa_nombre').order('nombre'),
      supabase.from('extras_detalle').select('*').eq('anio', anio).order('mes').order('nombre'),
      supabase.from('extras_departamento').select('*').order('nombre'),
      supabase.from('extras_alias').select('*').order('nombre'),
      supabase.from('empleados_alias').select('*')
    ]);
    if (detalleResp.error) throw detalleResp.error;
    if (deptoResp.error) throw deptoResp.error;
    if (extrasResp.error) throw extrasResp.error;
    if (extrasDeptoResp.error) throw extrasDeptoResp.error;
    if (extrasAliasResp.error) throw extrasAliasResp.error;
    if (empleadosAliasResp.error) throw empleadosAliasResp.error;
    res.json({
      ok: true, anio, detalle: detalleResp.data || [], departamentos: deptoResp.data || [],
      extras: extrasResp.data || [], extras_departamentos: extrasDeptoResp.data || [], extras_alias: extrasAliasResp.data || [],
      empleados_alias: empleadosAliasResp.data || []
    });
  } catch (err) {
    console.error('Error en /api/nominas/anio:', err);
    res.status(500).json({ error: 'Error al leer datos de Personal: ' + err.message });
  }
});

// Admite varios archivos a la vez (histórico: seleccionar de golpe todos
// los .xls de 2025 + lo que falte de 2026, en vez de subirlos uno a uno).
// Cada archivo es independiente — si uno falla (formato raro, mes duplicado
// con datos distintos...) no aborta el resto, se reporta por archivo.
app.post('/api/nominas/subir', requiereLogin, soloPersonal, (req, res, next) => {
  uploadNomina.array('archivos', 40)(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'Error al subir los archivos: ' + err.message });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No se han recibido archivos.' });
    const usuario = req.session.usuario.nombre || req.session.usuario.usuario;
    const ahora = new Date().toISOString();

    const resultados = [];
    const filasNominas = [];
    // Clave "empresa_nif|formato_origen" — el número de trabajador SOLO es
    // único dentro del mismo formato (ver comentario junto a
    // parsearResumenContableXLS: el mismo código puede ser una persona
    // distinta en cada formato).
    const empleadosPorFormato = new Map();
    const empresasNifVistos = new Set();

    for (const archivo of req.files) {
      try {
        const { anio, mes, empresaNombre, empresaNif, empleados, formatoOrigen } = parsearArchivoNomina(archivo.buffer);
        empleados.forEach(e => filasNominas.push({
          anio, mes, empresa_nif: empresaNif, empresa_nombre: empresaNombre, formato_origen: formatoOrigen,
          num_empleado: e.num_empleado, nombre: e.nombre,
          bruto: e.bruto, dcto_irpf: e.dcto_irpf, otros_desc: e.otros_desc, total_desctos: e.total_desctos,
          neto: e.neto, bonificacion: e.bonificacion, prestac_it: e.prestac_it, ss_empresa: e.ss_empresa,
          total_ss: e.total_ss, coste_total: e.coste_total, subido_por: usuario, updated_at: ahora
        }));
        const claveFormato = empresaNif + '|' + formatoOrigen;
        if (!empleadosPorFormato.has(claveFormato)) empleadosPorFormato.set(claveFormato, new Map());
        const mapaEmp = empleadosPorFormato.get(claveFormato);
        empleados.forEach(e => mapaEmp.set(e.num_empleado, {
          empresa_nif: empresaNif, empresa_nombre: empresaNombre, formato_origen: formatoOrigen,
          num_empleado: e.num_empleado, nombre: e.nombre
        }));
        empresasNifVistos.add(empresaNif);
        const totalCoste = Math.round(empleados.reduce((s, e) => s + e.coste_total, 0) * 100) / 100;
        resultados.push({ archivo: archivo.originalname, ok: true, anio, mes, empresa: empresaNombre, formato: formatoOrigen, num_empleados: empleados.length, total_coste: totalCoste });
      } catch (errArchivo) {
        resultados.push({ archivo: archivo.originalname, ok: false, error: errArchivo.message });
      }
    }

    if (filasNominas.length > 0) {
      const { error: errNominas } = await supabase.from('nominas_detalle')
        .upsert(filasNominas, { onConflict: 'anio,mes,empresa_nif,formato_origen,num_empleado' });
      if (errNominas) throw errNominas;

      // Trabajadores nuevos entran en la config sin departamento (ignoreDuplicates
      // respeta el departamento ya asignado si el trabajador ya existía).
      const todosEmpleados = [...empleadosPorFormato.values()].flatMap(m => [...m.values()]);
      const { error: errEmp } = await supabase.from('empleados_departamento')
        .upsert(todosEmpleados, { onConflict: 'empresa_nif,formato_origen,num_empleado', ignoreDuplicates: true });
      if (errEmp) throw errEmp;
    }

    let sinClasificar = [];
    if (empresasNifVistos.size > 0) {
      const { data, error: errSin } = await supabase.from('empleados_departamento')
        .select('empresa_nif, formato_origen, num_empleado, nombre').in('empresa_nif', [...empresasNifVistos]).is('departamento', null);
      if (errSin) throw errSin;
      sinClasificar = data || [];
    }

    res.json({ ok: true, resultados, sin_departamento: sinClasificar });
  } catch (err) {
    console.error('Error en /api/nominas/subir:', err);
    res.status(500).json({ error: 'Error al procesar las nóminas: ' + err.message });
  }
});

// Corrige un mes/empresa subido por error (no hace falta para el uso normal:
// volver a subir el mismo mes ya sustituye los datos fila a fila).
app.delete('/api/nominas/mes', requiereLogin, soloPersonal, async (req, res) => {
  try {
    const anio = parseInt(req.query.anio), mes = parseInt(req.query.mes), empresaNif = req.query.empresa_nif, formatoOrigen = req.query.formato_origen;
    if (!anio || !mes || !empresaNif) return res.status(400).json({ error: 'Faltan parámetros (anio, mes, empresa_nif).' });
    let q = supabase.from('nominas_detalle').delete().eq('anio', anio).eq('mes', mes).eq('empresa_nif', empresaNif);
    if (formatoOrigen) q = q.eq('formato_origen', formatoOrigen);
    const { error } = await q;
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('Error en DELETE /api/nominas/mes:', err);
    res.status(500).json({ error: 'Error al eliminar: ' + err.message });
  }
});

app.post('/api/empleados-departamento', requiereLogin, soloPersonal, async (req, res) => {
  try {
    const asignaciones = req.body.asignaciones || [];
    if (!Array.isArray(asignaciones) || asignaciones.length === 0) return res.status(400).json({ error: 'Nada que guardar.' });
    const filas = asignaciones.map(a => ({
      empresa_nif: a.empresa_nif, empresa_nombre: a.empresa_nombre, formato_origen: a.formato_origen || 'nominas_gestoria',
      num_empleado: parseInt(a.num_empleado), nombre: a.nombre, departamento: a.departamento || null, updated_at: new Date().toISOString()
    }));
    const { error } = await supabase.from('empleados_departamento').upsert(filas, { onConflict: 'empresa_nif,formato_origen,num_empleado' });
    if (error) throw error;
    res.json({ ok: true, guardadas: filas.length });
  } catch (err) {
    console.error('Error en POST /api/empleados-departamento:', err);
    res.status(500).json({ error: 'Error al guardar: ' + err.message });
  }
});

// Fusiona un trabajador de un formato antiguo (ej. código de Resumen
// Contable 2025) con su equivalente en el formato actual — solo afecta a
// cómo se agrupa "por trabajador" en el Informe, NO al reparto por
// departamento de Cierre Mensual (ese ya es correcto con formato_origen en
// la clave de empleados_departamento, se fusione o no a la persona).
app.post('/api/empleados-alias', requiereLogin, soloPersonal, async (req, res) => {
  try {
    const asignaciones = req.body.asignaciones || [];
    if (!Array.isArray(asignaciones) || asignaciones.length === 0) return res.status(400).json({ error: 'Nada que guardar.' });
    const filas = asignaciones.map(a => ({
      empresa_nif: a.empresa_nif, formato_origen: a.formato_origen, num_empleado: parseInt(a.num_empleado),
      num_empleado_canonico: a.num_empleado_canonico ? parseInt(a.num_empleado_canonico) : null,
      updated_at: new Date().toISOString()
    }));
    const { error } = await supabase.from('empleados_alias').upsert(filas, { onConflict: 'empresa_nif,formato_origen,num_empleado' });
    if (error) throw error;
    res.json({ ok: true, guardadas: filas.length });
  } catch (err) {
    console.error('Error en POST /api/empleados-alias:', err);
    res.status(500).json({ error: 'Error al guardar: ' + err.message });
  }
});

// ================================================================
// GASTOS DE PERSONAL — EXTRAS (11 sep 2026) — Financiero → Personal →
// Extras. Segundo gasto de Personal, junto a Nóminas: horas extra/festivos
// pagadas, llevadas por el usuario en la hoja "HORAS EXTRAS 2026" (una
// pestaña "PAGOS <MES> <AÑO>" por mes, con el total ya calculado por
// trabajador en la columna "A PAGAR (€)" — la propia hoja también lleva el
// saldo de días de descanso compensados, que no es gasto en € y no se lee
// aquí). Se sincroniza con un botón manual (igual que "Actualizar facturas"
// en Facturas Proveedores) en vez de leerse en vivo en cada carga, para no
// depender de Google en cada visita a Cierre Mensual.
//
// Los nombres en esta hoja son informales ("Conchi", "Joaquin", sin
// apellidos) y no se corresponden 1:1 con el "APELLIDOS, Nombre" de
// nominas_detalle. Primera versión (11 sep 2026) los llevaba en un reparto a
// departamento independiente sin cruzarlos; a petición del usuario (mismo
// día) se añadió extras_alias para vincular cada nombre de Extras a un
// trabajador concreto de Nóminas — el departamento entonces se hereda del
// trabajador vinculado (empleados_departamento) y extras_departamento queda
// como reserva solo para quien aparece en Extras pero no tiene nómina
// vinculada (personal eventual, por ejemplo). El emparejamiento se sugiere
// en el frontend por coincidencia de palabras del nombre (ver
// sugerirEmpleadoParaExtra en index.html) pero SIEMPRE requiere confirmar y
// Guardar — nunca se vincula solo.
//
// Tablas Supabase nuevas - crear UNA VEZ desde el SQL editor de Supabase:
//   create table extras_detalle (
//     id bigint generated always as identity primary key,
//     anio integer not null,
//     mes integer not null,
//     nombre text not null,
//     extras integer not null default 0,
//     importe numeric not null default 0,
//     updated_at timestamptz not null default now(),
//     unique (anio, mes, nombre)
//   );
//   create table extras_departamento (
//     nombre text primary key,
//     departamento text,
//     updated_at timestamptz not null default now()
//   );
//   create table extras_alias (
//     nombre text primary key,
//     empresa_nif text,
//     formato_origen text,
//     num_empleado integer,
//     updated_at timestamptz not null default now()
//   );
// ================================================================

// Parser CSV mínimo para el export de gviz (siempre entrecomilla cada
// campo y escapa comillas internas como "" — no hace falta más).
function parseCSVGoogle(texto) {
  const filas = [];
  let fila = [], campo = '', dentroComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroComillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') dentroComillas = false;
      else campo += c;
    } else if (c === '"') dentroComillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); campo = ''; filas.push(fila); fila = [];
    } else campo += c;
  }
  if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.length > 1 || f[0] !== '');
}

// "€5.388,00" / "€50,00" (formato español: punto miles, coma decimal) → número.
function euroEspanolANumero(v) {
  if (v == null) return 0;
  const s = String(v).replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 100) / 100;
}

// Lee en vivo la pestaña "PAGOS <MES> <AÑO>" de la hoja de Extras. OJO: si
// la pestaña no existe todavía (mes sin cerrar), gviz NO da error — devuelve
// en silencio la primera pestaña del libro ("Respuestas de formulario 1"),
// así que se valida que la cabecera tenga pinta de tabla de pagos antes de
// confiar en el resultado; si no, se trata como "sin datos este mes".
async function leerPagosExtrasDelMes(anio, mes) {
  const nombrePestana = 'PAGOS ' + MESES_ES[mes].toUpperCase() + ' ' + anio;
  const url = `https://docs.google.com/spreadsheets/d/${EXTRAS_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(nombrePestana)}`;
  const resp = await fetch(url);
  if (!resp.ok) return { encontrado: false, empleados: [] };
  const filas = parseCSVGoogle(await resp.text());
  if (filas.length < 2) return { encontrado: false, empleados: [] };
  const cabecera = filas[0].map(normalizarCabeceraNomina);
  if (!cabecera.some(c => c.includes('APAGAR'))) return { encontrado: false, empleados: [] };
  const colExtras = cabecera.findIndex(c => c === 'EXTRAS');
  const colImporte = cabecera.findIndex(c => c.includes('APAGAR'));
  const empleados = [];
  for (let i = 1; i < filas.length; i++) {
    const fila = filas[i];
    const nombre = (fila[0] || '').trim();
    if (!nombre || nombre.toUpperCase().startsWith('TOTAL')) continue;
    empleados.push({ nombre, extras: parseInt(fila[colExtras]) || 0, importe: euroEspanolANumero(fila[colImporte]) });
  }
  return { encontrado: true, empleados };
}

app.post('/api/extras/sincronizar', requiereLogin, soloPersonal, async (req, res) => {
  try {
    const anio = parseInt(req.query.anio) || new Date().getFullYear();
    const mesesSincronizados = [], mesesSinDatos = [];
    const filasExtras = [], nombresVistos = new Map();

    for (let mes = 1; mes <= 12; mes++) {
      const { encontrado, empleados } = await leerPagosExtrasDelMes(anio, mes);
      if (!encontrado) { mesesSinDatos.push(mes); continue; }
      mesesSincronizados.push(mes);
      empleados.forEach(e => {
        filasExtras.push({ anio, mes, nombre: e.nombre, extras: e.extras, importe: e.importe, updated_at: new Date().toISOString() });
        nombresVistos.set(e.nombre, true);
      });
    }

    if (filasExtras.length > 0) {
      const { error: errExtras } = await supabase.from('extras_detalle').upsert(filasExtras, { onConflict: 'anio,mes,nombre' });
      if (errExtras) throw errExtras;
      const { error: errDepto } = await supabase.from('extras_departamento')
        .upsert([...nombresVistos.keys()].map(nombre => ({ nombre })), { onConflict: 'nombre', ignoreDuplicates: true });
      if (errDepto) throw errDepto;
      // Placeholder sin vincular — ignoreDuplicates respeta un vínculo ya guardado.
      const { error: errAlias } = await supabase.from('extras_alias')
        .upsert([...nombresVistos.keys()].map(nombre => ({ nombre })), { onConflict: 'nombre', ignoreDuplicates: true });
      if (errAlias) throw errAlias;
    }

    res.json({ ok: true, anio, meses_sincronizados: mesesSincronizados, meses_sin_datos: mesesSinDatos, total_trabajadores: nombresVistos.size });
  } catch (err) {
    console.error('Error en /api/extras/sincronizar:', err);
    res.status(500).json({ error: 'Error al sincronizar extras: ' + err.message });
  }
});

app.post('/api/extras-departamento', requiereLogin, soloPersonal, async (req, res) => {
  try {
    const asignaciones = req.body.asignaciones || [];
    if (!Array.isArray(asignaciones) || asignaciones.length === 0) return res.status(400).json({ error: 'Nada que guardar.' });
    const filas = asignaciones.map(a => ({ nombre: a.nombre, departamento: a.departamento || null, updated_at: new Date().toISOString() }));
    const { error } = await supabase.from('extras_departamento').upsert(filas, { onConflict: 'nombre' });
    if (error) throw error;
    res.json({ ok: true, guardadas: filas.length });
  } catch (err) {
    console.error('Error en POST /api/extras-departamento:', err);
    res.status(500).json({ error: 'Error al guardar: ' + err.message });
  }
});

// Vincula un nombre de Extras a un trabajador concreto de Nóminas (para que
// herede su departamento en vez de necesitar uno propio). asignaciones con
// empresa_nif/num_empleado en null desvinculan (vuelve a depender de
// extras_departamento como reserva).
app.post('/api/extras-alias', requiereLogin, soloPersonal, async (req, res) => {
  try {
    const asignaciones = req.body.asignaciones || [];
    if (!Array.isArray(asignaciones) || asignaciones.length === 0) return res.status(400).json({ error: 'Nada que guardar.' });
    const filas = asignaciones.map(a => ({
      nombre: a.nombre,
      empresa_nif: a.empresa_nif || null,
      formato_origen: a.formato_origen || null,
      num_empleado: a.num_empleado ? parseInt(a.num_empleado) : null,
      updated_at: new Date().toISOString()
    }));
    const { error } = await supabase.from('extras_alias').upsert(filas, { onConflict: 'nombre' });
    if (error) throw error;
    res.json({ ok: true, guardadas: filas.length });
  } catch (err) {
    console.error('Error en POST /api/extras-alias:', err);
    res.status(500).json({ error: 'Error al guardar: ' + err.message });
  }
});

// ================================================================
// CIERRE MENSUAL (10 sep 2026, ampliado 11 sep 2026) — Financiero → Cierre
// Mensual. Ingresos = facturas de Rentman vía ORUM CENTRAL. Gastos =
// Facturas Proveedores repartidas por departamento + Gastos Anuales
// repartidos entre 12 meses + Personal: nóminas_detalle (repartido según
// empleados_departamento) + extras_detalle — si el nombre de Extras está
// vinculado a un trabajador de Nóminas (extras_alias) hereda SU
// departamento; si no, cae en extras_departamento como reserva propia.
// Extras se sincroniza con el botón manual de Personal · Extras, no en vivo
// en cada carga de Cierre Mensual.
// ================================================================
app.get('/api/cierre-mensual', requiereLogin, bloquearComercial, async (req, res) => {
  try {
    const anio = parseInt(req.query.anio) || new Date().getFullYear();

    const [facturasResp, provResult, gastosAnualesResp, nominasResp, deptoResp, extrasResp, extrasDeptoResp, extrasAliasResp] = await Promise.all([
      llamarOrumCentral('facturas'),
      obtenerFacturasProveedoresEnriquecidas(),
      supabase.from('gastos_anuales').select('*').eq('anio', anio),
      supabase.from('nominas_detalle').select('mes, empresa_nif, formato_origen, num_empleado, coste_total').eq('anio', anio),
      supabase.from('empleados_departamento').select('empresa_nif, formato_origen, num_empleado, departamento'),
      supabase.from('extras_detalle').select('mes, nombre, importe').eq('anio', anio),
      supabase.from('extras_departamento').select('nombre, departamento'),
      supabase.from('extras_alias').select('nombre, empresa_nif, formato_origen, num_empleado')
    ]);
    const facturas = facturasResp.data || [];
    const { facturasEnriquecidas: facturasProveedores } = provResult;
    if (gastosAnualesResp.error) throw gastosAnualesResp.error;
    const gastosAnuales = gastosAnualesResp.data || [];
    if (nominasResp.error) throw nominasResp.error;
    if (deptoResp.error) throw deptoResp.error;
    if (extrasResp.error) throw extrasResp.error;
    if (extrasDeptoResp.error) throw extrasDeptoResp.error;
    if (extrasAliasResp.error) throw extrasAliasResp.error;
    const nominas = nominasResp.data || [];
    const extras = extrasResp.data || [];
    // Clave "empresa_nif|formato_origen|num_empleado" — imprescindible
    // incluir formato_origen: el mismo número puede ser una persona
    // distinta según el formato del archivo de origen (ver parsearResumenContableXLS).
    const mapaDeptoEmpleado = {};
    (deptoResp.data || []).forEach(d => { mapaDeptoEmpleado[d.empresa_nif + '|' + d.formato_origen + '|' + d.num_empleado] = d.departamento; });
    const mapaDeptoExtras = {};
    (extrasDeptoResp.data || []).forEach(d => { mapaDeptoExtras[d.nombre] = d.departamento; });
    const mapaAliasExtras = {};
    (extrasAliasResp.data || []).forEach(a => { if (a.empresa_nif && a.formato_origen && a.num_empleado) mapaAliasExtras[a.nombre] = a.empresa_nif + '|' + a.formato_origen + '|' + a.num_empleado; });

    const meses = Array.from({ length: 12 }, (_, i) => ({
      mes: i + 1, nombre: MESES_ES[i + 1],
      ingresos: 0, gastos: 0, gastos_por_departamento: {}
    }));

    facturas.forEach(f => {
      if (!f.fecha_emision) return;
      const partes = f.fecha_emision.split('/'); // dd/mm/yyyy
      if (partes.length !== 3) return;
      const mes = parseInt(partes[1]), anioFactura = parseInt(partes[2]);
      if (anioFactura !== anio || mes < 1 || mes > 12) return;
      meses[mes - 1].ingresos += parseFloat(f.importe_con_iva) || 0;
    });

    facturasProveedores.forEach(f => {
      const mes = parseInt(f.mes), anioFactura = parseInt(f.anio);
      if (anioFactura !== anio || mes < 1 || mes > 12) return;
      const total = parseFloat(f.importeTotal) || 0;
      meses[mes - 1].gastos += total;
      (f.desglose_departamentos || []).forEach(d => {
        // Reparto guardado sobre la base sin IVA - se escala proporcionalmente
        // al total con IVA para que el desglose por departamento sume el
        // mismo total que "gastos" (coherencia visual, mismo criterio que ya
        // usa Facturas Proveedores en su resumen por departamento).
        meses[mes - 1].gastos_por_departamento[d.departamento] = (meses[mes - 1].gastos_por_departamento[d.departamento] || 0) + d.importe;
      });
    });

    // Personal: coste total de cada trabajador (nominas_detalle) va entero
    // al departamento que tenga asignado en empleados_departamento; si un
    // trabajador nuevo todavía no está clasificado, cae en un bucket aparte
    // para que se note en el desglose (en vez de desaparecer o mezclarse).
    nominas.forEach(n => {
      const mes = parseInt(n.mes);
      if (mes < 1 || mes > 12) return;
      const coste = parseFloat(n.coste_total) || 0;
      meses[mes - 1].gastos += coste;
      const depto = mapaDeptoEmpleado[n.empresa_nif + '|' + n.formato_origen + '|' + n.num_empleado] || 'Personal sin clasificar';
      meses[mes - 1].gastos_por_departamento[depto] = (meses[mes - 1].gastos_por_departamento[depto] || 0) + coste;
    });

    // Extras: si el nombre está vinculado a un trabajador de Nóminas
    // (extras_alias) hereda SU departamento; si no, cae en
    // extras_departamento (reserva propia de Extras) o "sin clasificar".
    extras.forEach(e => {
      const mes = parseInt(e.mes);
      if (mes < 1 || mes > 12) return;
      const importe = parseFloat(e.importe) || 0;
      meses[mes - 1].gastos += importe;
      const claveEmpleado = mapaAliasExtras[e.nombre];
      const depto = (claveEmpleado && mapaDeptoEmpleado[claveEmpleado]) || mapaDeptoExtras[e.nombre] || 'Extras sin clasificar';
      meses[mes - 1].gastos_por_departamento[depto] = (meses[mes - 1].gastos_por_departamento[depto] || 0) + importe;
    });

    // Gastos anuales (seguros, impuestos...) repartidos a partes iguales
    // entre los 12 meses — se suman a "gastos" y aparecen en el desglose
    // junto a los departamentos de Facturas Proveedores, bajo su categoría.
    gastosAnuales.forEach(g => {
      const mensual = (parseFloat(g.importe_anual) || 0) / 12;
      for (let i = 0; i < 12; i++) {
        meses[i].gastos += mensual;
        meses[i].gastos_por_departamento[g.categoria] = (meses[i].gastos_por_departamento[g.categoria] || 0) + mensual;
      }
    });

    const mesesRedondeados = meses.map(m => ({
      mes: m.mes, nombre: m.nombre,
      ingresos: Math.round(m.ingresos * 100) / 100,
      gastos: Math.round(m.gastos * 100) / 100,
      beneficio: Math.round((m.ingresos - m.gastos) * 100) / 100,
      margen: m.ingresos > 0.05 ? Math.round(((m.ingresos - m.gastos) / m.ingresos) * 1000) / 10 : 0,
      gastos_por_departamento: Object.keys(m.gastos_por_departamento)
        .map(dep => ({ departamento: dep, total: Math.round(m.gastos_por_departamento[dep] * 100) / 100 }))
        .sort((a, b) => b.total - a.total)
    }));

    const totalIngresos = mesesRedondeados.reduce((s, m) => s + m.ingresos, 0);
    const totalGastos = mesesRedondeados.reduce((s, m) => s + m.gastos, 0);
    res.json({
      anio, meses: mesesRedondeados,
      totales_anio: {
        ingresos: Math.round(totalIngresos * 100) / 100,
        gastos: Math.round(totalGastos * 100) / 100,
        beneficio: Math.round((totalIngresos - totalGastos) * 100) / 100,
        margen: totalIngresos > 0.05 ? Math.round(((totalIngresos - totalGastos) / totalIngresos) * 1000) / 10 : 0
      }
    });
  } catch (err) {
    console.error('Error en /api/cierre-mensual:', err);
    res.status(500).json({ error: 'Error al calcular el cierre mensual: ' + err.message });
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
// tipo === 'combustible' (repostaje): no se calcula por km, se pide el
// número de litros repostados y se usa el precio de combustible ya
// configurado (litros × fuelPrice) — sin desgaste ni mano de obra, y SIN
// margen: es puro suministro repercutido a precio de coste, no un
// servicio de ORUM (a diferencia de vehículo/personal, que sí llevan el
// margen de la tarifa).
function calcularCosteIsabella(cfg, tipo, vehTipo, km, horas, personas, litros) {
  const p = Number(personas) || 1;
  let combustible = 0, desgaste = 0, manoObra = 0;
  if (tipo === 'combustible') {
    combustible = (Number(litros) || 0) * cfg.fuelPrice;
  } else {
    if (Number(vehTipo) > 0) {
      const consumo = cfg[ISABELLA_VEH_CONSUMO_KEY[vehTipo]] || cfg.consumo2;
      combustible = (Number(km) / 100) * consumo * cfg.fuelPrice;
      desgaste = Number(km) * cfg.wear;
    }
    manoObra = Number(horas) * p * cfg.labor;
  }
  const costeNOE = combustible + desgaste + manoObra;
  const importe = tipo === 'combustible' ? costeNOE : costeNOE * (1 + cfg.marginPct / 100);
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
    const { tipo, vehTipo, km, horas, personas, litros } = req.body;
    const r = calcularCosteIsabella(cfg, tipo, vehTipo, km, horas, personas, litros);
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
      vehTipo: r.veh_tipo, tipo: r.tipo || 'vehiculo', personal: r.personal || '', personas: r.personas, km: r.km, horas: r.horas,
      litros: r.litros || 0, desc: r.descripcion || '', importe: r.importe, creadoPor: r.creado_por || '',
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
    const tipo = ['vehiculo', 'personal', 'combustible'].includes(b.tipo) ? b.tipo : 'vehiculo';
    const vehTipo = tipo === 'vehiculo' ? (Number(b.vehTipo) || 0) : 0;
    const personas = Number(b.personas) || 1;
    const litros = tipo === 'combustible' ? (Number(b.litros) || 0) : 0;
    const r = calcularCosteIsabella(cfg, tipo, vehTipo, Number(b.km) || 0, Number(b.horas) || 0, personas, litros);
    const usuario = req.session.usuario.nombre || req.session.usuario.usuario;
    const { data, error } = await supabase.from('isabella_servicios').insert({
      fecha: b.fecha, empresa: b.empresa, pedido: b.pedido || '', veh_nombre: b.vehNombre || '',
      veh_tipo: vehTipo, tipo, personal: b.personal || '', personas, km: Number(b.km) || 0, horas: Number(b.horas) || 0, litros,
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
