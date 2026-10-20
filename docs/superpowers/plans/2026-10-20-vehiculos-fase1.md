# Módulo Vehículos — Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menú "Vehículos" en ORUM Central con flota, fichas, vencimientos (semáforo + contador), histórico de mantenimientos con importe y documentos; Facturas Proveedores lee las matrículas de la nueva tabla.

**Architecture:** Lógica pura en `lib/vehiculos.js` (testeada con `node --test`), rutas Express en `lib/vehiculosRutas.js` montadas desde `server.js` con una línea, frontend en `public/vehiculos.js` cargado por `index.html`. Datos en 4 tablas nuevas de Supabase + bucket privado de Storage.

**Tech Stack:** Node/Express, `@supabase/supabase-js` (cliente `supabase` ya exportado por `lib/supabaseSource.js`), `multer` (ya instalado), JS plano en el navegador, `node:test` + `node:assert`.

**Spec:** `docs/superpowers/specs/2026-10-20-modulo-vehiculos-design.md` (§3, §4 "Fase 1", §5).

## Global Constraints

- Roles con acceso: `Direccion`, `Contabilidad`, `Logistica` — ven y editan todo. `Comercial`: 403.
- `NAVE MONDA`, `ALQUILADO 1`, `ALQUILADO 2` no son vehículos: nunca aparecen como "nombre de Rutas sin asignar".
- Estados de vencimiento: `ok` · `aviso` · `vencido`. Por defecto `aviso_dias = 30`, `aviso_km = 1000`.
- Importes en base sin IVA.
- Documentos: PDF, JPG, PNG; máx. 10 MB; bucket privado `vehiculos-documentos`; descarga por URL firmada de 60 s.
- Nunca se borra un vehículo: baja = `activo=false` + `fecha_baja`.
- Textos de interfaz en español; seguir el estilo existente (tema claro, `<table>` global, `kpiCard`, `.loading-text`).
- **Commits y push: preguntar al usuario antes de cada uno** (Railway despliega desde `main`). Los pasos "Commit" de este plan significan "proponer el commit y esperar el sí".
- No hay `.env` local: la verificación del servidor se hace con un PostgREST falso en memoria (ver memoria `orum-rutas-app`), la del SQL con el MCP de Supabase (proyecto `dmldahheogfozjhyxnzz`).

## Review Focus

- Vencimiento con solo `km_limite` y vehículo sin km conocidos → estado `ok` (no `vencido` por comparar con 0). Test en Task 2.
- Mantenimiento con `km` menor que `km_base` (lectura antigua, error de tecleo) → no baja el cuentakilómetros. Test en Task 2.
- Matrícula escrita con espacios/guion/minúsculas (`6625 myz`, `6625-MYZ`) → se normaliza a `6625MYZ` y choca con la existente. Test en Task 2.
- Fechas límite justo en el borde: vence hoy → `aviso`, no `vencido`; vencido = fecha anterior a hoy. Test en Task 2.
- Renovar un vencimiento sin periodicidad → el mantenimiento se guarda y el vencimiento no cambia (no se pone `fecha_limite` a null). Test en Task 2.

---

### Task 1: Esquema SQL, carga inicial y bucket

**Files:**
- Create: `sql/vehiculos.sql`

**Interfaces:**
- Produces: tablas `vehiculos`, `vehiculos_vencimientos`, `vehiculos_mantenimientos`, `vehiculos_documentos` con las columnas exactas de la spec §4 "Fase 1"; bucket `vehiculos-documentos` (privado).

