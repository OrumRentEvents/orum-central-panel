# Módulo Vehículos — diseño

Fecha: 2026-10-20 · Estado: aprobado (2026-10-20) · Se construye por fases, empezando por la **fase 1**.

## 1. Objetivo

Un apartado único en ORUM Central para gestionar todo lo relacionado con la flota:

1. **Ficha y vencimientos** (lo más importante): datos de cada vehículo, ITV, seguro, IVTM, revisiones, tacógrafo, fin de renting, documentos, e histórico de mantenimientos con su coste. Avisos en el panel y por email.
2. **Coste por vehículo**: combustible, mantenimientos/taller, seguros, impuestos y renting → coste total, €/km y €/día de uso.
3. **Uso y conductores**: km y uso de cada vehículo a partir del Excel del localizador GPS, asignando cada trayecto al conductor que figura en **Rutas**, y un ranking de conductores.

Hoy la información está repartida: Rutas usa nombres (`IVECO`, `FURGO NDL`…), Facturas usa una lista de matrículas fija en el código (`VEHICULOS_ORUM_FACTURAS` en `public/index.html`), Pagos anuales tiene la categoría "Seguros Vehículos" sin matrícula, y el localizador usa sus propios nombres (`IVECO DAILY (IVECO)`). La pieza central del módulo es una **tabla maestra de vehículos** que une las tres identidades.

## 2. Decisiones tomadas con el usuario

| Tema | Decisión |
|---|---|
| Acceso | Dirección y los tres responsables de Logística (rol `Logistica`: Jesús Aguilera, Leo Haro, Rafa Perez) ven **y editan todo**, costes incluidos. Contabilidad (Ana González, Isabel Guzmán) y Dirección (Maria Gómez, Sergio Rosillo): ven y editan todo. Comercial: sin acceso. |
| Responsable de vehículos | Jesús Aguilera. |
| Avisos | En el panel y por email a los tres de Logística. **Solo cuando cambia algo** (un vencimiento entra en aviso o vence), nunca un email diario fijo. |
| Mantenimiento ↔ coste | El mantenimiento lleva su importe y puede vincularse a la factura de compra. El coste del vehículo cuenta la factura una sola vez; si no hay factura vinculada aún, cuenta el importe apuntado. |
| Km | Del Excel del localizador (km por trayecto). El cuentakilómetros = lectura base apuntada a mano + km del localizador desde esa fecha. Cada mantenimiento con km puede recalibrar. |
| Importación | Subida manual del Excel del localizador en el panel. |
| Conductor | **Siempre el de Rutas**, nunca el del localizador. Si van dos o más, cuenta quien está marcado como **"Conduce"** en Rutas; sin marcar = "conductor sin determinar" (ver §6.3; antes decía "el primero", pero Rutas guarda la lista en orden alfabético). |
| Dos vueltas el mismo día | Cada conductor se lleva el kilometraje de su vuelta (reparto descrito en §6.3). |
| Combustible | Precio €/L con vigencia, apuntado cada vez que se reposta (como las tarifas). **Servicios Isabella pasa a leer este precio** en vez de su campo manual. |
| Ranking | Km, horas, excesos de velocidad, tiempo con motor encendido en parada (ralentí), paradas, consumo frente al óptimo. |

## 3. Arquitectura

- **Backend**: `lib/vehiculos.js` con la lógica pura (cálculo de vencimientos, cuentakilómetros, parseo del Excel, reparto por vueltas, ranking), testeable sin Supabase. Las rutas `/api/vehiculos/*` se registran desde `server.js` con una sola línea (`require('./lib/vehiculosRutas')(app, deps)`) para no engordar más `server.js` (4.600 líneas).
- **Frontend**: `public/vehiculos.js` cargado por `index.html` con `<script src>`. Expone `cargarVehiculos()`; reutiliza los helpers globales existentes (`kpiCard`, `ordenarLista`, `marcarMenuActivo`, `#content-title`/`#content-body`, estilos de tabla globales). `index.html` (8.800 líneas) solo gana la entrada de menú y la etiqueta `<script>`.
- **Datos**: tablas nuevas en Supabase (proyecto `orum-central`). SQL en `sql/vehiculos.sql` para ejecutar en el SQL Editor, como el resto de módulos.
- **Documentos**: bucket privado `vehiculos-documentos` de Supabase Storage; se descargan a través del servidor (URL firmada de corta duración), nunca públicos.
- **Tests**: `node --test` (sin dependencias nuevas) sobre `lib/vehiculos.js`. Se añade `"test": "node --test test/"` a `package.json`.

## 4. Modelo de datos

### Fase 1

