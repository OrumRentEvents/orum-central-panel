-- Calendario (nov 2026): reuniones y visitas (de Google), vacaciones y descansos
-- (de la Bolsa de horas), turnos y citas de taller (de Vehículos).
-- Se puede ejecutar más de una vez.

-- Turno semanal de cada trabajador (clave = la de la Bolsa de horas).
-- dia: 1 = lunes … 7 = domingo. entrada2/salida2 para jornada partida.
create table if not exists turnos_semana (
  clave text not null,
  dia smallint not null check (dia between 1 and 7),
  nombre text not null,
  entrada time,
  salida time,
  entrada2 time,
  salida2 time,
  libre boolean not null default false,
  actualizado_por text,
  actualizado_en timestamptz not null default now(),
  primary key (clave, dia),
  check (libre or (entrada is not null and salida is not null))
);
alter table turnos_semana enable row level security;

-- Cambio de turno para un día concreto (manda sobre el semanal)
create table if not exists turnos_dia (
  clave text not null,
  fecha date not null,
  nombre text not null,
  entrada time,
  salida time,
  entrada2 time,
  salida2 time,
  libre boolean not null default false,
  nota text,
  registrado_por text,
  creado_en timestamptz not null default now(),
  primary key (clave, fecha),
  check (libre or (entrada is not null and salida is not null))
);
create index if not exists turnos_dia_fecha on turnos_dia (fecha);
alter table turnos_dia enable row level security;

-- Permiso de Google Calendar de cada usuario (solo lectura). El token va cifrado
-- por el servidor; calendarios = [{ id, nombre, tipo: 'reunion'|'visita'|'no' }].
create table if not exists calendario_google (
  usuario text primary key,
  google_email text,
  token_cifrado text not null,
  calendarios jsonb not null default '[]',
  conectado_en timestamptz not null default now(),
  ultimo_error text,
  ultimo_error_en timestamptz
);
alter table calendario_google enable row level security;
