-- Módulo Mantenimiento (fase 1) — persiste el check "revisado por
-- mantenimiento" de cada salida de material de especial cuidado.
-- Ejecutar una sola vez en el SQL Editor de Supabase.
--
-- clave = proyecto_id + '::' + artículo normalizado -> identifica una
-- salida concreta. Sin fila = no revisado. Si el mismo artículo vuelve a
-- salir en otro proyecto más adelante, es una clave nueva y aparece sin
-- marcar otra vez (revisión "por salida concreta", no permanente).
create table if not exists mantenimiento_checks (
  clave text primary key,
  proyecto_id text not null,
  articulo text not null,
  revisado boolean not null default false,
  revisado_por text,
  revisado_ts timestamptz,
  updated_raw timestamptz not null default now()
);