**`vehiculos`**: ficha maestra.

| Columna | Tipo | Notas |
|---|---|---|
| id | bigint identity PK | |
| matricula | text unique null | null permitido (p. ej. "MERCEDES COMERCIAL" del localizador no tiene) |
| marca, modelo | text | |
| tipo | text | `furgoneta` · `camion` · `turismo` · `otro` |
| nombre_rutas | text unique null | nombre exacto en Rutas (`IVECO`, `FURGO NDL`…) |
| nombre_localizador | text unique null | nombre exacto en el Excel (`IVECO DAILY (IVECO)`) — se usa en fase 3 |
| propiedad | text | `propio` · `renting` · `leasing` · `alquilado` |
| fecha_alta, fecha_baja | date | |
| activo | boolean default true | los dados de baja no avisan ni aparecen en selectores |
| km_base, km_base_fecha | numeric, date | lectura real del cuentakilómetros |
| notas | text | |
| creado_por, actualizado_por, actualizado_en | | |

**`vehiculos_vencimientos`**: un vencimiento por fila.

| Columna | Tipo | Notas |
|---|---|---|
| id | bigint identity PK | |
| vehiculo_id | FK → vehiculos | on delete cascade |
| tipo | text | `itv` · `seguro` · `ivtm` · `revision` · `tacografo` · `fin_renting` · `otro` |
| descripcion | text | p. ej. "Cambio aceite y filtros" |
| fecha_limite | date null | |
| km_limite | numeric null | al menos uno de los dos obligatorio |
| aviso_dias | int default 30 | |
| aviso_km | int default 1000 | |
| periodicidad_meses | int null | para renovar al registrar el mantenimiento (ITV 12, seguro 12…) |
| periodicidad_km | int null | revisión cada X km |
| estado_notificado | text null | último estado avisado por email (`aviso`/`vencido`), para enviar solo en los cambios (fase 2) |
| activo | boolean default true | |

**`vehiculos_mantenimientos`**: histórico.

| Columna | Tipo | Notas |
|---|---|---|
| id | bigint identity PK | |
| vehiculo_id | FK → vehiculos | |
| fecha | date | |
| tipo | text | `revision` · `itv` · `reparacion` · `neumaticos` · `averia` · `limpieza` · `otro` |
| descripcion, taller | text | |
| km | numeric null | si viene, recalibra el cuentakilómetros (pasa a ser la nueva lectura base si es posterior a la actual) |
| importe | numeric null | base sin IVA, como el resto de costes del panel |
| factura_ref | jsonb null | `{fileId, numeroFactura, proveedor, importeBase}` de `FACTURAS_LOG` — se rellena en fase 4; en fase 1 la columna existe pero no hay UI |
| vencimiento_id | FK null → vehiculos_vencimientos | si el mantenimiento renueva un vencimiento |
| creado_por, creado_en | | |

Al guardar un mantenimiento con `vencimiento_id`, el vencimiento se renueva: `fecha_limite = fecha + periodicidad_meses` y/o `km_limite = km + periodicidad_km`.

**`vehiculos_documentos`**: `id, vehiculo_id, tipo (permiso_circulacion · ficha_tecnica · poliza · itv · contrato_renting · otro), nombre_archivo, ruta_storage, fecha_caducidad null, subido_por, subido_en`. Límite 10 MB por archivo, PDF o imagen.

### Fases posteriores (resumen)

- **`vehiculos_trayectos`** (fase 3): cada fila del Excel, con todas sus columnas (km, tiempos, paradas, motor encendido en parada, vel. media/máx., consumo, consumo óptimo…). Clave única `(vehiculo_id, hora_inicio)`.
- **`vehiculos_cortes_vuelta`** (fase 3): hora de corte manual para los días "a revisar".
- **`combustible_precios`** (fase 4): `precio_litro, vigente_desde, notas` — mismo patrón que `extras_tarifas`.
- **`gastos_anuales.vehiculo_id`** (fase 4): columna opcional para asignar seguros a su matrícula.

## 5. Fase 1: Flota, fichas, vencimientos, mantenimientos, documentos

### 5.1 Pantallas

Menú nuevo **Vehículos** (grupo Operaciones, icono `truck`), visible para Dirección, Contabilidad y Logística. Se añade `'vehiculos'` a la lista de menús del rol `Logistica`. El menú muestra un contador rojo con los vencimientos en aviso o vencidos.

**Flota** (vista principal)
- KPIs: vehículos activos · vencimientos vencidos · vencen en 30 días · mantenimientos del mes (nº e importe).
- Tarjeta por vehículo: matrícula, marca/modelo, nombre en Rutas, km actuales, semáforo (verde/ámbar/rojo) y el vencimiento más próximo.
- Botón "Nuevo vehículo". Filtro activos / dados de baja.

