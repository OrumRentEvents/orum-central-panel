# Módulo Vehículos — Fase 3 (localizador y uso) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Importar el Excel del localizador, sumar sus km al cuentakilómetros, repartir cada trayecto en su vuelta y conductor de Rutas, y mostrarlo en una pantalla "Uso". En Rutas se marca quién conduce.

**Architecture:** Lógica pura en `lib/localizador.js` (lectura del Excel, reparto en vueltas, conductor, agregados) con tests `node --test`. API en `lib/vehiculosRutas.js`. Frontend en `public/vehiculos.js`. Rutas: `server.js` (`/api/rutas/conductores`), `lib/supabaseSource.js` (`obtenerConductores`), `public/rutas.html` (modal).

**Tech Stack:** Node/Express, `xlsx` (ya instalado), Supabase, JS plano.

**Spec:** `docs/superpowers/specs/2026-10-20-modulo-vehiculos-design.md` §6.2–6.3.

## Global Constraints

- Conductor = `rutas_conductores.conductor`; si no hay y `conductores` tiene 1 → ese; si tiene ≥2 sin marcar → `null` ("sin determinar"). Nunca el del localizador.
- Corte de vueltas: solo al terminar en Monda (`destino` contiene "A-355" y `loc_destino` = "Monda"). Trayectos < 0,8 km no son salida.
- Vehículos dados de baja: sus trayectos se ignoran al importar.
- Reimportar no duplica: único `(vehiculo_id, inicio)`.
- Fechas/horas del Excel en hora local ("30-09-2026 19:34:29") → se guardan como `timestamp without time zone` y `fecha date`.
- Cambios en Supabase: solo añadir (Jesús y Logística están usando el módulo y Rutas en producción).
- Rutas: no repintar mientras el usuario trabaja; mantener SSE y copia a Sheets (memoria `orum-rutas-app`).
- Commits en rama `vehiculos-fase3`; merge a `main` y push con el visto bueno del usuario (el push lo hace él).

## Review Focus

- Excel con columnas en otro orden o con alguna de más → se localizan por nombre de cabecera, no por posición. Test en Task 1.
- Excel de otro informe (sin la columna "Kilometros" o "Hora Inicio") → error claro, nada guardado. Test en Task 1.
- Día con vueltas en Rutas pero el vehículo no se movió (0 trayectos) → no aparece como "a revisar". Test en Task 2.
- Lectura base posterior a trayectos ya importados → esos km no se suman dos veces. Test en Task 3.
- Vuelta en Rutas con el nombre "conductor" que ya no está en la lista de conductores marcados → se ignora y queda "sin determinar". Test en Task 2.

---

### Task 1: Lectura del Excel (`lib/localizador.js`)

**Interfaces — Produces:**
- `parsearInforme(buffer) -> { trayectos: [{ vehiculo_nombre, matricula|null, inicio:'YYYY-MM-DD HH:MM:SS', fin, fecha:'YYYY-MM-DD', origen, loc_origen, destino, loc_destino, km, seg_conduccion, paradas, seg_paradas, seg_motor_parado|null, vel_media, vel_max, litros, coste_litros, consumo_100, consumo_optimo_100, litros_optimo }], desde, hasta }`; lanza `Error('...')` si faltan columnas obligatorias.
- `segundos("0, 00:42:25") === 2545`, `segundos("1, 01:00:38") === 90038`, `segundos("00:08:55") === 535`, `segundos(null) === null`.

- [ ] Tests con un Excel sintético generado en el test con `XLSX.utils.aoa_to_sheet` (cabeceras reales del informe, dos filas, columnas desordenadas) y uno sin "Kilometros" → error. Ver fallar, implementar, ver pasar, commit.

### Task 2: Vueltas y conductor (`lib/localizador.js`)

