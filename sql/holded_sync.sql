-- Integración Rentman → Holded (1 oct 2026). Ver lib/holded.js.
-- Una fila por factura de Rentman enviada (o intentada) a Holded: evita
-- duplicados en reintentos y guarda qué se mandó y qué respondió Holded.
create table if not exists holded_sync_facturas (
  rentman_invoice_id  bigint primary key,
  numero              text not null,
  holded_invoice_id   text,
  holded_contact_id   text,
  estado              text not null default 'pendiente', -- pendiente | borrador | aprobada | error
  payload             jsonb,
  respuesta           jsonb,
  error               text,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now()
);

-- Una fila por línea de cobro de Caja (pago de Rentman + split) enviada a Holded.
create table if not exists holded_sync_cobros (
  pago_id             bigint not null,
  split_idx           integer not null default 1,
  rentman_invoice_id  bigint,
  numero_factura      text,
  metodo_pago         text,
  importe             numeric,
  fecha               date,
  holded_ref          text,
  estado              text not null default 'pendiente', -- pendiente | enviado | error
  respuesta           jsonb,
  error               text,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  primary key (pago_id, split_idx)
);

alter table holded_sync_facturas enable row level security;
alter table holded_sync_cobros enable row level security;

-- 5 oct 2026: rectificativas (Rentman tipo C) -> notas de credito en Holded.
alter table holded_sync_facturas add column if not exists tipo text not null default 'F'; -- F factura | C rectificativa
