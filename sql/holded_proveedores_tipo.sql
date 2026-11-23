-- 23 nov 2026: proveedor (400, «supplier» en Holded) o acreedor (410, «creditor»)
-- elegido en la ficha del proveedor de Financiero → Holded. Vacío = proveedor.
alter table holded_proveedores add column if not exists tipo_contacto text
  check (tipo_contacto in ('proveedor', 'acreedor'));
