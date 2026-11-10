# Fase 0: Base técnica, catálogo y panel

Duración estimada: 108 horas. Reparto: Claude escribe y explica; tú revisas, pruebas y apruebas.

## Hito F0-A: Repositorio y CI

### F0-01 · Inicializar repositorio y monorepo
- **Objetivo:** el repositorio de GitHub tiene la estructura del monorepo y una licencia AGPL-3.0.
- **Conceptos:** [Git], [pnpm workspaces], [Conventional Commits]
- **Claude / tú:** Claude crea la estructura, `.gitignore`, `.env.example` y README bilingüe. Tú revisas que no haya secretos y haces el primer push.
- **Pruebas:** verificación en CI de que `.env` está ignorado.
- **Criterios:** `pnpm install` funciona y el README explica el proyecto.
- **Depende de:** nada · **Estimación:** 2 h
- **Autoevaluación:** (1) ¿Qué problema resuelve un monorepo aquí? (2) ¿Por qué `.env.example` no lleva valores reales? (3) ¿Qué implica AGPL para quien ofrece el sistema como servicio?
- **Entrevista:** (1) ¿Monorepo o varios repositorios? Defiende una opción. (2) ¿Cómo evitas subir secretos a Git?

### F0-02 · CI base en GitHub Actions
- **Objetivo:** cada PR compila y prueba Java, TypeScript y Python.
- **Conceptos:** [GitHub Actions], [Testcontainers]
- **Claude / tú:** Claude escribe los workflows y la caché. Tú abres un PR que falle a propósito.
- **Pruebas:** un PR con una prueba rota queda en rojo.
- **Criterios:** tres trabajos en verde en menos de 10 minutos.
- **Depende de:** F0-01 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Qué dispara cada workflow? (2) ¿Qué ahorra la caché? (3) ¿Por qué CI debe fallar con una sola prueba rota?
- **Entrevista:** (1) ¿Qué pones en un pipeline mínimo? (2) ¿Cómo reduces el tiempo de CI?

### F0-03 · Escaneo de secretos y dependencias
- **Objetivo:** CI bloquea secretos filtrados y avisa de dependencias vulnerables.
- **Conceptos:** [Secret scanning], [Dependabot]
- **Claude / tú:** Claude configura las herramientas. Tú activas las opciones del repositorio.
- **Pruebas:** un secreto falso en una rama bloquea el PR.
- **Criterios:** cumple RNF-08, con alertas activas y documentadas en el README.
- **Depende de:** F0-02 · **Estimación:** 2 h
- **Autoevaluación:** (1) ¿Qué haces si se filtra una llave? (2) ¿Por qué borrar el commit no basta? (3) ¿Qué es una dependencia transitiva?
- **Entrevista:** (1) ¿Cómo respondes a una filtración de credenciales? (2) ¿Qué es la seguridad de la cadena de suministro?

## Hito F0-B: Stack local

### F0-04 · Compose: perfil `core`
- **Objetivo:** PostgreSQL 16, Keycloak, Redis y Redpanda corren con un solo comando.
- **Conceptos:** [Docker Compose], [PostgreSQL], [Redpanda]
- **Claude / tú:** Claude escribe el Compose con volúmenes y `healthcheck`. Tú lo levantas y mides la RAM.
- **Pruebas:** script que espera a que todos los servicios estén sanos.
- **Criterios:** `docker compose --profile core up` queda sano en menos de 2 minutos.
- **Depende de:** F0-01 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Para qué sirve un volumen? (2) ¿Qué comprueba un `healthcheck`? (3) ¿Cómo se comunican los contenedores?
- **Entrevista:** (1) ¿Imagen o contenedor? Explica la diferencia. (2) ¿Por qué no guardar datos dentro de un contenedor?

### F0-05 · Compose: perfil `observability`
- **Objetivo:** Prometheus, Loki, Tempo y Grafana muestran datos de prueba.
- **Conceptos:** [OpenTelemetry], [Prometheus], [Grafana]
- **Claude / tú:** Claude configura el colector y un tablero inicial. Tú interpretas el tablero.
- **Pruebas:** una traza y una métrica de prueba aparecen en Grafana.
- **Criterios:** tablero provisionado desde archivos del repositorio.
- **Depende de:** F0-04 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué diferencia hay entre métrica, log y traza? (2) ¿Para qué sirve el colector? (3) ¿Qué es un percentil p95?
- **Entrevista:** (1) ¿Monitoreo u observabilidad? (2) ¿Qué alertarías primero en un POS?