- [ ] **Step 1: Escribir `sql/vehiculos.sql`** con cabecera de comentario como `sql/mantenimiento_checks.sql` ("Ejecutar una sola vez en el SQL Editor de Supabase"), `create table if not exists` para las 4 tablas, y además:
  - `check (tipo in (...))` con los valores exactos de la spec en `vehiculos.tipo`, `vehiculos.propiedad`, `vehiculos_vencimientos.tipo`, `vehiculos_mantenimientos.tipo`, `vehiculos_documentos.tipo`.
  - `check (fecha_limite is not null or km_limite is not null)` en vencimientos.
  - FK `on delete cascade` hacia `vehiculos(id)`; `vencimiento_id` con `on delete set null`.
  - Índices por `vehiculo_id` en las tres tablas hijas.
  - `alter table ... enable row level security` en las 4 (sin políticas: solo accede el servidor con service key, como el resto).
  - `insert into storage.buckets (id, name, public) values ('vehiculos-documentos','vehiculos-documentos', false) on conflict do nothing;`
  - Carga inicial con `on conflict do nothing`, exactamente la tabla de la spec §5.3 (9 filas; el Mercedes comercial con `matricula null`, `tipo 'furgoneta'`, `propiedad 'propio'`, `notas 'Propiedad por confirmar'`; el C3 Aircross `tipo 'turismo'`, `propiedad 'renting'`; el Atego `tipo 'camion'`; el resto `furgoneta`).

- [ ] **Step 2: Enseñar el SQL al usuario y, con su sí, aplicarlo** con `apply_migration` del MCP de Supabase (nombre `vehiculos_fase1`).

- [ ] **Step 3: Verificar**

Run (MCP `execute_sql`): `select matricula, nombre_rutas, propiedad from vehiculos order by id;` y `select id, public from storage.buckets where id='vehiculos-documentos';`
Expected: 9 filas con los nombres de Rutas de la spec; bucket con `public = false`.

- [ ] **Step 4: Commit** `sql/vehiculos.sql` — "Vehículos fase 1: tablas, carga inicial y bucket de documentos".

---

### Task 2: Lógica pura (`lib/vehiculos.js`)

**Files:**
- Create: `lib/vehiculos.js`, `test/vehiculos.test.js`
- Modify: `package.json` (añadir `"test": "node --test test/"` en `scripts`)

**Interfaces:**
- Produces (CommonJS, todas puras, fechas como `'YYYY-MM-DD'`):
  - `normalizarMatricula(s: string|null) -> string|null` — mayúsculas, sin espacios ni guiones; `''` → `null`.
  - `kmActuales(vehiculo: {km_base, km_base_fecha}, mantenimientos: [{fecha, km}]) -> number|null` — máximo entre `km_base` y los `km` de mantenimientos; `null` si no hay ninguno.
  - `estadoVencimiento(venc: {fecha_limite, km_limite, aviso_dias, aviso_km}, km: number|null, hoy: string) -> {estado, dias_restantes: number|null, km_restantes: number|null}`.
  - `peorEstado(estados: string[]) -> 'ok'|'aviso'|'vencido'`.
  - `renovarVencimiento(venc: {periodicidad_meses, periodicidad_km, fecha_limite, km_limite}, mant: {fecha, km}) -> {fecha_limite, km_limite}` — sin periodicidad, devuelve los valores actuales sin tocar.
  - `validarVehiculo(datos) -> string|null` (mensaje de error o null), `validarVencimiento(datos) -> string|null`, `validarMantenimiento(datos) -> string|null`, `validarDocumento({mimetype, size}) -> string|null`.
  - `nombresRutasSinAsignar(nombresRutas: string[], vehiculos: [{nombre_rutas, activo}]) -> string[]`.
  - Constantes exportadas: `TIPOS_VEHICULO`, `PROPIEDADES`, `TIPOS_VENCIMIENTO`, `TIPOS_MANTENIMIENTO`, `TIPOS_DOCUMENTO`, `RUTAS_NO_VEHICULO = ['NAVE MONDA','ALQUILADO 1','ALQUILADO 2']`, `MAX_DOCUMENTO = 10*1024*1024`.

