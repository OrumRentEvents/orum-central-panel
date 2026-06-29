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

// Railway usa un proxy inverso — sin esto, Express no detecta bien que la conexión es HTTPS
// y las cookies de sesión con `secure: true` nunca se guardan en el navegador.
app.set('trust proxy', 1);

// ── Configuración de conexión a Apps Script (ORUM CENTRAL) ──
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || 'PEGA_AQUI_LA_URL_DEL_DOGET';
const APPS_SCRIPT_TOKEN = process.env.APPS_SCRIPT_TOKEN || 'ORUMx2026CentralData9Q';

// ── Middlewares base ──
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'orum-central-secret-cambiar-en-produccion',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 12, // 12 horas
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  }
}));

// ── Helper: llamar al doGet de Apps Script ──
async function llamarOrumCentral(action, extraParams = {}) {
  const params = new URLSearchParams({
    token: APPS_SCRIPT_TOKEN,
    action,
    ...extraParams
  });
  const url = `${APPS_SCRIPT_URL}?${params.toString()}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Apps Script respondió con status ${resp.status}`);
  }
  return resp.json();
}

// ── Middleware: requiere sesión activa ──
function requiereLogin(req, res, next) {
  if (!req.session.usuario) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  next();
}

// ================================================================
// RUTAS DE AUTENTICACIÓN
// ================================================================

app.post('/api/login', async (req, res) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const resultado = await llamarOrumCentral('usuarios');
    if (resultado.error) {
      return res.status(500).json({ error: 'Error leyendo usuarios: ' + resultado.error });
    }

    const usuarioEncontrado = resultado.data.find(
      u => String(u.usuario).toLowerCase() === String(usuario).toLowerCase()
    );

    if (!usuarioEncontrado) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const passwordValida = bcrypt.compareSync(password, usuarioEncontrado.password_hash);
    if (!passwordValida) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    // Guardar en sesión solo lo necesario, nunca el hash
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
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/sesion', (req, res) => {
  if (!req.session.usuario) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  res.json({ usuario: req.session.usuario });
});

// ================================================================
// RUTAS DE DATOS (requieren login)
// ================================================================

