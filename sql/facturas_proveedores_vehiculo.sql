-- Facturas de proveedores · gastos de vehículo (19 nov 2026)
-- Tipo de gasto del vehículo (combustible, AdBlue, neumáticos…) y litros, por
-- línea de factura. La matrícula ya estaba (columna matricula). Con esto la
-- ficha de cada vehículo (Vehículos → ficha → Gastos) suma sus facturas.
-- Solo añade columnas: se puede ejecutar más de una vez.

alter table facturas_proveedores_lineas add column if not exists gasto_vehiculo text;
alter table facturas_proveedores_lineas add column if not exists litros numeric;

-- La IA lo lee al subir la factura; se guarda también en la lectura.
alter table facturas_proveedores add column if not exists gasto_vehiculo text;
alter table facturas_proveedores add column if not exists litros numeric;

create index if not exists facturas_proveedores_lineas_matricula_idx on facturas_proveedores_lineas (matricula);
