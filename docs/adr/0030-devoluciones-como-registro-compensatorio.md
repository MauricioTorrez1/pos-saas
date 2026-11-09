# ADR 0030: Devoluciones como registro compensatorio

Estado: Aceptada · Fecha: 2026-11-08 · Concreta RF-019 y matiza el ADR 0025.

## Contexto
Una venta completada no se edita (invariante 2). Una devolución tiene que deshacer parte de ella, regresar el dinero por el mismo medio y dejar el corte cuadrado, sin tocar la venta.

## Opciones
**Cómo queda la venta devuelta**
1. **Estados nuevos `partially_returned` y `returned`**, como en el diagrama. La venta cambia de estado.
2. **La venta sigue `completed` y la devolución es un registro aparte.** La devolución se consulta junto a la venta, y lo devuelto se calcula.

**Cómo se reparte el reembolso de un pago mixto**
1. **Todo por el medio más cómodo, como efectivo.** Rompe el «mismo medio» del requisito.
2. **En proporción a lo que pagó cada medio, con el residuo al que más le toca.** Siempre suma exacto.

**Quién decide una excepción**
1. **El cajero, con un motivo.** Rápido, y fácil de abusar.
2. **Solo el dueño, con su PIN.** La regla por omisión rechaza.

## Decisión
- Opción 2 en las tres preguntas.
- Las tablas `sale_return`, `sale_return_line` y `refund_payment` guardan quién la pidió, quién la autorizó, el motivo y el reembolso por medio de pago. Ninguna se modifica ni se borra, y la base lo exige. **No se agregan estados nuevos a la venta**: el `counted_sale` sigue igual, y el corte y el inventario restan las devoluciones de su propia tabla.
- **Reembolso por línea:** la parte proporcional de lo que se pagó, redondeada hacia arriba desde medio centavo. Cuando vuelve lo último de una línea, se regresa exactamente lo que falte, así que las devoluciones de una línea nunca suman más ni menos de lo que costó. Se calcula con `BigInt`.
- **Nunca se devuelve más de lo vendido,** ni sumando varias devoluciones. Una pieza vuelve entera.
- **Reparto del reembolso:** proporcional a lo que cada medio pagó y todavía puede regresar. Un pago de $60 en efectivo y $40 por transferencia regresa $60 y $40.
- **Reglas por omisión:** se rechaza la devolución de una venta de más de 30 días y la de producto vendido por metro, kilo o litro (porque lo cortado no se puede volver a vender). El dueño puede hacer la excepción marcándola y con su PIN.
- **El dueño autoriza cada devolución.** Si pide el dueño, él mismo la autoriza. Si pide un cajero, necesita el PIN del dueño, y queda a nombre de los dos.
- El reembolso sale de la sesión de caja abierta, y sin sesión no se devuelve nada. La parte en efectivo baja el efectivo esperado, y la de tarjeta y transferencia baja lo esperado de cada una.
- La venta se busca por el folio del ticket (ADR 0027).

## Consecuencias
- El movimiento de inventario de la devolución llega con E1-25. Mientras tanto la devolución solo mueve dinero.
- La devolución de una tarjeta se regresa en la terminal aparte, y la caja solo lo recuerda. El de una transferencia, en el banco, con la misma referencia.
- La factura (E1-33) leerá estas tablas para la nota de crédito.
- El diagrama de estados del dominio ya no incluye `partially_returned` ni `returned` en esta caja.
- Probar los casos con la familia (devolver cable, un pago mixto, un ticket viejo) queda en la lista de pendientes antes del piloto.
