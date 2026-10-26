-- Baja manual (oct 2026): mes (AAAAMM) en que se marcó "Baja" en
-- Personal → Configuración. Mientras el trabajador no tenga una nómina de un
-- mes POSTERIOR, cuenta como baja (sale de la lista de Registrar extras) aunque
-- tenga nómina en el último mes subido. Con una nómina nueva vuelve solo.
alter table empleados_departamento add column if not exists baja_desde integer;