- [ ] **Step 1: Escribir los tests que fallan** en `test/vehiculos.test.js` (`node:test`, `node:assert/strict`):
  - `normalizarMatricula('6625 myz') === '6625MYZ'`, `('6625-MYZ') === '6625MYZ'`, `('  ') === null`.
  - `kmActuales({km_base: 100000}, [{km: 99000}]) === 100000` (no baja); `({km_base: 100000}, [{km: 105000}]) === 105000`; `({km_base: null}, []) === null`.
  - Con `hoy='2026-10-20'`, `aviso_dias 30`, `aviso_km 1000`:
    - `fecha_limite '2026-10-19'` → `vencido`; `'2026-10-20'` → `aviso` con `dias_restantes 0`; `'2026-11-19'` → `aviso` (30 días); `'2026-11-20'` → `ok`.
    - `km_limite 120000`, km `119500` → `aviso`, `km_restantes 500`; km `120000` → `vencido`; km `null` → `ok`.
    - fecha `ok` + km `vencido` → `vencido` (gana el peor).
  - `peorEstado(['ok','aviso']) === 'aviso'`, `peorEstado([]) === 'ok'`.
  - `renovarVencimiento({periodicidad_meses: 12, fecha_limite: '2026-10-01'}, {fecha: '2026-10-15'})` → `fecha_limite '2027-10-15'`; con `periodicidad_km 30000` y `km 110000` → `km_limite 140000`; sin periodicidades → devuelve `fecha_limite`/`km_limite` originales.
  - `validarVencimiento({tipo:'itv'})` → mensaje (falta fecha y km); `validarVencimiento({tipo:'xyz', fecha_limite:'2026-12-01'})` → mensaje; válido → `null`.
  - `validarVehiculo({tipo:'furgoneta', propiedad:'propio'})` sin matrícula → `null` (permitido); `tipo` desconocido → mensaje.
  - `validarDocumento({mimetype:'application/pdf', size: 11*1024*1024})` → mensaje; `('image/gif')` → mensaje; PDF 1 MB → `null`.
  - `nombresRutasSinAsignar(['IVECO','NAVE MONDA','ALQUILADO 1','NUEVA'], [{nombre_rutas:'IVECO', activo:true}])` → `['NUEVA']`.

- [ ] **Step 2: Ejecutar y ver que fallan**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/vehiculos'`.

- [ ] **Step 3: Implementar `lib/vehiculos.js`** con las firmas de arriba. Aritmética de fechas en UTC (`new Date(fecha + 'T00:00:00Z')`) para que no salte un día por zona horaria; sumar meses con `setUTCMonth`.

- [ ] **Step 4: Ejecutar y ver que pasan**

Run: `npm test`
Expected: todos PASS.

- [ ] **Step 5: Commit** `lib/vehiculos.js test/vehiculos.test.js package.json` — "Vehículos: lógica de vencimientos, km y validaciones con tests".

---

### Task 3: API (`lib/vehiculosRutas.js`) montada en `server.js`

**Files:**
- Create: `lib/vehiculosRutas.js`
- Modify: `server.js` (una línea de montaje tras la definición de `bloquearComercial`/`soloPersonal`, junto al resto de `require('./lib/...')`)

**Interfaces:**
- Consumes: Task 2 (todas las funciones), `supabase` de `lib/supabaseSource.js`, `requiereLogin` de `server.js`, `multer`.
- Produces: `module.exports = function montarVehiculos(app, { supabase, requiereLogin })`. Endpoints de la spec §5.4, todos JSON:
  - `GET /api/vehiculos?inactivos=1` → `{ ok, vehiculos: [{...ficha, km_actuales, estado, proximo: {tipo, descripcion, estado, dias_restantes, km_restantes}|null, avisos: n}], kpis: {activos, vencidos, en_aviso, mant_mes_n, mant_mes_importe}, rutas_sin_asignar: string[] }`
  - `GET /api/vehiculos/lista` → `{ ok, vehiculos: [{id, matricula, label}] }` con `label = matricula + ' · ' + marca + ' ' + modelo` (+ `' (renting)'` si aplica), solo activos con matrícula.
  - `GET /api/vehiculos/vencimientos` → `{ ok, vencimientos: [{...venc, vehiculo: {id, matricula, marca, modelo}, estado, dias_restantes, km_restantes}], contador }` ordenados vencido → aviso → ok y por días restantes; `contador` = vencidos + en aviso de vehículos activos.
  - `GET /api/vehiculos/:id` → `{ ok, vehiculo, km_actuales, vencimientos[con estado], mantenimientos[desc por fecha], documentos[] }`.
  - `POST /api/vehiculos`, `PUT /api/vehiculos/:id` (dar de baja = `PUT` con `activo:false`, que pone `fecha_baja` = hoy si viene vacía).
  - `POST|PUT|DELETE /api/vehiculos/:id/vencimientos[/:vid]`.
  - `POST|PUT|DELETE /api/vehiculos/:id/mantenimientos[/:mid]` — al crear con `vencimiento_id`, aplica `renovarVencimiento` y actualiza ese vencimiento.
  - `POST /api/vehiculos/:id/documentos` (`multer.memoryStorage`, campo `archivo`, `limits.fileSize = MAX_DOCUMENTO`), `GET /api/vehiculos/:id/documentos/:did` → `{ ok, url }` firmada 60 s, `DELETE` borra en Storage y en la tabla.
