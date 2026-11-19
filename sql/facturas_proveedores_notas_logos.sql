-- Facturas de proveedores (19 nov 2026): notas por factura, «no es duplicada» y
-- web de cada proveedor (para su logo en el panel). Se puede ejecutar más de una vez.

alter table facturas_proveedores_lineas add column if not exists notas text;
-- Marcada a mano como «no es duplicada» (p. ej. dos peajes del mismo día y del mismo importe)
alter table facturas_proveedores_lineas add column if not exists no_duplicada boolean not null default false;

-- Web del proveedor (dominio, p. ej. euromaster.es): el panel muestra su logo.
-- La IA la lee de la factura al subirla; también se puede poner a mano en la ficha.
create table if not exists proveedores_web (
  proveedor text primary key,
  dominio text not null,
  actualizado_en timestamptz not null default now()
);
alter table proveedores_web enable row level security;
alter table facturas_proveedores add column if not exists emisor_web text;
