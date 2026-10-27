# Manual de Dirección

ORUM Central es el panel donde Dirección ve la empresa entera en un sitio: ventas, cobros, gastos, personal, logística y vehículos. Los datos se crean en Rentman, Caja y las facturas que se suben, y ORUM Central los junta, avisa de lo que no cuadra y los pasa a Holded. El trabajo diario de cada área está en los manuales de Administración, Logística, Comerciales, Conductores y Tablets; con el rol Dirección se ven todos.

**Cómo encaja todo:** Rentman (proyectos, material, facturas de venta, cobros) + Caja (método real de cada cobro, efectivo, fianzas) + facturas de proveedores subidas al panel + nóminas → ORUM Central → Holded (contabilidad), informes por email, avisos a los departamentos. Si un dato está mal, se corrige en su origen y ORUM Central lo recoge solo.

## Rutina de Dirección

Dirección no tiene que introducir datos: su trabajo en ORUM Central es mirar, decidir y aprobar.

| Cuándo | Qué mirar o hacer | Dónde |
| --- | --- | --- |
| Cada día | Bloque «Requiere tu atención» y próximas entregas | Resumen |
| Cada día | Alertas activas: vencidas, facturas sin registro, pendientes de facturar | Financiero → Resumen |
| Cada día | Incidencias abiertas (Dirección las ve todas) | Incidencias |
| Cuando llegan | Autorizar las solicitudes de devolución de fianza | Caja → Fianzas |
| Lunes, 8:00 | Informe semanal de Dirección: objetivo de ventas del equipo y aportación de cada comercial | Email |
| Lunes, 8:00 | Resumen de vencimientos de vehículos (si hay algo pendiente) | Email |
| Cada semana | Vencidas y morosidad; top 20 clientes con pendiente de cobro | Financiero |
| Fin de mes | Aprobar los extras del mes | Personal → Aprobar y pagar extras |
| Fin de mes | Revisar ingresos, gastos y beneficio | Financiero → Cierre Mensual |
| Fin de mes | Informe Mensual | Menú → Informe Mensual |

## Resumen, proyectos e Informe Mensual

- **Resumen** (portada al entrar): proyectos por estado, evolución de presupuestos desde enero, próximas entregas y el bloque «Requiere tu atención», que lleva directamente a los presupuestos pendientes de seguimiento y a las facturas vencidas.
- **Proyectos:** todos los proyectos de todos los comerciales, con buscador, filtro por estado y detalle de material y servicios.
- **Informe Mensual:** se abre en una pestaña nueva con el mes en curso: ventas frente al objetivo por semana, lo que está en presupuesto y el desglose por comercial. El objetivo es el mismo que el del informe semanal: ventas de la misma semana de 2025 más un 20 %.

## Financiero

El trabajo diario de Financiero lo hace Administración. Dirección usa estas pantallas para controlar:

| Pantalla | Qué responde |
| --- | --- |
| Resumen | Cuánto se ha facturado y cobrado, qué queda pendiente, por comercial y por forma de pago, y las alertas activas |
| Control de pagos | Qué facturas cuadran con lo clasificado en Caja y cuáles no |
| Vencidas y morosidad | Quién debe dinero vencido y desde cuándo |
| Extracto de Cliente | Todas las facturas y cobros de un cliente |
| Cierre Mensual | Ingresos, gastos y beneficio de cada mes, sin IVA, con desglose por departamento |
| Informe semanal | PDF semanal de proyectos (No confirmados y resto) que genera Isabel cada lunes; cada semana se genera una vez y queda guardada tal cual |
| Fianzas | Fianzas cobradas, devueltas y pendientes |
| Auditoría / Alertas | Facturas pagadas sin registro en Caja, proyectos pendientes de facturar y PNC (proyectos no confirmados, cobrados sin factura) que no cuadran |
| Holded | Estado del volcado a la contabilidad: bloqueadas, descuadres y gastos por aprobar |
| Facturas Proveedores | Facturas de gasto subidas, su lectura, reparto por departamento y las que están a revisar |

### Cómo llega el dinero a la contabilidad

1. **Ventas:** el comercial o María emite la factura en Rentman → el cobro se apunta en Rentman → se clasifica su método en Caja → cada mañana a las 6:00 se vuelca a Holded.
2. **Gastos:** se sube la factura del proveedor (panel o móvil) → el sistema la lee → se pone forma de pago (y matrícula si es de vehículo) → a las 7:00 pasa a «Por aprobar» → María la revisa y la acepta en Holded.
3. **Pagos anuales** (seguros, IBI, IAE…): se dan de alta en Configuración → Pagos Anuales y el Cierre Mensual los reparte en doceavas partes. Nunca como factura.

## Personal

Todo el apartado Personal es solo para Dirección y Contabilidad.

| Pantalla | Para qué sirve |
| --- | --- |
| Nóminas | Subir los PDF de nóminas de cada mes; el coste se reparte por departamento en el Cierre Mensual |
| Informe | Coste de personal del año: nóminas más extras, por trabajador, departamento y empresa, comparado con años anteriores |
| Registrar extras / Aprobar y pagar extras | Registro, aprobación y pago de horas extra, domingos, festivos y nocturnos |
| Extras | Histórico de extras del año |
| Análisis, Histórico de personal, Comparador | Evolución del coste, previsión de cierre del año y comparación entre periodos y trabajadores |
| Configuración → Personal | Departamento de cada trabajador, que decide a qué departamento va su coste |

### Aprobar y pagar extras, paso a paso

