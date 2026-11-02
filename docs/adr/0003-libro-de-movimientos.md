# ADR 0003: Inventario como libro de movimientos

Estado: Aceptada · Fecha: 2026-11-02

## Contexto
Dos ventas sin internet del mismo rollo de cable no deben pisarse al sincronizar, y cada ajuste debe quedar auditado.

## Opciones
1. **Columna `stock` que se actualiza.** Simple, pero las actualizaciones concurrentes pierden datos y no hay historia.
2. **Libro de movimientos inmutable.** La existencia es la suma; ofrece historia completa a cambio de una proyección para leer rápido.
3. **Event sourcing en todo el sistema.** Más poderoso, pero excesivo para una persona.

## Decisión
Tabla `stock_movements` inmutable, con tipos como `opening_balance`, `sale`, `return`, `adjustment`, `shrinkage` y `purchase_receipt`. La tabla `stock_levels` es una proyección que se puede reconstruir. Las correcciones se hacen con movimientos compensatorios, nunca con `UPDATE` ni `DELETE`. La existencia puede quedar negativa: la venta no se frena y se genera una alerta. Las cantidades se guardan en milésimas con unidad base (metro, kilo, pieza).

## Consecuencias
- Dos cajas se concilian sumando movimientos, sin conflicto en la cantidad.
- El kardex sale directo del libro.
- La importación desde Eleventa entra como movimientos con `source = import`.
- La proyección debe verificarse periódicamente contra la suma.
