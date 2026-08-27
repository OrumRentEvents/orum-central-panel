// ================================================================
// Fuente de datos: Supabase en vez de Apps Script/Sheets.
// ================================================================
// Reconstruye EXACTAMENTE la misma forma de respuesta JSON que ya
// devolvía cada action= de ORUM CENTRAL (mismos nombres de campo, mismos
// formatos "SI"/"NO", mismas fechas como texto) - así ningún otro sitio
// del código (ni el frontend) necesita cambiar, solo de dónde viene el dato.
//
// Sheets sigue siendo la copia de seguridad (los webhooks de Rentman
// siguen escribiendo ahí igual que siempre) - esto solo cambia de dónde
// LEE el panel.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Supabase limita cada consulta a 1000 filas por defecto - sin esto,
// tablas grandes (Equipment tiene 11.000+) se cortarían en silencio.
// Pagina con .range() hasta traer todo.
const PAGE_SIZE = 1000;
async function selectAll(tabla, columnas, filtro) {
  var todas = [];
  var offset = 0;
  while (true) {
    var query = supabase.from(tabla).select(columnas || '*').range(offset, offset + PAGE_SIZE - 1);
    if (filtro) query = filtro(query);
    var { data, error } = await query;
    if (error) throw error;
    todas = todas.concat(data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return todas;
}

// Apps Script devolvía "" para campos vacíos; nuestros imports guardan
// null en su lugar. Si el frontend concatena texto ("Vehículo: " + v),
// un null se vería literalmente como la palabra "null" en pantalla -
// esto lo evita, sin cambiar nada en el frontend.
function v(x) { return x == null ? '' : x; }

function ultimaActualizacion(rows) {
  if (!rows || rows.length === 0) return null;
  var max = rows.reduce(function (m, r) {
    return r.sincronizado_en && r.sincronizado_en > m ? r.sincronizado_en : m;
  }, rows[0].sincronizado_en || '');
  return max || null;
}

async function obtenerProyectos() {
  const data = await selectAll('proyectos');
  const mapeado = data.map(function (r) {
    return {
      id: r.id, numero: r.numero, nombre: v(r.nombre), cliente: v(r.cliente), comercial: v(r.comercial),
      estado: v(r.estado), localizacion: v(r.localizacion), valor: r.valor,
      entrega_fecha: v(r.entrega_fecha_raw), entrega_hora: v(r.entrega_hora_raw),
      recogida_fecha: v(r.recogida_fecha_raw), recogida_hora: v(r.recogida_hora_raw),
      evento_inicio: v(r.evento_inicio_raw), evento_fin: v(r.evento_fin_raw),
      es_abrebotellas: r.es_abrebotellas ? 'SI' : 'NO',
      cancelado: r.cancelado ? 'SI' : 'NO',
      already_invoiced: r.already_invoiced, rental_price: r.rental_price, transport_price: r.transport_price,
      crew_price: r.crew_price, sale_price: r.sale_price, other_price: r.other_price, insurance_price: r.insurance_price,
      vehiculo: v(r.vehiculo), conductor: v(r.conductor), google_maps_url: v(r.google_maps_url),
      updated: v(r.updated_raw), fecha_creacion: v(r.fecha_creacion_raw)
    };
  });
  return { data: mapeado, total: mapeado.length, ultima_actualizacion: ultimaActualizacion(data) };
}

async function obtenerFacturas() {
  const data = await selectAll('facturas');
  const mapeado = data.map(function (r) {
    return {
      factura_id: r.factura_id, proyecto_id: r.proyecto_id, numero: r.numero, cliente: v(r.cliente),
      importe_sin_iva: r.importe_sin_iva, importe_con_iva: r.importe_con_iva, total_pagado: r.total_pagado,
      pendiente_cobro: r.pendiente_cobro, esta_pagada: r.esta_pagada ? 'SI' : 'NO',
      fecha_emision: v(r.fecha_emision_raw), fecha_vencimiento: v(r.fecha_vencimiento_raw), updated: v(r.updated_raw)
    };
  });
  return { data: mapeado, total: mapeado.length, ultima_actualizacion: ultimaActualizacion(data) };
}

async function obtenerPagos() {
  const data = await selectAll('pagos');
  const mapeado = data.map(function (r) {
    return {
      proyecto_id: r.proyecto_id, factura_id: r.factura_id, numero_factura: r.numero_factura, pago_id: r.pago_id,
      importe: r.importe, fecha_pago: v(r.fecha_pago_raw), descripcion: v(r.descripcion), updated: v(r.updated_raw)
    };
  });
  return { data: mapeado, total: mapeado.length, ultima_actualizacion: ultimaActualizacion(data) };
}

async function obtenerPresupuestos() {
  const data = await selectAll('presupuestos');
  const mapeado = data.map(function (r) {
    return {
      proyecto_id: r.proyecto_id, numero_proyecto: r.numero_proyecto, cliente: v(r.cliente), comercial: v(r.comercial),
      presupuesto_id: r.presupuesto_id, version: r.version,
      fecha_emision: v(r.fecha_emision_raw), fecha_caducidad: v(r.fecha_caducidad_raw), estado: v(r.estado),
      importe_sin_iva: r.importe_sin_iva, importe_con_iva: r.importe_con_iva, updated: v(r.updated_raw)
    };
  });
  return { data: mapeado, total: mapeado.length, ultima_actualizacion: ultimaActualizacion(data) };
}

async function obtenerServicios() {
  const data = await selectAll('servicios');
  const mapeado = data.map(function (r) {
    return {
      proyecto_id: r.proyecto_id, numero: r.numero, servicio: v(r.servicio),
      cantidad: r.cantidad, importe: r.importe, fecha_entrega: v(r.fecha_entrega_raw), updated: v(r.updated_raw)
    };
  });
  return { data: mapeado, total: mapeado.length, ultima_actualizacion: ultimaActualizacion(data) };
}

async function obtenerEquipment() {
  const data = await selectAll('equipment');
  const mapeado = data.map(function (r) {
    return {
      proyecto_id: r.proyecto_id, familia: v(r.familia), articulo: v(r.articulo),
      cantidad: r.cantidad, precio_unit: r.precio_unit, importe: r.importe, updated: v(r.updated_raw)
    };
  });
  return { data: mapeado, total: mapeado.length, ultima_actualizacion: ultimaActualizacion(data) };
}

async function obtenerLeads() {
  const data = await selectAll('leads');
  const mapeado = data.map(function (r) {
    return {
      mes: v(r.mes), fecha_lead: v(r.fecha_lead_raw), canal: v(r.canal), solicitud: v(r.solicitud),
      nombre: v(r.nombre), telefono: v(r.telefono), email: v(r.email), empresa: v(r.empresa), mensaje: v(r.mensaje),
      fecha_contacto: v(r.fecha_contacto_raw), ubicacion: v(r.ubicacion), estado: v(r.estado),
      forma_contacto: v(r.forma_contacto), cliente_nuevo: v(r.cliente_nuevo),
      no_presupuesto: v(r.no_presupuesto), no_pedido: v(r.no_pedido), importe_pedido: r.importe_pedido,
      anotaciones: v(r.anotaciones)
    };
  });
  return { data: mapeado, total: mapeado.length };
}

async function obtenerUsuarios() {
  const data = await selectAll('usuarios');
  const mapeado = data.map(function (r) {
    return { usuario: r.usuario, password_hash: r.password_hash, nombre: r.nombre, rol: r.rol, comercial_filtro: r.comercial_filtro };
  });
  return { data: mapeado };
}

async function obtenerCaja() {
  const [registrosData, ncConfData, ncFormData] = await Promise.all([
    selectAll('caja_registros'),
    selectAll('caja_nc_confirmaciones'),
    selectAll('caja_nc_formulario')
  ]);

  const registros = registrosData.map(function (r) {
    return {
      factura_id: r.factura_id, metodo_pago: v(r.metodo_pago), ubicacion: v(r.ubicacion), tipo: v(r.tipo),
      importe: r.importe, cliente: v(r.cliente), numero: r.numero, fecha_pago: v(r.fecha_pago_raw),
      es_abrebotellas: r.es_abrebotellas, usuario: v(r.usuario), num_operacion: v(r.num_operacion),
      updated: v(r.updated_raw)
    };
  });
  const nc_confirmaciones = ncConfData.map(function (r) {
    return {
      nc_id: r.nc_id, confirmado: r.confirmado, usuario: v(r.usuario), ts: r.ts,
      metodo: v(r.metodo), importe: r.importe, cliente: v(r.cliente), numero: r.numero
    };
  });
  const nc_formulario = ncFormData.map(function (r) {
    return {
      Timestamp: v(r.timestamp_raw), Email: v(r.email), 'Nº Proyecto': r.numero_proyecto,
      Cliente: v(r.cliente), Importe: r.importe, 'Método': v(r.metodo), ID_UNICO: r.id_unico
    };
  });
  return { registros: registros, nc_confirmaciones: nc_confirmaciones, nc_formulario: nc_formulario, errores: [] };
}

async function obtenerRutas(desde, hasta) {
  const [paradasData, vehiculosData] = await Promise.all([
    selectAll('rutas_paradas', '*', function (query) {
      if (desde) query = query.gte('fecha', desde);
      if (hasta) query = query.lte('fecha', hasta);
      return query;
    }),
    selectAll('rutas_vehiculos', 'nombre')
  ]);

  const paradas = paradasData.map(function (r) {
    return {
      tipo: v(r.tipo), proyecto_id: r.proyecto_id, numero: r.numero, cliente: v(r.cliente),
      localizacion: v(r.localizacion), google_maps_url: v(r.google_maps_url), estado: v(r.estado),
      fecha: r.fecha, hora: v(r.hora), vehiculo: v(r.vehiculo), conductor: v(r.conductor), notas: v(r.notas),
      vuelta: r.vuelta, orden: r.orden, es_manual: r.es_manual, clave: r.clave,
      // Faltaba este campo (bug real encontrado 25 ago 2026): las paradas
      // manuales lo necesitan para poder editarse/borrarse - sin él, el
      // frontend mandaba id:"" y el backend nunca encontraba la fila,
      // aunque respondía "ok" igualmente (falso positivo). clave siempre
      // es "MAN_" + id_manual para las manuales, así que se puede derivar
      // sin tocar el esquema de la tabla.
      id_manual: r.es_manual ? r.clave.replace(/^MAN_/, '') : null,
      // Estado de parada (tiempo real desde RUTA ORUM 2026)
      preparado: !!r.preparado, cargado: !!r.cargado, incidencia: !!r.incidencia,
      incidencia_texto: v(r.incidencia_texto), estado_usuario: v(r.estado_usuario)
    };
  });
  const vehiculos = vehiculosData.map(function (r) { return r.nombre; });
  return { ok: true, paradas: paradas, vehiculos: vehiculos };
}

// Lista ligera de paradas (solo tipo+fecha) para la gráfica comparativa
// por meses - sin agregación, eso lo hace server.js reutilizando la misma
// regla de "semana pertenece al mes con más días" del Informe Mensual.
async function obtenerParadasParaEvolucion() {
  return selectAll('rutas_paradas', 'tipo,fecha');
}

// Estadísticas de Rutas & Conductores: nº de entregas/recogidas por
// conductor y por vehículo dentro de un rango de fechas - para el
// informe de "quién ha hecho más rutas" / "qué vehículo sale más".
//
// OJO: rutas_paradas.conductor casi siempre viene vacío ("{}", el vacío
// de un array de Postgres) - el nombre real del conductor vive en
// rutas_conductores (asignación por fecha+vehículo+vuelta), así que hay
// que cruzar ahí. Y rutas_paradas.vehiculo a veces trae varios vehículos
// juntos en la misma parada ("NISSAN,IVECO", "__compartidos_X+Y__") -
// se separan para que cada vehículo cuente por su lado.
async function obtenerEstadisticasRutas(desde, hasta) {
  const [paradasData, conductoresData] = await Promise.all([
    selectAll('rutas_paradas', 'tipo,vehiculo,conductor,fecha,vuelta,incidencia', function (query) {
      if (desde) query = query.gte('fecha', desde);
      if (hasta) query = query.lte('fecha', hasta);
      return query;
    }),
    selectAll('rutas_conductores', 'fecha,vehiculo,vuelta,conductores', function (query) {
      if (desde) query = query.gte('fecha', desde);
      if (hasta) query = query.lte('fecha', hasta);
      return query;
    })
  ]);

  // Índice de asignaciones conductor<->vehículo: exacto por vuelta, y un
  // fallback por si la parada no trae vuelta (algunas manuales no la tienen).
  const porClaveExacta = {};
  const porFechaVehiculo = {};
  conductoresData.forEach(function (r) {
    const nombres = r.conductores || [];
    if (nombres.length === 0) return;
    porClaveExacta[r.fecha + '|' + r.vehiculo + '|' + r.vuelta] = nombres;
    const claveFV = r.fecha + '|' + r.vehiculo;
    porFechaVehiculo[claveFV] = (porFechaVehiculo[claveFV] || []).concat(nombres);
  });

  function limpiarVehiculos(campo) {
    if (!campo) return [];
    return String(campo).replace(/^__compartidos_/, '').replace(/__$/, '')
      .split(/[,+]/).map(function (v) { return v.trim(); }).filter(Boolean);
  }

  const porConductor = {};
  const porVehiculo = {};
  var totalEntregas = 0, totalRecogidas = 0, sinAsignar = 0, conIncidencia = 0;

  paradasData.forEach(function (r) {
    if (r.tipo === 'ENTREGA') totalEntregas++;
    else if (r.tipo === 'RECOGIDA') totalRecogidas++;
    if (r.incidencia) conIncidencia++;

    const vehiculosParada = limpiarVehiculos(r.vehiculo);
    if (vehiculosParada.length === 0) { sinAsignar++; return; }

    vehiculosParada.forEach(function (veh) {
      if (!porVehiculo[veh]) porVehiculo[veh] = { nombre: veh, entregas: 0, recogidas: 0, total: 0 };
      porVehiculo[veh].total++;
      if (r.tipo === 'ENTREGA') porVehiculo[veh].entregas++;
      else if (r.tipo === 'RECOGIDA') porVehiculo[veh].recogidas++;

      // Prioridad: si la propia parada ya trae conductor (backfill de las
      // hojas mensuales marzo-junio, o cualquier sync futuro que lo rellene
      // directo), se usa eso - es más preciso que el cruce por día+vehículo.
      // Si no, se cae al cruce con rutas_conductores (julio en adelante).
      const conductorPropio = Array.isArray(r.conductor) ? r.conductor : [];
      const claveExacta = r.fecha + '|' + veh + '|' + r.vuelta;
      const claveFV = r.fecha + '|' + veh;
      const nombres = conductorPropio.length > 0 ? conductorPropio : (porClaveExacta[claveExacta] || porFechaVehiculo[claveFV] || []);
      nombres.forEach(function (nombre) {
        if (!nombre) return;
        if (!porConductor[nombre]) porConductor[nombre] = { nombre: nombre, entregas: 0, recogidas: 0, total: 0 };
        porConductor[nombre].total++;
        if (r.tipo === 'ENTREGA') porConductor[nombre].entregas++;
        else if (r.tipo === 'RECOGIDA') porConductor[nombre].recogidas++;
      });
    });
  });

  const conductores = Object.keys(porConductor).map(function (k) { return porConductor[k]; }).sort(function (a, b) { return b.total - a.total; });
  const vehiculos = Object.keys(porVehiculo).map(function (k) { return porVehiculo[k]; }).sort(function (a, b) { return b.total - a.total; });

  return {
    ok: true,
    total_paradas: paradasData.length,
    total_entregas: totalEntregas,
    total_recogidas: totalRecogidas,
    sin_asignar: sinAsignar,
    con_incidencia: conIncidencia,
    conductores: conductores,
    vehiculos: vehiculos
  };
}

// Estadísticas de material alquilado: más/menos alquilado, lo que más
// ingresa, y roturas/no devueltos - para la pantalla de Almacén.
async function obtenerEstadisticasMaterial() {
  const [normalData, pncData, costesData, proyectosData] = await Promise.all([
    selectAll('estadisticas_material', 'familia,articulo,veces_alquilado,unidades_totales,importe_total'),
    selectAll('estadisticas_material_pnc', 'familia,articulo,veces_alquilado,unidades_totales,importe_total'),
    selectAll('costes_adicionales', 'proyecto_id,articulo,cantidad,importe'),
    selectAll('proyectos', 'id,estado,cancelado')
  ]);

  // Solo proyectos en etapa confirmada (no Pending/Concept/Inquiry, no
  // cancelados) - estadisticas_material/_pnc ya vienen filtradas así desde
  // origen, pero costes_adicionales (roturas) no, así que se filtra aquí.
  const confirmados = new Set();
  proyectosData.forEach(function (p) {
    var est = String(p.estado || '').toLowerCase();
    var pipeline = ['pending', 'concept', 'inquiry'].indexOf(est) !== -1;
    if (!p.cancelado && !pipeline) confirmados.add(p.id);
  });

  // Suma normal+PNC por artículo (un artículo puede tener varias filas -
  // una por semana - así que se acumulan todas).
  const porArticulo = {};
  function acumular(rows, esPnc) {
    rows.forEach(function (r) {
      const key = r.articulo;
      if (!porArticulo[key]) {
        porArticulo[key] = { articulo: r.articulo, familia: v(r.familia), veces: 0, unidades: 0, importe: 0, importe_normal: 0, importe_pnc: 0 };
      }
      const item = porArticulo[key];
      if (!item.familia && r.familia) item.familia = r.familia;
      item.veces += r.veces_alquilado || 0;
      item.unidades += r.unidades_totales || 0;
      item.importe += parseFloat(r.importe_total) || 0;
      if (esPnc) item.importe_pnc += parseFloat(r.importe_total) || 0;
      else item.importe_normal += parseFloat(r.importe_total) || 0;
    });
  }
  acumular(normalData, false);
  acumular(pncData, true);

  // "Almacenaje" son cajas/racks de transporte, no material que se
  // facture o alquile de verdad - salen en casi todas las entregas (por
  // eso dominarían el "más alquilado") pero a 0€, así que ensucian las
  // estadísticas sin aportar nada. Se excluyen del todo.
  const articulos = Object.keys(porArticulo).map(function (k) { return porArticulo[k]; })
    .filter(function (a) { return a.familia !== 'Almacenaje'; });

  // Roturas / no devueltos: el nombre del artículo en costes_adicionales
  // ya trae la nota pegada (ej. "TENEDOR... no devuelto") - se agrupa tal
  // cual, sin intentar separar el artículo base del texto de la nota
  // (arriesgado adivinar mal); así se ve exactamente qué se está cobrando.
  const porRotura = {};
  costesData.filter(function (r) { return confirmados.has(r.proyecto_id); }).forEach(function (r) {
    const key = r.articulo;
    if (!porRotura[key]) porRotura[key] = { articulo: r.articulo, veces: 0, unidades: 0, importe: 0 };
    porRotura[key].veces++;
    porRotura[key].unidades += parseFloat(r.cantidad) || 0;
    porRotura[key].importe += parseFloat(r.importe) || 0;
  });
  const roturas = Object.keys(porRotura).map(function (k) { return porRotura[k]; }).sort(function (a, b) { return b.importe - a.importe; });

  // Ingresos por familia
  const porFamilia = {};
  articulos.forEach(function (a) {
    const fam = a.familia || 'Sin familia';
    if (!porFamilia[fam]) porFamilia[fam] = { familia: fam, importe: 0, unidades: 0 };
    porFamilia[fam].importe += a.importe;
    porFamilia[fam].unidades += a.unidades;
  });
  const familias = Object.keys(porFamilia).map(function (k) { return porFamilia[k]; }).sort(function (a, b) { return b.importe - a.importe; });

  return {
    ok: true,
    articulos: articulos,
    roturas: roturas.slice(0, 100),
    familias: familias
  };
}

async function obtenerConductores(desde, hasta) {
  const data = await selectAll('rutas_conductores', '*', function (query) {
    if (desde) query = query.gte('fecha', desde);
    if (hasta) query = query.lte('fecha', hasta);
    return query;
  });
  const asignaciones = data.map(function (r) {
    return { fecha: r.fecha, vehiculo: r.vehiculo, vuelta: r.vuelta, conductores: r.conductores || [] };
  });
  return { ok: true, asignaciones: asignaciones, choferes: [] }; // lista de choferes sigue viniendo de RUTAS_SCRIPT_URL (CONFIG), no se duplica aquí
}

async function obtenerEstadoVehiculos(desde, hasta) {
  const data = await selectAll('rutas_estado_vehiculos', '*', function (query) {
    if (desde) query = query.gte('fecha', desde);
    if (hasta) query = query.lte('fecha', hasta);
    return query;
  });
  const estados = data.map(function (r) {
    return { fecha: r.fecha, vehiculo: r.vehiculo, vuelta: r.vuelta, estado: v(r.estado), usuario: v(r.usuario) };
  });
  return { ok: true, estados: estados };
}

// Igual que /api/rutas/material de server.js hoy (filtra equipment por
// proyecto_id), pero con una consulta indexada en vez de traer las 11.000+
// filas completas de equipment cada vez.
async function obtenerMaterialDeProyecto(proyectoId) {
  const { data, error } = await supabase.from('equipment').select('*').eq('proyecto_id', proyectoId);
  if (error) throw error;
  return data.map(function (r) {
    return {
      proyecto_id: r.proyecto_id, familia: v(r.familia), articulo: v(r.articulo),
      cantidad: r.cantidad, precio_unit: r.precio_unit, importe: r.importe, updated: v(r.updated_raw)
    };
  });
}

// Detalle para el botón 📦 de Proyectos/Presupuestos: material (igual que
// obtenerMaterialDeProyecto) + el desglose de servicios adicionales que ya
// guarda cada proyecto (transporte, personal/montaje, seguro, otros, venta).
// Mismos conceptos que CONCEPTOS_SERVICIOS en OrumCentral.gs.
const CONCEPTOS_SERVICIOS_PROYECTO = [
  { campo: 'transport_price', nombre: 'Transporte' },
  { campo: 'crew_price', nombre: 'Personal / Montaje' },
  { campo: 'insurance_price', nombre: 'Seguro' },
  { campo: 'other_price', nombre: 'Otros (roturas, etc.)' },
  { campo: 'sale_price', nombre: 'Venta' }
];
async function obtenerDetalleProyecto(proyectoId) {
  const [{ data: equipmentData, error: errEq }, { data: proyectoData, error: errProy }] = await Promise.all([
    supabase.from('equipment').select('*').eq('proyecto_id', proyectoId),
    supabase.from('proyectos').select('numero,transport_price,crew_price,insurance_price,other_price,sale_price').eq('id', proyectoId).maybeSingle()
  ]);
  if (errEq) throw errEq;
  if (errProy) throw errProy;
  const material = (equipmentData || []).map(function (r) {
    return {
      proyecto_id: r.proyecto_id, familia: v(r.familia), articulo: v(r.articulo),
      cantidad: r.cantidad, precio_unit: r.precio_unit, importe: r.importe, updated: v(r.updated_raw)
    };
  });
  const servicios = proyectoData
    ? CONCEPTOS_SERVICIOS_PROYECTO
        .map(function (c) { return { nombre: c.nombre, importe: parseFloat(proyectoData[c.campo]) || 0 }; })
        .filter(function (s) { return s.importe !== 0; })
    : [];

  // Forma de pago: Rentman no expone este dato por API - solo existe en
  // Caja (registrado a mano al cobrar). Se cruza por "numero" (nº visible
  // de proyecto), que es la clave que usa caja_registros, no por id interno.
  let facturas = [];
  if (proyectoData && proyectoData.numero != null) {
    const { data: cajaData, error: errCaja } = await supabase
      .from('caja_registros').select('factura_id,metodo_pago,importe,fecha_pago_raw')
      .eq('numero', proyectoData.numero);
    if (errCaja) throw errCaja;
    facturas = (cajaData || []).map(function (r) {
      return { factura_id: r.factura_id, metodo_pago: v(r.metodo_pago), importe: r.importe, fecha_pago: v(r.fecha_pago_raw) };
    });
  }
  return { material: material, servicios: servicios, facturas: facturas };
}

// Mapa action -> función, para que server.js pueda seguir llamando por nombre
// igual que hacía con Apps Script.
const ACCIONES = {
  proyectos: obtenerProyectos,
  facturas: obtenerFacturas,
  pagos: obtenerPagos,
  presupuestos: obtenerPresupuestos,
  servicios: obtenerServicios,
  equipment: obtenerEquipment,
  leads: obtenerLeads,
  usuarios: obtenerUsuarios,
  caja: obtenerCaja,
  rutas: obtenerRutas
};

async function llamarOrumCentralSupabase(action, extraParams) {
  const fn = ACCIONES[action];
  if (!fn) throw new Error('Acción no soportada por Supabase todavía: ' + action);
  if (action === 'rutas' && extraParams) return fn(extraParams.desde, extraParams.hasta);
  return fn();
}

module.exports = { llamarOrumCentralSupabase, obtenerMaterialDeProyecto, obtenerDetalleProyecto, obtenerConductores, obtenerEstadoVehiculos, obtenerEstadisticasRutas, obtenerEstadisticasMaterial, obtenerParadasParaEvolucion, ACCIONES, supabase };
