-- Vehículos: conductor habitual (16 nov 2026).
-- Para vehículos que no van por Rutas (Mercedes comercial → "Equipo comercial"):
-- los días con movimiento en el localizador y nadie apuntado en Rutas se asignan
-- a este nombre en Uso, en vez de "sin conductor". No cuenta para el ranking.
-- Si un día sí aparece en Rutas (p. ej. una entrega), manda Rutas.
alter table vehiculos add column if not exists conductor_habitual text;

update vehiculos set conductor_habitual = 'Equipo comercial'
where matricula = '1663HNF' and conductor_habitual is null;
