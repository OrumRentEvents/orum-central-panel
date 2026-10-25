-- Facturas de proveedores sin la Sheet (oct 2026). Lo que el panel leía y
-- escribía en la hoja "FACTURAS_LOG" del Apps Script de facturas pasa a
-- Supabase (ver lib/facturasProveedoresDatos.js). En Google solo queda Drive:
-- listar la carpeta de PDFs y descargar cada PDF al sincronizar.
-- Solo añade tablas: no toca datos existentes.

-- Una fila por periodo de factura (antes, una fila de FACTURAS_LOG). id hace
-- de "fila" para el panel (antes, nº de fila de la hoja).
create table if not exists facturas_proveedores_lineas (
  id             bigint generated always as identity primary key,
  file_id        text not null,
  proveedor      text,
  nombre_archivo text,
  numero_factura text,
  fecha          text,          -- "DD/MM/YYYY", como en la hoja
  importe_base   numeric(14,2),
  iva            numeric(14,2),
  importe_total  numeric(14,2),
  confianza      text,
  procesado_en   timestamptz not null default now(),
  forma_pago     text,
  contabilizada  boolean not null default false,
  digitalizada   boolean not null default false,
  matricula      text,
  mes            integer,
  anio           integer,
  fila_hoja      integer        -- nº de fila en FACTURAS_LOG (importadas)
);
create index if not exists facturas_proveedores_lineas_file on facturas_proveedores_lineas (file_id);
create unique index if not exists facturas_proveedores_lineas_fila_hoja on facturas_proveedores_lineas (fila_hoja);

-- Reparto de cada proveedor por departamento (antes, REPARTO_PROVEEDORES).
create table if not exists facturas_proveedores_reparto (
  id           bigint generated always as identity primary key,
  proveedor    text not null,
  departamento text not null,
  porcentaje   numeric(6,2) not null default 0
);

-- Quién cambió qué campo y cuándo (antes, HISTORIAL_FACTURAS).
create table if not exists facturas_proveedores_historial (
  id                bigint generated always as identity primary key,
  fecha             timestamptz not null default now(),
  file_id           text,
  linea_id          bigint,
  nombre_archivo    text,
  proveedor         text,
  campo             text,
  valor_anterior    text,
  valor_nuevo       text,
  usuario           text,
  importado_de_hoja boolean not null default false
);
create index if not exists facturas_proveedores_historial_file on facturas_proveedores_historial (file_id);

-- PDFs que fallaron al sincronizar (antes, ERRORES_PROCESAMIENTO).
create table if not exists facturas_proveedores_errores (
  id                bigint generated always as identity primary key,
  fecha             timestamptz not null default now(),
  file_id           text,
  proveedor         text,
  nombre_archivo    text,
  error             text,
  importado_de_hoja boolean not null default false
);

alter table facturas_proveedores_lineas    enable row level security;
alter table facturas_proveedores_reparto   enable row level security;
alter table facturas_proveedores_historial enable row level security;
alter table facturas_proveedores_errores   enable row level security;
