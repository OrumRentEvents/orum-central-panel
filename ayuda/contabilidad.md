# Manual de Contabilidad (Holded)

Este manual explica el día a día de la contabilidad en Holded (María) y el recorrido completo de cada movimiento: desde que alguien registra un cobro o un pago hasta el asiento que queda en los libros.

La idea general:

- **Rentman** es donde nacen las facturas de venta, las rectificativas y los cobros.
- **Caja** dice por dónde entró de verdad cada cobro (TPV, efectivo, transferencia…).
- **ORUM Central** junta las dos cosas, comprueba que todo cuadra y lo envía a Holded. Las facturas de gasto se suben y se aprueban aquí.
- **Holded** es la contabilidad: nadie mete a mano en Holded facturas, cobros ni pagos que ya envía ORUM Central, porque saldrían duplicados.

## Tu día, paso a paso

| Hora | Qué ha hecho el sistema solo | Qué haces tú |
| --- | --- | --- |
| 6:00 | Envía a Holded las facturas y rectificativas de Rentman hasta ayer y los cobros de esas facturas que ya están clasificados en Caja | — |
| 7:00 | Prepara las facturas de gasto pagadas y las deja «Por aprobar» | — |
| Al empezar | — | Revisar Financiero → Holded (abajo, «Revisión de la mañana») |
| Durante el día | — | Emitir facturas y rectificativas en Rentman, apuntar los cobros de transferencias y de Monda, clasificarlos en Caja, aprobar gastos |
| Antes de irte | — | Comprobar que no queda ningún cobro de hoy «sin asignar» en Caja |

**Importante:** lo que hagas hoy llega a Holded mañana a las 6:00. Si hace falta antes, en Financiero → Holded está el botón «Volcar ahora» (con la casilla «incluir también lo de hoy»).

### Revisión de la mañana (Financiero → Holded)

Ve de arriba abajo. Cada lista con un número mayor que cero pide algo:

1. **Último volcado.** Debe decir que terminó bien. Si hay errores, léelos: casi siempre es una factura bloqueada o un cobro que Holded rechazó.
2. **Facturas bloqueadas.** El motivo sale en la fila. Lo habitual:
    - *El cliente no tiene NIF en Rentman:* ponlo en la ficha del cliente en Rentman y pulsa «Reintentar» (o espera al volcado de mañana).
    - *IVA sin equivalente (0 %):* hay que decidir si es exenta, intracomunitaria o exportación antes de enviarla.
    - *Factura con importe negativo:* en Rentman debería haberse hecho como rectificativa.
3. **Cobros pendientes.** Cobros de Rentman que todavía no tienen método en Caja. Clasifícalos en Caja → Caja Diaria. Los de Marbella (TPV o efectivo) los clasifica el comercial: si llevan más de un día, recuérdaselo.
4. **Cobros cambiados en Caja después de enviarlos.** Alguien cambió el método o el importe en Caja cuando el cobro ya estaba en Holded. Holded no se entera solo: corrige ese cobro a mano en Holded (borra el cobro y créalo con la tesorería correcta).
5. **Facturas cambiadas en Rentman después de volcarlas.** Una factura ya contabilizada no se toca: se corrige con una rectificativa en Rentman (solo tú las haces).
6. **Compensaciones descuadradas.** Las «Factura 0» y «Rectificativa» de un cliente no suman cero. Busca la pareja que falta o la que está mal clasificada en Caja.
7. **Descuadre de céntimos con Rentman.** Holded calcula el IVA a su manera y a veces sale un céntimo distinto; la factura queda con 0,01 € pendiente. Ajústalo en Holded.
8. **Gastos «Pendiente de asignar pago».** Facturas de proveedor subidas sin forma de pago. Si ya están pagadas, elige la forma de pago y pasan a «Por aprobar». Si no, se quedan ahí hasta que se paguen.
9. **Gastos «Por aprobar».** Ver «Aprobar una factura de gasto», más abajo.
10. **Gastos bloqueados.** Lecturas que no cuadran, NIF que no coincide, duplicadas o líneas al 0 % sin configurar. Corrige y pulsa «Reintentar» (o «Releer» si el PDF se leyó mal).

### Aprobar una factura de gasto

Para cada factura en «Por aprobar»:

1. Abre el PDF y comprueba proveedor, número, fecha, base, IVA, retención y total.
2. Revisa la **cuenta de gasto** propuesta (la habitual del proveedor). Cámbiala si este gasto va a otra; marca «usar siempre» si a partir de ahora debe ir siempre ahí. Si el gasto necesita una **cuenta nueva** del grupo 6, añádela antes en Config. Cuentas de gasto: ORUM Central la crea sola en Holded con el mismo número (no se crea a mano en Holded).
3. Corrige la **fecha** o el **vencimiento** si la lectura se equivocó.
4. Indica **«Pagada el»** (el día real del pago) y la **tesorería**: Transferencia y Domiciliación salen por Banco; **Tarjeta** (tarjeta de empresa) sale por **Tarjeta empresa** (55500001); en Efectivo u Otro eliges tú Banco, Tarjeta empresa, Efectivo Marbella o Efectivo Monda.
5. Pulsa **«Aceptar»**. La factura entra en Holded aprobada, pagada y con el PDF adjunto, y en Facturas Proveedores se marca sola la casilla **«Contabilizada»** (queda en su historial con tu nombre). Si sale un aviso (por ejemplo, redondeo del IVA), léelo.

Los **abonos de proveedor** siguen el mismo camino y entran en Holded como devolución de compra.

## Recorrido de un cobro de cliente

### 1. Se emite la factura (Rentman)

- La emite el comercial o María en Rentman. Si el cliente paga por transferencia, solo después de recibir su justificante.
- El cliente tiene que tener **NIF** en Rentman, o la factura se bloqueará al volcarla.

**En Holded (al día siguiente, 6:00):** se crea la factura con el **mismo número de Rentman**, ya aprobada. Si el cliente no existía en Holded, se crea con su NIF y Holded le da su propia cuenta 430.

| Cuenta | Debe | Haber |
| --- | --- | --- |
| 430xxxxx Cliente | Total con IVA | |
| 70500000 Prestaciones de servicios | | Base |
| 47700000 IVA repercutido | | IVA |

### 2. El cliente paga y se apunta en Rentman

| Cómo paga | Quién lo apunta en Rentman | Quién lo clasifica en Caja |
| --- | --- | --- |
| TPV o efectivo en Marbella | El comercial | El comercial (TPV Marbella / Efectivo Marbella) |
| TPV o efectivo en Monda | María | María (TPV Monda / Efectivo Monda) |
| Transferencia | María, al verla en el banco | María (Transferencia) |

Si un cliente paga una parte de cada forma, en Caja se reparte el importe entre los métodos.

### 3. Se clasifica en Caja

En Caja → Caja Diaria → «Cargar cobros», el cobro sale «sin asignar»; se le pone su método real. **Sin este paso el cobro nunca llega a Holded.**

### 4. Se envía a Holded (6:00 del día siguiente)

El cobro solo se envía si su factura ya está aprobada en Holded. Si la factura está bloqueada, el cobro espera a que se desbloquee.

| Método en Caja | Tesorería de Holded | Asiento |
| --- | --- | --- |
| TPV Marbella | TPV Marbella | 44100010 D / 430 Cliente H |
| TPV Monda | TPV Monda | 44100020 D / 430 Cliente H |
| Transferencia | Banco | 57200001 D / 430 Cliente H |
| Efectivo Marbella | Efectivo Marbella | 57000100 D / 430 Cliente H |
| Efectivo Monda | Efectivo Monda | 57000200 D / 430 Cliente H |
| Factura 0 / Rectificativa | Compensaciones | ver «Compensaciones» |
| Fianza (cualquier variante) | — | **No se envía** (ver «Lo que no pasa solo») |

La factura queda **cobrada** en Holded y el saldo de la 430 del cliente baja.

### Rectificativas (solo María)

1. Se hacen en Rentman, en negativo, en el mismo proyecto que la factura que corrigen.
2. En Holded entran como **nota de crédito** con el mismo número de Rentman, y en las notas pone qué factura rectifica.

| Cuenta | Debe | Haber |
| --- | --- | --- |
| 70500000 Prestaciones de servicios | Base | |
| 47700000 IVA repercutido | IVA | |
| 430xxxxx Cliente | | Total |

- **Si se devuelve dinero de verdad:** en Caja se apunta con su método real (por ejemplo, Transferencia) y el importe en negativo. En Holded queda como devolución de la nota de crédito: 430 Cliente D / 57200001 H.

### Compensaciones (Factura 0 y Rectificativa)

Cuando una factura estaba mal y se anula con una rectificativa sin que se mueva dinero, en Caja se clasifican las dos como **Factura 0** (la factura mala) y **Rectificativa** (la que la anula).

| Movimiento | Asiento |
| --- | --- |
| «Cobro» de la factura mala | 55500010 Compensaciones D / 430 Cliente H |
| «Devolución» de la rectificativa | 430 Cliente D / 55500010 Compensaciones H |

Las dos quedan saldadas, la 430 del cliente a cero y **la tesorería Compensaciones tiene que estar siempre a 0**. Si no lo está, aparece en «Compensaciones descuadradas».

