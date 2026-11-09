# ADR 0032: Ajustes, mermas, kardex, bitácora y reporte del día

Estado: Aceptada · Fecha: 2026-11-09 · Concreta RF-030, RF-031, RF-040 y RF-049 en la parte local, y se apoya en los ADR 0003 y 0031.

## Contexto
Con el inventario por movimientos (ADR 0031), el dueño necesita corregir lo que el conteo contradice, anotar lo que se perdió, ver de dónde sale la existencia de un producto y saber cómo le fue en el día. Todo debe funcionar sin servidor y sin poder dañar los libros.

## Opciones
**Cómo se corrige una existencia**
1. **Editar el número.** Simple, pero borra el rastro y rompe la regla de que el libro no se edita.
2. **Un movimiento nuevo de tipo `adjustment` o `waste`, con motivo y con quién lo hizo.** Cada corrección queda explicada.

**Dónde queda quién, cuándo y por qué**
1. **Una columna `motivo` en el movimiento.** Sirve para el inventario, pero otras acciones delicadas (un precio escrito a mano, por ejemplo) no tendrían dónde.
2. **Una bitácora `audit_log` que solo se agrega, y el movimiento y su entrada se escriben en la misma transacción.** Sirve para todo lo que venga, y un cambio nunca queda sin su entrada.

**Cómo se sabe que el libro dice la verdad**
1. **Confiar en que cada venta lo escribió.** Un fallo pasaría sin que nadie lo vea.
2. **Compararlo con las ventas y las devoluciones cuando el dueño lo pide.** Cuesta una lectura de la base, y encuentra lo que falta, lo que sobra y lo que no coincide.

## Decisión
- Opción 2 en las tres preguntas.
- **Ajustes y mermas:** solo el dueño. Una merma siempre saca existencia, y un ajuste puede sumar o restar (en pantalla se llaman merma, sobrante y faltante, y la caja pone el signo). La cantidad no puede ser cero y el motivo es obligatorio. El movimiento y su entrada en `audit_log` se escriben en una sola transacción: si la bitácora falla, la existencia no cambia.
- **Bitácora:** `audit_log` guarda quién, qué, sobre qué, el detalle y cuándo, con disparadores que impiden editar o borrar (migración 11).
- **Kardex:** el historial de un producto con el saldo después de cada movimiento, calculado con una suma acumulada sobre todo el historial y recortado a los 50 más recientes, así que el último saldo siempre es la existencia.
- **Verificación del libro:** cada partida de una venta completada debe tener exactamente un movimiento `sale_line` con su producto y su cantidad, lo mismo con las devoluciones, y ningún movimiento de venta o devolución puede quedar sin partida. Reporta `sale_without_movement`, `return_without_movement`, `movement_without_source` y `wrong_quantity`. Solo lee.
- **Reporte del día:** solo el dueño y solo lectura. Ventas, total, ticket promedio, devoluciones, ventas por hora (en la hora de la caja) y por cajero, margen y dos listas de producto: agotados (existencia en cero o negativa) y con existencia pero sin ventas en 30 días. El margen es lo vendido antes de IVA menos el último costo conocido de cada producto; las partidas sin costo se cuentan aparte y no entran.
- Todo se alcanza desde Administración (F1): F2 inventario, F3 revisar el libro y F4 reporte.

## Consecuencias
- El costo del margen es el último que cargó Eleventa, no el costo promedio: E1-28 lo sustituye cuando exista.
- La verificación lee todas las partidas y movimientos. Con decenas de miles de ventas puede tardar un poco, y por eso la pide el dueño y no corre sola.
- **E1-09 (artículo varios y listas de precio) no entra en este lote.** Un artículo de precio libre rompe la regla de que el proceso principal pone los precios con el catálogo, y toca la pantalla de venta, el cobro y el libro de inventario (una partida sin producto no debe mover existencia). Eso merece su propio diseño y sus pruebas, no una prisa al final de un lote. Mientras tanto, los productos de precio variable se pueden dar de alta en el catálogo.
- Los reportes por correo (E1-24) y la exportación a Excel necesitan servidor o diseño aparte y quedan fuera.
