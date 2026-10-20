-- Módulo Vehículos (fase 3) — trayectos del localizador y conductor en Rutas.
-- Ver lib/localizador.js y docs/superpowers/specs/2026-10-20-modulo-vehiculos-design.md §6.2–6.3
-- Solo añade: no toca datos existentes salvo rellenar nombre_localizador vacío.
-- Se puede ejecutar más de una vez.

-- Quién conduce cuando en la vuelta van varios (Rutas guarda la lista en
-- orden alfabético). null = sin determinar.
alter table rutas_conductores add column if not exists conductor text;

-- Cada fila del "Informe detallado" del localizador.
create table if not exists vehiculos_trayectos (
  id bigint generated always as identity primary key,
  vehiculo_id bigint not null references vehiculos(id) on delete cascade,
  vehiculo_nombre text,           -- nombre tal cual en el localizador
  inicio timestamp not null,      -- hora local
  fin timestamp,
  fecha date not null,
  origen text, loc_origen text, destino text, loc_destino text,
  km numeric,
  seg_conduccion int,
  paradas int,
  seg_paradas int,
  seg_motor_parado int,           -- "Tiempo Motor enc." (ralentí)
  vel_media numeric, vel_max numeric,
  litros numeric, coste_litros numeric,
  consumo_100 numeric, consumo_optimo_100 numeric, litros_optimo numeric,
  importado_por text,
  importado_en timestamptz not null default now(),
  unique (vehiculo_id, inicio)
);
create index if not exists vehiculos_trayectos_fecha_idx on vehiculos_trayectos (fecha);

-- Horas de corte manuales para los días "a revisar" (['HH:MM', ...]).
create table if not exists vehiculos_cortes_vuelta (
  vehiculo_id bigint not null references vehiculos(id) on delete cascade,
  fecha date not null,
  cortes jsonb not null default '[]',
  actualizado_por text,
  actualizado_en timestamptz not null default now(),
  primary key (vehiculo_id, fecha)
);

alter table vehiculos_trayectos enable row level security;
alter table vehiculos_cortes_vuelta enable row level security;

-- Km por vehículo y día (para el cuentakilómetros sin traer cada trayecto).
create or replace view vehiculos_km_diarios with (security_invoker = true) as
  select vehiculo_id, fecha, sum(km) as km from vehiculos_trayectos group by vehiculo_id, fecha;

-- Nombres del localizador (export de sept. 2026), solo donde está vacío.
update vehiculos set nombre_localizador = n.nombre from (values
  ('6625MYZ', 'IVECO DAILY (IVECO)'), ('6275MDP', 'NISSAN INTERSTAR (NISSAN)'), ('7594MPZ', 'RENAULT (RENAULT)'),
  ('9063NCW', 'MAN TGE 3.140 (FURGO ORUM)'), ('2786NDL', 'MAN TGE 3.140 (FURGO MOBIL HOME)'),
  ('4424HVB', 'VOLKSWAGEN CRAFTER (VOLKSWAGEN )'), ('8939LDW', 'MERCEDES ATEGO (AZUL)'), ('1663HNF', 'MERCEDES (MERCEDES COMERCIAL)')
) as n(matricula, nombre)
where vehiculos.matricula = n.matricula and vehiculos.nombre_localizador is null;
