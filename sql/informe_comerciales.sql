-- Informes a comerciales y Dirección (lib/informeComerciales.js)
-- Ejecutar una sola vez en el SQL Editor de Supabase (ya aplicado vía MCP el 21 sep 2026).

-- Foto diaria del estado de cada presupuesto. Sin ella no se puede saber
-- qué presupuestos se transformaron o cancelaron en una semana: Supabase solo
-- guarda el estado actual, no cuándo cambió. fecha = día al que corresponde
-- la foto (estado al cierre de ese día). Se purga sola pasados 45 días.
create table if not exists presupuestos_snapshot (
  fecha date not null,
  proyecto_id text not null,
  estado text,
  importe_sin_iva numeric,
  primary key (fecha, proyecto_id)
);

-- A quién se envía cada correo.
--   tipo = 'comercial'  -> "comercial" debe coincidir con el nombre de
--                          PROYECTOS/PRESUPUESTOS (p.ej. 'Danilo Castellano')
--   tipo = 'direccion'  -> recibe el informe semanal de Dirección (comercial = null)
create table if not exists informe_destinatarios (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('comercial', 'direccion')),
  comercial text,
  email text not null,
  activo boolean not null default true,
  check (tipo = 'direccion' or comercial is not null)
);

-- Un registro por día: sirve de cerrojo (evita enviar dos veces si hay dos
-- instancias o un reinicio a las 8:00) y de historial de lo enviado.
create table if not exists informe_envios (
  fecha date primary key,
  ejecutado_en timestamptz not null default now(),
  resultado jsonb
);

alter table presupuestos_snapshot enable row level security;
alter table informe_destinatarios enable row level security;
alter table informe_envios enable row level security;
