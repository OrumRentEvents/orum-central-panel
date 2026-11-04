-- Bolsa de horas (nov 2026), idea de Leo: lo que se debe a cada trabajador (o lo
-- que debe él) en horas, días de festivo y días de descanso, más sus vacaciones.
-- No genera pagos ni pasa por aprobación: es independiente de Registrar extras.
--
-- clave = la misma del trabajador en extras ("nif|formato|num") o "libre|NOMBRE"
-- para quien no está en nómina. Nada se borra: al anular queda en el historial.
create table if not exists bolsa_movimientos (
  id bigserial primary key,
  clave text not null,
  nombre text not null,
  tipo text not null check (tipo in ('horas', 'festivo', 'descanso')),
  -- horas y descanso: + se le debe, − se le ha compensado. festivo: siempre 1.
  cantidad numeric not null check (cantidad <> 0),
  fecha date not null,
  nota text,
  motivo text check (motivo in ('compensadas', 'pagadas')), -- solo al quitar horas
  disfrutado_fecha date, -- solo festivo
  registrado_por text,
  creado_en timestamptz not null default now(),
  anulado_por text,
  anulado_en timestamptz
);
create index if not exists bolsa_movimientos_clave on bolsa_movimientos (clave, fecha);
alter table bolsa_movimientos enable row level security;

create table if not exists bolsa_vacaciones (
  id bigserial primary key,
  clave text not null,
  nombre text not null,
  fecha_inicio date not null,
  fecha_fin date not null,
  dias integer not null check (dias > 0), -- días naturales, ambos incluidos
  nota text,
  registrado_por text,
  creado_en timestamptz not null default now(),
  anulado_por text,
  anulado_en timestamptz,
  check (fecha_fin >= fecha_inicio)
);
create index if not exists bolsa_vacaciones_clave on bolsa_vacaciones (clave, fecha_inicio);
alter table bolsa_vacaciones enable row level security;

-- Personas añadidas a mano con «Añadir empleado» (no están en nómina)
create table if not exists bolsa_empleados (
  clave text primary key,
  nombre text not null,
  area text,
  registrado_por text,
  creado_en timestamptz not null default now()
);
alter table bolsa_empleados enable row level security;
