-- Chat por departamento (oct 2026): un canal para Office, otro para
-- Lavandería y otro para Mantenimiento. Logística y Dirección están en los
-- tres. Los mensajes no se borran ni se editan (decisión del usuario).
create table if not exists chat_mensajes (
  id bigserial primary key,
  canal text not null check (canal in ('office', 'lavanderia', 'mantenimiento')),
  usuario text not null,
  nombre text not null,
  rol text,
  texto text,
  foto_ruta text,            -- ruta dentro del bucket chat-fotos
  creado_en timestamptz not null default now(),
  check (coalesce(texto, '') <> '' or foto_ruta is not null)
);
create index if not exists chat_mensajes_canal_id on chat_mensajes (canal, id desc);
alter table chat_mensajes enable row level security;

-- Último mensaje leído por cada usuario en cada canal (para los "sin leer").
create table if not exists chat_lecturas (
  usuario text not null,
  canal text not null,
  ultimo_id bigint not null default 0,
  actualizado_en timestamptz not null default now(),
  primary key (usuario, canal)
);
alter table chat_lecturas enable row level security;

-- Fotos del chat: bucket privado, solo el servidor las lee y las sirve.
insert into storage.buckets (id, name, public) values ('chat-fotos', 'chat-fotos', false)
on conflict (id) do nothing;
