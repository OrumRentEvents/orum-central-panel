-- Módulo Vehículos (fase 5) — ajustes editables desde el panel (ranking de
-- conductores: umbrales de velocidad por tipo, pesos, km mínimo). Ver lib/ranking.js.
-- Solo añade. Se puede ejecutar más de una vez.
create table if not exists vehiculos_config (
  clave text primary key,
  valor jsonb not null default '{}',
  actualizado_por text,
  actualizado_en timestamptz not null default now()
);
alter table vehiculos_config enable row level security;
