# ADR 0077: Factura global mensual con vista previa, un periodo por global y una venta en una sola global

Estado: Aceptada · Fecha: 2026-11-25 · Concreta E1-32 (RF-036). Usa los ADR 0012, 0038, 0041, 0042, 0050 y 0076.

## Contexto
Las ventas que nadie pide facturar deben ir en un CFDI a «Público en general» (RFC `XAXX010101000`) por periodo. Es el mismo efecto externo irreversible que la factura individual (ADR 0050), pero sobre cientos de ventas a la vez: una venta no puede quedar en dos globales, ni en una global y en una factura propia sin corregirlo, y un timeout no debe producir dos CFDI del mismo mes. El contador todavía no dice con qué periodicidad factura la tienda.

## Opciones
**Periodicidad**
1. **Mensual por omisión, elegible en cada petición** (diaria, quincenal o mensual). El SAT permite las tres para este régimen; cambiarla es elegir otra opción en la pantalla, sin migración.
2. **Fija en la configuración.** Más rígida y no ahorra nada.

Semanal y bimestral quedan fuera: la semana puede cruzar dos meses (el nodo `global` lleva un solo mes) y la bimestral es de otros regímenes. Se agregan si el contador las pide.

**Quién la dispara**
1. **El dueño o el encargado, desde el panel web, después de una vista previa** con las ventas incluidas y los totales por tasa. Ve lo que va a timbrar y confirma con el número de ventas que vio.
2. **Automática al cerrar el periodo.** Cómoda, pero timbra sin que nadie revise y hoy no hay programador de tareas en el núcleo. Se puede agregar sobre el mismo servicio.

**Qué impide que una venta quede dos veces**
1. **Dos tablas, `global_invoice` y `global_invoice_sale`, con un índice único parcial `(tenant_id, sale_id) WHERE released_at IS NULL`**, y un candado de transacción por negocio compartido con la factura individual. La base es el árbitro y el candado evita que una venta se reclame a la vez por los dos caminos.
2. **Una columna `global_invoice_id` en `sale`.** Mezcla el módulo de ventas con el de facturación y no deja historia de intentos fallidos.

## Decisión
Opción 1 en las tres.
- **Migración V17:** `global_invoice` (estado `pending`/`stamped`/`failed`, código SAT de periodicidad, primer y último día, mes y año del nodo `global`, forma de pago, número de ventas, total esperado y el timbrado, UUID fiscal, código de error sin datos fiscales) con un índice único parcial de un periodo vivo (`pending` o `stamped`) por periodicidad y día inicial; `global_invoice_sale` con el total con que entró cada venta; `invoice.overlaps_global_invoice_id`. Todo con RLS forzada y sin `DELETE` para la aplicación: una liga se **libera** (`released_at`), nunca se borra.
- **Ventas que entran:** las de días de negocio (ADR 0076) dentro del periodo, netas de las devoluciones que ya llegaron al núcleo (una venta devuelta por completo no entra), sin factura propia `pending` o `stamped` y sin otra global viva. Una factura propia `failed` no la excluye: el cliente no la obtuvo. También entran las **ventas tardías**: las de un periodo anterior cuya global ya estaba timbrada cuando la caja sincronizó; si no, nunca se facturarían. La vista previa las marca.
- **Contenido del CFDI** (Anexo 20): receptor `PUBLICO EN GENERAL`, `XAXX010101000`, régimen `616`, código postal del lugar de expedición (`INVOICING_ISSUER_ZIP_CODE`; sin él, 503 `issuer_not_configured` y nada se guarda), uso `S01`, nodo `global` con periodicidad, mes y año. Un concepto por ticket y por tasa: clave `01010101`, unidad `ACT`, cantidad 1, descripción «Venta», `NoIdentificacion` = folio, precio = total neto con IVA incluido. Forma de pago: la del método que más dinero trajo en esas ventas, salvo que la petición diga otra.
- **Flujo (`GlobalInvoiceService`)**, el mismo del ADR 0050: periodo cerrado (termina antes de hoy en la zona de la tienda, si no 422 `period_not_closed`) → reclamo en una transacción con el candado: si hay una global viva del periodo, `stamped` da 409 con la existente y `pending` en curso da 409; si no, se calculan las ventas, se comparan con `expectedSaleCount` de la vista previa (409 `preview_stale` si cambió) y se insertan la global y sus ligas → llamada a Facturapi sin transacción abierta, con el id de la global como `external_id` → resultado y bitácora (`invoice.global.stamped`, `invoice.global.failed`) en una transacción.
- **Errores del PAC:** un 4xx o la falta de llave dejan la global `failed` y **liberan sus ventas**, así que el siguiente intento recalcula (queda una fila `failed` de historia y otra nueva). Un timeout deja `pending` con sus ventas; el reintento del mismo periodo consulta `external_id` y solo timbra si no existe (`recovered: true`). El texto del proveedor vuelve solo a quien timbró y no se registra.
- **Endpoints:** `GET /invoices/global/preview`, `POST /invoices/global` y `GET /invoices/global`, todos con `invoice.issue` (dueño y encargado). El panel tiene la pantalla `/invoices/global`; la caja no la tiene en esta entrega.
- **Plazo del SAT:** la vista previa muestra el día límite (72 horas después del cierre, RMF 2.7.1.21, por confirmar con el contador) pero no se bloquea una global tardía.

**Una venta que se factura después por separado** (regla del SAT, motivo de cancelación 04): el cliente tiene derecho a su factura nominativa aunque la venta ya esté en una global timbrada. El SAT pide cancelar esa global con motivo 04 «Operación nominativa relacionada en una factura global», emitir de nuevo la global sin esa venta y emitir la nominativa ([preguntas frecuentes de cancelación del SAT](https://www.sat.gob.mx/minisitio/Factura/documentos/PreguntasFrecuentes_CancelacionFactura25082026.pdf)). Aquí:
- Si la global está `stamped`, la factura individual **sí se timbra** y guarda `overlaps_global_invoice_id`; la bitácora lo anota y la lista del panel marca la global «Por corregir: N ventas se facturaron aparte. Cancélala con motivo 04 y emítela de nuevo».
- Si la global está `pending`, la individual contesta 409 `in_pending_global` hasta que termine.
- La cancelación y la reemisión llegan en E1-33: cancelar libera las ligas y la nueva global del mismo periodo deja fuera la venta con factura propia por la regla de arriba.

## Consecuencias
- **Lo cambia el contador:** la periodicidad (se elige en la pantalla), la forma de pago (hoy una sola por global; si pide una global por forma de pago, se agrega un filtro), si los exentos viajan con `ObjetoImp` distinto (hoy sin impuestos, igual que la individual) y si las ventas tardías van en la global siguiente o en una complementaria del periodo original.
- Una devolución que llega **después** de timbrar la global no la cambia: se corrige con una nota de crédito (E1-33). `global_invoice_sale.total_cents` guarda con qué monto entró cada venta para eso.
- La idempotencia es por periodo: repetir la petición después de un timeout es seguro sin llave de idempotencia extra, porque el índice parcial deja una sola global viva por periodo.
- Sin verificar con la llave de prueba real de Facturapi: que acepte el nodo `global` con estos conceptos y el `sku` como `NoIdentificacion`. El riesgo de `docs/plan/07-riesgos.md` sigue abierto hasta esa prueba; si falla, se actualiza el ADR 0012.
