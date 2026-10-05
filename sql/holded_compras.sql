-- Facturas de gastos (PDF de proveedores en Drive) → compras en borrador en Holded (5 oct 2026).
-- Ver lib/holdedCompras.js. Aplicado en Supabase con la migración holded_compras.
create table if not exists holded_proveedores (
  proveedor        text primary key,          -- nombre de la carpeta de Drive
  nif              text,
  nombre_fiscal    text,
  holded_contact_id text,
  cuenta_gasto     integer,                   -- nº de cuenta 6xx/2xx de Holded
  iva_cero         text,                      -- impuesto de Holded para líneas al 0 %
  retencion        text,                      -- impuesto de retención de Holded si el proveedor retiene
  notas            text,
  actualizado_por  text,
  actualizado_en   timestamptz not null default now()
);
create table if not exists holded_sync_compras (
  file_id            text primary key,        -- id del PDF en Drive
  proveedor          text,
  nombre_archivo     text,
  nif                text,
  numero             text,
  fecha              date,
  total              numeric,
  estado             text not null default 'pendiente', -- bloqueada | error | borrador
  holded_purchase_id text,
  extraccion         jsonb,
  payload            jsonb,
  respuesta          jsonb,
  error              text,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now()
);
alter table holded_proveedores enable row level security;
alter table holded_sync_compras enable row level security;

-- 5 oct 2026: lectura única de cada PDF (lib/lecturaFacturas.js). La hace la
-- sincronización de las 6:00; de aquí salen la Sheet y el volcado a Holded.
create table if not exists facturas_proveedores (
  file_id text primary key, proveedor text, nombre_archivo text, emisor_nombre text, nif text,
  numero text, fecha date, vencimiento date, es_rectificativa boolean, concepto text,
  lineas_iva jsonb, periodos jsonb, retencion_porcentaje numeric, retencion_importe numeric,
  total numeric, moneda text, confianza text, dudas text, modelo text,
  leido_en timestamptz not null default now()
);
create index if not exists idx_facturas_proveedores_fecha on facturas_proveedores (fecha);
alter table facturas_proveedores enable row level security;
