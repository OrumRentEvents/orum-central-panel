-- Avisos del chat (oct 2026): notificaciones push aunque la app esté
-- cerrada. Cada dispositivo (móvil, tablet u ordenador) que pulsa
-- "Activar avisos" deja aquí su suscripción del navegador y los canales de
-- los que quiere aviso. Se borra al desactivarlos, cuando el navegador la da
-- por caducada (el servidor recibe 404/410) o al borrar el usuario.

create table if not exists chat_suscripciones (
  endpoint       text primary key,
  usuario        text not null references usuarios(usuario) on update cascade on delete cascade,
  p256dh         text not null,
  auth           text not null,
  canales        text[] not null default '{}',
  descripcion    text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists chat_suscripciones_usuario on chat_suscripciones (usuario);
alter table chat_suscripciones enable row level security;
