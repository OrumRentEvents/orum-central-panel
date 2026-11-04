-- Bolsa de horas (nov 2026): saldo de vacaciones pendientes y hoja de ajuste de saldos
-- de Sergio. Los ajustes son movimientos normales, con motivo 'ajuste', para que el
-- historial explique cada número. tipo 'vacaciones' = días de vacaciones asignados.
alter table bolsa_movimientos drop constraint if exists bolsa_movimientos_tipo_check;
alter table bolsa_movimientos add constraint bolsa_movimientos_tipo_check check (tipo in ('horas', 'festivo', 'descanso', 'vacaciones'));
alter table bolsa_movimientos drop constraint if exists bolsa_movimientos_motivo_check;
alter table bolsa_movimientos add constraint bolsa_movimientos_motivo_check check (motivo in ('compensadas', 'pagadas', 'ajuste'));
