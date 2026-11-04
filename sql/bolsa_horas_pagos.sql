-- Bolsa de horas unificada con los extras (nov 2026): las horas que Sergio cambia por
-- dinero bajan de la bolsa y crean un extra «Hora Extra». Este campo los une, para
-- devolver las horas a la bolsa si ese pago se rechaza o se borra.
alter table bolsa_movimientos add column if not exists extra_registro_id bigint;
create index if not exists bolsa_movimientos_extra on bolsa_movimientos (extra_registro_id) where extra_registro_id is not null;
