-- Recuperación de material (oct 2026). Flujo acordado con el usuario:
-- 1. Logística (Leo o quien lo recupere) marca en Rentman, en Equipos
--    perdidos, el material que vuelve → movimiento "equipment_found".
-- 2. ORUM Central lo lee y la MISMA persona lo confirma en la pestaña
--    Material recuperado: revisa proyecto (propuesto si se puede deducir) y
--    cantidad. Sin confirmar no pasa a Administración.
-- 3. María o Sergio quitan el cargo "NO DEVUELTO" en Rentman; al ver que el
--    cargo ya no está (o ha bajado), ORUM Central lo cierra solo.
-- La API de Rentman no dice de qué proyecto es un "equipment_found": el
-- proyecto lo propone ORUM Central por el artículo y lo confirma Logística.

-- Copia de los cargos "<ARTÍCULO> NO DEVUELTO" de Rentman (costes adicionales).
-- Se guardan para recordarlos aunque luego se borren en Rentman (existe=false).
create table if not exists recuperacion_cargos (
  cargo_id bigint primary key,           -- id del coste en Rentman
  proyecto_id bigint not null,           -- id del proyecto en Rentman (= proyectos.id)
  articulo text not null,                -- nombre sin " NO DEVUELTO"
  cantidad numeric not null,
  precio numeric not null default 0,
  creado_en timestamptz,
  existe boolean not null default true,
  visto_en timestamptz not null default now()
);
create index if not exists recuperacion_cargos_articulo on recuperacion_cargos (articulo);
create index if not exists recuperacion_cargos_proyecto on recuperacion_cargos (proyecto_id);
alter table recuperacion_cargos enable row level security;

-- Cada "Material recuperado" de Rentman (id = id del movimiento de stock).
create table if not exists material_recuperado (
  id bigint primary key,
  equipo_id bigint,
  articulo text not null,
  cantidad numeric not null,
  fecha timestamptz not null,
  marcado_por text,                      -- quién lo marcó en Rentman
  estado text not null default 'por_confirmar' check (estado in ('por_confirmar', 'por_quitar', 'cerrado')),
  proyecto_id bigint,                    -- confirmado por Logística
  cargo_id bigint,                       -- cargo NO DEVUELTO al que corresponde (si lo hay)
  cargo_cantidad_al_confirmar numeric,   -- para saber si luego se quitó o se bajó
  importe numeric,                       -- cantidad × precio del cargo
  confirmado_por text,
  confirmado_en timestamptz,
  cerrado_por text,                      -- 'automático' si se cerró al desaparecer el cargo
  cerrado_en timestamptz,
  cerrado_motivo text,                   -- cargo_quitado, cargo_reducido, sin_cargo, abono, se_cobra, otro
  notas text,
  creado_en timestamptz not null default now()
);
create index if not exists material_recuperado_estado on material_recuperado (estado, fecha desc);
alter table material_recuperado enable row level security;
