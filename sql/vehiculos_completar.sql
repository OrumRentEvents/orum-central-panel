-- Completar una tarea de un vehículo (oct 2026): al terminar la cita de un
-- vencimiento (ITV, revisión, taller…) se apunta el resultado.
--   resultado = 'ok'      → todo bien: el vencimiento se renueva (o se cierra
--                           si no se repite)
--   resultado = 'repetir' → esta visita está terminada pero hay que volver
--                           (ITV desfavorable, otra visita al taller…):
--                           resultado_nota dice por qué y el vencimiento
--                           queda con la nueva cita (cita_nota = motivo).
alter table vehiculos_mantenimientos add column if not exists resultado text check (resultado in ('ok', 'repetir'));
alter table vehiculos_mantenimientos add column if not exists resultado_nota text;
alter table vehiculos_vencimientos add column if not exists cita_nota text;
