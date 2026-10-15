-- Paradas que necesitan transpalé (hoja de rutas). Aplicado en Supabase el 15 oct 2026.
-- clave = "<proyecto_id>_ENTREGA" / "<proyecto_id>_RECOGIDA" para las paradas de proyectos
-- (sin la fecha, para que la marca no se pierda si cambia el día) o la clave de la parada manual.
-- auto = true cuando la marcó el sistema al marcar la entrega (se quita sola si se desmarca la entrega).
create table if not exists rutas_transpale (
  clave text primary key,
  transpale boolean not null default false,
  auto boolean not null default false,
  usuario text,
  updated_raw timestamptz not null default now()
);
alter table rutas_transpale enable row level security;
