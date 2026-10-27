# Sistema: usuarios, accesos y actividad

Esta parte solo la ve Sergio. Explica cómo se gestionan los usuarios, los accesos y el histórico de actividad.

## Usuarios (Configuración → Usuarios)

Aquí se da de alta a cada persona y se le pone su rol, su contraseña y su PIN.

### Dar de alta a alguien

1. En «Nuevo usuario» escribe el usuario (sin espacios), nombre y apellido, el rol, la contraseña (mínimo 6 caracteres) y, si va a usar la app móvil, un PIN de 4 cifras.
2. Si es comercial, en **Filtro comercial** pon su nombre tal como sale en Rentman: solo verá sus proyectos.
3. Pulsa «Crear».

### Cambiar algo

- **Contraseña o PIN:** escribe el nuevo y pulsa «Guardar». Al cambiar o quitar un PIN, los móviles que lo tenían recordado tendrán que volver a teclearlo.
- **Usuario de acceso:** se puede cambiar; esa persona tendrá que entrar con el nuevo.
- **Borrar:** quita el acceso. Si solo quieres que deje de entrar sin perder nada, mejor desactívalo (ver abajo).
- Cada PIN tiene que ser distinto, porque al entrar con PIN el sistema reconoce a la persona solo por él.

| Rol | Para quién |
| --- | --- |
| Dirección | Gerencia |
| Contabilidad | Administración |
| Logística | Responsables de logística y almacén |
| Comercial | Comerciales |
| Tablet Lavandería / Tablet Office | La tablet de cada departamento (solo app) |
| Mantenimiento | Equipo de mantenimiento (solo app) |

## Actividad y accesos (Configuración → Actividad y accesos)

### Pestañas

| Pestaña | Para qué sirve |
| --- | --- |
| Resumen | Por persona: último acceso y desde qué dispositivo, días activo, tiempo de uso aproximado, entradas, pantallas, fichas, cambios, descargas, errores y lo que más usa. Pulsa una persona para ver su línea de tiempo |
| Línea de tiempo | Todo lo que ha pasado, filtrable por persona, tipo (entradas, pantallas, fichas, cambios, descargas) y fechas |
| Por proyecto | Quién ha abierto o tocado un proyecto, una factura, una incidencia o un usuario |
| Alertas | Avisos de accesos raros, con «Marcar revisada» y «Ver su actividad» |
| Accesos | Usuarios (activo, solo consulta), dispositivos recordados y sesiones abiertas |
| Permisos | Qué ve cada rol en el menú |

### Qué se registra

- **Entradas** (con contraseña, PIN, dispositivo recordado o Face ID), intentos fallidos y salidas.
- **Pantallas** que se abren y **fichas** (un proyecto, una factura, una incidencia, un trabajador).
- **Cambios:** cada cosa que se guarda, en lenguaje normal y sobre qué proyecto o factura. También los intentos bloqueados de los usuarios de solo consulta.
- **Descargas** de archivos (PDF, fotos, Excel).
- Desde qué dispositivo, si fue panel, móvil o tablet, y la IP.
- No se guardan contraseñas, PIN ni el contenido de lo que se escribe.
- El detalle se guarda 12 meses; el resumen de cada día se queda siempre.

### Alertas

Salta una alerta (y un aviso al móvil de Dirección, si tiene activados los avisos en app → Avisos) cuando:

- alguien entra entre las 22:00 y las 7:00;
- alguien entra desde un dispositivo que no había usado en 90 días;
- hay 3 o más intentos de entrada fallidos en 15 minutos;
- alguien abre o descarga 15 archivos o más en 10 minutos.

### Control de accesos

- **Desactivar a alguien:** quita la marca «Activo». No podrá entrar de ninguna forma, se le cierran las sesiones abiertas y se olvidan sus dispositivos. Su historial se conserva. Para volver a dejarle entrar, marca otra vez «Activo».
- **Solo consulta:** marca la casilla. Ve lo mismo que su rol pero sin Configuración, y el servidor rechaza cualquier cambio que intente. José Márquez está así.
- **Olvidar un dispositivo:** útil si alguien pierde el móvil; tendrá que volver a teclear su PIN.
- **Cerrar una sesión:** saca a esa persona en ese dispositivo.
- Las sesiones abiertas se pierden al publicar una versión nueva de ORUM Central.

## Chat

Puedes eliminar cualquier mensaje del chat con el enlace «Eliminar» que sale junto a la hora: desaparece para todos al momento, con su foto. Nadie más ve esa opción.

## Estado Sincronización

Configuración → Estado Sincronización (se abre en otra pestaña) muestra cuántos registros hay de cada tipo y cuándo se sincronizó cada tabla por última vez. Es lo primero que hay que mirar cuando alguien dice que un dato de Rentman no aparece.
