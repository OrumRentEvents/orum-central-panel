-- Preparación (oct 2026): Lavandería y Office marcan cada artículo de un
-- proyecto cuando lo tienen preparado. Cuando todos los artículos de su zona
-- están marcados, el proyecto pasa a "Preparado" en esa zona aunque en
-- Rentman siga Confirmed (porque falta material de otras zonas).
-- Se guarda la cantidad que había al marcar: si luego cambia en Rentman, el
-- check deja de valer y la pantalla avisa ("100 → 120").
-- Distinto del check de Lavandería/Office de Rutas (rutas_checks_area), que es
-- el aviso de Logística de que la parada lleva material de esa zona.

create table if not exists preparacion_checks (
  area         text not null check (area in ('lavanderia', 'office')),
  proyecto_id  bigint not null,
  articulo     text not null,
  cantidad     numeric not null,
  usuario      text,
  marcado_en   timestamptz not null default now(),
  primary key (area, proyecto_id, articulo)
);
alter table preparacion_checks enable row level security;
