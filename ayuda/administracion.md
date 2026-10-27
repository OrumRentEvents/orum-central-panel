# Manual de Administración

Administración trabaja en ORUM Central, Rentman, Caja y Holded. Rentman es el origen de proyectos, facturas de venta y cobros; ORUM Central es donde se revisa, se aprueba y se cierra; Holded es la contabilidad y todo lo que llega allí pasa antes por una aprobación en ORUM Central.

Con el rol Contabilidad ves el menú Financiero y Personal (incluidas las pantallas Holded, Cuentas de gasto, Registrar extras y Aprobar y pagar extras), Material recuperado e Incidencias. La Caja se abre desde Financiero → Caja, en otra pestaña.

## Rutina de trabajo

| Cuándo | Qué hace el sistema solo | Qué haces tú | Dónde |
| --- | --- | --- | --- |
| Al recibir una factura de proveedor | Lee la factura en cuanto se sube | Subirla, poner la forma de pago y, si es de un vehículo, la matrícula | Financiero → Facturas Proveedores, o la app móvil → Subir factura |
| Cada día, 6:00 | Vuelca a Holded las facturas de venta y cobros del día anterior | Revisar las listas de bloqueadas y descuadres | Financiero → Holded |
| Cada día, 7:00 | Prepara las facturas de gasto pagadas para aprobar | Aprobar cada una en «Por aprobar» (María) | Financiero → Holded |
| Cada día | — | Clasificar en Caja el método de cada cobro de Rentman | Caja → Caja Diaria |
| Cada día | — | Gestionar las solicitudes de devolución de fianza | Caja → Fianzas |
| Cuando Logística confirma material recuperado | — | Quitar el cargo del cliente en Rentman | Material recuperado + Rentman |
| Viernes, 8:00 | Envía el email de fianzas pendientes autorizadas | Hacer las devoluciones de fianza de la semana | Correo + Caja → Fianzas |
| Cada semana | — | Repasar vencidas, Control de pagos y Auditoría | Financiero |
| Fin de mes | — | Revisar el cierre del mes | Financiero → Cierre Mensual |

Los procesos automáticos también se pueden lanzar a mano con sus botones («Volcar ahora», «Preparar facturas nuevas ahora») si hace falta antes.

## Facturas de proveedores

Toda factura de gasto entra en ORUM Central subiéndola desde el panel o desde el móvil. Ya no se usa la carpeta de Drive. **Todas las facturas de gasto pasan por María**, que las revisa y las acepta en Holded.

### Paso a paso

1. **Subir la factura.**
    - En el ordenador: Financiero → Facturas Proveedores → «⬆️ Subir facturas». Arrastra uno o varios archivos (PDF, JPG, PNG o WebP) o haz clic para elegirlos.
    - En el móvil: app → «Subir factura». Puedes hacer una foto a la factura en papel o elegir un PDF.
    - El proveedor se puede elegir de la lista o dejar en «Detectar automáticamente»: el sistema lo reconoce por el NIF de la factura.
2. **Lectura automática.** Al subirla, el sistema lee proveedor, NIF, número, fecha, base, IVA, retención y total. Tarda unos segundos por factura.
3. **Completar la factura.** Justo después de leerla te pide:
    - **Forma de pago** (Transferencia, Tarjeta, Domiciliación, Efectivo u Otro). Si la dejas vacía, la factura queda como **pendiente de pago** y no se prepara para Holded hasta que se ponga.
    - **Matrícula**, si el gasto es de un vehículo (taller, neumáticos, ITV…). Si la factura trae la matrícula, sale ya propuesta.
4. **Revisar las lecturas dudosas.** En el Listado, la tarjeta «A revisar (confianza media/baja)» reúne las lecturas que el sistema no tiene claras. Ábrelas con el icono de factura escaneada, compáralas con el documento y corrige con el lápiz lo que haga falta. «Ver errores» lista los archivos que no se pudieron leer.
5. **Aprobar en Holded (María).** Cada mañana a las 7:00 las facturas pagadas pasan a Financiero → Holded → «Por aprobar». Para cada una: abre el PDF, comprueba base, IVA y total, revisa la cuenta de gasto propuesta, elige «Pagada el» y la tesorería, y pulsa «Aceptar». La factura entra en Holded aprobada, pagada y con el PDF adjunto.

- **Factura que ya estaba sin archivo:** si subes una factura que ya existe pero no tenía documento, el archivo se le adjunta en lugar de crear una duplicada.
- **Abonos de proveedor:** siguen el mismo camino que una factura.
- **Borrar una factura** (botón 🗑️): solo Dirección, y solo si todavía no está en Holded.
- **Pendientes de pago:** las que no tienen forma de pago esperan en Holded → «Pendiente de asignar pago», donde también se puede elegir.

### Configuración de facturas

| Pantalla | Para qué sirve | Quién la usa |
| --- | --- | --- |
| Configuración → Facturas Proveedores | Reparto del gasto de cada proveedor por departamento (y matrícula en vehículos). Solo sirve para el Cierre Mensual, no para la contabilidad | Gerencia |
| Configuración → Cuentas de gasto | Plan de cuentas del grupo 6 y, por proveedor, su cuenta habitual, IVA 0 % y retención | Gerencia y Administración |

