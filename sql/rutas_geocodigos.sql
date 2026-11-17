-- Rutas · Mapa (fase 3, nov 2026): caché de coordenadas por dirección.
-- Cada dirección se consulta a Google una sola vez; las que Google no encuentra
-- también se guardan (precision = 'no_encontrada') para no volver a pagarlas.
-- No toca ninguna tabla existente.
create table if not exists rutas_geocodigos (
  direccion        text primary key,          -- dirección normalizada (minúsculas, espacios simples)
  consulta         text not null,             -- texto tal cual se mandó a Google
  lat              double precision,
  lng              double precision,
  precision        text not null,             -- 'exacta' | 'aproximada' | 'no_encontrada'
  direccion_google text,                      -- dirección que devolvió Google
  place_id         text,
  tipo_google      text,                      -- location_type de Google (ROOFTOP, APPROXIMATE…)
  fuente           text not null default 'google', -- 'google' | 'manual'
  verificado       boolean not null default false,
  usuario          text,
  actualizado      timestamptz not null default now()
);
alter table rutas_geocodigos enable row level security;
