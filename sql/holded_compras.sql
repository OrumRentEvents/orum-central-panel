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
