# ADR 0082: Cancelación de CFDI con estado asíncrono y nota de crédito por devolución

Estado: Aceptada · Fecha: 2026-11-26 · Concreta E1-33 (RF-037, RF-038). Usa los ADR 0012, 0042, 0050 y 0080.

## Contexto
Una factura individual o global ya timbrada puede tener errores, o una venta suya puede devolverse. El SAT no permite borrar un CFDI: se cancela con un motivo (`01` a `04`) y, si el receptor debe aceptar, la cancelación queda en espera hasta que responde o pasan 72 horas. Una devolución de una venta facturada se corrige con un CFDI de egreso (nota de crédito) relacionado con el original. Igual que al timbrar (ADR 0050), un timeout no debe mandar dos veces la misma petición, y nada se borra.

## Opciones
**Cómo seguir una cancelación que tarda**
1. **Estado en la misma fila** (`requested`, `pending`, `accepted`, `rejected`, `failed`) **y consulta bajo demanda** con «Consultar cancelación», que lee el CFDI en Facturapi. Sin infraestructura nueva.
2. **Webhooks de Facturapi.** Más inmediato, pero exige endpoint público con firma y reintentos; el núcleo todavía no está desplegado con HTTPS (F0-24/F0-25). Se agrega después sobre el mismo `save`.
3. **Sondeo programado.** No hay programador de tareas en el núcleo.

**Motivo 01 (sustituida)**
1. **Primero se timbra la sustituta con `POST /invoices` y `replacesInvoiceId`** (relación SAT `04` con el UUID original) y luego se cancela la original con su UUID. Es el orden que pide el SAT y el sistema comprueba que el UUID sustituto es justo esa factura.
2. Aceptar cualquier UUID. Permite cancelar con una sustituta que no corresponde.

**Unicidad de la factura por venta**
1. **Índice único parcial** `(tenant_id, sale_id) WHERE replaces_invoice_id IS NULL AND superseded_at IS NULL` más la revisión bajo el candado de facturación (ADR 0080). Permite la sustituta y volver a facturar una venta cuya factura se canceló.
2. Mantener la restricción única de antes. Impide ambos casos.

**Nota de crédito**
1. **Una por devolución** (`credit_note.return_id` único), relacionada (relación `01`) con la factura vigente de la venta o, si no tiene, con la global timbrada **antes** de que llegara la devolución. Una devolución anterior a la global ya se descontó de ella (ADR 0080) y no lleva nota.
2. Notas libres por importe. Más flexible, pero sin liga con el libro de devoluciones.

## Decisión
Opción 1 en las cuatro.
- **Migración V18:** en `invoice`: `provider_customer_id` (para emitir la nota al mismo cliente sin volver a pedir sus datos), `replaces_invoice_id`, `superseded_at` y las columnas de cancelación (estado, motivo, UUID sustituto, código de error, quién y cuándo; restricción: motivo `01` exige sustituto). Las mismas columnas de cancelación en `global_invoice`; su índice de un periodo vivo ignora las globales con cancelación aceptada. Tabla `credit_note` con su propio ciclo `pending`/`stamped`/`failed`, liga a la factura **o** a la global, RLS forzada y sin `DELETE`.
- **Motivos permitidos:** factura individual `01`, `02`, `03`; global `02`, `03`, `04`. El `04` es el caso de ADR 0080: una venta de la global se facturó aparte; se cancela la global, se libera y la global corregida del mismo periodo ya no incluye esa venta.
- **Flujo de `CancellationService`:** reclamo con `FOR UPDATE` (409 `not_stamped`, `already_cancelled`, `awaiting_acceptance`, `in_progress`), estado `requested` y bitácora, *commit*; si un intento anterior quedó sin respuesta, primero se lee el CFDI en Facturapi y solo se manda la cancelación si allá sigue vigente. La respuesta se traduce: `canceled`/`accepted` → `accepted`; `pending` → `pending`; `rejected`/`expired` → `rejected`. Un 4xx deja `failed` (se puede volver a pedir); un timeout deja `requested` con `provider_unavailable`. Al aceptarse, la factura queda `superseded_at` o la global libera sus ventas. Cada cambio de estado va a la bitácora como `invoice.cancellation.<estado>`.
- **Nota de crédito (`CreditNoteService`):** mismo patrón del ADR 0050 (reclamo, `external_id` = id de la nota, consulta antes de reintentar). Tipo `E`, uso `G02` (individual) o `S01` (global, receptor público), un concepto por tasa «Devolución de mercancía», clave `84111506`, unidad `ACT`, por lo reembolsado; forma de pago la del reembolso. Errores: 422 `not_invoiced`, `customer_unknown`, `issuer_not_configured`; 409 `already_issued`.
- **Endpoints:** `POST /invoices/{id}/cancel`, `POST /invoices/{id}/cancellation-refresh`, `POST /invoices/global/{id}/cancel`, `POST /invoices/global/{id}/cancellation-refresh` con `invoice.cancel` (solo el dueño); `GET /invoices`, `GET /invoices/credit-notes`, `GET /invoices/credit-notes/candidates` y `POST /invoices/credit-notes` con `invoice.issue` (dueño y encargado).
- **Panel:** `/invoices` lista las facturas con su cancelación, «Sustituir» y «Cancelar» (solo el dueño), y las devoluciones pendientes de nota con «Emitir nota de crédito»; `/invoices/global` agrega «Cancelar» a cada global, con el motivo `04` preseleccionado si alguna venta se facturó aparte.

## Consecuencias
- Nada se borra: una factura cancelada sigue en la lista con su estado y su motivo.
- La cancelación que espera al cliente necesita que alguien oprima «Consultar». Cuando el núcleo esté en internet con HTTPS, un webhook firmado puede llamar al mismo `save`.
- Los **descuentos sin devolución** (bonificaciones) no tienen nota de crédito en esta entrega; se agregan como otra fuente de `credit_note` si el contador los pide.
- Una factura emitida antes de V18 no tiene `provider_customer_id`; su nota se rechaza con `customer_unknown` y se emite desde Facturapi.
- Falta probarlo con la llave de prueba real de Facturapi y revisar los motivos con el contador.
