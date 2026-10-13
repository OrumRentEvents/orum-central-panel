-- Teléfono de contacto del cliente, para la hoja de rutas (aplicado en Supabase el 13 oct 2026).
-- Lo rellena lib/rentmanSync.js al sincronizar cada proyecto desde Rentman.
alter table proyectos add column if not exists contacto_nombre text;    -- persona de contacto del proyecto en Rentman
alter table proyectos add column if not exists contacto_telefono text;  -- su móvil (o su fijo si no tiene móvil)
alter table proyectos add column if not exists cliente_telefono text;   -- teléfono general de la ficha del cliente
