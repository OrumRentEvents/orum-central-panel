-- Módulo Vehículos (fase 2) — avisos por email y tipo "mantenimiento".
-- Ver lib/vehiculosAvisos.js. Solo añade: no toca datos existentes.
-- Ejecutar una sola vez en el SQL Editor de Supabase (se puede repetir).

-- A quién llegan los avisos de vencimientos (editable sin tocar código).
create table if not exists vehiculos_avisos_destinatarios (
  id bigint generated always as identity primary key,
  nombre text,
  email text not null unique,
  activo boolean not null default true
);

-- Un registro por día: cerrojo contra envíos dobles (reinicios, dos
-- instancias) e historial de lo enviado.
create table if not exists vehiculos_avisos_envios (
  fecha date primary key,
  ejecutado_en timestamptz not null default now(),
  resultado jsonb
);

alter table vehiculos_avisos_destinatarios enable row level security;
alter table vehiculos_avisos_envios enable row level security;

insert into vehiculos_avisos_destinatarios (nombre, email) values
  ('Jesús Aguilera', 'jesus.aguilera.orum@gmail.com'),
  ('Leo Haro', 'leo.haro.orum@gmail.com'),
  ('Rafa Pérez', 'rafael.perezserrano11@gmail.com'),
  ('Sergio Rosillo', 'sergio.rosillo@orumevents.com'),
  ('Logística (genérico)', 'logistica@orumevents.com')
on conflict (email) do nothing;

-- Nuevo tipo de mantenimiento "mantenimiento" (además de revisión, reparación...).
alter table vehiculos_mantenimientos drop constraint if exists vehiculos_mantenimientos_tipo_check;
alter table vehiculos_mantenimientos add constraint vehiculos_mantenimientos_tipo_check
  check (tipo in ('mantenimiento', 'revision', 'itv', 'reparacion', 'neumaticos', 'averia', 'limpieza', 'otro'));