### F0-06 · Compose: perfiles `automation` y `analytics`
- **Objetivo:** n8n, un servicio FastAPI mínimo y un proyecto dbt con DuckDB corren en local.
- **Conceptos:** [n8n], [FastAPI], [dbt], [DuckDB]
- **Claude / tú:** Claude crea el andamiaje. Tú ejecutas un modelo dbt de ejemplo.
- **Pruebas:** `pytest` del endpoint de salud y `dbt test`.
- **Criterios:** cada perfil arranca solo, sin exigir los demás.
- **Depende de:** F0-04 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Por qué usar perfiles? (2) ¿Qué hace dbt y qué no? (3) ¿Por qué Python no contiene lógica de negocio?
- **Entrevista:** (1) ¿ETL o ELT? (2) ¿Cuándo DuckDB en lugar de PostgreSQL?

## Hito F0-C: Núcleo

### F0-07 · Esqueleto de Spring Boot 4.1
- **Objetivo:** el núcleo arranca con módulos verificados y las versiones confirmadas.
- **Conceptos:** [Spring Boot], [Spring Modulith]
- **Claude / tú:** Claude crea el proyecto y los módulos vacíos. Tú confirmas fechas de soporte y actualizas el ADR 0008.
- **Pruebas:** `ApplicationModules.verify()` y prueba de arranque.
- **Criterios:** CI falla si un módulo accede a la parte interna de otro.
- **Depende de:** F0-02 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué es una frontera de módulo? (2) ¿Qué hace la autoconfiguración? (3) ¿Por qué no usar microservicios aquí?
- **Entrevista:** (1) ¿Monolito modular o microservicios? (2) ¿Cómo evitas que un monolito se vuelva un desorden?

### F0-08 · Flyway y modelo base
- **Objetivo:** existen `tenant`, `branch`, `register` y `app_user` con UUIDv7.
- **Conceptos:** [Flyway], [UUIDv7]
- **Claude / tú:** Claude escribe las migraciones. Tú las lees y das de alta tu negocio de prueba.
- **Pruebas:** migración completa en Testcontainers.
- **Criterios:** una base vacía queda al día sin pasos manuales.
- **Depende de:** F0-07 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Por qué no editar una migración ya aplicada? (2) ¿Qué ventaja da UUIDv7 frente a UUIDv4? (3) ¿Por qué `register` existe si hay una sola caja?
- **Entrevista:** (1) ¿Cómo haces una migración sin tiempo fuera? (2) ¿Secuencia o UUID como llave primaria?

### F0-09 · RLS y prueba de aislamiento
- **Objetivo:** ningún negocio puede leer filas de otro.
- **Conceptos:** [Row-Level Security], [SET LOCAL]
- **Claude / tú:** Claude escribe políticas, roles y el aspecto que fija `tenant_id`. Tú intentas romperlo con una consulta.
- **Pruebas:** Testcontainers recorre todas las tablas y prueba acceso cruzado.
- **Criterios:** cumple RF-010 y RNF-06: una tabla nueva sin política rompe CI.
- **Depende de:** F0-08 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué hace `FORCE ROW LEVEL SECURITY`? (2) ¿Por qué `SET LOCAL` y no `SET`? (3) ¿Qué pasa sin `tenant_id` fijado?
- **Entrevista:** (1) ¿Cómo aíslas datos en un SaaS? (2) ¿Qué riesgo tiene un pool de conexiones con RLS?

### F0-10 · Outbox hacia Redpanda
- **Objetivo:** un evento de prueba llega a Redpanda solo si la transacción se confirma.
- **Conceptos:** [Eventos en Modulith], [Kafka]
- **Claude / tú:** Claude configura el registro de eventos y el productor. Tú apagas Redpanda y compruebas que el evento espera.
- **Pruebas:** Testcontainers con transacción revertida y con broker caído.
- **Criterios:** ningún evento se pierde ni aparece sin transacción.
- **Depende de:** F0-09 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué problema resuelve el outbox? (2) ¿Qué significa «al menos una vez»? (3) ¿Por qué el consumidor debe ser idempotente?
- **Entrevista:** (1) Explica el patrón outbox. (2) ¿Qué garantías de entrega ofrece Kafka?