**Ficha del vehículo** (al pulsar una tarjeta), con secciones:
- *Datos*: edición inline de la ficha, incluida la lectura base del cuentakilómetros.
- *Vencimientos*: tabla con tipo, fecha y/o km límite, días o km que faltan, estado; alta/edición/baja.
- *Mantenimientos*: histórico ordenable (fecha, tipo, descripción, taller, km, importe) y total del año. Al registrar uno se puede marcar "renueva el vencimiento X".
- *Documentos*: subir, descargar y borrar.

**Vencimientos** (vista global): todos los vencimientos de todos los vehículos ordenados por urgencia, para la revisión rápida de Jesús.

### 5.2 Estado de un vencimiento

Función pura `estadoVencimiento(venc, kmActuales, hoy)`:
- `vencido` si `fecha_limite < hoy` o `kmActuales >= km_limite`.
- `aviso` si faltan ≤ `aviso_dias` o ≤ `aviso_km`.
- `ok` en otro caso.

Si tiene fecha y km, gana el peor de los dos. Sin km actuales conocidos, solo cuenta la fecha.

`kmActuales` en fase 1 = la mayor entre `km_base` y el `km` del último mantenimiento (en fase 3 se suman los km del localizador).

### 5.3 Integraciones de la fase 1

- **Facturas Proveedores**: el selector de matrícula deja de usar `VEHICULOS_ORUM_FACTURAS` fijo y lee los vehículos activos de `/api/vehiculos/lista`. Sigue permitiendo una nota libre (VMS, Isabella…) como ahora. Si la API falla, se usa la lista fija actual como respaldo.
- **Rutas**: **no se toca en fase 1**. Su lista sale de `rutas_vehiculos` (hoja CONFIG) e incluye entradas que no son vehículos (`NAVE MONDA`, `ALQUILADO 1/2`). La ficha solo guarda `nombre_rutas` para el cruce de la fase 3, y la vista Flota avisa si un nombre de `rutas_vehiculos` no está asignado a ningún vehículo (salvo `NAVE MONDA`, `ALQUILADO 1` y `ALQUILADO 2`, que no son vehículos y quedan fuera del módulo).
- **Carga inicial**: el SQL incluye los vehículos conocidos.

  | Matrícula | Vehículo | Nombre en Rutas | Propiedad |
  |---|---|---|---|
  | 6625MYZ | Iveco Daily | IVECO | propio |
  | 7594MPZ | Renault | RENAULT | propio |
  | 8939LDW | Mercedes Atego | AZUL | propio |
  | 6275MDP | Nissan Interstar | NISSAN | propio |
  | 9063NCW | MAN TGE 3.140 (Furgo ORUM) | FURGO NCW | propio |
  | 2786NDL | MAN TGE 3.140 (Furgo Mobil Home) | FURGO NDL | propio |
  | 4424HVB | Volkswagen Crafter | VOLKSWAGEN | propio |
  | 7710NHY | Citroën C3 Aircross | — | renting |
  | — | Mercedes comercial | — | por confirmar |

  Carga confirmada por el usuario el 2026-10-20.

### 5.4 API (fase 1)

Todas con `requiereLogin` + `permiteVehiculos` (roles Direccion, Contabilidad, Logistica).

| Método | Ruta | |
|---|---|---|
| GET | `/api/vehiculos` | flota con km actuales, estado y próximos vencimientos |
| GET | `/api/vehiculos/lista` | activos, mínima (id, matricula, label) para selectores |
| GET | `/api/vehiculos/:id` | ficha completa (vencimientos, mantenimientos, documentos) |
| POST/PUT | `/api/vehiculos`, `/api/vehiculos/:id` | alta / edición |
| POST/PUT/DELETE | `/api/vehiculos/:id/vencimientos[/:vid]` | |
| POST/PUT/DELETE | `/api/vehiculos/:id/mantenimientos[/:mid]` | |
| POST/GET/DELETE | `/api/vehiculos/:id/documentos[/:did]` | subida con `multer` en memoria (como nóminas), descarga por URL firmada |
| GET | `/api/vehiculos/vencimientos` | vista global + contador para el menú |

Cada escritura guarda quién y cuándo (`req.session.usuario.nombre`).

### 5.5 Errores

- Matrícula duplicada, `nombre_rutas` duplicado o vencimiento sin fecha ni km → 400 con mensaje claro, mostrado junto al formulario.
- Documento demasiado grande o de tipo no permitido → 400.
- No se borra un vehículo con histórico: se da de baja (`activo=false`, `fecha_baja`).

