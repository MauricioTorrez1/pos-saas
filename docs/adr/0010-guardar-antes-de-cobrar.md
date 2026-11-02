# ADR 0010: Guardar la venta antes de cobrar

Estado: Aceptada · Fecha: 2026-11-02 · Modifica el diagrama de venta.

## Contexto
El diagrama original cobraba y abría el cajón antes de guardar. Si la PC se apaga justo después de aprobar una tarjeta, queda un cobro sin venta y el corte no cuadra.

## Opciones
1. **Guardar al final.** Simple, pero pierde ventas ante un fallo.
2. **Guardar antes de cobrar, con máquina de estados.** Un paso extra y una recuperación al arrancar.

## Decisión
La venta se guarda como `pending_payment` en SQLite antes de cualquier cobro. Luego se cobra, se confirma como `completed`, se abre el cajón y se imprime. Con tarjeta tecleada, el cajero cobra en la terminal y captura el folio. Con terminal integrada (Entrega 2), un pago queda en `card_pending` hasta llegar a un estado final. Al arrancar, la caja muestra las ventas pendientes para resolverlas.

## Consecuencias
- Un apagón nunca deja un cobro sin rastro.
- No se puede ofrecer otra forma de pago mientras haya un cobro con tarjeta sin estado final, para evitar el cobro doble.
- Las ventas pendientes no cuentan en existencias ni en el corte hasta confirmarse.
