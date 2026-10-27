-- Preparación por zona (oct 2026, cambio de estados de Rentman): cuando
-- Lavandería u Office tienen todos los artículos de un proyecto marcados,
-- apuntan quién lo ha preparado; Office además cuenta los contenedores que
-- mete (racks, cajas grises, platibox, pallet, carro porta platos).
-- Sin fila = nadie apuntado todavía y sin contenedores.
create table if not exists preparacion_zona (
  area           text not null check (area in ('lavanderia', 'office')),
  proyecto_id    bigint not null,
  preparadores   text[] not null default '{}',
  contenedores   jsonb not null default '{}'::jsonb,
  usuario        text,
  actualizado_en timestamptz not null default now(),
  primary key (area, proyecto_id)
);
alter table preparacion_zona enable row level security;

-- Las tablets entran todas con el mismo usuario ("Office", "Lavandería"): cada
-- artículo guarda además el nombre de la persona que lo ha marcado.
alter table preparacion_checks add column if not exists preparado_por text;
-- Persona que está preparando ese proyecto en esa zona: se elige una vez por
-- proyecto y se queda guardada (cualquier tablet la ve) hasta que alguien
-- pulse «No soy yo». Lo que se marque en ese proyecto va a su nombre.
alter table preparacion_zona add column if not exists preparando text;

-- App del conductor: el conductor da la parada por completada (entregado /
-- recogido). Va en la misma fila que Preparado / Cargado / Incidencia.
alter table rutas_estados_parada
  add column if not exists completado boolean not null default false,
  add column if not exists completado_en timestamptz,
  add column if not exists completado_por text;