### F0-11 · Observabilidad del núcleo
- **Objetivo:** cada petición genera traza, métrica y log con `tenant_id`, y los errores llegan a Sentry.
- **Conceptos:** [Spring Observability], [Sentry]
- **Claude / tú:** Claude configura la instrumentación sin datos personales. Tú provocas un error y lo encuentras.
- **Pruebas:** prueba de integración del `trace_id` en los logs.
- **Criterios:** se sigue una petición de punta a punta en Grafana.
- **Depende de:** F0-05, F0-07 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué es un `trace_id`? (2) ¿Qué no debe ir en un log? (3) ¿Qué agrega Sentry a Loki?
- **Entrevista:** (1) ¿Cómo depuras una petición lenta en producción? (2) ¿Qué es un SLO?

### F0-12 · Bitácora de auditoría
- **Objetivo:** cada cambio sensible queda registrado sin poder editarse.
- **Conceptos:** [Triggers en PostgreSQL], [OWASP Logging]
- **Claude / tú:** Claude escribe `audit_log` y su API interna. Tú compruebas que el rol de la aplicación no puede borrar.
- **Pruebas:** Testcontainers: `UPDATE` y `DELETE` fallan.
- **Criterios:** cumple RF-040 y RNF-07: guarda usuario, hora, valor anterior y valor nuevo.
- **Depende de:** F0-09 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Qué eventos se auditan? (2) ¿Cómo se garantiza que no se edite? (3) ¿Qué datos no deben guardarse?
- **Entrevista:** (1) ¿Cómo diseñas una bitácora a prueba de manipulación? (2) ¿Auditoría o logs? Explica la diferencia.

## Hito F0-D: Identidad

### F0-13 · Keycloak y login con OIDC
- **Objetivo:** el núcleo valida tokens con `tenant_id` como claim.
- **Conceptos:** [Keycloak], [OpenID Connect], [Spring Security]
- **Claude / tú:** Claude exporta el realm al repositorio sin secretos y configura el servidor de recursos. Tú haces el login y lees tu token.
- **Pruebas:** Testcontainers: sin token 401, token válido 200.
- **Criterios:** el realm se importa solo al levantar Compose.
- **Depende de:** F0-04, F0-09 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué firma un JWT? (2) ¿Dónde se valida el token? (3) ¿Qué es un claim?
- **Entrevista:** (1) ¿OAuth 2.0 u OIDC? (2) ¿Cómo revocas un JWT?

### F0-14 · Roles y autorización
- **Objetivo:** dueño, cajero, almacenista y técnico tienen permisos distintos.
- **Conceptos:** [Autorización en Spring]
- **Claude / tú:** Claude escribe permisos por endpoint. Tú revisas la tabla de permisos con tu familia.
- **Pruebas:** matriz de rol y endpoint con 200 o 403.
- **Criterios:** un cajero no puede cambiar precios (RF-008).
- **Depende de:** F0-13, F0-12 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿401 o 403? (2) ¿Rol o permiso? (3) ¿Por qué validar en el servidor además de ocultar el botón?
- **Entrevista:** (1) ¿RBAC o ABAC? (2) ¿Qué es el principio de mínimo privilegio?

### F0-15 · Registro de caja y PIN en el servidor
- **Objetivo:** una caja se registra una vez y recibe los hashes de PIN.
- **Conceptos:** [Argon2], [Password Storage]
- **Claude / tú:** Claude escribe `POST /registers/enroll` y la gestión de PIN. Tú registras una caja de prueba.
- **Pruebas:** unitarias de hash y bloqueo, e integración de registro.
- **Criterios:** el PIN nunca se guarda en texto plano; 5 errores lo bloquean (RF-009).
- **Depende de:** F0-14 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Por qué Argon2 y no SHA-256? (2) ¿Qué es una sal? (3) ¿Qué riesgo tiene un PIN corto?
- **Entrevista:** (1) ¿Cómo guardas contraseñas? (2) ¿Cómo autenticas un dispositivo sin conexión?

