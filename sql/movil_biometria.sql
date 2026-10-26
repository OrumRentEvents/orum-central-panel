-- App móvil (oct 2026): entrar con Face ID o huella (WebAuthn / llaves de
-- acceso). La cara o la huella nunca salen del móvil: el móvil firma un reto
-- con una llave privada que no sale de él y aquí solo se guarda la llave
-- pública (SPKI) para comprobar la firma. Una fila por móvil activado.
-- Se borran al cambiar o quitar el PIN de esa persona, al borrar el usuario o
-- al desactivarlo en ese móvil.

create table if not exists movil_credenciales (
  id           text primary key,          -- id de la credencial (base64url)
  usuario      text not null references usuarios(usuario) on update cascade on delete cascade,
  public_key   text not null,             -- SPKI DER en base64url
  alg          integer not null,          -- -7 (ES256) o -257 (RS256)
  descripcion  text,
  creado_en    timestamptz not null default now(),
  ultimo_uso   timestamptz
);
create index if not exists movil_credenciales_usuario on movil_credenciales (usuario);
alter table movil_credenciales enable row level security;
