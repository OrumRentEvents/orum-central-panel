-- Avisos de cambios en proyectos (oct 2026, lib/avisosProyecto.js).
-- Cuando un proyecto de hoy o mañana se confirma, o cambia el material, la
-- fecha o se cancela, el servidor deja aquí una fila por departamento
-- afectado (lavanderia, office, mantenimiento, logistica). Cada departamento
-- pulsa "Visto" y el comercial del proyecto recibe un aviso de que se ha
-- enterado.
create table if not exists avisos_proyecto (
  id           bigserial primary key,
  proyecto_id  bigint not null,
  numero       text,
  cliente      text,
  comercial    text,          -- proyectos.comercial (= usuarios.comercial_filtro)
  area         text not null check (area in ('lavanderia', 'office', 'mantenimiento', 'logistica')),
  tipo         text not null check (tipo in ('nuevo', 'material', 'fecha', 'cancelado')),
  urgente      boolean not null default false,
  titulo       text not null,
  lineas       jsonb not null default '[]',  -- textos del cambio: "Mantel redondo 280: 20 → 25"
  entrega      text,          -- "28/10/2026 10:00", para enseñarlo
  creado_en    timestamptz not null default now(),
  visto_por    text,
  visto_nombre text,
  visto_en     timestamptz
);
create index if not exists avisos_proyecto_creado on avisos_proyecto (creado_en desc);
create index if not exists avisos_proyecto_pendientes on avisos_proyecto (area) where visto_en is null;
alter table avisos_proyecto enable row level security;

-- Dispositivos que reciben los avisos de proyectos (Logística, Dirección y
-- comerciales; las tablets los reciben por el chat de su departamento).
create table if not exists avisos_suscripciones (
  endpoint   text primary key,
  usuario    text not null references usuarios(usuario) on update cascade on delete cascade,
  p256dh     text not null,
  auth       text not null,
  creado_en  timestamptz not null default now()
);
create index if not exists avisos_suscripciones_usuario on avisos_suscripciones (usuario);
alter table avisos_suscripciones enable row level security;
