-- Estadísticas de material calculadas al momento desde Supabase (oct 2026).
-- Antes las mantenía el Apps Script "ORUM CENTRAL" sumando y restando
-- contadores (hojas ESTADISTICAS_* → tablas estadisticas_material/_pnc) cada
-- vez que procesaba un proyecto. Se descuadraban: el 25/10/2026 el detalle
-- tenía 90 proyectos que ya no debían contar (82 vueltos a Pending/Concept y
-- 8 cancelados, ~58.000 €). Esta vista aplica la misma regla siempre sobre los
-- datos actuales: proyectos confirmados (no cancelados ni Pending/Concept/
-- Inquiry) con fecha de entrega; cada línea de material cuenta una vez, con
-- importe = cantidad × precio redondeado a céntimos. Los proyectos borrados
-- en Rentman siguen contando (la sincronización no los borra de Supabase).
-- security_invoker: respeta el RLS de las tablas de origen.

create or replace view estadisticas_material_calc with (security_invoker = true) as
select
  coalesce(p.es_abrebotellas, false)                                        as es_pnc,
  e.articulo,
  max(e.familia)                                                            as familia,
  count(*)::int                                                             as veces_alquilado,
  sum(coalesce(e.cantidad, 0))                                              as unidades_totales,
  sum(round(coalesce(e.cantidad, 0) * coalesce(e.precio_unit, 0), 2))      as importe_total
from equipment e
join proyectos p on p.id = e.proyecto_id
where not coalesce(p.cancelado, false)
  and lower(coalesce(p.estado, '')) not in ('pending', 'concept', 'inquiry')
  and p.entrega_fecha_raw ~ '^\d{2}/\d{2}/\d{4}'
group by 1, 2;
