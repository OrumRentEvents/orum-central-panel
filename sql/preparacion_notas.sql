-- Notas de Preparación (oct 2026): avisos por proyecto que escriben Office,
-- Lavandería, almacén o Dirección ("faltan 20 servilletas beige, llegan el
-- jueves"). Las ven todas las zonas. Cada uno corrige o borra las suyas;
-- Dirección y Logística pueden borrar cualquiera.

create table if not exists preparacion_notas (
  id             bigint generated always as identity primary key,
  proyecto_id    bigint not null,
  zona           text not null check (zona in ('almacen', 'lavanderia', 'office')),
  texto          text not null check (length(texto) between 1 and 1000),
  usuario        text not null,   -- usuario de acceso (para saber de quién es)
  autor          text not null,   -- nombre que se enseña
  creado_en      timestamptz not null default now(),
  editado_en     timestamptz
);
create index if not exists preparacion_notas_proyecto on preparacion_notas (proyecto_id);
alter table preparacion_notas enable row level security;