## Hito F0-E: Catálogo

### F0-16 · Productos, códigos y unidades
- **Objetivo:** un rollo de 100 m se registra con unidad base metro y varios códigos.
- **Conceptos:** [Spring Data JPA], [Bean Validation]
- **Claude / tú:** Claude escribe entidades y API. Tú capturas un cable y un clavo de prueba.
- **Pruebas:** unitarias de conversión e integración de código único por negocio.
- **Criterios:** cumple RF-001 y RF-002.
- **Depende de:** F0-14 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Por qué una unidad base? (2) ¿Cómo se guarda 3.275 m? (3) ¿Qué hace único a un código?
- **Entrevista:** (1) ¿Qué es un agregado en DDD? (2) ¿Cómo evitas el problema N+1 en JPA?

### F0-17 · Precios, impuestos y claves SAT
- **Objetivo:** cada producto tiene listas de precio, IVA y claves SAT.
- **Conceptos:** [Catálogos del SAT], [BigDecimal]
- **Claude / tú:** Claude escribe el modelo y las validaciones. Tú confirmas las claves SAT de 10 productos con el contador.
- **Pruebas:** unitarias de escala de precio e integración del reporte de pendientes.
- **Criterios:** cumple RF-003 y RF-004, con precios `e4`.
- **Depende de:** F0-16 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Por qué `e4` en precios? (2) ¿Qué es una clave de unidad SAT? (3) ¿Cómo afecta un IVA incluido al desglose?
- **Entrevista:** (1) ¿Por qué `double` es incorrecto para dinero? (2) ¿Cómo modelas precios por cliente?

### F0-18 · Importación de catálogo
- **Objetivo:** un CSV entra con reporte de errores por fila, incluyendo la plantilla de Eleventa.
- **Conceptos:** [Spring Batch], [Apache Commons CSV]
- **Claude / tú:** Claude escribe el importador. Tú das un archivo real de Eleventa, fuera del repositorio.
- **Pruebas:** archivos sintéticos con errores e importación repetida.
- **Criterios:** cumple RF-005 y repetir la importación no duplica.
- **Depende de:** F0-17 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Por qué validar por fila? (2) ¿Cómo evitas duplicar? (3) ¿Dónde se guarda el archivo real?
- **Entrevista:** (1) ¿Cómo importas un millón de filas? (2) ¿Qué significa que un proceso sea idempotente?

### F0-19 · Cambio masivo de precios
- **Objetivo:** el dueño sube 5% a una marca con vista previa.
- **Conceptos:** [Transacciones en Spring]
- **Claude / tú:** Claude escribe la operación con vista previa. Tú pruebas con la marca Truper de prueba.
- **Pruebas:** integración con bitácora y evento `ProductPriceChanged`.
- **Criterios:** cumple RF-006.
- **Depende de:** F0-17, F0-10, F0-12 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Por qué mostrar vista previa? (2) ¿Qué pasa si falla a la mitad? (3) ¿Cómo llega el cambio a la caja?
- **Entrevista:** (1) ¿Qué garantiza `@Transactional`? (2) ¿Cómo diseñas una operación masiva segura?

## Hito F0-F: Panel y contratos

### F0-20 · Panel Next.js con login
- **Objetivo:** el dueño entra al panel por Keycloak.
- **Conceptos:** [Next.js], [TypeScript]
- **Claude / tú:** Claude crea la app y el login OIDC. Tú pruebas sesión y cierre.
- **Pruebas:** Vitest y un flujo de login con Playwright.
- **Criterios:** rutas protegidas según el rol.
- **Depende de:** F0-13 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Dónde vive el token? (2) ¿Qué es renderizado en servidor? (3) ¿Por qué `strict` en TypeScript?
- **Entrevista:** (1) ¿Cookie o `localStorage` para tokens? (2) ¿Qué es XSS?

