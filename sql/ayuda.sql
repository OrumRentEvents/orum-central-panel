-- Ayuda de ORUM Central (oct 2026, lib/ayuda.js): preguntas hechas al chat
-- de la Ayuda. Sirve para ver qué no supo contestar (lo que falta en los
-- manuales de la carpeta ayuda/) y la valoración 👍/👎 de cada respuesta.
create table if not exists ayuda_preguntas (
  id          bigserial primary key,
  creado_en   timestamptz not null default now(),
  usuario     text not null,
  nombre      text,
  rol         text,
  pantalla    text,
  pregunta    text not null,
  respuesta   text,
  encontrada  boolean,          -- false = los manuales no lo explican
  valoracion  smallint check (valoracion in (-1, 1))
);
create index if not exists ayuda_preguntas_fecha on ayuda_preguntas (creado_en desc);
create index if not exists ayuda_preguntas_usuario on ayuda_preguntas (usuario, creado_en desc);
alter table ayuda_preguntas enable row level security;
