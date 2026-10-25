-- PIN de 4 cifras para entrar desde el móvil (oct 2026). Se guarda cifrado
-- (bcrypt) como la contraseña. Cada usuario tiene uno distinto: al entrar solo
-- se teclea el PIN y con él se sabe quién es (como en Rutas). La unicidad la
-- comprueba el servidor al guardarlo, porque con bcrypt no se puede poner un
-- índice único. Vacío = ese usuario no puede entrar con PIN.

alter table usuarios add column if not exists pin_hash text;
