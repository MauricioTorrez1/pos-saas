# ADR 0050: Factura individual con un intento registrado antes de timbrar y consulta antes de repetir

Estado: Aceptada · Fecha: 2026-11-10 · Concreta E1-31 (RF-035). Usa los ADR 0011, 0023, 0035, 0038, 0041, 0042 y 0046.

## Contexto
Una venta que ya llegó al núcleo (ADR 0046) debe poder facturarse a un cliente con RFC. Timbrar es un efecto externo que no se deshace: un CFDI duplicado o perdido es un problema fiscal real. Dos peticiones a la vez, un timeout con la respuesta perdida o un reintento del cliente no deben producir dos facturas de una venta ni dejar una factura timbrada sin registro. Además, los datos fiscales del cliente son personales y no deben quedar en logs ni en tablas que no los necesitan.

## Opciones
**Cómo se evita timbrar dos veces**
1. **Registrar el intento antes de llamar, con `UNIQUE (tenant_id, sale_id)`, y consultar a Facturapi antes de repetir** un intento de resultado desconocido, buscándolo por una referencia nuestra (`external_id` = id local de la factura). La base es el árbitro, y la consulta cierra el hueco de la respuesta perdida.
2. **Reenviar sin consultar, confiando en una llave de idempotencia del proveedor.** La documentación de Facturapi menciona `idempotency_key` en la creación de facturas, pero el ADR 0041 partió de que no estaba documentada y no la hemos probado con una llave real. No se apoya la seguridad en algo sin verificar.
3. **Un candado en memoria por venta.** No sobrevive a un reinicio ni a un segundo proceso.

**Qué se guarda del receptor**
1. **Solo el RFC.** El nombre, régimen, código postal y correo viajan a Facturapi y no se guardan. Quien reintenta una factura fallida vuelve a enviar los datos.
2. **Guardar todos los datos fiscales** para reintentar sin pedirlos de nuevo. Más cómodo, pero es dato personal duplicado que el núcleo no necesita.

**Qué se guarda del PDF y el XML**
1. **Solo la referencia** (`provider_invoice_id`) y se descargan bajo demanda (`downloadPdf`, `downloadXml` del ADR 0041). Facturapi los conserva y regenera.
2. **Guardar los archivos** en la base o en disco. Un CFDI pesa unos 5 a 10 KB y el PDF más, y habría que respaldarlos y protegerlos; se reconsidera si el SAT o el contador piden conservar el XML propio (la obligación legal es conservarlo cinco años).

