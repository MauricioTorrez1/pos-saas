# ADR 0005: Outbox y Redpanda desde el inicio

Estado: Aceptada · Fecha: 2026-11-02 · Modifica la especificación, que decía «outbox y después Kafka».

## Contexto
Cuando se confirma una venta, otros procesos deben enterarse (analítica, notificaciones). Publicar directo al broker puede perder eventos si la transacción y el envío no coinciden.

## Opciones
1. **Solo outbox, con Kafka después.** Lo más ligero.
2. **Kafka directo, sin outbox.** Riesgo de eventos perdidos o fantasma.
3. **Outbox y broker desde el inicio.** Fiable y sirve de portafolio, con más operación.

## Decisión
Outbox transaccional con el registro de publicación de eventos de Spring Modulith, y Redpanda (compatible con la API de Kafka) como bus desde fase 0. Se elige por decisión explícita de stack completo ([ADR 0013](0013-stack-completo.md)). Todo evento lleva `event_id` UUIDv7, `tenant_id` y versión de esquema.

## Consecuencias
- Si el broker se cae, la venta no se detiene: los eventos esperan en el outbox.
- Los consumidores deben ser idempotentes, porque la entrega es «al menos una vez».
- Redpanda consume RAM aunque al inicio casi no tenga consumidores.
- El núcleo nunca depende del broker para cerrar una venta.
