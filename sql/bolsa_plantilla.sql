-- Bolsa de horas (nov 2026): Sergio añade y quita gente de la plantilla. bolsa_empleados
-- guarda también a los de nómina con alguna excepción: fuera_desde con fecha = quitado
-- (conserva saldos e historial, y puede volver); sin fecha = dentro aunque nómina diga baja.
alter table bolsa_empleados add column if not exists fuera_desde date;