## Decisión
Opción 1 en las tres.
- **Tabla `invoice`** (migración V7) con `tenant_id`, RLS forzada, `UNIQUE (tenant_id, sale_id)`, llave foránea a la venta, y sin `DELETE` para la aplicación. `CHECK` de que `stamped` equivale a tener UUID fiscal e id del proveedor.
- **Máquina de estados persistida:** `pending` (hay un intento en curso o de resultado desconocido), `stamped` (UUID fiscal guardado) y `failed` (Facturapi rechazó o no hay llave). `error_code` guarda solo un código (`provider_rejected`, `provider_not_configured`, `provider_unavailable`) y el estado HTTP, nunca texto del proveedor ni datos fiscales.
- **Flujo (`IndividualInvoiceService`):** valida el receptor → lee la venta → reclama la venta (`INSERT ... ON CONFLICT DO NOTHING` en su propia transacción, confirmada antes de llamar) → llama a Facturapi sin transacción abierta → guarda el resultado y la bitácora en una transacción. El segundo intento ve `pending` y recibe 409; uno con `stamped` recibe 409 con la factura existente.
- **Reintento seguro:** una factura `failed` por 4xx o falta de llave se reintenta directo (no pudo timbrar). Una `pending` cuyo intento terminó sin respuesta (`error_code` presente) o quedó huérfana (más de 2 minutos, `invoicing.attempt-lease`) primero se **consulta** con `GET /invoices?external_id=<id local>`; si existe y trae UUID se guarda como timbrada (`recovered: true` en la bitácora) y no se timbra otra vez; solo si no existe se timbra. Si la consulta falla, no se timbra y se contesta 503. El reclamo usa `SELECT ... FOR UPDATE`, así que dos reintentos simultáneos toman turnos.
- **Cliente de Facturapi:** `FiscalInvoicing` gana `findByExternalId` (lectura, con los reintentos del ADR 0041) y `InvoiceDraft` lleva `externalId`, que se envía como `external_id`. La creación de un cliente fiscal por factura puede dejar clientes repetidos en Facturapi; se acepta hasta que haya catálogo de clientes.
- **Validación (`FiscalDataValidator`):** forma del RFC con fecha real (12 o 13 caracteres), RFC genéricos rechazados (son de la global), catálogo de régimen y de uso de CFDI, compatibilidad régimen-persona (física o moral), usos `D01` a `D10` solo para personas físicas, `CN01` solo con régimen 605, código postal de cinco dígitos y correo opcional con forma válida. Los errores nombran campo y regla, nunca el valor. Es un primer filtro: el nombre exacto, el código postal contra el catálogo del SAT y el RFC contra la lista de contribuyentes los valida Facturapi.
- **Claves SAT:** la venta guarda `unit` pero no clave de producto (llega con el catálogo, E1-18). Mientras tanto la clave sale de la petición por línea (`satProductKeys`) o de `invoicing.default-sat-product-key`; sin ninguna, 422. La clave de unidad sale de la unidad de la venta (`H87`, `MTR`, `KGM`, `LTR`). Un artículo exento viaja sin impuestos. **Esto lo confirma el contador** antes de producción.
- **Forma de pago:** la de la mayor forma de pago de la venta (efectivo `01`, transferencia `03`, tarjeta `04`) salvo que la petición traiga `paymentForm`. Una tarjeta de débito (`28`) no se distingue de una de crédito en los datos de la venta.
- **Endpoint:** `POST /invoices` ya estaba en la tabla `EndpointPermissions` con el permiso `invoice.issue` (dueño y gerente); no se agregó ninguna regla. Contesta 201, 404 (venta desconocida o de otro negocio), 409 (ya facturada o en curso), 422 (datos inválidos o rechazo del proveedor) o 503 (sin llave o sin respuesta). El texto de rechazo de Facturapi vuelve solo al usuario que mandó esos datos y no se registra.
- **Bitácora (ADR 0038):** `invoice.stamped` y `invoice.failed`, en la transacción del cambio, con ids, UUID fiscal, total y si coincide con el de la venta; sin RFC ni nombre.
- **Pruebas:** servidor falso de `FiscalInvoicing` sobre PostgreSQL real (éxito, duplicado, 4xx, 5xx, respuesta perdida con consulta, consulta fallida, sin llave, 8 hilos, aislamiento entre negocios, permisos, logs sin RFC ni nombre) y el cliente contra un servidor HTTP falso. Lo que depende de la llave de prueba real de Facturapi no está verificado: que `external_id` se acepte y se pueda filtrar como indica su documentación, la forma de la lista de `GET /invoices`, y que un CFDI de prueba salga con estos datos.

## Consecuencias
- Un timeout no se repite solo: el siguiente `POST /invoices` de la misma venta consulta y recupera. Si el cliente nunca reintenta, queda una factura `pending` visible (E1-33 y la pantalla pueden listarlas).
- La factura global (E1-32) y las notas de crédito (E1-33) reutilizan `invoice` y `findByExternalId`; una venta incluida en una global tendrá que bloquearse aquí, y una venta con devolución todavía se puede facturar completa: se define en E1-32 y E1-33.
- Si el total de Facturapi difiere del de la venta (el redondeo por línea del ADR 0023), el CFDI queda timbrado y la bitácora lo marca con `totalMatchesSale: false` para revisarlo con el contador.
- Hasta que existan las descargas por endpoint, el PDF y el XML se obtienen con el id del proveedor desde la pantalla de factura.
