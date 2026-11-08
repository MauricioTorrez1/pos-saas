# ADR 0025: Máquina de estados de la venta, con reglas también en la base

Estado: Aceptada · Fecha: 2026-11-08 · Concreta el ADR 0010 y RF-017.

## Contexto
El ADR 0010 pide guardar la venta como `pending_payment` antes de cobrar y resolverla al arrancar. E1-10 define las tablas, quién puede cambiar un estado, de dónde salen los importes que se guardan y cómo le pregunta la caja al cajero. Todavía no hay botón de cobro (llega con E1-11), así que la operación queda lista por el puente y la pantalla de recuperación ya funciona.

## Opciones
**Dónde viven las reglas de los estados**
1. **Solo en TypeScript.** Es simple, pero cualquier código futuro que escriba en la tabla, como la sincronización, podría saltárselas.
2. **`CHECK` en la tabla.** La base las hace cumplir, pero cambiar un `CHECK` obliga a reconstruir la tabla, y la Entrega 2 y E1-15 agregan estados.
3. **TypeScript y disparadores.** El código da un error claro y la base se niega aunque el código falle. Una migración puede reemplazar un disparador sin reconstruir nada.

**De dónde salen los importes**
1. **La pantalla los manda y el proceso principal los guarda.** Depende de que la pantalla tenga razón.
2. **La pantalla manda producto y cantidad, y el proceso principal calcula con el catálogo.** Si el catálogo cambió, el total guardado podría no ser el que vio el cliente.
3. **Lo anterior, y además comparar con el total en pantalla.** Si no coinciden, no se guarda nada y la pantalla se entera.

**Cómo pregunta la caja**
1. **Un diálogo que no deja vender hasta responder, una venta a la vez.** Ninguna se olvida.
2. **Un aviso que se puede dejar para después.** Deja vender de inmediato, pero una venta pendiente se puede quedar ahí semanas.

**Con qué teclas se responde**
1. **F2 y F4, con el teclado descansando en el diálogo.** El lector manda letras, dígitos y Enter, así que nunca responde por el cajero.
2. **Enter sobre un botón enfocado.** Una lectura accidental del lector confirmaría o cancelaría una venta.

## Decisión
- Opción 3 en las dos primeras preguntas y opción 1 en las otras dos.
- Hay tres estados: `pending_payment`, `completed` y `cancelled`. Solo se puede ir de `pending_payment` a `completed` o a `cancelled`. Cada cambio es una transacción, y `SaleStore` implementa el `SaleRecorder` del ADR 0010.
- `card_pending` es de la Entrega 2 y `partially_returned` y `returned` son de E1-15. **No se construyen aquí.** Cada uno llegará con una migración que reemplace el disparador `sale_follows_state_machine`.
- `sale`, `sale_line` y `payment` usan las escalas del ADR 0011, UUIDv7 y `tenant_id`. `(tenant_id, idempotency_key)` es único. La llave la crea la pantalla con `crypto.randomUUID()`: si llega dos veces, se devuelve la misma venta y no se crea otra.
- La base se niega a todo esto: empezar en otro estado, una transición que la máquina no tiene, cambiar importes o identidad, tocar una venta ya resuelta, borrar una venta, una línea o un pago, y agregar líneas o pagos a una venta que ya no está pendiente.
- Una venta `completed` debe tener pagos que sumen su total (invariante 5), y un disparador lo revisa. El pago y el nuevo estado se escriben en la misma transacción, así que **una fila de `payment` solo existe en ventas completadas**.
- **Existencias y corte (ADR 0010):** la vista `counted_sale` es la única definición de «venta que cuenta» y solo incluye `completed`. E1-23 y E1-25 deben leer de ella y de `payment`. E1-15 la reemplaza cuando existan las devoluciones.
- Cada línea guarda el nombre, el precio y la tasa con que se vendió, y `product_id` no tiene llave foránea, porque una venta debe sobrevivir a un producto que salga del catálogo.
- El diálogo usa `closedby="none"`, porque un `preventDefault` en el evento `cancel` no detiene a Chromium si se oprime Esc dos veces. El teclado vuelve al contenido después de cada respuesta, para que el Enter de una lectura no oprima el botón que se acaba de usar.

## Consecuencias
- Un error en el código ya no puede dejar una venta completada sin pago o con dos estados: lo detiene la base. Cada uno de los 12 disparadores tiene una prueba que falla si se quita.
- Confirmar registra un pago en efectivo por el total, porque es lo único que la caja puede cobrar hasta E1-11. El botón lo dice: «Sí, se cobró en efectivo». E1-11 y E1-12 tienen que agregar la forma de pago a esta pregunta, y no pueden dejarla fija.
- Al confirmar una venta recuperada no se abre el cajón ni se imprime ticket. E1-13 y E1-14 deciden si el cajón se abre y cómo se reimprime.
- Una llave que ya pertenece a una venta resuelta se rechaza por el índice único, con un error de SQLite. La pantalla nunca debería reusarla, así que no vale la pena un mensaje propio.
- Si lo que hay en pantalla se quedó atrás del catálogo, la venta no se guarda. E1-18 es la primera tarea que puede provocarlo, y E1-11 debe mostrar `catalog_changed` al cajero.
- Mientras haya ventas pendientes, la caja no vende. Hasta que existan los roles (F0-14), cualquiera en la caja puede confirmar o cancelar.
- Matar el proceso no es lo mismo que un corte de luz (ADR 0021). Apagar la PC de verdad queda en la lista de pendientes antes del piloto, y se puede hacer cuando E1-11 traiga el botón de cobro.