Si un proveedor no tiene cuenta habitual, se elige en cada factura; marcando «usar siempre» queda guardada para las siguientes. Una cuenta nueva tiene que existir también en Holded con el mismo número, o «Aceptar» dará error.

## Pagos anuales

Los pagos anuales (seguros, IBI, IAE, tasas y similares) se gestionan siempre en Configuración → Pagos Anuales y **nunca como factura de proveedor**. Si se subiera también su factura, el Cierre Mensual los contaría dos veces.

1. **Alta:** concepto, categoría, importe anual y periodo (mes de inicio y mes de fin; puede pasar de un año a otro, por ejemplo IAE de abril 2026 a marzo 2027). El cierre reparte el importe en doceavas partes entre esos meses.
2. **Verificar:** marca la casilla cuando hayas comprobado importe y periodo contra el recibo; queda apuntado quién y cuándo.
3. **Cambio de cuota a mitad de año:** usa el botón «Cambia desde…». Cierra la partida el mes anterior y crea otra con el importe nuevo, así los meses ya cerrados no cambian. No edites el importe de la partida antigua.

## Cobros de clientes

Los cobros se apuntan en Rentman y su método real se clasifica en Caja; ORUM Central cruza las dos cosas y avisa de lo que no encaja. **Un cobro sin clasificar en Caja no llega a Holded.**

| Pantalla | Qué muestra | Qué revisar |
| --- | --- | --- |
| Control de pagos | Cada factura con cobrado, pendiente, forma de pago real (de Caja) y si cuadra | «No cuadra»: lo cobrado en Caja no coincide con Rentman. «Sin registro»: hay pago en Rentman sin clasificar en Caja |
| Vencidas y morosidad | Facturas vencidas sin cobrar, total vencido y mayor retraso | Reclamar empezando por las de más retraso e importe |
| Extracto de Cliente | Todas las facturas de un cliente con sus cobros por fecha | Para contestar a un cliente o preparar una reclamación |
| Auditoría / Alertas | Facturas pagadas sin registro en Caja, PNC que no cuadran y proyectos pendientes de facturar | Repaso semanal |

- El número de factura o de proyecto abre su ficha en Rentman.
- **PNC** = proyectos no confirmados: cobros sin factura (por ejemplo, abrebotellas) que se registran en Caja.
- **Reglas que no cambian:** las facturas de venta las emiten los comerciales o María; las rectificativas solo María. Una factura de Rentman no se modifica después de volcarla a Holded: si hay que corregirla, se hace con una rectificativa.

## Caja

Caja es la aplicación donde se clasifica cada cobro y se controla el efectivo de Marbella y Monda. Se abre desde Financiero → Caja.

### Quién hace qué en Caja

| Persona | Qué puede hacer |
| --- | --- |
| Sergio | Todo |
| María | Todo, salvo confirmar a Contabilidad el efectivo recibido y ejecutar devoluciones de fianza por transferencia |
| Ana e Isabel | Marcar como «Recibido» el efectivo oficial y los cobros PNC, marcar hechas las devoluciones por transferencia; Caja Diaria en solo lectura |
| Comerciales (Danilo, Lucas) | Registrar cobros PNC, ver efectivo y TPV en Caja Diaria y pedir devoluciones de fianza |

### Clasificar un cobro (Caja Diaria)

1. Pulsa «Cargar cobros» para traer los pagos de Rentman del periodo. Los que aún no tienen método salen como «sin asignar».
2. Asigna a cada cobro su método real: Transferencia, TPV Marbella, TPV Monda, Efectivo Marbella, Efectivo Monda, Factura 0, Rectificativa o una de las variantes de fianza.
3. Un pago partido (por ejemplo, mitad transferencia y mitad TPV) se reparte entre métodos.

- **Factura 0:** la factura que se emitió y estaba mal. **Rectificativa:** la que la corrige. Entre las dos se compensan y no se mueve dinero.
- **Devolución real de dinero:** se apunta con su método real e importe negativo.

### Efectivo y cierres de caja

- Cada caja (Marbella, Monda) muestra su **último cierre** y el **efectivo pendiente de entregar**.
- Cuando el efectivo llega a la oficina, Ana o Isabel lo marcan como «Recibido». Una vez recibido ya no se puede cambiar (salvo Sergio).
- El control del efectivo oficial empezó el 26/10/2026.

### Cobros PNC (sin factura)

1. Quien cobra (comercial o María) lo registra en Caja con «+ Registrar cobro».
2. Ana o Isabel lo marcan como «Recibido» cuando llega el dinero.
3. Solo Sergio puede anular un cobro PNC o retirar los ya confirmados (pasan a «📦 Entregados»).

## Fianzas

La fianza cobrada sale de Rentman (importe, estado y forma de cobro de la fianza). Las devoluciones se piden, se autorizan y se confirman en Caja → Fianzas.

- **Cobro:** todas las fianzas se cobran por transferencia o TPV. Cobrarla en efectivo tiene que estar autorizado por Gerencia.
- **Los comerciales nunca devuelven una fianza directamente:** siempre se pide por Caja.

