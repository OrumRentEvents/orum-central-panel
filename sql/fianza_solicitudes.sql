-- Fianzas: solicitudes de devolución + email de los viernes (20 oct 2026).
-- Sustituye a la hoja SOLICITUDES del Apps Script "ORUM Fianzas 2026".
-- La app Caja (REPOSITORIO CAJA ORUM GITHUB) lee y escribe fianza_solicitudes;
-- el email semanal lo manda este servidor (lib/emailFianzas.js).
-- Solo añade tablas: no toca datos existentes.

-- Una fila por solicitud. Flujo: María la crea (PENDIENTE) → Ana hace la
-- transferencia y la marca DEVUELTA → María avisa al cliente (notificado).
-- CANCELADA = "Deshacer" antes de que Ana la ejecute.
create table if not exists fianza_solicitudes (
  id                 text primary key,              -- 'SOL-<ms>' (mismo formato que la hoja, para importar sin cambiar ids)
  proyecto_id        bigint not null,               -- id de Rentman (= proyectos.id)
  numero_proyecto    text,
  cliente            text,
  importe            numeric(12,2) not null,        -- a devolver (puede ser menor que la fianza si se retiene una parte)
  metodo             text,
  fecha_evento       date,
  solicitado_por     text,
  fecha_solicitud    timestamptz not null default now(),
  notas              text,                          -- notas de María para Ana (IBAN, etc.)
  estado             text not null default 'PENDIENTE' check (estado in ('PENDIENTE', 'DEVUELTA', 'CANCELADA')),
  fecha_devolucion   timestamptz,
  devuelta_por       text,
  notas_devolucion   text,                          -- notas de Ana al confirmar la transferencia
  fecha_cancelacion  timestamptz,
  cancelada_por      text,
  notificado         boolean not null default false, -- cliente avisado de la devolución
  fecha_notificacion timestamptz,
  notificado_por     text,
  importada_de_hoja  boolean not null default false
);
-- Como mucho una solicitud pendiente por proyecto (la hoja lo comprobaba a mano).
create unique index if not exists fianza_solicitudes_una_pendiente
  on fianza_solicitudes (proyecto_id) where estado = 'PENDIENTE';
create index if not exists fianza_solicitudes_proyecto on fianza_solicitudes (proyecto_id);

-- A quién llega el resumen de los viernes (editable sin tocar código).
-- tipo 'para' = destinatario principal, 'cc' = en copia.
create table if not exists fianza_email_destinatarios (
  id     bigint generated always as identity primary key,
  nombre text,
  email  text not null,
  tipo   text not null default 'para' check (tipo in ('para', 'cc')),
  activo boolean not null default true
);

-- Una fila por viernes: cerrojo contra envíos dobles + resultado del envío.
create table if not exists fianza_email_envios (
  fecha        date primary key,
  ejecutado_en timestamptz not null default now(),
  resultado    jsonb
);

alter table fianza_solicitudes         enable row level security;
alter table fianza_email_destinatarios enable row level security;
alter table fianza_email_envios        enable row level security;

insert into fianza_email_destinatarios (nombre, email, tipo)
select 'Ana', 'financiero@orumevents.com', 'para'
where not exists (select 1 from fianza_email_destinatarios where email = 'financiero@orumevents.com');
-- María: añadir cuando se sepa su correo, p. ej.
-- insert into fianza_email_destinatarios (nombre, email, tipo) values ('María', '...', 'cc');