**Interfaces — Produces:**
- `asignarVueltas(trayectosDelDia /*ordenados por inicio*/, nVueltas, cortes /*['HH:MM']|null*/) -> { vueltas: number[] (1-based, una por trayecto), revisar: boolean }`.
- `conductorDeVuelta(filaRutas|null) -> string|null`.
- `calcularUso(trayectos, filasRutas, cortesPorClave, vehiculos) -> { porVehiculo, porConductor, revisar:[{vehiculo_id, fecha, vueltas, salidas}], sinConductor:[{vehiculo_id, fecha, km}] }` (km, seg_conduccion, días, trayectos; detalle diario por vehículo con vuelta→conductor).

- [ ] Tests: 1 vuelta; 2 vueltas con 2 salidas; 2 vueltas con 3 salidas → revisar; cortes manuales; maniobras < 0,8 km; día sin trayectos no se revisa; conductor marcado / único / sin determinar / marcado que no está en la lista. Commit.

### Task 3: Km actuales con el localizador (`lib/vehiculos.js`)

- `kmActuales(vehiculo, mantenimientos, kmDiarios /*[{fecha, km}]*/)` — lectura = la de mayor km entre base y mantenimientos (con su fecha); resultado = lectura + km de días **posteriores** a la fecha de esa lectura. Sin fecha de lectura → solo la lectura. Sin `kmDiarios` → comportamiento actual.
- [ ] Tests nuevos + los existentes siguen pasando. Commit.

### Task 4: SQL (`sql/vehiculos_fase3.sql`)

- `alter table rutas_conductores add column if not exists conductor text;`
- `vehiculos_trayectos` (todas las columnas de Task 1 + `id`, `vehiculo_id` FK, `importado_por`, `importado_en`; `unique (vehiculo_id, inicio)`; índice `(fecha)`), RLS.
- `vehiculos_cortes_vuelta (vehiculo_id, fecha, cortes jsonb, actualizado_por, primary key (vehiculo_id, fecha))`, RLS.
- vista `vehiculos_km_diarios` = `select vehiculo_id, fecha, sum(km) km from vehiculos_trayectos group by 1,2`.
- [ ] Aplicar con MCP (solo añade). Commit.

### Task 5: Rutas — "Conduce"

- `server.js` POST `/api/rutas/conductores`: acepta `conductor` (solo si está en `conductores`, si no `null`), lo guarda, lo emite por SSE y lo pasa a la copia de Sheets.
- `lib/supabaseSource.js` `obtenerConductores`: devuelve `conductor`.
- `public/rutas.html`: `conductorPrincipal[clave]`; en el modal, con ≥2 marcados aparece "¿Quién conduce?" (radios con los marcados); al guardar se envía; en la cabecera del vehículo el que conduce sale con 🚐.
- [ ] Verificar en el navegador con el servidor + PostgREST falso (marcar 2, elegir conductor, recargar → persiste). Commit.

### Task 6: API de importación y uso (`lib/vehiculosRutas.js`)

- `POST /api/vehiculos/localizador` (multer, campo `archivo`, `?confirmar=1` para guardar): mapea por matrícula y si no por `nombre_localizador`; devuelve `{ desde, hasta, total, nuevos, existentes, ignorados:[{nombre, motivo}], desconocidos:[nombre] }`; con `confirmar=1` hace upsert en lotes de 500.
- `GET /api/vehiculos/uso?mes=YYYY-MM` → `calcularUso(...)` + nombres de vehículos.
- `PUT /api/vehiculos/uso/cortes` `{vehiculo_id, fecha, cortes}`.
- `cargarTodo`/ficha: `kmActuales` con `vehiculos_km_diarios` (paginado).
- [ ] Probar con el Excel real de septiembre contra el PostgREST falso: 1.125 trayectos con matrícula, 180 de 2786NDL ignorados, reimportar = 0 nuevos. Commit.

### Task 7: Pantalla "Uso" (`public/vehiculos.js`, menú)

- Submenú "Uso". Selector de mes, botón "Importar localizador" (subida → resumen → "Confirmar importación").
- Pestañas: Por vehículo (tabla + detalle diario desplegable), Por conductor, A revisar (con campo de horas de corte), Sin conductor.
- [ ] Verificar en el navegador con septiembre importado. Commit.

### Task 8: Cierre

- [ ] `npm test` verde; quitar config temporal; revisión final; preguntar merge; memoria.
