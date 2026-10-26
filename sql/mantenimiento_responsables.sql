-- Mantenimiento (oct 2026): segunda casilla por salida. "revisado" sigue
-- siendo la de Mantenimiento (Leo / Nourdin); "resp_*" es la de los
-- responsables de Logística que verifican el material. La fila se borra solo
-- cuando las dos quedan sin marcar.

alter table mantenimiento_checks add column if not exists resp_revisado boolean not null default false;
alter table mantenimiento_checks add column if not exists resp_por text;
alter table mantenimiento_checks add column if not exists resp_ts timestamptz;
