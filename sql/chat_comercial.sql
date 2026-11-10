-- Chat Comercial (nov 2026): comerciales + responsables de Logística (y Dirección).
-- Solo amplía los canales permitidos en chat_mensajes.
alter table chat_mensajes drop constraint if exists chat_mensajes_canal_check;
alter table chat_mensajes add constraint chat_mensajes_canal_check
  check (canal in ('office', 'lavanderia', 'mantenimiento', 'comercial'));
