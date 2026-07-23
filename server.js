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

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

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

async function llamarOrumCentral(action, extraParams = {}) {
  const params = new URLSearchParams({ token: APPS_SCRIPT_TOKEN, action, ...extraParams });
  const url = `${APPS_SCRIPT_URL}?${params.toString()}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Apps Script respondió con status ${resp.status}`);
  return resp.json();
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

app.get('/api/financiero', requiereLogin, async (req, res) => {
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

    const FORMAS_PAGO_REALES = ['transferencia', 'efectivo-marbella', 'efectivo-monda', 'tpv-marbella', 'tpv-monda'];
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

app.get('/api/preparacion', requiereLogin, async (req, res) => {
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
// RUTAS — endpoints
// ================================================================

app.get('/api/rutas', async (req, res) => {
  if (req.query.token !== 'ORUMx2026RutasPublic' && !req.session.usuario) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const { desde, hasta } = req.query;
    const params = new URLSearchParams({ token: APPS_SCRIPT_TOKEN, action: 'rutas' });
    if (desde) params.append('desde', desde);
    if (hasta) params.append('hasta', hasta);
    const resp = await fetch(`${APPS_SCRIPT_URL}?${params.toString()}`);
    res.json(await resp.json());
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
      descripcion: req.body.descripcion, direccion: req.body.direccion
    });
    res.json(data);
  } catch (err) {
    console.error('Error en /api/rutas/manual:', err);
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
    const equipmentResp = await llamarOrumCentral('equipment');
    const equipment = (equipmentResp.data || []).filter(e => String(e.proyecto_id) === proyectoId);
    res.json({ ok: true, material: equipment });
  } catch (err) {
    console.error('Error en GET /api/rutas/material:', err);
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

app.post('/api/facturas-proveedores/sincronizar', requiereLogin, async (req, res) => {
  try {
    const anio = req.query.anio || '2026';
    const paramsLista = new URLSearchParams({ token: APPS_SCRIPT_FACTURAS_TOKEN, action: 'listaPendientes', anio });
    const respLista = await fetch(`${APPS_SCRIPT_FACTURAS_URL}?${paramsLista.toString()}`);
    const dataLista = await respLista.json();
    if (dataLista.error) return res.status(500).json({ error: 'Error listando pendientes: ' + dataLista.error });

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

    res.json({ ok: true, total_pendientes: pendientes.length, procesadas: resultados.length, con_error: errores.length, resultados, errores });
  } catch (err) {
    console.error('Error en /api/facturas-proveedores/sincronizar:', err);
    res.status(500).json({ error: 'Error al sincronizar facturas: ' + err.message });
  }
});

app.get('/api/facturas-proveedores', requiereLogin, async (req, res) => {
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

app.get('/api/facturas-proveedores/proveedores', requiereLogin, async (req, res) => {
  try {
    const params = new URLSearchParams({ token: APPS_SCRIPT_FACTURAS_TOKEN, action: 'proveedores' });
    const resp = await fetch(`${APPS_SCRIPT_FACTURAS_URL}?${params.toString()}`);
    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/facturas-proveedores/reparto', requiereLogin, async (req, res) => {
  try {
    const params = new URLSearchParams({ token: APPS_SCRIPT_FACTURAS_TOKEN, action: 'reparto' });
    const resp = await fetch(`${APPS_SCRIPT_FACTURAS_URL}?${params.toString()}`);
    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error });
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/facturas-proveedores/reparto', requiereLogin, async (req, res) => {
  try {
    const reparto = req.body.reparto || [];
    const resp = await fetch(APPS_SCRIPT_FACTURAS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: APPS_SCRIPT_FACTURAS_TOKEN, accion: 'guardarReparto', reparto }) });
    const data = await resp.json();
    if (data.error) return res.status(500).json({ error: data.error });
    res.json(data);
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

function isoWeeksInMonth(mes, anio) {
  const primerDia = new Date(anio, mes - 1, 1);
  const ultimoDia = new Date(anio, mes, 0);
  const semanas = [];
  let cursor = lunesDeLaSemana(primerDia);
  while (cursor <= ultimoDia) {
    const lunes = new Date(cursor);
    const domingo = new Date(cursor); domingo.setDate(domingo.getDate() + 6);
    semanas.push({ isoWeek: isoWeekNumber(lunes), lunes, domingo });
    cursor = new Date(cursor); cursor.setDate(cursor.getDate() + 7);
  }
  return semanas;
}

function valorFinalProyecto(p) {
  const esPNC = p.es_abrebotellas === 'SI' || p.es_abrebotellas === true;
  const valorSinIva = parseFloat(p.valor) || 0;
  return esPNC ? valorSinIva : Math.round(valorSinIva * 1.21 * 100) / 100;
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
  <div class="footnote">* Semanas en curso — datos en tiempo real desde Rentman · Objetivo = 2025 +20% · Generado: ${new Date().toLocaleString('es-ES')}</div>
</body></html>`;
}

app.get('/api/reporte-mes', requiereLogin, async (req, res) => {
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