### F0-21 · Pantallas de catálogo
- **Objetivo:** el dueño crea, busca, edita e importa productos.
- **Conceptos:** [React], [Playwright]
- **Claude / tú:** Claude escribe las pantallas. Tú las usas con 20 productos y reportas lo incómodo.
- **Pruebas:** Playwright: crear, editar e importar.
- **Criterios:** responde bien con 5,000 productos.
- **Depende de:** F0-20, F0-18, F0-19 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Por qué paginar? (2) ¿Dónde se valida el formulario? (3) ¿Qué hace `useEffect`?
- **Entrevista:** (1) ¿Paginación por offset o por cursor? (2) ¿Cómo optimizas una lista grande en React?

### F0-22 · Etiquetas en PDF
- **Objetivo:** el dueño imprime etiquetas desde cualquier impresora.
- **Conceptos:** [OpenPDF], [Código de barras]
- **Claude / tú:** Claude genera el PDF. Tú imprimes una hoja y escaneas el código.
- **Pruebas:** unitaria del contenido del PDF.
- **Criterios:** cumple RF-007 y el lector reconoce el código.
- **Depende de:** F0-21 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Por qué PDF por ahora? (2) ¿Qué interfaz permite cambiar de impresora? (3) ¿Qué tipo de código conviene?
- **Entrevista:** (1) ¿Cómo aplicas el principio abierto-cerrado aquí? (2) ¿Cómo pruebas un documento generado?

### F0-23 · Contratos y casos compartidos
- **Objetivo:** `packages/contracts` contiene esquemas y casos de cálculo en JSON.
- **Conceptos:** [JSON Schema], [OpenAPI]
- **Claude / tú:** Claude crea el paquete y su verificación en ambos lenguajes. Tú agregas un caso de cable por metro.
- **Pruebas:** los mismos casos corren en JUnit y Vitest.
- **Criterios:** un caso roto falla en ambos.
- **Depende de:** F0-07, F0-02 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué problema evita este paquete? (2) ¿Cómo se versiona un contrato? (3) ¿Qué es un cambio incompatible?
- **Entrevista:** (1) ¿Qué es contract testing? (2) ¿Cómo evolucionas una API sin romper clientes?

## Hito F0-G: Despliegue

### F0-24 · Servidor con Terraform
- **Objetivo:** existe un servidor reproducible dentro del presupuesto decidido.
- **Conceptos:** [Terraform]
- **Claude / tú:** Claude escribe la infraestructura como código. Tú eliges proveedor, creas la cuenta y compras el dominio.
- **Pruebas:** `terraform validate` y `terraform plan` en CI.
- **Criterios:** ADR 0013 resuelto con precio confirmado, y sin secretos en el repositorio.
- **Depende de:** F0-04 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué guarda el archivo de estado? (2) ¿Por qué no subirlo a Git? (3) ¿Qué hace `plan`?
- **Entrevista:** (1) ¿Qué es infraestructura como código? (2) ¿Cómo manejas secretos en Terraform?

### F0-25 · Despliegue automático y respaldos
- **Objetivo:** un merge a `main` despliega en staging, con HTTPS y respaldo diario.
- **Conceptos:** [pg_dump], [Caddy]
- **Claude / tú:** Claude escribe el despliegue y el respaldo. Tú restauras un respaldo en local.
- **Pruebas:** prueba de humo tras desplegar y restauración documentada.
- **Criterios:** cumple RNF-09, tiene monitoreo externo para RNF-04, y el panel responde en el dominio.
- **Depende de:** F0-24, F0-20, F0-11 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué son RPO y RTO? (2) ¿Por qué probar una restauración? (3) ¿Cómo renuevas un certificado?
- **Entrevista:** (1) ¿Cómo despliegas sin tiempo fuera? (2) ¿Cómo diseñas una estrategia de respaldos?

