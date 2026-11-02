# ADR 0001: Monolito modular con Spring Modulith

Estado: Aceptada · Fecha: 2026-11-02

## Contexto
Una sola persona construye y opera el núcleo. Una venta toca catálogo, pagos, caja e inventario, y cuando una venta de cable descuenta existencia, ambas cosas deben quedar consistentes.

## Opciones
1. **Microservicios.** Despliegue independiente y escalado por servicio, a cambio de red entre módulos, transacciones distribuidas y mucha operación.
2. **Monolito sin fronteras.** Lo más rápido al inicio, pero los módulos terminan acoplados.
3. **Monolito modular.** Un solo despliegue con fronteras verificadas por pruebas.

## Decisión
Monolito modular con Spring Modulith. Módulos iniciales: `identity`, `catalog`, `sales`, `payments`, `cash`, `inventory`, `invoicing`, `sync` y `reporting`. Cada módulo expone una API pública y publica eventos; ningún módulo toca las tablas de otro. Python queda como servicio aparte solo para analítica e IA.

## Consecuencias
- Una transacción local basta en la mayoría de los casos.
- `ApplicationModules.verify()` corre en CI y rompe el build si alguien cruza una frontera.
- Extraer un módulo después sigue siendo posible porque ya se comunica por eventos.
- Todo el núcleo escala junto. Es aceptable en esta etapa.
