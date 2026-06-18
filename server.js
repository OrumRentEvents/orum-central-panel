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
      return {
        factura_id: f.factura_id,
        numero_factura: f.numero,
        proyecto_id: f.proyecto_id,
        proyecto_numero: proyecto ? proyecto.numero : null,
        cliente: f.cliente,
        comercial: proyecto ? proyecto.comercial : null,
        fecha_entrega: proyecto ? proyecto.entrega_fecha : null,
        fecha_emision: f.fecha_emision,
        fecha_vencimiento: f.fecha_vencimiento,
        importe_con_iva: f.importe_con_iva,
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

    const pncCuadran = crucePNC.filter(p => p.cuadra).length;

    res.json({
      kpis,
      total_proyectos: proyectos.length,
      total_facturas: facturas.length,
      total_proyectos_pnc: proyectosPNC.length,
      pnc_cuadran: pncCuadran,
      total_registros_caja: registros.length,
      total_nc_formulario: ncFormulario.length,
      total_nc_confirmaciones: ncConfirmaciones.length,
      facturas_sin_registro_caja: cruceFacturas.filter(f => f.sin_registro_caja).length,
      pnc_que_no_cuadran: crucePNC.filter(p => !p.cuadra).length,
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
// PÁGINA PRINCIPAL
// ================================================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ORUM Central Panel escuchando en puerto ${PORT}`);
});
