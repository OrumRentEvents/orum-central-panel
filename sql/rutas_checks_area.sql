-- App de Rutas — casillas "Office" y "Lavandería" de cada parada: los
-- responsables de logística marcan si la parada ya está asignada a cada
-- área. Ejecutar una sola vez en el SQL Editor de Supabase.
--
-- clave = la misma clave de parada que usa rutas_paradas (o
-- "manual_<id>" en las manuales). Sin fila = ninguna de las dos marcada.
create table if not exists rutas_checks_area (
  clave text primary key,
  office boolean not null default false,
  lavanderia boolean not null default false,
  usuario text,
  updated_raw timestamptz not null default now()
);
-- Igual que el resto de tablas: solo accede el servidor (service key).
alter table rutas_checks_area enable row level security;
