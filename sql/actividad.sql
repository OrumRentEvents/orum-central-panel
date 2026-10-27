-- Control de accesos e histórico de actividad (oct 2026, lib/actividad.js).
-- Qué hace cada usuario en ORUM Central: entradas, pantallas y fichas que
-- abre, cambios y descargas. Nunca se guardan contraseñas, PIN ni el
-- contenido de los formularios. El detalle se borra a los 12 meses; el
-- resumen diario se queda.
create table if not exists actividad (
  id         bigserial primary key,
  creado_en  timestamptz not null default now(),
  usuario    text,            -- null en un intento de entrada sin usuario (PIN incorrecto)
  nombre     text,
  rol        text,
  tipo       text not null check (tipo in ('entrada', 'entrada_fallida', 'salida', 'pantalla', 'ficha', 'cambio', 'descarga')),
  accion     text not null,   -- en lenguaje normal: "Subió una factura", "Abrió Caja"
  objeto     text,            -- proyecto, factura, etc.: "proyecto 2518"
  ruta       text,
  metodo     text,
  estado     int,             -- código HTTP: 4xx/5xx = dio error
  app        text,            -- panel, móvil o tablet
  dispositivo text,           -- "iPhone · Safari"
  ip         text
);
create index if not exists actividad_usuario_fecha on actividad (usuario, creado_en desc);
create index if not exists actividad_fecha on actividad (creado_en desc);
create index if not exists actividad_objeto on actividad (objeto) where objeto is not null;
alter table actividad enable row level security;

-- Resumen por usuario y día (se calcula cada noche y no se borra)
create table if not exists actividad_resumen (
  usuario    text not null,
  dia        date not null,
  entradas   int not null default 0,
  pantallas  int not null default 0,
  fichas     int not null default 0,
  cambios    int not null default 0,
  descargas  int not null default 0,
  errores    int not null default 0,
  minutos    int not null default 0,   -- tiempo de uso aproximado
  primera    timestamptz,
  ultima     timestamptz,
  primary key (usuario, dia)
);
alter table actividad_resumen enable row level security;

-- Alertas: entrada a deshora, dispositivo nuevo, PIN fallidos, muchas descargas
create table if not exists actividad_alertas (
  id           bigserial primary key,
  creado_en    timestamptz not null default now(),
  usuario      text,
  tipo         text not null,
  texto        text not null,
  revisada_en  timestamptz,
  revisada_por text
);
create index if not exists actividad_alertas_fecha on actividad_alertas (creado_en desc);
alter table actividad_alertas enable row level security;

-- Desactivar un usuario sin borrarlo (no puede entrar; su historial se queda)
-- y fecha en que leyó el aviso de que su actividad se registra.
alter table usuarios add column if not exists activo boolean not null default true;
alter table usuarios add column if not exists aviso_actividad_visto timestamptz;

-- Usuarios de solo consulta (oct 2026, p. ej. José Márquez): ven lo mismo
-- que su rol pero el servidor les rechaza cualquier cambio y no ven
-- Configuración. Lo aplica lib/actividad.js.
alter table usuarios add column if not exists solo_lectura boolean not null default false;
