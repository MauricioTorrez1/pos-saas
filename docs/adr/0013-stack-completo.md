# ADR 0013: Stack completo desde el inicio

Estado: Aceptada, precio por confirmar · Fecha: 2026-11-02 · Reemplaza la propuesta H23.

## Contexto
La propuesta H23 sugería arrancar solo con PostgreSQL, núcleo, Keycloak y Sentry. Mauricio eligió el stack completo, que además sirve de portafolio.

## Opciones
1. **Infraestructura ligera.** Servidor más barato y 25 a 40 horas menos de arranque.
2. **Stack completo.** Muestra más experiencia desde el inicio, con más RAM, costo y operación.

## Decisión
Desde fase 0 corren PostgreSQL, Redis, Redpanda, Keycloak, n8n, Prometheus, Loki, Tempo, Grafana, FastAPI y dbt con DuckDB, además de Sentry como servicio. Docker Compose usa los perfiles `core`, `observability`, `automation` y `analytics`, porque la PC de desarrollo tiene 16 GB de RAM.

## Consecuencias
- 25 a 40 horas extra antes de la Entrega 1, unas 2 a 3 semanas al ritmo de enero.
- **Precio sin resolver.** Agregadores daban unos 26 USD al mes por 16 GB, pero la página oficial de Hetzner muestra €120.99 por el CPX41 y lo marca como no disponible. Eso excede el presupuesto de $300 a $700 MXN.
- **Condición de revisión.** Antes de contratar, si no existe un servidor de 16 GB dentro del presupuesto, hay que elegir entre subir el presupuesto, otro proveedor, o usar en producción solo el perfil `core` y mantener los demás en local o en servicios administrados.
- Más servicios significan más parches y respaldos.
