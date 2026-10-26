-- Informe semanal de ventas (No Confirmados / Resto) — lib/informeSemanalProyectos.js
-- Ejecutar una sola vez en el SQL Editor de Supabase.
--
-- Cada informe se genera una vez desde el panel y su PDF queda guardado tal
-- cual en el bucket privado "informes-semanales": las cifras del PDF son las
-- del día en que se generó, aunque luego cambie algo en Rentman.
create table if not exists informes_semanales (
  lunes        date primary key,           -- lunes de la semana informada
  semana       int  not null,              -- semana ISO
  ruta         text not null,              -- ruta del PDF en el bucket
  resumen      jsonb not null,             -- nº de proyectos y totales de cada bloque
  generado_por text,
  generado_en  timestamptz not null default now()
);
alter table informes_semanales enable row level security;

insert into storage.buckets (id, name, public) values ('informes-semanales', 'informes-semanales', false)
on conflict (id) do nothing;
