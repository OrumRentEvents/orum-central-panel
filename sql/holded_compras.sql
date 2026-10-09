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

-- 9 oct 2026: plan de cuentas de gasto (grupo 6, nombres de Sage) para elegir
-- en Financiero → Config. Cuentas de gasto, y aprobación del contable en ORUM
-- Central antes de volcar (estado por_aprobar → aprobada). Migración
-- cuentas_gasto_aprobacion.
create table if not exists cuentas_gasto (
  numero         integer primary key,
  nombre         text not null,
  activa         boolean not null default true,
  actualizado_por text,
  actualizado_en timestamptz not null default now()
);
alter table cuentas_gasto enable row level security;
alter table holded_sync_compras
  add column if not exists cuenta_gasto integer,      -- cuenta elegida para ESTA factura (por defecto la del proveedor)
  add column if not exists aprobado_por text,
  add column if not exists aprobado_en timestamptz;

-- 9 oct 2026: histórico de Sage 2026 por NIF de proveedor (diario + plan de
-- cuentas de Sage). Si un proveedor nuevo siempre fue a la misma cuenta 6, se
-- propone como habitual; si repartía, se muestran sus cuentas como pista.
-- Migración sage_historico_proveedor; datos cargados una vez a mano.
create table if not exists sage_historico_proveedor (
  nif            text primary key,
  cuenta_sage    text,                 -- 400/410 del proveedor en Sage
  nombre_sage    text,
  cuentas        jsonb not null default '[]'::jsonb,  -- [{cuenta, nombre, apuntes, importe}] de más a menos apuntes
  importado_en   timestamptz not null default now()
);
alter table sage_historico_proveedor enable row level security;

-- 9 oct 2026: corrección del contable a la lectura del PDF ({fecha, vencimiento}
-- en YYYY-MM-DD; vencimiento null = sin vencimiento). Se aplica siempre que se
-- prepara o aprueba la factura. Migración holded_sync_compras_correccion.
alter table holded_sync_compras add column if not exists correccion jsonb;

-- 9 oct 2026: total que calcula Holded para cada factura/rectificativa de
-- venta, para detectar descuadres de céntimos con Rentman (redondeo del IVA).
-- Migración holded_sync_facturas_total_holded.
alter table holded_sync_facturas add column if not exists total_holded numeric;

-- 9 oct 2026: la compra entra en Holded ya pagada. forma_pago = la de Facturas
-- Proveedores; pago_fecha / pago_tesoreria = lo que eligió el contable al
-- aceptar (clave de TESORERIAS en lib/holded.js). Migración holded_sync_compras_pago.
alter table holded_sync_compras
  add column if not exists forma_pago text,
  add column if not exists pago_fecha date,
  add column if not exists pago_tesoreria text;
