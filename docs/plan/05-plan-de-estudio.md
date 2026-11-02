# Plan de estudio

Temas en orden, con recursos gratuitos y un ejercicio corto. Como Claude escribe el código hasta salir de Eleventa, el objetivo inicial es poder **leerlo, cuestionarlo y explicarlo en una entrevista**. La prioridad es Java.

Regla de oro: si no puedes explicar un cambio en tus palabras, no lo apruebes todavía.

## Antes de la Fase 0
| # | Tema | Recurso | Ejercicio |
| --- | --- | --- | --- |
| 1 | Java moderno: records, `sealed`, `Optional`, streams | [Dev.java](https://dev.java/learn/) | Modela `Money` como `record` que rechace negativos |
| 2 | Spring Boot: inyección, configuración, capas | [Guías de Spring](https://spring.io/guides) | Crea un endpoint `GET /products/{id}` en memoria |
| 3 | SQL: joins, agregaciones, transacciones | [Tutorial de PostgreSQL](https://www.postgresql.org/docs/16/tutorial.html) | Calcula la existencia de un cable sumando movimientos |
| 4 | Git, PR y Conventional Commits | [Pro Git](https://git-scm.com/book/es/v2) | Abre un PR de práctica y escribe su descripción |
| 5 | Docker y Compose | [Introducción a Docker](https://docs.docker.com/get-started/) | Levanta PostgreSQL con un volumen y comprueba que los datos sobreviven |

## Durante la Fase 0
| # | Tema | Recurso | Ejercicio |
| --- | --- | --- | --- |
| 6 | Row-Level Security | [PostgreSQL RLS](https://www.postgresql.org/docs/16/ddl-rowsecurity.html) | Crea dos negocios e intenta ver las filas del otro |
| 7 | Migraciones con Flyway | [Flyway](https://documentation.red-gate.com/flyway) | Agrega una columna y explica por qué no se edita una migración vieja |
| 8 | Spring Modulith y eventos | [Spring Modulith](https://docs.spring.io/spring-modulith/reference/) | Haz que un módulo reaccione a un evento de otro |
| 9 | Patrón outbox | [Transactional Outbox](https://microservices.io/patterns/data/transactional-outbox.html) | Dibuja qué pasa si el broker cae tras confirmar una venta |
| 10 | OAuth 2.0 y OIDC | [OpenID Connect](https://openid.net/developers/how-connect-works/) | Decodifica tu token y explica cada claim |
| 11 | Pruebas con JUnit y Testcontainers | [JUnit](https://junit.org/) y [Testcontainers](https://java.testcontainers.org/) | Prueba un repositorio contra PostgreSQL real |
| 12 | Observabilidad | [OpenTelemetry](https://opentelemetry.io/docs/concepts/) | Sigue una petición lenta en Grafana |

## Antes de la Entrega 1
| # | Tema | Recurso | Ejercicio |
| --- | --- | --- | --- |
| 13 | TypeScript | [Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) | Tipa una línea de venta con unidades |
| 14 | React | [React](https://react.dev/learn) | Haz un carrito que sume cable y clavo |
| 15 | Electron y seguridad | [Seguridad en Electron](https://www.electronjs.org/docs/latest/tutorial/security) | Explica qué hace `preload` |
| 16 | SQLite y WAL | [WAL](https://www.sqlite.org/wal.html) | Guarda una venta y un `sync_outbox` en una transacción |
| 17 | Dinero y redondeo | [ADR 0011](../adr/0011-precision-monetaria.md) | Calcula a mano 3.275 m a $12.50 |
| 18 | Idempotencia y sistemas sin conexión | [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110#name-idempotent-methods) | Explica qué pasa si un lote llega dos veces |
| 19 | ESC/POS | [Referencia de Epson](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/) | Identifica el comando que abre el cajón |
| 20 | CFDI 4.0 | [Facturapi](https://docs.facturapi.io/) | Crea una factura en modo de prueba para un clavo |

## Antes de la Entrega 2
| # | Tema | Recurso | Ejercicio |
| --- | --- | --- | --- |
| 21 | Webhooks seguros | [Notificaciones de Mercado Pago](https://www.mercadopago.com.mx/developers/en/docs/mp-point/notifications.md) | Valida una firma con un ejemplo |
| 22 | Procesos asíncronos y condiciones de carrera | [Procesar pagos](https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md) | Dibuja qué pasa si cancelas mientras el cliente paga |

## Antes de la Fase 2
| # | Tema | Recurso | Ejercicio |
| --- | --- | --- | --- |
| 23 | Niveles de aislamiento | [PostgreSQL](https://www.postgresql.org/docs/16/transaction-iso.html) | Reproduce dos ventas a crédito simultáneas |
| 24 | Rendimiento de consultas | [`EXPLAIN`](https://www.postgresql.org/docs/16/using-explain.html) | Mejora un reporte con un índice |
| 25 | Seguridad web | [OWASP Top 10](https://owasp.org/Top10/) | Busca un IDOR en la consulta de folio |

## Antes de la Fase 3
| # | Tema | Recurso | Ejercicio |
| --- | --- | --- | --- |
| 26 | Next.js: renderizado y caché | [Next.js](https://nextjs.org/docs) | Publica un catálogo con revalidación |
| 27 | Motores de reglas con JSON Logic | [JSON Logic](https://jsonlogic.com/) | Escribe la condición de un 3x2 en clavo |
| 28 | Pruebas basadas en propiedades | [jqwik](https://jqwik.net/docs/current/user-guide.html) | Prueba que un descuento nunca supera el total |

## Antes de la Fase 4
| # | Tema | Recurso | Ejercicio |
| --- | --- | --- | --- |
| 29 | Diseño de API públicas | [OWASP API Security](https://owasp.org/API-Security/) | Diseña llaves con revocación y límite |
| 30 | Terraform y AWS | [Terraform](https://developer.hashicorp.com/terraform/docs) | Define un servidor sin secretos en el repositorio |

## Antes de la Fase 5
| # | Tema | Recurso | Ejercicio |
| --- | --- | --- | --- |
| 31 | Python moderno y Polars | [Polars](https://docs.pola.rs/) | Calcula ventas por día con datos sintéticos |
| 32 | dbt y modelado | [dbt](https://docs.getdbt.com/) | Crea un modelo con pruebas |
| 33 | Aprendizaje automático básico | [scikit-learn](https://scikit-learn.org/stable/) | Compara un modelo contra una base ingenua |
| 34 | Aplicaciones con LLM | [Docs de Claude](https://docs.claude.com/) | Escribe un prompt y sus casos de evaluación |

## Preparación para entrevistas de Java
Al terminar cada hito, practica en voz alta las preguntas de entrevista de sus fichas. Prepara además estas historias con evidencia del repositorio:

1. Cómo garantizas que un negocio no vea datos de otro.
2. Cómo una venta sin internet no se duplica ni se pierde.
3. Por qué el dinero no usa `double`.
4. Qué harías distinto en una segunda versión.
5. Qué parte escribió una IA, qué revisaste y qué corregiste. Sé transparente: revisar bien también es una habilidad.
