-- PDFs (o fotos) de facturas de proveedores en Supabase Storage (oct 2026).
-- Se suben desde ORUM Central ("Subir facturas"); los que estaban en la
-- carpeta de Google Drive se copian una vez. Bucket privado: solo el servidor
-- (service key) lee y escribe; el panel abre cada archivo con un enlace
-- firmado de un minuto.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facturas-proveedores', 'facturas-proveedores', false, 26214400,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Dónde está el archivo de cada factura (file_id = el de facturas_proveedores
-- y facturas_proveedores_lineas: el id de Drive en las antiguas, "SUP_…" en
-- las subidas desde el panel).
create table if not exists facturas_proveedores_archivos (
  file_id        text primary key,
  ruta           text not null,          -- ruta dentro del bucket
  nombre_archivo text,
  mime           text not null default 'application/pdf',
  tamano         integer,
  origen         text not null default 'panel' check (origen in ('panel', 'drive')),
  subido_por     text,
  subido_en      timestamptz not null default now()
);
alter table facturas_proveedores_archivos enable row level security;
