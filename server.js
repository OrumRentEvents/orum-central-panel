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
    const [proyectosResp, cajaResp] = await Promise.all([
      llamarOrumCentral('proyectos'),
      llamarOrumCentral('caja')
    ]);

    const proyectos = proyectosResp.data || [];
    const registros = cajaResp.registros || [];
    const ncConfirmaciones = cajaResp.nc_confirmaciones || [];
    const ncFormulario = cajaResp.nc_formulario || [];

    // Indexar registros de Caja por número de proyecto para cruce rápido
    const registrosPorNumero = {};
    registros.forEach(r => {
      const num = String(r.numero);
      if (!registrosPorNumero[num]) registrosPorNumero[num] = [];
      registrosPorNumero[num].push(r);
    });

    // Indexar cobros PNC (formulario) por número de proyecto
    const ncPorNumero = {};
    ncFormulario.forEach(r => {
      const num = String(r['Nº Proyecto']);
      if (!ncPorNumero[num]) ncPorNumero[num] = [];
      ncPorNumero[num].push(r);
    });

    // Separar proyectos normales vs PNC (abrebotellas)
    const proyectosNormales = proyectos.filter(p => p.es_abrebotellas !== 'SI' && p.es_abrebotellas !== true);
    const proyectosPNC = proyectos.filter(p => p.es_abrebotellas === 'SI' || p.es_abrebotellas === true);

    // Cruce de proyectos normales con su forma de pago real (Caja)
    const cruceNormales = proyectosNormales.map(p => ({
      numero: p.numero,
      cliente: p.cliente,
      comercial: p.comercial,
      estado: p.estado,
      valor: p.valor,
      already_invoiced: p.already_invoiced,
      pagos_caja: registrosPorNumero[String(p.numero)] || []
    }));

    // Cruce de proyectos PNC con su cobro del formulario
    const crucePNC = proyectosPNC.map(p => ({
      numero: p.numero,
      cliente: p.cliente,
      comercial: p.comercial,
      estado: p.estado,
      valor: p.valor,
      cobros_formulario: ncPorNumero[String(p.numero)] || []
    }));

    res.json({
      total_proyectos_normales: proyectosNormales.length,
      total_proyectos_pnc: proyectosPNC.length,
      total_registros_caja: registros.length,
      total_nc_formulario: ncFormulario.length,
      total_nc_confirmaciones: ncConfirmaciones.length,
      cruce_normales: cruceNormales,
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
