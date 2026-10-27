// Ayuda de ORUM Central (oct 2026) — /api/ayuda/*. Los manuales viven en la
// carpeta ayuda/ (Markdown) y se cambian junto con el código: cuando cambia
// una pantalla, se cambia su manual en el mismo commit.
//
// Cada uno ve el manual de su puesto (Dirección todos; «Sistema» solo Sergio)
// y puede preguntar a un chat que contesta SOLO con esos manuales. Las
// preguntas quedan en ayuda_preguntas (sql/ayuda.sql) para ver qué no supo
// contestar y mejorar los manuales.
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic(); // ANTHROPIC_API_KEY de Railway
const MODELO = 'claude-opus-5-5';
const ADMIN = 'sergio';
const MAX_PREGUNTAS_DIA = 40;
const CARPETA = path.join(__dirname, '..', 'ayuda');

// Qué manuales ve cada rol, en orden (el primero es el suyo)
const MANUALES = [
  { id: 'general', titulo: 'Lo básico', archivo: 'general.md' },
  { id: 'administracion', titulo: 'Administración', archivo: 'administracion.md' },
  { id: 'logistica', titulo: 'Logística y almacén', archivo: 'logistica.md' },
  { id: 'comerciales', titulo: 'Comerciales', archivo: 'comerciales.md' },
  { id: 'direccion', titulo: 'Dirección', archivo: 'direccion.md' },
  { id: 'conductores', titulo: 'Conductores', archivo: 'conductores.md' },
  { id: 'tablets', titulo: 'Tablets', archivo: 'tablets.md' },
  { id: 'sistema', titulo: 'Sistema', archivo: 'sistema.md' }
];
const POR_ROL = {
  Direccion: ['direccion', 'general', 'administracion', 'logistica', 'comerciales', 'conductores', 'tablets'],
  Contabilidad: ['administracion', 'general'],
  Logistica: ['logistica', 'general', 'tablets', 'conductores'],
  Comercial: ['comerciales', 'general'],
  Lavanderia: ['tablets'],
  Office: ['tablets'],
  Mantenimiento: ['tablets']
};

// Se leen una vez al arrancar (cambian con cada publicación)
const textos = {};
MANUALES.forEach(m => {
  try { textos[m.id] = fs.readFileSync(path.join(CARPETA, m.archivo), 'utf8'); }
  catch (err) { console.error('[Ayuda] No se pudo leer ' + m.archivo + ':', err.message); textos[m.id] = ''; }
});

function manualesDe(u) {
  const ids = (POR_ROL[u.rol] || ['general']).slice();
  if (String(u.usuario || '').toLowerCase() === ADMIN && !u.solo_lectura) ids.push('sistema');
  return ids.map(id => MANUALES.find(m => m.id === id)).filter(m => m && textos[m.id]);
}

const INSTRUCCIONES = `Eres la Ayuda de ORUM Central, el panel interno de ORUM (alquiler de material para eventos). Contestas dudas de uso a la plantilla, en español, de tú, en frases cortas y claras.

Reglas:
- Contesta SOLO con lo que dicen los manuales de abajo. No inventes pantallas, botones, pasos ni personas que no salgan en ellos.
- Si la pregunta es de un proceso, explícalo en pasos numerados, diciendo dónde está cada cosa (menú → pantalla → botón) y quién lo hace.
- Si los manuales no lo explican, dilo con sinceridad, marca encontrada=false y sugiere apuntar una incidencia de tipo «Sistema» o preguntar a Dirección.
- No contestas preguntas sobre datos concretos (importes, fechas o estados de un proyecto o factura): explica dónde mirarlos.
- Ten en cuenta el puesto y la pantalla de quien pregunta.
- Respuesta en texto plano; puedes usar listas con «1.» o «-». Nada de tablas ni títulos.`;

const ESQUEMA = {
  type: 'object',
  properties: {
    respuesta: { type: 'string', description: 'La respuesta para la persona' },
    encontrada: { type: 'boolean', description: 'true si los manuales explican lo que pregunta' }
  },
  required: ['respuesta', 'encontrada'],
  additionalProperties: false
};

