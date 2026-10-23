-- Paradas por subproyecto (23 oct 2026). Aplicado en Supabase el mismo día.
-- Un proyecto cuyos grupos de material tienen fechas distintas (p. ej. un subproyecto "EXTRA"
-- que se entrega otro día) tiene una parada por fecha; esta columna dice qué subproyectos
-- van en cada una. Vacía en los proyectos con una sola entrega/recogida.
alter table public.rutas_paradas add column if not exists subproyectos text;
comment on column public.rutas_paradas.subproyectos is 'Subproyectos de Rentman que van en esta parada; solo cuando el proyecto tiene varias fechas de entrega/recogida (lib/rentmanSync.js)';

-- Material de cada parada (23 oct 2026): en esos proyectos, solo las líneas cuyo grupo de
-- material se entrega/recoge ese día. Null = Rutas enseña el material de todo el proyecto.
alter table public.rutas_paradas add column if not exists material jsonb;
comment on column public.rutas_paradas.material is 'Material de esta parada [{familia,articulo,cantidad}]; solo cuando el proyecto tiene varias fechas de entrega/recogida. Null = el de todo el proyecto (lib/rentmanSync.js)';
