-- Caja: todo en Supabase (24 oct 2026).
-- Sustituye a las hojas del Apps Script de Caja (CIERRES, SALDOS, RETIRADAS,
-- TICKS, HISTORIAL) y al formulario de Google de No Confirmados. La app Caja
-- (REPOSITORIO CAJA ORUM GITHUB, lib/caja.js) lee y escribe aquí directamente.
-- Solo añade tablas/columnas y un trigger: no toca datos existentes.

-- Un cierre por caja y periodo (desde/hasta = días que cubre, hora de Madrid).
-- El saldo arrastrado ("saldo anterior" del siguiente) = saldo_final del
-- último cierre por ts - ya no hay hoja SALDOS aparte.
create table if not exists caja_cierres (
  id                bigint generated always as identity primary key,
  caja              text not null check (caja in ('marbella', 'monda')),
  desde             date not null,
  hasta             date not null,
  total_ef          numeric(12,2) not null default 0,
  total_tpv         numeric(12,2) not null default 0,
  total_transf      numeric(12,2) not null default 0,
  retiradas         jsonb not null default '[]',   -- copia de las retiradas que entraron en el cierre
  saldo_anterior    numeric(14,4) not null default 0,
  saldo_final       numeric(14,4) not null default 0,
  usuario           text,                          -- "Responsable de cierre" (editable en el modal)
  ts                timestamptz not null default now(),
  importado_de_hoja boolean not null default false,
  unique (caja, desde, hasta)
);
create index if not exists caja_cierres_caja_ts on caja_cierres (caja, ts desc);

-- Retiradas de efectivo (y pagos de factura en efectivo) de cada caja.
-- Antes se borraban de la hoja al cerrar; ahora se marcan cerradas y quedan.
create table if not exists caja_retiradas (
  id                bigint generated always as identity primary key,
  caja              text not null check (caja in ('marbella', 'monda')),
  es_nc             boolean not null default false, -- caja de No Confirmados
  importe           numeric(12,2) not null,
  descripcion       text,
  tipo              text not null default 'retirada', -- 'retirada' | 'factura'
  usuario           text,
  ts                timestamptz not null default now(),
  cerrada_en        timestamptz,                    -- null = pendiente (entra en el próximo cierre)
  cerrada_por       text,
  cierre_id         bigint references caja_cierres (id),
  importada_de_hoja boolean not null default false
);
create index if not exists caja_retiradas_pendientes on caja_retiradas (caja, es_nc) where cerrada_en is null;

-- Verificación de Contabilidad (tick por línea). key = '<fecha_pago>_<id>'.
create table if not exists caja_ticks (
  key     text primary key,
  valor   boolean not null default true,
  nota    text,
  usuario text,
  fecha   timestamptz not null default now()
);

-- Historial de acciones (pestaña Historial, solo admin).
create table if not exists caja_historial (
  id                bigint generated always as identity primary key,
  ts                timestamptz not null default now(),
  accion            text not null,
  usuario           text,
  datos             jsonb,
  importado_de_hoja boolean not null default false
);
create index if not exists caja_historial_ts on caja_historial (ts desc);

-- No Confirmados: caja_nc_formulario ya existía (copia del formulario de
-- Google que subía el cron cada 15 min). Pasa a ser la tabla de verdad: el
-- formulario propio de Caja escribe aquí. "Eliminar confirmados" ya no borra
-- la fila: la marca eliminada (antes se movía a la pestaña histórico de la hoja).
alter table caja_nc_formulario add column if not exists fecha          date;
alter table caja_nc_formulario add column if not exists registrado_por text;
alter table caja_nc_formulario add column if not exists creado_en      timestamptz;
alter table caja_nc_formulario add column if not exists eliminado_en   timestamptz;
alter table caja_nc_formulario add column if not exists eliminado_por  text;
alter table caja_nc_formulario add column if not exists origen         text not null default 'formulario_google'; -- 'formulario_google' | 'caja'
update caja_nc_formulario
   set fecha = to_date(split_part(timestamp_raw, ' ', 1), 'DD/MM/YYYY')
 where fecha is null and timestamp_raw ~ '^\d{1,2}/\d{1,2}/\d{4}';
create index if not exists caja_nc_formulario_fecha on caja_nc_formulario (fecha) where eliminado_en is null;

-- fecha_pago_ts solo lo rellenaba el cron (hoja -> Supabase). Sin cron, el
-- mismo trigger que ya usan pagos/facturas lo calcula desde fecha_pago_raw
-- ('dd/mm/yyyy hh:mm'). lib/holded.js lo necesita.
drop trigger if exists rellenar_ts on caja_registros;
create trigger rellenar_ts before insert or update on caja_registros
  for each row execute function orum_rellenar_ts('fecha_pago_raw', 'fecha_pago_ts');

alter table caja_cierres    enable row level security;
alter table caja_retiradas  enable row level security;
alter table caja_ticks      enable row level security;
alter table caja_historial  enable row level security;
