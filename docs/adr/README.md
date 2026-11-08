# Decisiones de arquitectura (ADR)

Un ADR (Architecture Decision Record, registro de decisión de arquitectura) explica por qué se tomó una decisión. Ninguna decisión cambia sin un ADR nuevo que reemplace al anterior.

| ADR | Decisión | Estado |
| --- | --- | --- |
| [0001](0001-monolito-modular.md) | Monolito modular con Spring Modulith | Aceptada |
| [0002](0002-caja-electron.md) | Caja en Electron, pantalla separada del hardware | Aceptada |
| [0003](0003-libro-de-movimientos.md) | Inventario como libro de movimientos | Aceptada |
| [0004](0004-rls-multi-tenant.md) | Una base de datos con Row-Level Security | Aceptada |
| [0005](0005-outbox-y-kafka.md) | Outbox y Redpanda desde el inicio | Aceptada |
| [0006](0006-keycloak-y-pin-local.md) | Keycloak en la nube y PIN local en la caja | Aceptada |
| [0007](0007-promociones-json-logic.md) | Promociones con JSON Logic y acciones tipadas | Aceptada |
| [0008](0008-spring-boot-4.md) | Spring Boot 4.1 en lugar de 3 | Aceptada |
| [0009](0009-logica-local-typescript.md) | Lógica local en TypeScript con casos compartidos | Aceptada |
| [0010](0010-guardar-antes-de-cobrar.md) | Guardar la venta antes de cobrar | Aceptada |
| [0011](0011-precision-monetaria.md) | Centavos en totales y mayor escala en unitarios | Aceptada |
| [0012](0012-entregas-y-factura.md) | Factura en la Entrega 1 y terminal integrada en la 2 | Aceptada |
| [0013](0013-stack-completo.md) | Stack completo desde el inicio | Aceptada, precio por confirmar |
| [0014](0014-maven-uv-junit.md) | Maven, uv y JUnit 6 | Aceptada |
| [0015](0015-escaneo-de-seguridad.md) | Gitleaks, OSV-Scanner y Dependabot | Aceptada |
| [0016](0016-keycloak-en-postgresql.md) | Keycloak con base propia y stack local probado en cada PR | Aceptada |
| [0017](0017-n8n-y-dbt-locales.md) | n8n con SQLite y dbt v2 OSS bajo pedido | Aceptada |
| [0018](0018-escaneo-de-java-con-sbom.md) | Escaneo de Java con la lista real de Maven | Aceptada |
| [0019](0019-caja-primero.md) | Empezar por la caja y conectar el servidor después | Aceptada |
| [0020](0020-casos-compartidos.md) | Casos en JSON y cálculo de Java fuera de los módulos | Aceptada |
| [0021](0021-sqlite-de-la-caja.md) | SQLite de la caja con `node:sqlite` | Aceptada |
| [0022](0022-libreria-de-dinero.md) | Librería de dinero como código fuente, piezas enteras y lectura estricta de texto | Aceptada |