app.get('/api/proyectos', requiereLogin, async (req, res) => {
  try {
    const resultado = await llamarOrumCentral('proyectos');

    // Si el usuario es Comercial, filtramos para que solo vea sus propios proyectos
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

// ── FINANCIERO: cruce de proyectos (Rentman) con forma de pago real (Caja) ──
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

    // Indexar PROYECTOS por su id interno (Rentman)
    const proyectoPorId = {};
    proyectos.forEach(p => { proyectoPorId[String(p.id)] = p; });

    // Indexar FACTURAS por su "numero" de factura (el que aparece en Caja)
    const facturaPorNumero = {};
    facturas.forEach(f => { facturaPorNumero[String(f.numero)] = f; });

    // Indexar registros de Caja por número de FACTURA (no de proyecto)
    const registrosPorNumeroFactura = {};
    registros.forEach(r => {
      const num = String(r.numero);
      if (!registrosPorNumeroFactura[num]) registrosPorNumeroFactura[num] = [];
      registrosPorNumeroFactura[num].push(r);
    });

    // Indexar cobros PNC (formulario) por número de proyecto
    const ncPorNumeroProyecto = {};
    ncFormulario.forEach(r => {
      const num = String(r['Nº Proyecto']);
      if (!ncPorNumeroProyecto[num]) ncPorNumeroProyecto[num] = [];
      ncPorNumeroProyecto[num].push(r);
    });

    // Cruce de facturas con su forma de pago real, y enriquecidas con datos del proyecto
    const FORMAS_PAGO_REALES = ['transferencia', 'efectivo-marbella', 'efectivo-monda', 'tpv-marbella', 'tpv-monda'];
    const cruceFacturas = facturas.map(f => {
      const proyecto = proyectoPorId[String(f.proyecto_id)] || null;
      const pagosCaja = registrosPorNumeroFactura[String(f.numero)] || [];
      const primerPago = pagosCaja[0] || null;
      const esRectificativaACero = primerPago && primerPago.metodo_pago === 'factura0';
      const importeFactura = Math.round((parseFloat(f.importe_con_iva) || 0) * 100) / 100;
      const importeCobradoReal = Math.round(
        pagosCaja.reduce((sum, p) => sum + (parseFloat(p.importe) || 0), 0) * 100
      ) / 100;
      const difFacturaCobro = Math.round((importeFactura - importeCobradoReal) * 100) / 100;

      let diasRetraso = null;
      if (f.esta_pagada !== 'SI' && f.fecha_vencimiento) {
        const partes = f.fecha_vencimiento.split('/');
        if (partes.length === 3) {
          const vencimiento = new Date(partes[2], partes[1] - 1, partes[0]);
          const hoyLocal = new Date();
          hoyLocal.setHours(0, 0, 0, 0);
          const diffMs = hoyLocal - vencimiento;
          diasRetraso = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        }
      }

      return {
        factura_id: f.factura_id,
        numero_factura: f.numero,
        proyecto_id: f.proyecto_id,
        proyecto_numero: proyecto ? proyecto.numero : null,
        cliente: f.cliente,
        comercial: proyecto ? proyecto.comercial : null,
        estado_proyecto: proyecto ? proyecto.estado : null,
        fecha_entrega: proyecto ? proyecto.entrega_fecha : null,
        fecha_emision: f.fecha_emision,
        fecha_vencimiento: f.fecha_vencimiento,
        dias_retraso: diasRetraso,
        importe_con_iva: importeFactura,
        importe_cobrado_real: importeCobradoReal,
        diferencia_factura_cobro: difFacturaCobro,
        cuadra_con_cobro: Math.abs(difFacturaCobro) < 0.05,
        esta_pagada: f.esta_pagada,
        pendiente_cobro: f.pendiente_cobro,
        pagos_caja: pagosCaja,
        forma_pago: primerPago ? primerPago.metodo_pago : null,
        es_rectificativa_a_cero: esRectificativaACero,
        forma_pago_real: primerPago && FORMAS_PAGO_REALES.includes(primerPago.metodo_pago) ? primerPago.metodo_pago : null,
        sin_registro_caja: pagosCaja.length === 0 && f.esta_pagada === 'SI'
      };
    });

    // Separar proyectos PNC (abrebotellas) y cruzar con cobros del formulario, sumando todas las líneas
    const proyectosPNC = proyectos.filter(p => p.es_abrebotellas === 'SI' || p.es_abrebotellas === true);
    const crucePNC = proyectosPNC.map(p => {
      const cobros = ncPorNumeroProyecto[String(p.numero)] || [];
      const totalCobrado = cobros.reduce((sum, c) => sum + (parseFloat(c['Importe']) || 0), 0);
      const valorEsperado = parseFloat(p.valor) || 0;
      const diferencia = Math.round((valorEsperado - totalCobrado) * 100) / 100;
      return {
        numero: p.numero,
        cliente: p.cliente,
        comercial: p.comercial,
        estado: p.estado,
        fecha_entrega: p.entrega_fecha,
        valor_esperado: valorEsperado,
        total_cobrado_formulario: Math.round(totalCobrado * 100) / 100,
        diferencia: diferencia,
        cuadra: Math.abs(diferencia) < 0.05,
        cobros_formulario: cobros
      };
    });

    // ── Vista agregada por PROYECTO: valor total, facturado, cobrado, pendiente de facturar/cobrar ──
    const IVA = 1.21;
    // Indexar facturas (ya cruzadas) por proyecto_id
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
        // PNC: el valor de Rentman ya es el importe final a cobrar, sin IVA aplicado (clientes especiales)
        const cobros = ncPorNumeroProyecto[String(p.numero)] || [];
        const totalCobrado = Math.round(cobros.reduce((sum, c) => sum + (parseFloat(c['Importe']) || 0), 0) * 100) / 100;
        const formasPagoPNC = [...new Set(cobros.map(c => c['Método']).filter(Boolean))];
        return {
          id: p.id,
          numero: p.numero,
          cliente: p.cliente,
          comercial: p.comercial,
          estado: p.estado,
          fecha_entrega: p.entrega_fecha,
          es_pnc: true,
          valor_proyecto_sin_iva: valorSinIva,
          valor_proyecto: valorSinIva,
          total_facturado: 0,
          total_cobrado: totalCobrado,
          pendiente_facturar: 0,
          pendiente_cobrar: Math.round((valorSinIva - totalCobrado) * 100) / 100,
          formas_pago: formasPagoPNC
        };
      } else {
        // Proyectos normales: el valor de Rentman es SIN IVA, hay que aplicar 21% para comparar con facturas
        const valorConIva = Math.round(valorSinIva * IVA * 100) / 100;
        const facturasDelProyecto = facturasPorProyectoId[String(p.id)] || [];
        const totalFacturado = Math.round(
          facturasDelProyecto.reduce((sum, f) => sum + (parseFloat(f.importe_con_iva) || 0), 0) * 100
        ) / 100;
        const totalCobrado = Math.round(
          facturasDelProyecto.reduce((sum, f) => sum + (parseFloat(f.importe_cobrado_real) || 0), 0) * 100
        ) / 100;
        const formasPagoNormales = [...new Set(
          facturasDelProyecto
            .map(f => f.sin_registro_caja ? 'Sin registro' : (f.es_rectificativa_a_cero ? 'Rectificativa' : f.forma_pago))
            .filter(Boolean)
        )];
        return {
          id: p.id,
          numero: p.numero,
          cliente: p.cliente,
          comercial: p.comercial,
          estado: p.estado,
          fecha_entrega: p.entrega_fecha,
          es_pnc: false,
          valor_proyecto_sin_iva: valorSinIva,
          valor_proyecto: valorConIva,
          total_facturado: totalFacturado,
          total_cobrado: totalCobrado,
          pendiente_facturar: Math.round((valorConIva - totalFacturado) * 100) / 100,
          pendiente_cobrar: Math.round((totalFacturado - totalCobrado) * 100) / 100,
          formas_pago: formasPagoNormales
        };
      }
    });

    // ── KPIs agregados ──
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
        if (vencimiento && vencimiento < hoy) {
          totalVencidas += parseFloat(f.pendiente_cobro) || 0;
        }
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
      desglose_forma_pago: Object.keys(desglosePorFormaPago).map(k => ({
        forma_pago: k,
        total: Math.round(desglosePorFormaPago[k] * 100) / 100
      }))
    };

    // ── Desglose por comercial (facturado total) ──
    const facturadoPorComercial = {};
    cruceFacturas.forEach(cf => {
      if (!cf.comercial) return;
      facturadoPorComercial[cf.comercial] = (facturadoPorComercial[cf.comercial] || 0) + (parseFloat(cf.importe_con_iva) || 0);
    });
    const desgloseComercial = Object.keys(facturadoPorComercial)
      .map(c => ({ comercial: c, total: Math.round(facturadoPorComercial[c] * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    // ── Top clientes por pendiente de cobro total (facturas pendientes + PNC pendientes) ──
    const pendientePorCliente = {};
    cruceProyectos.forEach(p => {
      if (p.pendiente_cobrar <= 0.05) return;
      const clave = p.cliente || 'Sin cliente';
      if (!pendientePorCliente[clave]) {
        pendientePorCliente[clave] = { cliente: clave, comercial: p.comercial, pendiente: 0, proyectos: [] };
      }
      pendientePorCliente[clave].pendiente += p.pendiente_cobrar;
      pendientePorCliente[clave].proyectos.push(p.numero);
    });
    const topClientesPendientes = Object.values(pendientePorCliente)
      .map(c => ({ ...c, pendiente: Math.round(c.pendiente * 100) / 100 }))
      .sort((a, b) => b.pendiente - a.pendiente)
      .slice(0, 20);

    const pncCuadran = crucePNC.filter(p => p.cuadra).length;
    const proyectosPendientesFacturar = cruceProyectos.filter(p => !p.es_pnc && Math.abs(p.pendiente_facturar) >= 0.05).length;

    // ── Facturas vencidas, ordenadas por días de retraso (más urgente primero) ──
    const facturasVencidas = cruceFacturas
      .filter(f => f.dias_retraso !== null && f.dias_retraso > 0)
      .sort((a, b) => b.dias_retraso - a.dias_retraso);

    // ── Auditoría: agregación navegable de las 3 alertas ──
    const auditoria = {
      facturas_sin_registro: cruceFacturas.filter(f => f.sin_registro_caja),
      pnc_no_cuadran: crucePNC.filter(p => !p.cuadra),
      proyectos_pendientes_facturar: cruceProyectos.filter(p => !p.es_pnc && Math.abs(p.pendiente_facturar) >= 0.05)
    };

    res.json({
      kpis,
      desglose_comercial: desgloseComercial,
      top_clientes_pendientes: topClientesPendientes,
      total_proyectos: proyectos.length,
      total_facturas: facturas.length,
      total_proyectos_pnc: proyectosPNC.length,
      pnc_cuadran: pncCuadran,
      total_registros_caja: registros.length,
      total_nc_formulario: ncFormulario.length,
      total_nc_confirmaciones: ncConfirmaciones.length,
      facturas_sin_registro_caja: cruceFacturas.filter(f => f.sin_registro_caja).length,
      pnc_que_no_cuadran: crucePNC.filter(p => !p.cuadra).length,
      proyectos_pendientes_facturar: proyectosPendientesFacturar,
      facturas_vencidas: facturasVencidas,
      auditoria: auditoria,
      cruce_proyectos: cruceProyectos,
      cruce_facturas: cruceFacturas,
      cruce_pnc: crucePNC,
      nc_confirmaciones: ncConfirmaciones
    });
  } catch (err) {
    console.error('Error en /api/financiero:', err);
    res.status(500).json({ error: 'Error al cruzar datos financieros: ' + err.message });
  }
});

// ================================================================
// PREPARACIÓN — Lavandería / Office / Almacén
// Lee PROYECTOS + EQUIPMENT de Sheets (sin tocar Rentman).
// Replica exactamente la lógica ya validada en el dashboard antiguo.
// ================================================================

// Estados (por NOMBRE, tal y como se guarda en la hoja PROYECTOS) que se excluyen
// de las pantallas de preparación: presupuestos, consultas y cancelados.
const ESTADOS_EXCLUIR_NOMBRE = ['pending', 'concept', 'inquiry', 'cancelado', 'canceled'].map(normalizarTexto);
// Estados que cuentan como "preparado/listo" dentro del flujo de preparación
const ESTADOS_LISTO_NOMBRE = ['returned', 'cargado', 'marbella', 'on location', 'controlado', 'preparado'].map(normalizarTexto);

// Normaliza texto para comparar familias sin depender de tildes/mayúsculas exactas
function normalizarTexto(str) {
  return (str || '')
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
    .toLowerCase()
    .trim();
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

// Lunes de la semana de una fecha dada (semana real lun-dom)
function lunesDeLaSemana(d) {
  const x = inicioDelDia(d);
  const dia = x.getDay() || 7; // domingo=0 → 7
  x.setDate(x.getDate() - dia + 1);
  return x;
}

// Clasifica una fecha de entrega en uno de los periodos según el modo de vista
function clasificarPeriodo(fechaEntrega, modo) {
  if (!fechaEntrega) return null;
  const hoy = inicioDelDia(new Date());
  const fecha = inicioDelDia(fechaEntrega);
  const diffDias = Math.round((fecha - hoy) / 86400000);

  if (modo === 'semanas') {
    // HOY / MAÑANA / ESTA SEMANA / PRÓXIMA SEMANA (lun-dom reales)
    if (diffDias === 0) return 'HOY';
    if (diffDias === 1) return 'MAÑANA';
    const lunesEstaSemana = lunesDeLaSemana(hoy);
    const lunesProxima = new Date(lunesEstaSemana); lunesProxima.setDate(lunesProxima.getDate() + 7);
    const lunesSiguiente = new Date(lunesProxima); lunesSiguiente.setDate(lunesSiguiente.getDate() + 7);
    if (fecha >= lunesEstaSemana && fecha < lunesProxima) return 'ESTA SEMANA';
    if (fecha >= lunesProxima && fecha < lunesSiguiente) return 'PRÓXIMA SEMANA';
    return null; // fuera de rango, no se muestra
  } else {
    // Almacén — HOY / MAÑANA / PASADO MAÑANA / PRÓXIMOS 5 DÍAS
    if (diffDias === 0) return 'HOY';
    if (diffDias === 1) return 'MAÑANA';
    if (diffDias === 2) return 'PASADO MAÑANA';
    if (diffDias >= 3 && diffDias <= 7) return 'PRÓXIMOS 5 DÍAS';
    return null;
  }
}

const ORDEN_PERIODOS_SEMANAS = ['HOY', 'MAÑANA', 'ESTA SEMANA', 'PRÓXIMA SEMANA'];
const ORDEN_PERIODOS_DIAS = ['HOY', 'MAÑANA', 'PASADO MAÑANA', 'PRÓXIMOS 5 DÍAS'];

app.get('/api/preparacion', requiereLogin, async (req, res) => {
  try {
    const vista = req.query.vista || 'almacen'; // 'lavanderia' | 'office' | 'almacen'
    const modo = vista === 'almacen' ? 'dias' : 'semanas';
    const ordenPeriodos = modo === 'dias' ? ORDEN_PERIODOS_DIAS : ORDEN_PERIODOS_SEMANAS;

    const [proyectosResp, equipmentResp] = await Promise.all([
      llamarOrumCentral('proyectos'),
      llamarOrumCentral('equipment')
    ]);

    const proyectos = (proyectosResp.data || [])
      .filter(p => p.cancelado !== 'SI');

    // NOTA: PROYECTOS guarda el NOMBRE del estado (resuelto), no el ID numérico.
    // Filtramos por nombre de estado "no presupuesto/consulta" en vez de por ID,
    // ya que el ID de Rentman no se persiste en la hoja actual.
    const proyectosConfirmados = proyectos.filter(p => {
      const estadoNorm = normalizarTexto(p.estado);
      return !ESTADOS_EXCLUIR_NOMBRE.includes(estadoNorm);
    });

    const proyectoPorId = {};
    proyectosConfirmados.forEach(p => { proyectoPorId[String(p.id)] = p; });

    const equipment = (equipmentResp.data || []);

    // Filtrar equipment a las familias de la vista (lavandería/office); almacén ve todo
    let equipmentFiltrado = equipment;
    if (vista === 'lavanderia') {
      equipmentFiltrado = equipment.filter(e => familiaPerteneceA(e.familia, FAMILIAS_LAVANDERIA));
    } else if (vista === 'office') {
      equipmentFiltrado = equipment.filter(e => familiaPerteneceA(e.familia, FAMILIAS_OFFICE));
    }

    // Solo equipment de proyectos confirmados y vivos
    equipmentFiltrado = equipmentFiltrado.filter(e => proyectoPorId[String(e.proyecto_id)]);

    // ── Construir lista de proyectos relevantes para esta vista (los que tienen equipment filtrado) ──
    const idsProyectosConEquipo = new Set(equipmentFiltrado.map(e => String(e.proyecto_id)));
    const proyectosVista = vista === 'almacen'
      ? proyectosConfirmados
      : proyectosConfirmados.filter(p => idsProyectosConEquipo.has(String(p.id)));

    const hoy = inicioDelDia(new Date());

    // ── Vista "Por proyecto" — agrupado por periodo, dos columnas Confirmado/Preparado ──
    const porProyecto = {};
    ordenPeriodos.forEach(per => { porProyecto[per] = { confirmado: [], preparado: [] }; });

    proyectosVista.forEach(p => {
      const fechaEntrega = parsearFechaDDMMYYYY(p.entrega_fecha);
      const periodo = clasificarPeriodo(fechaEntrega, modo);
      if (!periodo) return;

      const estaListo = ESTADOS_LISTO_NOMBRE.includes(normalizarTexto(p.estado));

      const item = {
        id: p.id,
        numero: p.numero,
        cliente: p.cliente,
        comercial: p.comercial,
        estado: p.estado,
        fecha_entrega: p.entrega_fecha,
        entrega_hora: p.entrega_hora,
        localizacion: p.localizacion,
        es_nuevo_hoy: false // se calcula con 'updated' si se necesita más adelante
      };

      if (estaListo) porProyecto[periodo].preparado.push(item);
      else porProyecto[periodo].confirmado.push(item);
    });

    // ── Vista "Por material" — agrupado por familia → artículo → detalle por proyecto/periodo ──
    const porMaterial = {}; // familia -> articulo -> { total, detalle: [...] }

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
      porMaterial[familia][articulo].detalle.push({
        proyecto_numero: proyecto.numero,
        cliente: proyecto.cliente,
        fecha_entrega: proyecto.entrega_fecha,
        periodo,
        cantidad
      });
    });

    // Convertir a array ordenado, familias y artículos alfabéticamente
    const porMaterialArray = Object.keys(porMaterial).sort().map(familia => ({
      familia,
      articulos: Object.keys(porMaterial[familia]).sort().map(articulo => ({
        articulo,
        total: Math.round(porMaterial[familia][articulo].total * 100) / 100,
        detalle: porMaterial[familia][articulo].detalle.sort((a, b) =>
          ordenPeriodos.indexOf(a.periodo) - ordenPeriodos.indexOf(b.periodo)
        )
      }))
    }));

    // ── Resumen de progreso por periodo (X/total listos) ──
    const resumenPeriodos = ordenPeriodos.map(per => {
      const confirmado = porProyecto[per].confirmado.length;
      const preparado = porProyecto[per].preparado.length;
      const total = confirmado + preparado;
      return { periodo: per, listos: preparado, total, pendientes: confirmado };
    });

    // ── Equipment detalle por proyecto (para modal) ──
    const equipmentDetalle = equipmentFiltrado.map(e => ({
      proyecto_id: e.proyecto_id,
      familia: e.familia || 'Sin familia',
      articulo: e.articulo || '',
      cantidad: parseFloat(e.cantidad) || 0
    }));

    const respuesta = {
      vista,
      modo,
      orden_periodos: ordenPeriodos,
      resumen_periodos: resumenPeriodos,
      por_proyecto: porProyecto,
      por_material: porMaterialArray,
      equipment_detalle: equipmentDetalle,
      ultima_actualizacion: proyectosResp.ultima_actualizacion
    };

    // ── Solo en Almacén: pestañas adicionales "Servicios" y "Logística" ──
    if (vista === 'almacen') {
      // -- Servicios (montaje, desplazamiento, etc.) próximos 14 días --
      const serviciosResp = await llamarOrumCentral('servicios');
      const servicios = (serviciosResp.data || []);
      const hoyMs = inicioDelDia(new Date()).getTime();
      const limite14diasMs = hoyMs + 14 * 86400000;

      const serviciosVentana = servicios.filter(s => {
        const fecha = parsearFechaDDMMYYYY(s.fecha_entrega);
        if (!fecha) return false;
        const fechaMs = inicioDelDia(fecha).getTime();
        return fechaMs >= hoyMs && fechaMs <= limite14diasMs;
      }).map(s => {
        const proyecto = proyectoPorId[String(s.proyecto_id)];
        return {
          proyecto_numero: s.numero,
          cliente: proyecto ? proyecto.cliente : '',
          servicio: s.servicio,
          cantidad: s.cantidad,
          fecha_entrega: s.fecha_entrega
        };
      });

      // Agrupado por cliente
      const porCliente = {};
      serviciosVentana.forEach(s => {
        const clave = s.cliente || 'Sin cliente';
        if (!porCliente[clave]) porCliente[clave] = [];
        porCliente[clave].push(s);
      });
      const serviciosPorCliente = Object.keys(porCliente).sort().map(cliente => ({
        cliente,
        items: porCliente[cliente].sort((a, b) => (a.fecha_entrega || '').localeCompare(b.fecha_entrega || ''))
      }));

      // Agrupado por tipo de servicio
      const porTipo = {};
      serviciosVentana.forEach(s => {
        const clave = s.servicio || 'Sin especificar';
        if (!porTipo[clave]) porTipo[clave] = [];
        porTipo[clave].push(s);
      });
      const serviciosPorTipo = Object.keys(porTipo).sort().map(tipo => ({
        tipo,
        items: porTipo[tipo].sort((a, b) => (a.fecha_entrega || '').localeCompare(b.fecha_entrega || ''))
      }));

      respuesta.servicios = {
        por_cliente: serviciosPorCliente,
        por_tipo: serviciosPorTipo
      };

      // -- Logística: proyectos asignados a Lavandería vs Office (próximos 14 días, confirmados) --
      const equipmentLavanderia = equipment.filter(e => familiaPerteneceA(e.familia, FAMILIAS_LAVANDERIA));
      const equipmentOffice = equipment.filter(e => familiaPerteneceA(e.familia, FAMILIAS_OFFICE));

      const idsLavanderia = new Set(equipmentLavanderia.map(e => String(e.proyecto_id)));
      const idsOffice = new Set(equipmentOffice.map(e => String(e.proyecto_id)));

      const proyectosEnVentana = proyectosConfirmados.filter(p => {
        const fecha = parsearFechaDDMMYYYY(p.entrega_fecha);
        if (!fecha) return false;
        const fechaMs = inicioDelDia(fecha).getTime();
        return fechaMs >= hoyMs && fechaMs <= limite14diasMs;
      });

      const mapearProyectoLogistica = p => ({
        id: p.id,
        numero: p.numero,
        cliente: p.cliente,
        fecha_entrega: p.entrega_fecha,
        estado: p.estado
      });

      respuesta.logistica = {
        lavanderia: proyectosEnVentana
          .filter(p => idsLavanderia.has(String(p.id)))
          .map(mapearProyectoLogistica)
          .sort((a, b) => (a.fecha_entrega || '').localeCompare(b.fecha_entrega || '')),
        office: proyectosEnVentana
          .filter(p => idsOffice.has(String(p.id)))
          .map(mapearProyectoLogistica)
          .sort((a, b) => (a.fecha_entrega || '').localeCompare(b.fecha_entrega || ''))
      };
    }

    res.json(respuesta);
  } catch (err) {
    console.error('Error en /api/preparacion:', err);
    res.status(500).json({ error: 'Error al construir vista de preparación: ' + err.message });
  }
});