### 5.6 Pruebas

- `test/vehiculos.test.js`: `estadoVencimiento` (fecha, km, ambos, sin km), `kmActuales`, renovación de un vencimiento al registrar un mantenimiento, validaciones.
- Frontend: verificación en el navegador con el `fetch` simulado (como en Rutas, porque no hay `.env` local) con las vistas Flota, Ficha y Vencimientos, en escritorio y móvil.
- SQL: lo ejecuta el usuario en el SQL Editor y se comprueba con el MCP de Supabase.

## 6. Fases siguientes (resumen; cada una tendrá su propio plan)

### 6.1 Fase 2: avisos por email
Comprobación diaria (cron interno a las 8:00) y tras cada importación del localizador. Envía email con Resend (como `lib/informeComerciales.js`) a Jesús, Leo y Rafa **solo** cuando un vencimiento pasa de `ok`→`aviso` o de `aviso`→`vencido` respecto a `estado_notificado`; un único email agrupa todos los cambios del día. Requiere los emails de los tres (no están en `usuarios`).

### 6.2 Fase 3: localizador y uso
Importar el Excel (`Informe detallado.xlsx`, hoja "Trayectos", 25 columnas) con vista previa: periodo, trayectos nuevos y ya existentes, y vehículos desconocidos a asignar. Las columnas de tiempo (`"0, 00:42:25"`) y fecha (`"30-09-2026 19:34:29"`) se parsean a segundos y a timestamp. La columna "Tiempo Motor enc." se guarda si viene (en el Excel de septiembre venía vacía). Los km del localizador se suman al cuentakilómetros.

### 6.3 Reparto por vueltas y conductor
Los trayectos de un vehículo en un día se cruzan con `rutas_conductores` (`fecha`, `vehiculo` = `nombre_rutas`, `vuelta`).

**Conductor (decisión 2026-10-20, opción A):** Rutas guardaba los conductores en orden alfabético (orden de las casillas), así que "el primero conduce" no era fiable. Se añade `rutas_conductores.conductor`: en el modal de Rutas, con dos o más personas marcadas, se elige quién conduce. Con una sola persona, conduce ella. Con varias sin marcar (incluido todo lo anterior a este cambio) = **"conductor sin determinar"**: cuenta para el uso del vehículo, no para ningún conductor.

**Vueltas:**
- Una vuelta → todos los trayectos del día a esa vuelta.
- Varias → se cortan cada vez que el vehículo termina un trayecto en la nave de **Monda** ("CARRETERA A-355 KM. 20", Monda). La nave de Marbella (Calle Mercurio) **no** corta: las furgonetas pasan por ella a mitad de ruta (con ella el acierto en septiembre bajaba de 124/132 a 119/132 días). Los trayectos de < 0,8 km (maniobras en el patio) no cuentan como salida.
- Si el número de salidas no coincide con el de vueltas → día **"a revisar"**; se guardan horas de corte manuales en `vehiculos_cortes_vuelta`.
- Trayectos sin vuelta en Rutas → **"sin conductor"**, en una lista aparte (septiembre: 14 días, 1.278 km).
- Vehículos dados de baja (p. ej. la Mobil Home 2786NDL, de otra empresa del grupo) se ignoran al importar.

### 6.4 Fase 4: combustible y costes
Pestaña Combustible con el histórico de €/L con vigencia. Servicios Isabella lee el vigente (se retira `fuelPrice` de `isabella_config`). Coste estimado por trayecto = litros del localizador × €/L vigente. Coste real por vehículo/mes = facturas con matrícula (combustible, taller) + mantenimientos sin factura vinculada + `gastos_anuales` con `vehiculo_id` prorrateados + renting → total, €/km, €/día de uso. Vínculo mantenimiento ↔ factura de `FACTURAS_LOG` por `fileId + numeroFactura`.

### 6.5 Fase 5: ranking de conductores
Por rango de fechas y por conductor: km, horas de conducción, días, trayectos con vel. máx. > umbral 1 / umbral 2 (configurables, por defecto 100 y 120), velocidad máxima, tiempo en paradas, ralentí, consumo real frente al óptimo (l/100), coste de combustible. Puntuación combinada; ordenable por cualquier columna.

## 7. Fuera de alcance

- Conexión automática con la plataforma del localizador (API). Se valorará después.
- Cambiar la lista de vehículos de Rutas para que lea de `vehiculos`.
- Multas y siniestros como entidad propia (se registran como mantenimiento tipo `otro`/`averia` por ahora).
