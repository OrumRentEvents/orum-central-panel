-- Accesos directos de cada usuario (oct 2026): { "escritorio": [ids del menú],
-- "movil": [ids de botones de la app] }, en el orden que los ha puesto. Null o
-- sin la clave = lo de siempre (escritorio sin accesos; móvil, los botones de
-- su rol). Se guarda en el usuario para que le sigan en cualquier dispositivo.

alter table usuarios add column if not exists accesos jsonb;
