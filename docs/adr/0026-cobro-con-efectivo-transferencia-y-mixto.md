# ADR 0026: Cobro con efectivo, transferencia y pago mixto

Estado: Aceptada · Fecha: 2026-11-08 · Concreta RF-014, RF-015 y el ADR 0025.

## Contexto
E1-11 trae el botón de cobro. Una venta se puede pagar con efectivo, con transferencia o con las dos, y el cambio sale del efectivo. Faltaba decidir qué guarda `payment`, quién valida la suma y cómo responde la recuperación del ADR 0025, que tenía el pago fijo en efectivo.

## Opciones
**Qué importe guarda un pago en efectivo**
1. **Lo que entregó el cliente.** La suma de pagos pasa del total y rompe la invariante 5.
2. **Lo que el efectivo pagó de la venta.** Los pagos suman el total, y el cambio solo se muestra.

**Quién valida que los pagos sumen el total**
1. **La pantalla.** Depende de que la pantalla tenga razón.
2. **El proceso principal vuelve a calcular desde el total guardado, y la base lo revisa otra vez.** La pantalla manda lo que recibió, nunca los pagos ya armados.

**Cómo termina la pantalla de cobro**
1. **Enter completa la venta.** El Enter que cierra una lectura del escáner cobraría sin querer.
2. **Solo teclas de función completan (F2). Enter pasa al siguiente campo.**

## Decisión
- Opción 2 en las tres preguntas.
- `planPayments` (`src/shared/payment-plan.ts`) es la única regla: las transferencias son exactas, porque un banco no da cambio. El efectivo paga lo que las transferencias dejan, y el cambio sale del efectivo recibido. Rechaza con una razón: `short`, `transfers_exceed_total`, `cash_not_needed` y `reference_missing`. La pantalla la usa para mostrar «Faltan» o «Cambio» mientras se teclea, y el proceso principal la usa para decidir.
- **Pagos:** `payment.method` es `cash` o `transfer` (y `card` para el falso del ADR 0010). De una transferencia se guarda la referencia que dio el banco. `SaleRecorder.markCompleted` recibe la lista de pagos y los escribe con el cambio de estado en una sola transacción.
- **La base se niega** a un método desconocido y a una transferencia sin referencia (migración 5, con disparadores y no `CHECK`, como en el ADR 0025). Si E1-12 agrega `card_manual`, reemplaza el disparador. `SaleCheckout` también revisa la suma antes de guardar nada.
- **Puente:** `checkoutSale({ saleId, cashReceivedCents, transfers })` valida con `parsePaymentRequest`, recalcula con el total guardado y cobra. Si no suma, devuelve `payment_refused` con la razón y no registra nada. `confirmPendingSale` recibe lo mismo, y no abre el cajón ni imprime.
- **Guardar antes de cobrar:** F12 llama a `savePendingSale` con una llave nueva (`crypto.randomUUID()`) y solo entonces abre el cobro. Si el catálogo cambió, el cajero lee un aviso y no se guarda nada. Esc cancela la venta guardada y deja los productos en pantalla.
- **Teclado:** F2 cobra, F5 llena el efectivo que falta, F6 llena la transferencia que falta, Esc vuelve. Terminada la venta, el cambio sigue a la vista hasta que el cajero oprime Enter o Esc.
- **Recuperación:** «Sí, se cobró» (F2) pasa a «¿Con qué se pagó?», con el mismo formulario. Así una venta que quedó a la mitad se registra con efectivo, transferencia o ambos.
- La pantalla maneja una transferencia por venta. El modelo y el puente aceptan varias (hasta 10).

## Consecuencias
- El corte (E1-23) suma el efectivo y las transferencias por separado desde `payment`. El efectivo de un pago mixto es neto del cambio.
- El cambio no se guarda: no hace falta para el corte, y el ticket lo recibe del resultado del cobro. E1-13 decide si lo imprime.
- Cajón e impresora siguen con los falsos hasta E1-14 y E1-13, así que hoy no abre ni imprime nada real.
- Si un precio cambió mientras se armaba la venta, el cajero debe quitar los productos y volver a agregarlos. E1-18 es la primera tarea que lo puede provocar.
- La tarjeta tecleada (E1-12) llega como un método más, con su folio obligatorio.
- Hasta que existan los roles (F0-14), cualquiera en la caja puede cobrar, cancelar o confirmar.