1. Los responsables registran los extras durante el mes (Registrar extras).
2. A fin de mes, entra en Personal → Aprobar y pagar extras → pestaña **Registros**: revisa los pendientes y apruébalos o recházalos.
3. En **Pagos del mes y descansos** ves lo que se paga a cada trabajador y su saldo de días de descanso. Cuando se abona en nómina, se marca como pagado.
4. En **Tarifas y ajustes** se cambian los precios, siempre con fecha de entrada en vigor (los meses anteriores no se recalculan).

Solo lo aprobado o pagado cuenta como coste. Si un trabajador sale sin departamento, el aviso lleva a Configuración → Personal para asignarlo; si no, su coste no se reparte.

## Comercial

Dirección ve el apartado Comercial completo (Resumen, Proyectos, Presupuestos y Leads) con todos los comerciales y un filtro por comercial.

**Informe semanal de Dirección (lunes, 8:00).** Es el único informe con el desglose por comercial:

- si el equipo alcanzó el objetivo de ventas de la semana anterior, con la aportación de cada comercial;
- la evolución de las últimas 6 semanas frente al objetivo;
- por comercial: presupuestos enviados, transformados y cancelados, ventas y cartera.

Ventas = proyectos confirmados con entrega en esa semana, sin IVA. Cada comercial recibe su propio informe con sus cifras y el total del equipo, sin las de los demás.

## Operaciones

| Pantalla | Qué responde |
| --- | --- |
| Logística → Preparación | Qué se está preparando y qué está listo, por zona |
| Logística → Rutas | Entregas y recogidas por vehículo, vuelta y conductor |
| Logística → Servicios Isabella | Servicios prestados al grupo Isabella con coste real, importe y beneficio |
| Mantenimiento | Revisión del material de especial cuidado de los próximos 15 días |
| Análisis → Material | Qué material se alquila más, cuál es más rentable e ingresos por familia |
| Análisis → Rutas & Conductores | Viajes y paradas por vehículo y conductor |
| Vehículos → Flota, Vencimientos, Repostajes | Ficha de cada vehículo, ITV, seguros, mantenimientos, documentos y repostajes |
| Vehículos → Uso | Kilómetros por vehículo y conductor, a partir del localizador GPS cruzado con las rutas |
| Vehículos → Ranking conductores | Puntuación de conducción de cada conductor (sobre 100); «Ajustes del ranking» cambia pesos y umbrales |
| Material recuperado | Material perdido que ha vuelto y cargos que hay que quitar al cliente |
| Chat | Los tres chats (Office, Lavandería, Mantenimiento) |

Los vencimientos de vehículos avisan por email a Jesús, Leo, Rafa, Sergio y logistica@orumevents.com cuando un vencimiento empeora; los lunes llega un resumen con todo lo pendiente.

## Avisos e incidencias

- **Avisos de proyectos:** Dirección recibe en el móvil los mismos avisos que Logística (proyectos confirmados para hoy o mañana, cambios de material, fecha o cancelaciones) y ve en la app → Avisos qué departamentos los han visto. Hay que activarlos en app → Avisos → «Activar avisos».
- **Incidencias:** Dirección ve todas, puede cambiar el estado de cualquiera y reasignarlas. Ver «Lo básico» para el proceso completo.

## Aprobaciones y reglas que fija Dirección

| Qué | Quién aprueba | Regla |
| --- | --- | --- |
| Extras del personal | Dirección | Solo lo aprobado o pagado cuenta como coste |
| Tarifas de extras | Dirección | Se cambian con fecha de entrada en vigor; no se recalculan meses pasados |
| Facturas de gasto a Holded | María | Todas pasan por ella; se revisan una a una antes de aceptarlas |
| Borrar una factura de proveedor | Dirección | Solo si todavía no está en Holded |
| Pagos anuales | Contabilidad | Siempre en Pagos Anuales, nunca como factura de proveedor |
| Facturas rectificativas | Solo María | Una factura de Rentman no se modifica después de volcarla |
| Devolución de fianza | María o Sergio autorizan | Sin autorización no se devuelve ni sale en el email del viernes |
| Retención de fianza | María o Sergio autorizan | Importe 0 € con motivo obligatorio |
| Fianza en efectivo | Gerencia | Por defecto, transferencia o TPV |
| Objetivo de ventas | Dirección | Es de equipo: ventas de la misma semana de 2025 + 20 % |

## Accesos por rol

| Rol | Qué ve |
| --- | --- |
| Dirección | Todo |
| Contabilidad | Financiero, Personal, Material recuperado, Incidencias y Configuración (salvo Usuarios) |
| Logística | Logística, Mantenimiento, Vehículos, Material recuperado, Incidencias y Chat |
| Comercial | Solo Comercial (con sus proyectos) e Incidencias; en la app, Rutas (solo notas) y Avisos |
| Tablets de Lavandería y Office | Solo su zona de Preparación, su chat y sus avisos, en la app |
| Mantenimiento | Solo Mantenimiento, su chat y sus avisos, en la app |
| Usuario de solo consulta | Lo mismo que su rol, sin Configuración, y no puede cambiar nada |

Los PIN y las altas de usuarios los gestiona Sergio en Configuración → Usuarios.

## Sincronización y si algo falla

**Sincronización.** ORUM Central recibe los cambios de Rentman al momento y hace un repaso cada 10 minutos. Configuración → Estado Sincronización indica cuándo fue la última copia de cada tabla y si hubo errores; es lo primero que hay que mirar cuando alguien dice que un dato no aparece.

**Si algo falla:** mirar Estado Sincronización, comprobar el dato en Rentman y apuntar una incidencia con el número de proyecto o factura y una captura.
