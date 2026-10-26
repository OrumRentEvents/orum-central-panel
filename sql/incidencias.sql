-- Incidencias (oct 2026). Acordado con el usuario:
-- · Crean: Dirección, Contabilidad, Logística y Comercial (las tablets no).
-- · Ven: cada uno las que creó y las que tiene asignadas; Dirección, todas.
-- · Cierran (Resuelta): el responsable o Dirección, con una nota de solución.
-- · Estados: abierta → en_curso → resuelta (se puede reabrir).
-- · Fotos, proyecto o vehículo opcionales. Sin email por ahora.
-- · Nada se borra: los comentarios y cambios quedan en incidencias_seguimiento.
-- API en lib/incidencias.js; pantalla en public/incidencias.html.
create table if not exists incidencias (
  id bigserial primary key,
  texto text not null,
  tipo text not null default 'otro' check (tipo in ('material', 'vehiculo', 'cliente', 'almacen', 'personal', 'facturacion', 'fianza', 'otro')),
  prioridad text not null default 'normal' check (prioridad in ('normal', 'urgente')),
  estado text not null default 'abierta' check (estado in ('abierta', 'en_curso', 'resuelta')),
  proyecto_id bigint,                   -- = proyectos.id (Rentman)
  proyecto_numero integer,              -- copia para enseñarlo sin buscar
  vehiculo_id bigint references vehiculos(id),
  responsable text,                     -- usuarios.usuario (null = sin asignar)
  creado_por text not null,             -- usuarios.usuario
  creado_por_nombre text,
  origen text,                          -- app, panel, rutas, preparacion, mantenimiento, vehiculo
  solucion text,                        -- nota al marcarla resuelta
  resuelta_por text,
  resuelta_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index if not exists incidencias_estado on incidencias (estado, creado_en desc);
create index if not exists incidencias_responsable on incidencias (responsable);
create index if not exists incidencias_creado_por on incidencias (creado_por);
create index if not exists incidencias_vehiculo on incidencias (vehiculo_id);
alter table incidencias enable row level security;

-- Historial de cada incidencia: comentarios y cambios (estado, responsable).
create table if not exists incidencias_seguimiento (
  id bigserial primary key,
  incidencia_id bigint not null references incidencias(id),
  tipo text not null check (tipo in ('creada', 'comentario', 'estado', 'responsable')),
  texto text,
  usuario text not null,
  nombre text,
  creado_en timestamptz not null default now()
);
create index if not exists incidencias_seguimiento_inc on incidencias_seguimiento (incidencia_id, id);
alter table incidencias_seguimiento enable row level security;

-- Fotos: al crearla (seguimiento_id null) o con un comentario.
create table if not exists incidencias_fotos (
  id bigserial primary key,
  incidencia_id bigint not null references incidencias(id),
  seguimiento_id bigint references incidencias_seguimiento(id),
  ruta text not null,                   -- ruta dentro del bucket incidencias-fotos
  usuario text not null,
  creado_en timestamptz not null default now()
);
create index if not exists incidencias_fotos_inc on incidencias_fotos (incidencia_id);
alter table incidencias_fotos enable row level security;

-- Bucket privado: solo el servidor lee las fotos y las sirve con enlace temporal.
insert into storage.buckets (id, name, public) values ('incidencias-fotos', 'incidencias-fotos', false)
on conflict (id) do nothing;