function registrar(app, { supabase, requiereLogin }) {
  async function q(promesa) {
    const { data, error } = await promesa;
    if (error) throw error;
    return data;
  }
  const ruta = (etiqueta, fn) => async (req, res) => {
    try {
      res.json({ ok: true, ...(await fn(req, res)) });
    } catch (err) {
      if (err.estado) return res.status(err.estado).json({ error: err.message });
      console.error('Error en ' + etiqueta + ':', err);
      res.status(500).json({ error: err.message });
    }
  };
  const fallo = (estado, msg) => Object.assign(new Error(msg), { estado });
  const esAdmin = u => String(u.usuario || '').toLowerCase() === ADMIN;

  // Manuales que ve esta persona, con su texto
  app.get('/api/ayuda', requiereLogin, ruta('GET ayuda', async req => {
    const u = req.session.usuario;
    return {
      manuales: manualesDe(u).map(m => ({ id: m.id, titulo: m.titulo, contenido: textos[m.id] })),
      puede_ver_preguntas: esAdmin(u) && !u.solo_lectura
    };
  }));

  // Pregunta al chat de la Ayuda. historial: las últimas preguntas y respuestas de esta conversación
  app.post('/api/ayuda/preguntar', requiereLogin, ruta('POST ayuda/preguntar', async req => {
    const u = req.session.usuario, b = req.body || {};
    const pregunta = String(b.pregunta || '').trim().slice(0, 1000);
    if (!pregunta) throw fallo(400, 'Escribe tu pregunta');
    const desde = new Date(Date.now() - 864e5).toISOString();
    const { count, error } = await supabase.from('ayuda_preguntas').select('id', { count: 'exact', head: true }).eq('usuario', u.usuario).gte('creado_en', desde);
    if (error) throw error;
    if ((count || 0) >= MAX_PREGUNTAS_DIA) throw fallo(429, 'Has llegado al máximo de preguntas de hoy. Mañana podrás seguir preguntando.');

    const manuales = manualesDe(u);
    // Los manuales van primero y sin cambios entre preguntas: así se reutiliza la caché
    const sistema = [
      { type: 'text', text: INSTRUCCIONES },
      { type: 'text', text: manuales.map(m => '<manual titulo="' + m.titulo + '">\n' + textos[m.id] + '\n</manual>').join('\n\n'), cache_control: { type: 'ephemeral' } }
    ];
    const mensajes = [];
    (Array.isArray(b.historial) ? b.historial : []).slice(-3).forEach(h => {
      if (!h || !h.pregunta || !h.respuesta) return;
      mensajes.push({ role: 'user', content: String(h.pregunta).slice(0, 1000) });
      mensajes.push({ role: 'assistant', content: JSON.stringify({ respuesta: String(h.respuesta).slice(0, 3000), encontrada: true }) });
    });
    const contexto = 'Quien pregunta: ' + (u.nombre || u.usuario) + ', puesto ' + u.rol + (u.solo_lectura ? ' (usuario de solo consulta: no puede cambiar nada)' : '') +
      (b.pantalla ? '. Está en la pantalla: ' + String(b.pantalla).slice(0, 100) : '') + '.';
    mensajes.push({ role: 'user', content: contexto + '\n\nPregunta: ' + pregunta });

    const response = await anthropic.beta.messages.create({
      model: MODELO,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ESQUEMA } },
      system: sistema,
      messages: mensajes
    });
    let salida;
    if (response.stop_reason === 'refusal') salida = { respuesta: 'No puedo contestar a eso. Si es una duda de ORUM Central, prueba a explicarla de otra forma o pregunta a Dirección.', encontrada: false };
    else {
      const texto = (response.content || []).find(x => x.type === 'text');
      try { salida = JSON.parse(texto ? texto.text : ''); }
      catch (e) { throw new Error('La Ayuda no ha devuelto una respuesta válida'); }
    }
    const [fila] = await q(supabase.from('ayuda_preguntas').insert({
      usuario: u.usuario, nombre: u.nombre || null, rol: u.rol, pantalla: b.pantalla ? String(b.pantalla).slice(0, 100) : null,
      pregunta, respuesta: salida.respuesta, encontrada: !!salida.encontrada
    }).select('id'));
    return { id: fila.id, respuesta: salida.respuesta, encontrada: !!salida.encontrada };
  }));

  // 👍 / 👎 a una respuesta propia
  app.post('/api/ayuda/preguntas/:id/valorar', requiereLogin, ruta('POST ayuda/valorar', async req => {
    const v = Number((req.body || {}).valor);
    if (v !== 1 && v !== -1) throw fallo(400, 'Valoración no válida');
    const r = await q(supabase.from('ayuda_preguntas').update({ valoracion: v }).eq('id', parseInt(req.params.id) || 0).eq('usuario', req.session.usuario.usuario).select('id'));
    if (!r.length) throw fallo(404, 'Pregunta no encontrada');
    return {};
  }));

  // Lo que pregunta la gente (solo Sergio): ?filtro=sin_respuesta|negativas
  app.get('/api/ayuda/preguntas', requiereLogin, ruta('GET ayuda/preguntas', async req => {
    const u = req.session.usuario;
    if (!esAdmin(u) || u.solo_lectura) throw fallo(403, 'No autorizado');
    let c = supabase.from('ayuda_preguntas').select('*').order('creado_en', { ascending: false }).limit(300);
    if (req.query.filtro === 'sin_respuesta') c = c.eq('encontrada', false);
    if (req.query.filtro === 'negativas') c = c.eq('valoracion', -1);
    return { preguntas: await q(c) };
  }));
}

module.exports = { registrar, MANUALES, POR_ROL };
