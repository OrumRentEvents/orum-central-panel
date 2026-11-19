-- 19 nov 2026 (aplicado con el conector de Supabase): cuotas de leasing
-- repartidas en varias cuentas al aprobarlas en Financiero → Holded.
--   amortización → una 524 por contrato (holded_leasing.cuenta_amortizacion)
--   intereses    → siempre 66230000 (CUENTA_INTERESES_LEASING en lib/holdedCompras.js)
--   seguro       → una 625 por contrato (holded_leasing.cuenta_seguro)
-- Contrato nuevo: las dos cuentas se crean solas en Holded con el número
-- siguiente al último de su grupo (5240 / 6250).
alter table facturas_proveedores add column if not exists leasing jsonb;   -- desglose leído del PDF
alter table holded_sync_compras add column if not exists reparto jsonb;    -- reparto con el que se aprobó
create table if not exists holded_leasing (
  contrato            text primary key,   -- nº de contrato sin ceros delante (p. ej. 1792798)
  bien                text,
  cuenta_amortizacion integer,
  cuenta_seguro       integer,
  creado_por          text,
  creado_en           timestamptz not null default now()
);
alter table holded_leasing enable row level security;
