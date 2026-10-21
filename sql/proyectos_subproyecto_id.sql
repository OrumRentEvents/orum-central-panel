-- 21 oct 2026: ID del subproyecto de Rentman en cada proyecto, para que
-- Logística pueda abrir la vista de almacén de Rentman
-- (https://serviciosyalquilerparaeventossl.rentmanapp.com/#/warehouse/booking/{subproyecto_id}).
-- Lo rellena lib/rentmanSync.js (primer subproyecto, el mismo que usa para
-- estado, fechas y material). Hay que aplicarlo en Supabase ANTES de desplegar
-- ese cambio: sin la columna, el upsert de proyectos falla en todos.
alter table public.proyectos add column if not exists subproyecto_id bigint;
comment on column public.proyectos.subproyecto_id is 'ID del primer subproyecto en Rentman (enlace a la vista de almacén #/warehouse/booking/{id}). Lo escribe lib/rentmanSync.js.';
