-- Caja (25 oct 2026): autorización de devoluciones de fianza y efectivo
-- recibido por Contabilidad. Solo añade columnas y una tabla.

-- Devoluciones de fianza: a partir de ahora toda solicitud nueva la tiene que
-- autorizar María o Sergio antes de ejecutarse. Las que ya existían no
-- (requiere_autorizacion = false): la columna se crea con default false, que
-- se queda en las filas existentes, y luego el default pasa a true.
alter table fianza_solicitudes add column if not exists metodo_devolucion text; -- cómo se devuelve (null = como se cobró, Rentman custom_4)
alter table fianza_solicitudes add column if not exists requiere_autorizacion boolean not null default false;
alter table fianza_solicitudes alter column requiere_autorizacion set default true;
alter table fianza_solicitudes add column if not exists autorizada_en timestamptz;
alter table fianza_solicitudes add column if not exists autorizada_por text;

-- Efectivo de facturas oficiales que María entrega a Contabilidad: Ana o
-- Isabel lo marcan recibido cobro a cobro (como "Recibido" en No
-- Confirmados). clave = la de la pantalla de Caja (pago_id, o pago_id_N si
-- el pago está partido); el resto es una copia del cobro en ese momento.
create table if not exists caja_efectivo_recibido (
  clave          text primary key,
  pago_id        bigint,
  metodo         text,
  importe        numeric(12,2),
  numero         integer,
  cliente        text,
  fecha_pago_raw text,
  recibido_por   text,
  recibido_en    timestamptz not null default now()
);
alter table caja_efectivo_recibido enable row level security;
