-- Chat (nov 2026): «✓ Visto» en un mensaje, para dejar claro que se ha recibido.
-- Uno por persona y mensaje; se puede quitar. Se borra con el mensaje.
create table if not exists chat_vistos (
  mensaje_id bigint not null references chat_mensajes(id) on delete cascade,
  usuario text not null,
  nombre text not null,
  creado_en timestamptz not null default now(),
  primary key (mensaje_id, usuario)
);
alter table chat_vistos enable row level security;
