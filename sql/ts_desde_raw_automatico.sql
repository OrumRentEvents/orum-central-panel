-- Columnas *_ts calculadas por la base de datos (aplicado en Supabase el 13 oct 2026).
--
-- Las columnas *_ts (la fecha como timestamp) las rellenaba la copia de cada 15 min desde
-- la hoja de Google. Desde el 13 oct 2026 esa copia ya no toca estas tablas, y ni el servidor
-- (lib/rentmanSync.js) ni el Apps Script envían el *_ts: los pagos nuevos quedaban con
-- fecha_pago_ts a null y Caja Diaria, que filtra por esa columna, no los mostraba.
-- Ahora lo calcula la propia base de datos a partir del texto *_raw, lo escriba quien lo escriba.
--
-- Convención: la fecha/hora del texto tal cual, como si fuera UTC (la que usaba el cron).
create or replace function orum_ts_de_raw(t text) returns timestamptz
language plpgsql immutable as $$
declare m text[];
begin
  m := regexp_match(coalesce(t, ''), '^(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?');
  if m is null then return null; end if;
  return make_timestamptz(m[3]::int, m[2]::int, m[1]::int, coalesce(m[4], '0')::int, coalesce(m[5], '0')::int, 0, 'UTC');
exception when others then
  return null;
end $$;

-- Disparador genérico. Argumentos: pares (columna_raw, columna_ts).
-- Recalcula el *_ts si viene a null o si el texto *_raw ha cambiado.
create or replace function orum_rellenar_ts() returns trigger
language plpgsql as $$
declare i int; raw_nuevo text; raw_viejo text; ts_nuevo timestamptz;
begin
  for i in 0 .. (tg_nargs / 2 - 1) loop
    raw_nuevo := to_jsonb(new) ->> tg_argv[i * 2];
    ts_nuevo := (to_jsonb(new) ->> tg_argv[i * 2 + 1])::timestamptz;
    raw_viejo := case when tg_op = 'UPDATE' then to_jsonb(old) ->> tg_argv[i * 2] else null end;
    if ts_nuevo is null or (tg_op = 'UPDATE' and raw_nuevo is distinct from raw_viejo) then
      new := jsonb_populate_record(new, jsonb_build_object(tg_argv[i * 2 + 1], orum_ts_de_raw(raw_nuevo)));
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists rellenar_ts on pagos;
create trigger rellenar_ts before insert or update on pagos
  for each row execute function orum_rellenar_ts('fecha_pago_raw', 'fecha_pago_ts');
drop trigger if exists rellenar_ts on facturas;
create trigger rellenar_ts before insert or update on facturas
  for each row execute function orum_rellenar_ts('fecha_emision_raw', 'fecha_emision_ts', 'fecha_vencimiento_raw', 'fecha_vencimiento_ts');
drop trigger if exists rellenar_ts on presupuestos;
create trigger rellenar_ts before insert or update on presupuestos
  for each row execute function orum_rellenar_ts('fecha_emision_raw', 'fecha_emision_ts', 'fecha_caducidad_raw', 'fecha_caducidad_ts');
drop trigger if exists rellenar_ts on servicios;
create trigger rellenar_ts before insert or update on servicios
  for each row execute function orum_rellenar_ts('fecha_entrega_raw', 'fecha_entrega_ts');

-- Rellenar lo que ya hubiera quedado a null
update pagos set fecha_pago_ts = orum_ts_de_raw(fecha_pago_raw) where fecha_pago_ts is null and coalesce(fecha_pago_raw, '') <> '';
update facturas set fecha_emision_ts = orum_ts_de_raw(fecha_emision_raw) where fecha_emision_ts is null and coalesce(fecha_emision_raw, '') <> '';
update facturas set fecha_vencimiento_ts = orum_ts_de_raw(fecha_vencimiento_raw) where fecha_vencimiento_ts is null and coalesce(fecha_vencimiento_raw, '') <> '';
update presupuestos set fecha_emision_ts = orum_ts_de_raw(fecha_emision_raw) where fecha_emision_ts is null and coalesce(fecha_emision_raw, '') <> '';
update presupuestos set fecha_caducidad_ts = orum_ts_de_raw(fecha_caducidad_raw) where fecha_caducidad_ts is null and coalesce(fecha_caducidad_raw, '') <> '';
update servicios set fecha_entrega_ts = orum_ts_de_raw(fecha_entrega_raw) where fecha_entrega_ts is null and coalesce(fecha_entrega_raw, '') <> '';
