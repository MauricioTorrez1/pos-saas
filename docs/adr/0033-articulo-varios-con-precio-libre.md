# ADR 0033: Artículo varios con precio libre

Estado: Aceptada · Fecha: 2026-11-09 · Concreta la parte de artículo varios de RF-003. Las listas de precio quedan fuera. Se apoya en los ADR 0010, 0025 y 0032.

## Contexto
En una tlapalería siempre hay algo que no está en el catálogo: un tornillo suelto, un corte, un servicio. Eleventa lo resuelve con un «artículo varios» donde el cajero escribe el precio. Pero la regla de la caja es que el proceso principal pone los precios con el catálogo, no la pantalla. Un precio escrito a mano es justo lo que esa regla evita, así que hay que dejarlo pasar con control.

## Opciones
**Cómo entra un precio libre**
1. **Que la pantalla mande el precio como cualquier dato.** Rompe la regla: una pantalla equivocada podría cobrar lo que sea y nadie quedaría anotado.
2. **Una partida distinta, `miscellaneous`, que el proceso principal valida y aprueba.** La regla sigue en pie para los productos, y el precio libre es la excepción explícita.

**Quién lo aprueba**
1. **Cualquier cajero.** Rápido, pero un precio libre es la puerta para cobrar de menos.
2. **El dueño, con su sesión o, si vende un cajero, con el PIN del dueño.** Es lo mismo que ya se pide para sacar efectivo y aprobar una devolución.

**Qué pasa con el inventario**
1. **Crear un producto de verdad por cada artículo varios.** Llena el catálogo de basura.
2. **Un identificador fijo que no es un producto y que nunca mueve existencia.**

## Decisión
- Opción 2 en las tres preguntas.
- **Pantalla:** F2 abre «Artículo varios» con qué es, precio de cada uno (con IVA incluido), cantidad en piezas enteras y, si vende un cajero, el PIN del dueño. Cada artículo es su propia línea y no se junta con otro. El PIN vive en memoria solo hasta que se guarda o se vacía la venta.
- **Proceso principal:** una línea `miscellaneous` con descripción de hasta 60 caracteres y precio entero positivo en diezmilésimas. El IVA es el 16% ya incluido. El dueño que tiene la sesión abierta no necesita PIN. Un cajero sin PIN recibe `authorization_required`, y con uno incorrecto, `wrong_pin` o `locked`, con el mismo conteo de intentos de siempre; no se guarda nada.
- **Bitácora:** antes de guardar la venta se escribe en `audit_log` una entrada `sale.misc_item` por línea, con la descripción, la cantidad, el precio y quién lo aprobó. Va antes porque guardar y escribir no caben en una sola transacción, y así una venta guardada siempre tiene su entrada, incluso si la pantalla repite la petición con la misma llave. Si guardar falla, queda una entrada de un precio que se aprobó y no se usó, y eso es verdad.
- **Inventario:** las partidas se guardan con el producto fijo `00000000-0000-7000-8000-000000000000`. `postWith`, por donde pasan las ventas y las devoluciones, no escribe movimientos para ese identificador, y la revisión del libro tampoco los espera. Un artículo varios no cuenta como «sin costo» de un producto ni aparece en agotados, porque no está en el catálogo.
- **Ticket y devoluciones:** el nombre escrito sale en el ticket, y una devolución del artículo reembolsa su dinero y no repone nada.

## Consecuencias
- Un artículo varios no tiene costo, así que su venta entra a la ganancia como partida sin costo conocido.
- Solo se vende por pieza. Algo por metro o por kilo debe estar en el catálogo.
- Si el dueño quiere que un cajero venda varios sin PIN, necesita un permiso por persona, que no existe todavía.
- **Las listas de precio (mayoreo, por cliente) no están hechas.** Piden clientes y precios por cliente, y no hay pantalla ni datos de dónde salgan. Quedan para cuando haya clientes en el catálogo.
