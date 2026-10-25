-- Rutas sin Google (oct 2026): lo que quedaba en los Apps Script pasa a Supabase.
--  - Vehículo/vuelta/orden/notas y paradas manuales: server.js escribe ya
--    directamente en rutas_paradas / rutas_asignaciones / rutas_manual
--    (antes lo hacía el Apps Script "ORUM CENTRAL" tras escribir su hoja).
--  - Lista de choferes (antes pestaña CONFIG de "RUTA ORUM 2026") y
--    historial de cambios (antes pestaña HISTORIAL_RUTAS): tablas nuevas.
-- Solo añade tablas: no toca datos existentes.

create table if not exists rutas_config (
  clave   text primary key,          -- 'CHOFERES' = lista de nombres (jsonb array)
  valor   jsonb,
  updated timestamptz not null default now()
);

create table if not exists rutas_historial (
  id                bigint generated always as identity primary key,
  ts                timestamptz not null default now(),
  usuario           text,
  accion            text,
  detalle           text,
  importado_de_hoja boolean not null default false
);
create index if not exists rutas_historial_ts on rutas_historial (ts desc);

alter table rutas_config    enable row level security;
alter table rutas_historial enable row level security;
