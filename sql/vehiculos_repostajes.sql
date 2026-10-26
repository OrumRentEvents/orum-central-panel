-- Repostajes (oct 2026): se apuntan desde la app (botón Repostaje) — vehículo,
-- km del cuentakilómetros en ese momento, litros y quién reposta (lista de
-- choferes de Rutas). El km sirve además de lectura del cuentakilómetros
-- para Vehículos (km actuales y avisos por km).
create table if not exists vehiculos_repostajes (
  id bigserial primary key,
  vehiculo_id bigint not null references vehiculos(id),
  fecha date not null,
  km numeric not null check (km > 0),
  litros numeric not null check (litros > 0),
  persona text not null,
  registrado_por text,
  creado_en timestamptz not null default now()
);
create index if not exists vehiculos_repostajes_vehiculo_fecha on vehiculos_repostajes (vehiculo_id, fecha);
alter table vehiculos_repostajes enable row level security;
