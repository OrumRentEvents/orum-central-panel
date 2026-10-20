-- Módulo Vehículos (fase 1) — ficha maestra de la flota, vencimientos,
-- histórico de mantenimientos y documentos. Ver
-- docs/superpowers/specs/2026-10-20-modulo-vehiculos-design.md
-- Ejecutar una sola vez en el SQL Editor de Supabase.
--
-- Une las tres formas de nombrar un vehículo: matrícula (Facturas),
-- nombre_rutas (Rutas: IVECO, FURGO NDL...) y nombre_localizador (Excel
-- del localizador GPS, fase 3).

create table if not exists vehiculos (
  id bigint generated always as identity primary key,
  matricula text unique,
  marca text,
  modelo text,
  tipo text not null default 'furgoneta' check (tipo in ('furgoneta', 'camion', 'turismo', 'otro')),
  nombre_rutas text unique,
  nombre_localizador text unique,
  propiedad text not null default 'propio' check (propiedad in ('propio', 'renting', 'leasing', 'alquilado')),
  fecha_alta date,
  fecha_baja date,
  activo boolean not null default true,
  km_base numeric,
  km_base_fecha date,
  notas text,
  creado_por text,
  actualizado_por text,
  actualizado_en timestamptz not null default now()
);

create table if not exists vehiculos_vencimientos (
  id bigint generated always as identity primary key,
  vehiculo_id bigint not null references vehiculos(id) on delete cascade,
  tipo text not null check (tipo in ('itv', 'seguro', 'ivtm', 'revision', 'tacografo', 'fin_renting', 'otro')),
  descripcion text,
  fecha_limite date,
  km_limite numeric,
  aviso_dias int not null default 30,
  aviso_km int not null default 1000,
  periodicidad_meses int,
  periodicidad_km int,
  estado_notificado text,
  activo boolean not null default true,
  check (fecha_limite is not null or km_limite is not null)
);
create index if not exists vehiculos_vencimientos_vehiculo_idx on vehiculos_vencimientos (vehiculo_id);

create table if not exists vehiculos_mantenimientos (
  id bigint generated always as identity primary key,
  vehiculo_id bigint not null references vehiculos(id) on delete cascade,
  fecha date not null,
  tipo text not null check (tipo in ('revision', 'itv', 'reparacion', 'neumaticos', 'averia', 'limpieza', 'otro')),
  descripcion text,
  taller text,
  km numeric,
  importe numeric,            -- base sin IVA
  factura_ref jsonb,          -- {fileId, numeroFactura, proveedor, importeBase} de FACTURAS_LOG (fase 4)
  vencimiento_id bigint references vehiculos_vencimientos(id) on delete set null,
  creado_por text,
  creado_en timestamptz not null default now()
);
create index if not exists vehiculos_mantenimientos_vehiculo_idx on vehiculos_mantenimientos (vehiculo_id);

create table if not exists vehiculos_documentos (
  id bigint generated always as identity primary key,
  vehiculo_id bigint not null references vehiculos(id) on delete cascade,
  tipo text not null check (tipo in ('permiso_circulacion', 'ficha_tecnica', 'poliza', 'itv', 'contrato_renting', 'otro')),
  nombre_archivo text not null,
  ruta_storage text not null,
  fecha_caducidad date,
  subido_por text,
  subido_en timestamptz not null default now()
);
create index if not exists vehiculos_documentos_vehiculo_idx on vehiculos_documentos (vehiculo_id);

-- Solo accede el servidor (service key), como el resto de tablas.
alter table vehiculos enable row level security;
alter table vehiculos_vencimientos enable row level security;
alter table vehiculos_mantenimientos enable row level security;
alter table vehiculos_documentos enable row level security;

-- Bucket privado para permisos de circulación, pólizas, fichas técnicas...
insert into storage.buckets (id, name, public) values ('vehiculos-documentos', 'vehiculos-documentos', false)
on conflict do nothing;

-- Carga inicial (confirmada por el usuario el 2026-10-20).
insert into vehiculos (matricula, marca, modelo, tipo, nombre_rutas, propiedad, notas, creado_por) values
  ('6625MYZ', 'Iveco', 'Daily', 'furgoneta', 'IVECO', 'propio', null, 'carga inicial'),
  ('7594MPZ', 'Renault', null, 'furgoneta', 'RENAULT', 'propio', null, 'carga inicial'),
  ('8939LDW', 'Mercedes', 'Atego', 'camion', 'AZUL', 'propio', null, 'carga inicial'),
  ('6275MDP', 'Nissan', 'Interstar', 'furgoneta', 'NISSAN', 'propio', null, 'carga inicial'),
  ('9063NCW', 'MAN', 'TGE 3.140 (Furgo ORUM)', 'furgoneta', 'FURGO NCW', 'propio', null, 'carga inicial'),
  ('2786NDL', 'MAN', 'TGE 3.140 (Furgo Mobil Home)', 'furgoneta', 'FURGO NDL', 'propio', null, 'carga inicial'),
  ('4424HVB', 'Volkswagen', 'Crafter', 'furgoneta', 'VOLKSWAGEN', 'propio', null, 'carga inicial'),
  ('7710NHY', 'Citroën', 'C3 Aircross', 'turismo', null, 'renting', null, 'carga inicial')
on conflict do nothing;
-- Sin matrícula no hay clave única que evite duplicarlo al re-ejecutar.
insert into vehiculos (matricula, marca, modelo, tipo, propiedad, notas, creado_por)
select null, 'Mercedes', 'Comercial', 'furgoneta', 'propio', 'Propiedad por confirmar', 'carga inicial'
where not exists (select 1 from vehiculos where matricula is null and marca = 'Mercedes' and modelo = 'Comercial');