// ── Tokens de acceso por perfil (sin login) ──
const TOKENS_PREPARACION = {
  'ORUMx2026Lav': 'lavanderia',
  'ORUMx2026Off': 'office',
  'ORUMx2026Alm': 'almacen'
};

// ── Endpoint público para Lavandería / Office / Almacén (token en URL) ──
app.get('/api/preparacion-publica', async (req, res) => {
  const token = req.query.token || '';
  const perfil = TOKENS_PREPARACION[token];
  if (!perfil) {
    return res.status(401).json({ error: 'Acceso no autorizado' });
  }
  try {
    // Respetar la vista pedida, validando que el perfil la tiene permitida
    const vistasPermitidas = { lavanderia: ['lavanderia'], office: ['office'], almacen: ['almacen', 'lavanderia', 'office'] };
    const vistaParam = req.query.vista || perfil;
    const vista = (vistasPermitidas[perfil] || []).includes(vistaParam) ? vistaParam : perfil;
    const modo = vista === 'almacen' ? 'dias' : 'semanas';
    const ordenPeriodos = modo === 'dias' ? ORDEN_PERIODOS_DIAS : ORDEN_PERIODOS_SEMANAS;

    const [proyectosResp, equipmentResp] = await Promise.all([
      llamarOrumCentral('proyectos'),
      llamarOrumCentral('equipment')
    ]);

    const proyectos = (proyectosResp.data || []).filter(p => p.cancelado !== 'SI');
    const proyectosConfirmados = proyectos.filter(p => {
      const estadoNorm = normalizarTexto(p.estado);
      return !ESTADOS_EXCLUIR_NOMBRE.includes(estadoNorm);
    });
    const proyectoPorId = {};
    proyectosConfirmados.forEach(p => { proyectoPorId[String(p.id)] = p; });

    const equipment = equipmentResp.data || [];
    let equipmentFiltrado = equipment;
    if (vista === 'lavanderia') {
      equipmentFiltrado = equipment.filter(e => familiaPerteneceA(e.familia, FAMILIAS_LAVANDERIA));
    } else if (vista === 'office') {
      equipmentFiltrado = equipment.filter(e => familiaPerteneceA(e.familia, FAMILIAS_OFFICE));
    }
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
      const item = {
        id: p.id, numero: p.numero, cliente: p.cliente, comercial: p.comercial,
        estado: p.estado, fecha_entrega: p.entrega_fecha, entrega_hora: p.entrega_hora,
        localizacion: p.localizacion
      };
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
      const articulo = e.articulo || 'Sin articulo';
      if (!porMaterial[familia]) porMaterial[familia] = {};
      if (!porMaterial[familia][articulo]) porMaterial[familia][articulo] = { total: 0, detalle: [] };
      const cantidad = parseFloat(e.cantidad) || 0;
      porMaterial[familia][articulo].total += cantidad;
      porMaterial[familia][articulo].detalle.push({
        proyecto_numero: proyecto.numero, cliente: proyecto.cliente,
        fecha_entrega: proyecto.entrega_fecha, periodo, cantidad
      });
    });

    const porMaterialArray = Object.keys(porMaterial).sort().map(familia => ({
      familia,
      articulos: Object.keys(porMaterial[familia]).sort().map(articulo => ({
        articulo,
        total: Math.round(porMaterial[familia][articulo].total * 100) / 100,
        detalle: porMaterial[familia][articulo].detalle.sort((a, b) =>
          ordenPeriodos.indexOf(a.periodo) - ordenPeriodos.indexOf(b.periodo))
      }))
    }));

    const resumenPeriodos = ordenPeriodos.map(per => {
      const confirmado = porProyecto[per].confirmado.length;
      const preparado = porProyecto[per].preparado.length;
      const total = confirmado + preparado;
      return { periodo: per, listos: preparado, total, pendientes: confirmado };
    });

    const equipmentDetalle = equipmentFiltrado.map(e => ({
      proyecto_id: e.proyecto_id,
      familia: e.familia || 'Sin familia',
      articulo: e.articulo || '',
      cantidad: parseFloat(e.cantidad) || 0
    }));

    const respuesta = {
      vista, modo, orden_periodos: ordenPeriodos,
      resumen_periodos: resumenPeriodos,
      por_proyecto: porProyecto,
      por_material: porMaterialArray,
      equipment_detalle: equipmentDetalle,
      ultima_actualizacion: proyectosResp.ultima_actualizacion
    };

    if (vista === 'almacen') {
      const serviciosResp = await llamarOrumCentral('servicios');
      const servicios = serviciosResp.data || [];
      const hoyMs = inicioDelDia(new Date()).getTime();
      const limite14diasMs = hoyMs + 14 * 86400000;
      const serviciosVentana = servicios.filter(s => {
        const fecha = parsearFechaDDMMYYYY(s.fecha_entrega);
        if (!fecha) return false;
        return inicioDelDia(fecha).getTime() >= hoyMs && inicioDelDia(fecha).getTime() <= limite14diasMs;
      }).map(s => ({
        proyecto_numero: s.numero,
        cliente: (proyectoPorId[String(s.proyecto_id)] || {}).cliente || '',
        servicio: s.servicio, cantidad: s.cantidad, fecha_entrega: s.fecha_entrega
      }));
      const porTipo = {};
      serviciosVentana.forEach(s => {
        const clave = s.servicio || 'Sin especificar';
        if (!porTipo[clave]) porTipo[clave] = [];
        porTipo[clave].push(s);
      });
      respuesta.servicios = {
        por_tipo: Object.keys(porTipo).sort().map(tipo => ({
          tipo, items: porTipo[tipo].sort((a, b) => (a.fecha_entrega || '').localeCompare(b.fecha_entrega || ''))
        }))
      };
      const equipmentLavanderia = equipment.filter(e => familiaPerteneceA(e.familia, FAMILIAS_LAVANDERIA));
      const equipmentOffice = equipment.filter(e => familiaPerteneceA(e.familia, FAMILIAS_OFFICE));
      const idsLavanderia = new Set(equipmentLavanderia.map(e => String(e.proyecto_id)));
      const idsOffice = new Set(equipmentOffice.map(e => String(e.proyecto_id)));
      const proyectosEnVentana = proyectosConfirmados.filter(p => {
        const fecha = parsearFechaDDMMYYYY(p.entrega_fecha);
        if (!fecha) return false;
        const fechaMs = inicioDelDia(fecha).getTime();
        return fechaMs >= hoyMs && fechaMs <= limite14diasMs;
      });
      const mapear = p => ({ id: p.id, numero: p.numero, cliente: p.cliente, fecha_entrega: p.entrega_fecha, estado: p.estado });
      respuesta.logistica = {
        lavanderia: proyectosEnVentana.filter(p => idsLavanderia.has(String(p.id))).map(mapear).sort((a,b) => (a.fecha_entrega||'').localeCompare(b.fecha_entrega||'')),
        office: proyectosEnVentana.filter(p => idsOffice.has(String(p.id))).map(mapear).sort((a,b) => (a.fecha_entrega||'').localeCompare(b.fecha_entrega||''))
      };
    }

    res.json(respuesta);
  } catch (err) {
    console.error('Error en /api/preparacion-publica:', err);
    res.status(500).json({ error: 'Error al construir vista: ' + err.message });
  }
});

// ── Sirve preparacion.html para acceso por token ──
app.get('/preparacion', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'preparacion.html'));
});

app.listen(PORT, () => {
  console.log(`ORUM Central Panel escuchando en puerto ${PORT}`);
});
