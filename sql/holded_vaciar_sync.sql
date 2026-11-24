-- ================================================================
-- Cambio de empresa de Holded: vaciar lo que apunta a la empresa anterior
-- ================================================================
-- Usar al cambiar HOLDED_API_KEY a otra empresa (prueba nueva, nov 2026;
-- definitiva, 1 ene 2027). Los IDs de Holded guardados aquí son de la
-- empresa anterior: si no se vacían, el volcado cree que ya está todo
-- enviado o manda cobros a facturas que no existen en la nueva.
--
-- Orden: 1) HOLDED_VOLCADO_AUTO=off en Railway; 2) cambiar HOLDED_API_KEY
-- (y HOLDED_FECHA_CORTE si toca); 3) este script; 4) "Comprobar empresa
-- Holded"; 5) "Volcar ahora"; 6) quitar HOLDED_VOLCADO_AUTO.
--
-- Antes de vaciar se copia todo a tablas *_bak_<fecha> por si hiciera falta.

do $$
declare sufijo text := to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD_HH24MI');
begin
  execute format('create table holded_sync_facturas_bak_%s as table holded_sync_facturas', sufijo);
  execute format('create table holded_sync_cobros_bak_%s as table holded_sync_cobros', sufijo);
  execute format('create table holded_sync_ejecuciones_bak_%s as table holded_sync_ejecuciones', sufijo);
  execute format('create table holded_sync_compras_bak_%s as table holded_sync_compras', sufijo);
  execute format('create table holded_proveedores_bak_%s as table holded_proveedores', sufijo);
  -- (24 nov 2026) Las copias nacen sin seguridad por filas: sin esto se podían
  -- leer y modificar con la clave pública. El servidor entra con la de servicio.
  execute format('alter table holded_sync_facturas_bak_%s enable row level security', sufijo);
  execute format('alter table holded_sync_cobros_bak_%s enable row level security', sufijo);
  execute format('alter table holded_sync_ejecuciones_bak_%s enable row level security', sufijo);
  execute format('alter table holded_sync_compras_bak_%s enable row level security', sufijo);
  execute format('alter table holded_proveedores_bak_%s enable row level security', sufijo);
end $$;

-- Ventas y cobros: desde cero (se vuelven a volcar desde HOLDED_FECHA_CORTE).
truncate holded_sync_cobros, holded_sync_facturas, holded_sync_ejecuciones;

-- Gastos: las ya aceptadas vuelven a "por aprobar" en el próximo
-- "Preparar facturas nuevas" (la lectura del PDF está guardada, no se relee).
-- Las demás conservan cuenta elegida, correcciones y forma de pago.
delete from holded_sync_compras where estado = 'aprobada' or holded_purchase_id is not null;

-- Proveedores: el contacto de Holded se vuelve a buscar por NIF.
update holded_proveedores set holded_contact_id = null where holded_contact_id is not null;
