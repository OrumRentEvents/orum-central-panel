-- Módulo Vehículos — cita pedida (taller / ITV) por vencimiento.
-- Solo añade columnas. Se puede ejecutar más de una vez.
alter table vehiculos_vencimientos add column if not exists cita_pedida boolean not null default false;
alter table vehiculos_vencimientos add column if not exists cita_fecha date;
alter table vehiculos_vencimientos add column if not exists cita_lugar text;
