-- App móvil de ORUM Central (oct 2026): dispositivos recordados.
-- Al entrar con el PIN, el móvil o la tablet guarda una llave larga y
-- aleatoria; con ella vuelve a entrar solo (las sesiones del servidor viven
-- en memoria y se pierden en cada despliegue). Aquí solo se guarda su huella
-- SHA-256, nunca la llave. Se borran al cambiar o quitar el PIN de esa
-- persona, al borrar el usuario o al pulsar "Salir" en ese dispositivo, y
-- caducan tras 180 días sin usarse.

create table if not exists movil_dispositivos (
  token_hash   text primary key,
  usuario      text not null references usuarios(usuario) on update cascade on delete cascade,
  descripcion  text,
  creado_en    timestamptz not null default now(),
  ultimo_uso   timestamptz not null default now()
);
create index if not exists movil_dispositivos_usuario on movil_dispositivos (usuario);
alter table movil_dispositivos enable row level security;
