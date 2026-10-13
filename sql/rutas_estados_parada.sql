-- App de Rutas — estado de cada parada (Preparado / Cargado / Incidencia).
-- Ejecutar una sola vez en el SQL Editor de Supabase.
--
-- Hasta oct 2026 esto vivía solo en la pestaña ESTADOS_PARADA de la hoja
-- "RUTA ORUM 2026" y el Apps Script lo copiaba a columnas de rutas_paradas;
-- esa copia perdía cambios. Ahora server.js escribe aquí directamente y la
-- pantalla lee de aquí; la hoja de Google queda como copia de seguridad.
--
-- clave = la misma clave de parada que usa rutas_paradas.
create table if not exists rutas_estados_parada (
  clave text primary key,
  preparado boolean not null default false,
  cargado boolean not null default false,
  incidencia boolean not null default false,
  incidencia_texto text,
  usuario text,
  updated_raw timestamptz not null default now()
);
-- Igual que el resto de tablas: solo accede el servidor (service key).
alter table rutas_estados_parada enable row level security;