### F0-26 · El rol en `GET /me`
- **Objetivo:** el panel decide por el rol que guarda el núcleo, no por roles del realm que nadie mantiene.
- **Conceptos:** [Autorización en Spring], [Next.js]
- **Claude / tú:** Claude agrega `role` a `GET /me` y hace que el panel lo lea en el servidor. Tú cambias el rol de un usuario y compruebas que el panel lo refleja sin iniciar sesión otra vez.
- **Pruebas:** `/me` con Keycloak real por cada rol y sin usuario (rol vacío); Vitest y Playwright del panel con el rol que responde el núcleo.
- **Criterios:** un cambio de rol se ve en la siguiente petición; un token sin usuario conserva el negocio y no tiene rol.
- **Depende de:** F0-14, F0-20 · **Estimación:** 1 h
- **Autoevaluación:** (1) ¿Por qué el rol no va en el token? (2) ¿Qué pasa si el núcleo no responde al pedir el rol? (3) ¿Por qué un rol oculto en el panel no basta?
- **Entrevista:** (1) ¿Roles en el token o en la base? (2) ¿Cómo evitas una consulta extra por petición?

[Git]: https://git-scm.com/doc
[pnpm workspaces]: https://pnpm.io/workspaces
[Conventional Commits]: https://www.conventionalcommits.org/
[GitHub Actions]: https://docs.github.com/en/actions
[Testcontainers]: https://java.testcontainers.org/
[Secret scanning]: https://docs.github.com/en/code-security/secret-scanning
[Dependabot]: https://docs.github.com/en/code-security/dependabot
[Docker Compose]: https://docs.docker.com/compose/
[PostgreSQL]: https://www.postgresql.org/docs/16/
[Redpanda]: https://docs.redpanda.com/
[OpenTelemetry]: https://opentelemetry.io/docs/
[Prometheus]: https://prometheus.io/docs/
[Grafana]: https://grafana.com/docs/
[n8n]: https://docs.n8n.io/
[FastAPI]: https://fastapi.tiangolo.com/
[dbt]: https://docs.getdbt.com/
[DuckDB]: https://duckdb.org/docs/
[Spring Boot]: https://docs.spring.io/spring-boot/
[Spring Modulith]: https://docs.spring.io/spring-modulith/reference/
[Flyway]: https://documentation.red-gate.com/flyway
[UUIDv7]: https://www.rfc-editor.org/rfc/rfc9562
[Row-Level Security]: https://www.postgresql.org/docs/16/ddl-rowsecurity.html
[SET LOCAL]: https://www.postgresql.org/docs/16/sql-set.html
[Eventos en Modulith]: https://docs.spring.io/spring-modulith/reference/events.html
[Kafka]: https://kafka.apache.org/documentation/
[Spring Observability]: https://docs.spring.io/spring-boot/reference/actuator/observability.html
[Sentry]: https://docs.sentry.io/platforms/java/guides/spring-boot/
[Triggers en PostgreSQL]: https://www.postgresql.org/docs/16/plpgsql-trigger.html
[OWASP Logging]: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
[Keycloak]: https://www.keycloak.org/documentation
[OpenID Connect]: https://openid.net/developers/how-connect-works/
[Spring Security]: https://docs.spring.io/spring-security/reference/
[Autorización en Spring]: https://docs.spring.io/spring-security/reference/servlet/authorization/index.html
[Argon2]: https://www.rfc-editor.org/rfc/rfc9106
[Password Storage]: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
[Spring Data JPA]: https://docs.spring.io/spring-data/jpa/reference/
[Bean Validation]: https://beanvalidation.org/
[Catálogos del SAT]: https://www.sat.gob.mx/
[BigDecimal]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/math/BigDecimal.html
[Spring Batch]: https://docs.spring.io/spring-batch/reference/
[Apache Commons CSV]: https://commons.apache.org/proper/commons-csv/
[Transacciones en Spring]: https://docs.spring.io/spring-framework/reference/data-access/transaction.html
[Next.js]: https://nextjs.org/docs
[TypeScript]: https://www.typescriptlang.org/docs/
[React]: https://react.dev/learn
[Playwright]: https://playwright.dev/docs/intro
[OpenPDF]: https://github.com/LibrePDF/OpenPDF
[Código de barras]: https://www.gs1.org/standards/barcodes
[JSON Schema]: https://json-schema.org/learn
[OpenAPI]: https://spec.openapis.org/oas/latest.html
[Terraform]: https://developer.hashicorp.com/terraform/docs
[pg_dump]: https://www.postgresql.org/docs/16/app-pgdump.html
[Caddy]: https://caddyserver.com/docs/