- Middleware interno `permiteVehiculos`: 403 `{error:'No autorizado para este apartado'}` si `req.session.usuario.rol` no está en `['Direccion','Contabilidad','Logistica']`.
- Auditoría: `creado_por`/`actualizado_por`/`subido_por` = `req.session.usuario.nombre || req.session.usuario.usuario`; `actualizado_en = now`.
- Errores: validación → 400 `{error: mensaje}`; violación de unique de Postgres (`code '23505'`) → 400 `"Ya existe un vehículo con esa matrícula o nombre en Rutas"`; resto → 500 `{error: err.message}` y `console.error('Error en <método> <ruta>:', err)` como en el resto del servidor.
- `rutas_sin_asignar` se calcula con `nombresRutasSinAsignar` sobre `select nombre from rutas_vehiculos`.
- Matrícula siempre guardada con `normalizarMatricula`.

- [ ] **Step 1: Implementar `lib/vehiculosRutas.js`** con lo anterior y montarlo en `server.js`: `require('./lib/vehiculosRutas')(app, { supabase, requiereLogin });`

- [ ] **Step 2: Comprobar que el servidor carga**

Run: `node -e "require('./lib/vehiculosRutas')"` y `npm test`
Expected: sin errores; tests de Task 2 siguen en PASS.

- [ ] **Step 3: Probar los endpoints contra un PostgREST falso** (patrón de la memoria `orum-rutas-app`: `server.js` con `SUPABASE_URL` apuntando a un servidor en memoria en el scratchpad, entrada temporal en `ORUM/.claude/launch.json`, que se quita al terminar). Con sesión `Logistica`:
  - `POST /api/vehiculos` con `matricula '6625 myz'` cuando ya existe `6625MYZ` → 400 con el mensaje de duplicado.
  - `POST` mantenimiento con `vencimiento_id` de una ITV con `periodicidad_meses 12` → el vencimiento queda con `fecha_limite` un año después de la fecha del mantenimiento.
  - Sesión `Comercial` → 403 en `GET /api/vehiculos`.

Expected: las tres respuestas como se describe.

- [ ] **Step 4: Commit** `lib/vehiculosRutas.js server.js` — "Vehículos: API de flota, vencimientos, mantenimientos y documentos".

---

### Task 4: Frontend del módulo (`public/vehiculos.js`) y menú

**Files:**
- Create: `public/vehiculos.js`
- Modify: `public/index.html` — `MENU` (≈ línea 994: nueva entrada tras `mantenimiento`), filtro del rol `Logistica` (≈ línea 1023: añadir `'vehiculos'`), `<script src="vehiculos.js"></script>` antes de `</body>`.

**Interfaces:**
- Consumes: endpoints de Task 3; globales de `index.html`: `kpiCard(etiqueta, valor)`, `ordenarLista(lista, {campo, asc})`, `marcarMenuActivo(id)`, `#content-title`, `#content-body`.
- Produces: globales `cargarVehiculos()`, `abrirFichaVehiculo(id)`, `cargarVencimientosVehiculos()`, `actualizarContadorVehiculos()`.
- Entrada de menú: `{ id: 'vehiculos', icon: 'truck', group: 'operaciones', label: 'Vehículos', submenu: [ {Flota → cargarVehiculos()}, {Vencimientos → cargarVencimientosVehiculos()} ] }` con el mismo formato de submenú que `log`.

