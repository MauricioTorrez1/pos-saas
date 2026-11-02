# ADR 0007: Promociones con JSON Logic y acciones tipadas

Estado: Aceptada · Fecha: 2026-11-02 · Aplica desde fase 3.

## Contexto
La misma promoción debe evaluarse igual en la caja (TypeScript) y en el servidor (Java). JSON Logic decide si una regla aplica, pero no reparte un 2x1 o un combo entre líneas.

## Opciones
1. **Reglas en código.** Cada promoción nueva requeriría desplegar.
2. **Motor externo (Drools y similares).** Solo corre en Java y no sirve sin internet.
3. **JSON Logic más acciones tipadas.** Portátil y configurable; hay que escribir el repartidor en ambos lenguajes.

## Decisión
Cada regla se compone de condición JSON Logic, acción tipada (`percent_off`, `amount_off`, `buy_x_get_y`, `volume_price`, `bundle_price`), prioridad, acumulación y vigencia. Solo se usan enteros, sin división dentro de la condición. Los casos de prueba en `packages/contracts` corren en TypeScript y en Java. En fase 1 existe solo la interfaz `PromotionEngine`, con una implementación vacía.

## Consecuencias
- Crear un 3x2 en clavos no requiere desplegar.
- Dos implementaciones del repartidor, protegidas por los mismos casos.
- Sin internet, los cupones de un solo uso no se pueden validar, así que no se aceptan.
- Una diferencia entre caja y servidor se registra como discrepancia; nunca anula una venta cerrada ([ADR 0009](0009-logica-local-typescript.md)).