### Paso a paso de una devolución

1. **Solicitar.** El comercial del evento (o María, o Sergio) busca la fianza en «Fianzas por devolver», indica el importe a devolver, el método de devolución y una nota con el motivo. Solo puede haber una solicitud pendiente por proyecto.
2. **Retener toda la fianza:** se pide igual, con importe 0 € y el motivo obligatorio en la nota.
3. **Autorizar.** María o Sergio revisan la solicitud y la autorizan. Sin autorización no se devuelve ni sale en el email del viernes.
4. **Devolver.**
    - Por **transferencia:** Ana o Isabel, los viernes, hacen la transferencia y la confirman con el número de operación y una nota.
    - En **efectivo o TPV:** la hace María o el comercial.
5. **Cerrar (María).** Cuando la devolución está hecha, María la marca como devuelta en Rentman desde Caja → Fianzas (el botón escribe directamente en Rentman) y envía al cliente el justificante.
6. **Email de los viernes (8:00):** Ana y María reciben el resumen de solicitudes autorizadas pendientes.

### Avisos de la pantalla de fianzas

- **Pide más que la fianza:** revisar el importe con quien lo solicitó.
- **En Rentman ya figura como devuelta:** comprobar si se pagó y, si es así, cerrar la solicitud.
- **En Rentman ya no figura como fianza cobrada:** el proyecto cambió o se borró; consultar antes de devolver.

Una solicitud hecha por error se puede deshacer: queda cancelada y no sale en el siguiente email.

## Material recuperado

Cuando un cliente pierde material, Rentman le cobra un coste «ARTÍCULO NO DEVUELTO». Si después el material aparece:

1. Logística lo marca como recuperado en Rentman y lo confirma en ORUM Central (Material recuperado), indicando proyecto y cantidad.
2. Aparece en la lista **«Cargos por quitar»** de Material recuperado (el número junto al menú avisa).
3. **María (o Sergio) quita ese cargo del proyecto en Rentman.**
4. ORUM Central lo cierra solo al ver que el cargo ha desaparecido o ha bajado.

## Extras del personal

Para Administración, los extras son informativos: se consultan, pero no se aprueban ni se pagan desde aquí. Sirven para saber qué extras tiene cada trabajador y cuánto cuestan en el Cierre Mensual.

1. **Registrar:** los responsables de cada área apuntan en Registrar extras el trabajador (o su nombre, si es eventual), la fecha, el tipo, la cantidad y el proyecto o una nota.
2. **Aprobar o rechazar:** Dirección, en Personal → Aprobar y pagar extras.
3. **Pagar:** lo aprobado se abona en nómina y se marca como pagado.

| Tipo | Importe | Días de descanso |
| --- | --- | --- |
| Hora extra | 8 €/h (admite horas negativas) | — |
| Domingo, festivo, nocturno, sábado tarde | 50 € | +1 |
| Descanso disfrutado | — | −1 |
| Plus / Descuento | Importe libre | — |

Solo lo aprobado o pagado cuenta como coste. Los precios se cambian indicando desde qué fecha rigen; los meses anteriores no se recalculan.

## Holded: listas que revisar

En Financiero → Holded la parte de ventas se vuelca sola cada día. Las listas con número mayor que cero piden atención:

| Lista | Qué significa | Qué hacer |
| --- | --- | --- |
| Bloqueadas | Factura que no se pudo volcar; el motivo está en la fila | Corregir el dato (normalmente el cliente o su NIF) y pulsar «Reintentar» |
| Cobros pendientes | Cobros de Rentman sin método en Caja | Clasificarlos en Caja |
| Facturas cambiadas en Rentman después de volcarlas | Alguien editó una factura ya contabilizada | Avisar a María: se corrige con una rectificativa |
| Compensaciones descuadradas | Facturas 0 y rectificativas de un cliente que no suman cero | Revisar las parejas en Caja |
| Descuadre de céntimos con Rentman | Diferencia de redondeo del IVA | Comprobar y ajustar en Holded |
| Por aprobar / Pendiente de asignar pago | Facturas de gasto | Aprobar o poner forma de pago |

## Cierre Mensual

Financiero → Cierre Mensual muestra ingresos, gastos y beneficio de cada mes, sin IVA. Haz clic en un mes para ver su desglose: ingresos, gastos, gastos por departamento y personal. Los gastos salen de las facturas de proveedores, los pagos anuales (en doceavas partes), las nóminas y los extras aprobados.

Si una cifra no cuadra, mira primero si falta subir alguna factura o si un pago anual está duplicado como factura.

## Si algo no cuadra

1. **Espera un momento y recarga.** Los cambios de Rentman tardan unos segundos en llegar.
2. **Comprueba en Rentman.** El número de factura o proyecto abre su ficha; si allí está mal, se corrige allí.
3. **Una factura de proveedor no aparece:** comprueba en Facturas Proveedores → «Ver errores» y, si no está, vuelve a subirla.
4. **Apunta una incidencia** (tipo Facturación, Fianza o Sistema) con el número de factura o proyecto y una captura.
