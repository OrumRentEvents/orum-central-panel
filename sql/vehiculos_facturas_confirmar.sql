-- Vehículos · facturas de taller por confirmar (19 nov 2026)
-- Cuando entra una factura de proveedor con matrícula y tipo ITV, revisión,
-- reparación o neumáticos, el vehículo recibe un aviso «por confirmar». El
-- responsable lo confirma con «Completar» (la visita queda enlazada a la factura
-- y el vencimiento se renueva) o lo descarta. Ver lib/vehiculosRutas.js.
-- Se puede ejecutar más de una vez.

create table if not exists vehiculos_facturas_confirmar (
  id bigint generated always as identity primary key,
  vehiculo_id bigint not null references vehiculos(id) on delete cascade,
  file_id text not null,                -- factura (facturas_proveedores_lineas.file_id)
  tipo text not null,                   -- gasto_vehiculo: itv, revision, reparacion, neumaticos
  fecha date,
  proveedor text,
  numero text,
  concepto text,
  base numeric,                         -- importe sin IVA (todas las líneas de la factura)
  estado text not null default 'pendiente' check (estado in ('pendiente', 'confirmada', 'descartada')),
  mantenimiento_id bigint references vehiculos_mantenimientos(id) on delete set null,
  nota text,
  creado_en timestamptz not null default now(),
  resuelto_por text,
  resuelto_en timestamptz,
  unique (file_id, vehiculo_id)
);
create index if not exists vehiculos_facturas_confirmar_veh_idx on vehiculos_facturas_confirmar (vehiculo_id, estado);
alter table vehiculos_facturas_confirmar enable row level security;