## Recorrido de un pago a proveedor

1. **Se paga y se sube la factura.** Quien recibe la factura (Administración, Sergio o el comercial que pagó) la sube en Financiero → Facturas Proveedores o desde el móvil → «Subir factura», con su **forma de pago** («Tarjeta» = tarjeta de empresa). Si es de un vehículo, también la matrícula.
2. **Lectura automática.** El sistema lee proveedor, NIF, número, fecha, base, IVA, retención y total.
3. **7:00: preparación.** Las facturas con forma de pago pasan a «Por aprobar»; las que no la tienen, a «Pendiente de asignar pago».
4. **María aprueba** (ver «Aprobar una factura de gasto»).
5. **En Holded**, al pulsar «Aceptar»:
    - Si el proveedor no existe, se crea con su NIF; Holded le da su cuenta de proveedor (400/410).
    - Se crea la compra aprobada con el PDF:

    | Cuenta | Debe | Haber |
    | --- | --- | --- |
    | 6xxxxxxx Cuenta de gasto elegida | Base | |
    | 47200000 IVA soportado | IVA | |
    | 47510000 Retenciones (si la hay) | | Retención |
    | 400/410 Proveedor | | Total a pagar |

    - Se registra el pago:

    | Pagado por | Asiento |
    | --- | --- |
    | Transferencia o domiciliación | 400/410 Proveedor D / 57200001 Banco H |
    | Tarjeta de empresa | 400/410 Proveedor D / 55500001 Tarjeta empresa H |
    | Efectivo Marbella | 400/410 Proveedor D / 57000100 H |
    | Efectivo Monda | 400/410 Proveedor D / 57000200 H |

6. **Abono de proveedor:** lo contrario. 400/410 D / 6xx H / 47200000 H, y la devolución del dinero 57200001 (o caja) D / 400/410 H.

- La casilla **«Contabilizada»** de Facturas Proveedores no se marca a mano: se marca sola cuando la factura queda aprobada en Holded. Para ver qué falta, filtra «Contabilizada: No» (y, si quieres, por forma de pago).
- Solo se contabilizan facturas **ya pagadas**. Una factura sin pagar se queda en ORUM Central hasta que tenga forma de pago.
- Los **pagos anuales** (seguros, IBI, IAE…) se llevan en Configuración → Pagos Anuales y no se suben como factura.

## Lo que no pasa solo (lo hace María en Holded)

Hay movimientos que ORUM Central todavía **no** envía. Hasta que se automaticen, se apuntan a mano en Holded como asiento:

| Situación | Asiento a mano | Cuándo |
| --- | --- | --- |
| Cobro de una factura anterior a la fecha de corte (está en el saldo inicial, no en Holded como factura) | Tesorería D / 430 Cliente H | Cuando llegue el cobro |
| Fianzas cobradas, retenidas o devueltas | Pendiente de decidir con la gestoría (cuenta 560) | — |
| El banco abona la liquidación del TPV | 57200001 D / 44100010 o 44100020 H, y la comisión a 62600001 | Pendiente de decidir con la gestoría |
| Se ingresa en el banco el efectivo de una caja | 57200001 D / 57000100 o 57000200 H | Pendiente de decidir con la gestoría |
| El banco carga el gasto de la tarjeta de empresa (fin de mes) | 55500001 Tarjeta empresa D / 57200001 Banco H, por el importe del cargo | Cada mes, al ver el cargo en el banco |
| Cobros sin factura (PNC, abrebotellas) | No van a Holded | — |

## Comprobaciones de fin de mes

1. **Compensaciones (55500010)** a 0.
2. **Tarjeta empresa (55500001)** a 0 después de pasar al banco el cargo mensual de la tarjeta. Si no queda a 0, hay un gasto con tarjeta sin factura aprobada o una factura que no se pagó con tarjeta.
3. **Clientes (430):** el saldo de cada cliente coincide con lo pendiente en Control de pagos.
4. **Caja Diaria:** ningún cobro del mes «sin asignar».
5. **Gastos:** nada en «Por aprobar» ni «Pendiente de asignar pago» que ya esté pagado.
6. **Rentman:** el total facturado del mes en Rentman coincide con el de Holded (ventas menos notas de crédito).

## Reglas que no cambian

- Las facturas de venta se emiten en Rentman, nunca en Holded.
- No se crean a mano en Holded facturas, cobros ni pagos que ya envía ORUM Central.
- Una factura ya enviada a Holded no se modifica en Rentman: se hace una rectificativa.
- Un cobro solo llega a Holded si está clasificado en Caja.
- Un gasto solo llega a Holded si María lo aprueba en ORUM Central.