- [ ] **Step 1: Vista Flota** (`cargarVehiculos`): 4 `kpiCard` (Vehículos activos · Vencidos · Vencen en 30 días · Mantenimientos del mes "n · importe €"); aviso amarillo si `rutas_sin_asignar` no está vacío ("En Rutas hay vehículos sin ficha: …"); rejilla de tarjetas (matrícula en grande, marca/modelo, nombre en Rutas, km actuales con separador de miles, punto de color verde/ámbar/rojo y el texto del vencimiento más próximo, p. ej. "ITV · vence en 12 días"); selector Activos/Dados de baja; botón "Nuevo vehículo" que abre el formulario de ficha vacío.

- [ ] **Step 2: Ficha** (`abrirFichaVehiculo(id)`): título con matrícula + modelo y "← Flota"; secciones Datos (formulario con todos los campos de la ficha, botón Guardar y "Dar de baja"), Vencimientos (tabla tipo · descripción · fecha límite · km límite · faltan · estado, con alta/edición/borrado en fila), Mantenimientos (tabla ordenable con `ordenarLista`, total del año en curso, formulario de alta con desplegable "Renueva el vencimiento…" con los vencimientos del vehículo), Documentos (lista con descargar/borrar y subida con `FormData`). Los errores 400 se pintan junto al formulario que los causó, sin `alert`.

- [ ] **Step 3: Vista Vencimientos** (`cargarVencimientosVehiculos`): tabla única ordenada por urgencia (vehículo · tipo · descripción · fecha límite · km límite · faltan · estado), filas rojas/ámbar, clic en una fila → `abrirFichaVehiculo`.

- [ ] **Step 4: Contador en el menú** (`actualizarContadorVehiculos`): pide `/api/vehiculos/vencimientos` tras el login y tras cada guardado en el módulo; pinta una pastilla roja con `contador` junto a "Vehículos" (oculta si 0). Si falla, no muestra nada (sin error visible).

- [ ] **Step 5: Verificar en el navegador** con `public/index.html` servido como estático y `fetch` simulado (patrón de Rutas) con 3 vehículos (uno vencido, uno en aviso, uno ok): Flota, Ficha, Vencimientos y contador en escritorio y a 375 px de ancho, sin errores en consola; rol `Logistica` ve el menú Vehículos.

Expected: captura de las tres vistas; contador = 2.

- [ ] **Step 6: Commit** `public/vehiculos.js public/index.html` — "Vehículos: menú, flota, ficha y vencimientos".

---

### Task 5: Facturas Proveedores lee las matrículas de la tabla

**Files:**
- Modify: `public/index.html` ≈ líneas 6890–6900 (`VEHICULOS_ORUM_FACTURAS`) y el arranque tras el login.

**Interfaces:**
- Consumes: `GET /api/vehiculos/lista` (Task 3).

- [ ] **Step 1:** Cambiar `const VEHICULOS_ORUM_FACTURAS` a `let` (la lista fija actual queda como respaldo) y añadir `cargarVehiculosFacturas()`, que tras el login reemplaza su contenido por `json.vehiculos.map(v => ({ matricula: v.matricula, label: v.label }))` si la respuesta es `ok` y no vacía. Sin errores visibles si falla. El resto del código de Facturas (`some`, `find`, selector y nota libre) no cambia.

- [ ] **Step 2: Verificar en el navegador** con `fetch` simulado: con `/api/vehiculos/lista` devolviendo `2786NDL` el selector de matrícula la muestra; con la API fallando, el selector muestra las 7 matrículas de siempre; una factura con nota libre ("VMS") sigue mostrando el campo de nota.

Expected: los tres casos como se describen.

- [ ] **Step 3: Commit** `public/index.html` — "Facturas: matrículas desde la tabla de vehículos".

---

### Task 6: Cierre

- [ ] **Step 1:** `npm test` en verde; quitar la entrada temporal de `ORUM/.claude/launch.json` y el PostgREST falso si siguen.
- [ ] **Step 2:** Preguntar al usuario por el push a `main` (despliegue en Railway) y, tras desplegar, comprobar con él en producción: alta de un vencimiento real (ITV del Iveco) y subida de un documento.
- [ ] **Step 3:** Guardar memoria `orum-vehiculos-modulo` (fases, tablas, decisiones de la spec que no están en el código: conductor = primero de Rutas, emails solo en cambios, precio de combustible único) y enlazarla en `MEMORY.md`.
