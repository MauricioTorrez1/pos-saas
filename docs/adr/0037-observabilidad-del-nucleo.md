# ADR 0037: Observabilidad del núcleo con OpenTelemetry, `tenant_id` y Sentry

Estado: Aceptada · Fecha: 2026-11-10 · Concreta F0-11. Se apoya en los ADR 0013 y 0035 y en el colector de F0-05.

## Contexto
El stack de observabilidad (colector OTLP, Tempo, Prometheus, Loki, Grafana) ya corre en Compose, pero el núcleo no le envía nada. Hace falta que cada petición deje traza, métrica y log con el negocio al que pertenece, sin datos personales, y que los errores lleguen a Sentry.

## Opciones
**Cómo salen las señales**
1. **`spring-boot-starter-opentelemetry`**: Micrometer genera trazas, métricas y logs y Spring Boot los envía por OTLP al colector. Sin agente Java aparte.
2. **Agente de OpenTelemetry (`-javaagent`).** Instrumenta de más, pero es un binario extra que desplegar y configurar.

**Dónde va el `tenant_id`**
1. **En el log (MDC) y en la traza (atributo de alta cardinalidad)**, nunca como etiqueta de métrica.
2. **Como etiqueta de métrica.** Una serie de Prometheus por negocio: la cardinalidad crece con los clientes.

## Decisión
- `spring-boot-starter-opentelemetry` envía trazas, métricas y logs por OTLP/HTTP al colector (`OTEL_EXPORTER_OTLP_ENDPOINT`, por defecto `http://localhost:4318`). Muestreo del 100 % en desarrollo y configurable con `CORE_TRACING_SAMPLING`.
- `TenantContext` guarda `tenant_id` en el MDC (contexto de logging); el patrón de log muestra `[servicio,traceId,spanId,tenant_id]`. Un `ObservationFilter` agrega `tenant.id` a cada span; ninguna métrica lo lleva como etiqueta.
- Sentry (`sentry-spring-boot-4`) con `send-default-pii=false`; un DSN vacío lo apaga. Un `BeforeSendCallback` etiqueta cada error con el `tenant_id`.
- Regla de logs: nunca nombres, teléfonos, correos, PIN, tokens ni datos de tarjeta; solo ids.

## Consecuencias
- Una prueba de integración comprueba que una línea de log escrita dentro de una petición trae el `trace_id` de su span y el `tenant_id`.
- Con el perfil `observability` activo, una petición se sigue en Grafana: Tempo (traza), Loki (log por `trace_id`) y Prometheus (métrica).
- Sentry agrega al log la agrupación de errores, la frecuencia y el aviso; Loki solo guarda el texto.
- Falta programar el reenvío periódico de eventos pendientes del outbox (ADR 0036) con una métrica de pendientes; queda para la tarea que cree el primer evento real.
- Sin `SENTRY_DSN`, ningún error sale del equipo.
