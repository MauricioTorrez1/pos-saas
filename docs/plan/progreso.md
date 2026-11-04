# Progreso

Actualizado: 2026-11-03. Estados: Pendiente, En curso, En revisión, Terminada, Bloqueada.

## Estado actual
- **Tarea en curso:** E1-01.
- **Siguiente:** la caja en el orden del [ADR 0019](../adr/0019-caja-primero.md): E1-02, E1-03, E1-05, E1-06, E1-07, E1-10, E1-11, E1-13 y E1-14. F0-08 y las demás se retoman después.
- **Rellenos temporales:** `ci-smoke` lo reemplaza E1-05.
- **Bloqueos:** precio del servidor por resolver (F0-24); exportación de Eleventa sin probar; lista de Issues sin aprobar; E1-01 sin probar en Windows 10, porque la PC de la tienda no está a la mano. Los pendientes de la tienda están en una nota local, fuera de Git.

## Fase 0
| Tarea | Título | Horas | Estado |
| --- | --- | --- | --- |
| F0-01 | Inicializar repositorio y monorepo | 2 | Terminada |
| F0-02 | CI base en GitHub Actions | 3 | Terminada |
| F0-03 | Escaneo de secretos y dependencias | 2 | Terminada |
| F0-04 | Compose: perfil `core` | 4 | Terminada |
| F0-05 | Compose: perfil `observability` | 5 | Terminada |
| F0-06 | Compose: perfiles `automation` y `analytics` | 4 | Terminada |
| F0-07 | Esqueleto de Spring Boot 4.1 | 4 | Terminada |
| F0-08 | Flyway y modelo base | 4 | Pendiente |
| F0-09 | RLS y prueba de aislamiento | 5 | Pendiente |
| F0-10 | Outbox hacia Redpanda | 5 | Pendiente |
| F0-11 | Observabilidad del núcleo | 4 | Pendiente |
| F0-12 | Bitácora de auditoría | 3 | Pendiente |
| F0-13 | Keycloak y login con OIDC | 5 | Pendiente |
| F0-14 | Roles y autorización | 4 | Pendiente |
| F0-15 | Registro de caja y PIN en el servidor | 5 | Pendiente |
| F0-16 | Productos, códigos y unidades | 6 | Pendiente |
| F0-17 | Precios, impuestos y claves SAT | 5 | Pendiente |
| F0-18 | Importación de catálogo | 6 | Pendiente |
| F0-19 | Cambio masivo de precios | 3 | Pendiente |
| F0-20 | Panel Next.js con login | 5 | Pendiente |
| F0-21 | Pantallas de catálogo | 6 | Pendiente |
| F0-22 | Etiquetas en PDF | 3 | Pendiente |
| F0-23 | Contratos y casos compartidos | 4 | Terminada |
| F0-24 | Servidor con Terraform | 5 | Pendiente |
| F0-25 | Despliegue automático y respaldos | 5 | Pendiente |

## Entrega 1
| Tarea | Título | Horas | Estado |
| --- | --- | --- | --- |
| E1-01 | Esqueleto de la caja en Electron | 4 | En revisión |
| E1-02 | SQLite local y migraciones | 4 | Pendiente |
| E1-03 | Interfaces de hardware y falsos | 3 | Pendiente |
| E1-04 | Login con PIN en la caja | 4 | Pendiente |
| E1-05 | Dinero y cantidades | 5 | Pendiente |
| E1-06 | IVA incluido y totales | 4 | Pendiente |
| E1-07 | Pantalla de venta | 5 | Pendiente |
| E1-08 | Venta por peso y por metro | 4 | Pendiente |
| E1-09 | Artículo varios y listas de precio | 3 | Pendiente |
| E1-10 | Máquina de estados de la venta | 5 | Pendiente |
| E1-11 | Efectivo, transferencia y pago mixto | 5 | Pendiente |
| E1-12 | Tarjeta tecleada con folio | 2 | Pendiente |
| E1-13 | Ticket ESC/POS | 5 | Pendiente |
| E1-14 | Cajón y prueba de hardware | 3 | Pendiente |
| E1-15 | Devoluciones | 6 | Pendiente |
| E1-16 | Envío desde la caja | 5 | Pendiente |
| E1-17 | Recepción en el núcleo | 6 | Pendiente |
| E1-18 | Cambios hacia la caja | 5 | Pendiente |
| E1-19 | Discrepancias y cuarentena | 4 | Pendiente |
| E1-20 | Prueba de punta a punta sin internet | 4 | Pendiente |
| E1-21 | Sesión de caja | 5 | Pendiente |
| E1-22 | Aviso de retiro parcial | 2 | Pendiente |
| E1-23 | Corte con arqueo | 5 | Pendiente |
| E1-24 | Reporte por correo | 3 | Pendiente |
| E1-25 | Movimientos por venta y devolución | 4 | Pendiente |
| E1-26 | Ajustes y mermas | 3 | Pendiente |
| E1-27 | Kardex y verificación | 4 | Pendiente |
| E1-28 | Costo promedio | 4 | Pendiente |
| E1-29 | Saldo inicial desde Eleventa | 4 | Pendiente |
| E1-30 | Cliente de Facturapi | 4 | Pendiente |
| E1-31 | Factura individual | 6 | Pendiente |
| E1-32 | Factura global | 5 | Pendiente |
| E1-33 | Cancelación y nota de crédito | 4 | Pendiente |
| E1-34 | Reportes básicos | 5 | Pendiente |
| E1-35 | Respaldo de la caja | 4 | Pendiente |
| E1-36 | Instalador para Windows | 4 | Pendiente |
| E1-37 | Piloto paralelo | 4 | Pendiente |
| E1-38 | Salida de Eleventa | 4 | Pendiente |

## Entrega 2
| Tarea | Título | Horas | Estado |
| --- | --- | --- | --- |
| E2-01 | Spike de la terminal real | 2 | Pendiente |
| E2-02 | Aplicación y cliente de Mercado Pago | 4 | Pendiente |
| E2-03 | Crear orden en la terminal | 4 | Pendiente |
| E2-04 | Webhook con firma | 4 | Pendiente |
| E2-05 | Avisos a la caja y consulta puntual | 5 | Pendiente |
| E2-06 | Espera, cancelación y sin cobro doble | 5 | Pendiente |
| E2-07 | Reembolsos | 3 | Pendiente |
| E2-08 | Conciliación | 4 | Pendiente |
| E2-09 | Cobro real y piloto | 3 | Pendiente |

## Fase 2
| Tarea | Título | Horas | Estado |
| --- | --- | --- | --- |
| F2-01 | Portal de autofactura | 6 | Pendiente |
| F2-02 | Autofactura de una venta en global | 3 | Pendiente |
| F2-03 | Complementos de pago | 5 | Pendiente |
| F2-04 | Clientes y aviso de privacidad | 5 | Pendiente |
| F2-05 | Historial del cliente | 2 | Pendiente |
| F2-06 | Club de maestros | 5 | Pendiente |
| F2-07 | Cotizaciones | 5 | Pendiente |
| F2-08 | Apartados | 5 | Pendiente |
| F2-09 | Crédito y límite | 6 | Pendiente |
| F2-10 | Abonos y cuentas por cobrar | 4 | Pendiente |
| F2-11 | Proveedores | 3 | Pendiente |
| F2-12 | Órdenes de compra sugeridas | 5 | Pendiente |
| F2-13 | Recepción de mercancía | 5 | Pendiente |
| F2-14 | Cuentas por pagar | 4 | Pendiente |
| F2-15 | Comparativo de proveedores | 3 | Pendiente |
| F2-16 | Conteos cíclicos y reorden | 5 | Pendiente |
| F2-17 | Orden de reparación y folio | 5 | Pendiente |
| F2-18 | Fotos de recepción | 4 | Pendiente |
| F2-19 | Estados de reparación | 3 | Pendiente |
| F2-20 | WhatsApp Cloud API | 6 | Pendiente |
| F2-21 | Aprobación por WhatsApp | 4 | Pendiente |
| F2-22 | Refacciones | 3 | Pendiente |
| F2-23 | Entrega, cobro y garantía | 5 | Pendiente |
| F2-24 | Consulta pública del folio | 3 | Pendiente |

## Fase 3
| Tarea | Título | Horas | Estado |
| --- | --- | --- | --- |
| F3-01 | Catálogo público | 6 | Pendiente |
| F3-02 | Existencia web con margen | 3 | Pendiente |
| F3-03 | Carrito y pago | 6 | Pendiente |
| F3-04 | Reserva con expiración | 5 | Pendiente |
| F3-05 | Link de pago | 6 | Pendiente |
| F3-06 | Pedido a venta | 4 | Pendiente |
| F3-07 | Entrega y avisos | 4 | Pendiente |
| F3-08 | Bot: consultas | 6 | Pendiente |
| F3-09 | Bot: pedidos | 6 | Pendiente |
| F3-10 | Modelo de promociones | 4 | Pendiente |
| F3-11 | Evaluador en TypeScript | 5 | Pendiente |
| F3-12 | Evaluador en Java | 5 | Pendiente |
| F3-13 | Repartidor de descuentos | 6 | Pendiente |
| F3-14 | Promociones en caja | 4 | Pendiente |
| F3-15 | Cupones | 4 | Pendiente |
| F3-16 | Panel de promociones | 5 | Pendiente |
| F3-17 | Publicación en redes | 5 | Pendiente |
| F3-18 | Catálogo en Meta | 5 | Pendiente |
| F3-19 | Reseñas | 4 | Pendiente |

## Fase 4
| Tarea | Título | Horas | Estado |
| --- | --- | --- | --- |
| F4-01 | Alta de negocio | 6 | Pendiente |
| F4-02 | Asistente por giro | 5 | Pendiente |
| F4-03 | Planes y límites | 5 | Pendiente |
| F4-04 | Cobro de suscripción | 6 | Pendiente |
| F4-05 | Sucursales y cajas | 5 | Pendiente |
| F4-06 | Traspasos | 4 | Pendiente |
| F4-07 | Roles configurables | 5 | Pendiente |
| F4-08 | Credenciales por negocio | 5 | Pendiente |
| F4-09 | Alertas de fraude | 4 | Pendiente |
| F4-10 | API pública | 6 | Pendiente |
| F4-11 | Webhooks salientes | 5 | Pendiente |
| F4-12 | Importar Excel | 4 | Pendiente |
| F4-13 | Recetas e ingredientes | 6 | Pendiente |
| F4-14 | Modificadores | 5 | Pendiente |
| F4-15 | Piloto en la heladería | 4 | Pendiente |
| F4-16 | Lotes y caducidades | 6 | Pendiente |
| F4-17 | Números de serie | 3 | Pendiente |
| F4-18 | Caja web | 6 | Pendiente |
| F4-19 | Mesas y comandas | 6 | Pendiente |
| F4-20 | Restricción de edad | 2 | Pendiente |
| F4-21 | Farmacia y receta | 4 | Pendiente |
| F4-22 | Firma de código | 3 | Pendiente |
| F4-23 | Escalar infraestructura | 5 | Pendiente |

## Fase 5
| Tarea | Título | Horas | Estado |
| --- | --- | --- | --- |
| F5-01 | Consumidor de eventos | 5 | Pendiente |
| F5-02 | Modelos dbt | 6 | Pendiente |
| F5-03 | Lento movimiento | 5 | Pendiente |
| F5-04 | Se compran juntos | 6 | Pendiente |
| F5-05 | Temporadas | 4 | Pendiente |
| F5-06 | Filtro de margen | 3 | Pendiente |
| F5-07 | Explicación con Claude | 5 | Pendiente |
| F5-08 | Aprobación del dueño | 4 | Pendiente |
| F5-09 | Medición de resultados | 5 | Pendiente |
| F5-10 | Pronóstico de demanda | 6 | Pendiente |
| F5-11 | ABC y rotación | 4 | Pendiente |
| F5-12 | Catálogo de cuentas y pólizas | 6 | Pendiente |
| F5-13 | Balanza y estado de resultados | 6 | Pendiente |
| F5-14 | IVA y exportación | 4 | Pendiente |
| F5-15 | Evaluación de sugerencias | 3 | Pendiente |

## Bitácora de sesiones
| Fecha | Qué se hizo | Siguiente |
| --- | --- | --- |
| 2026-11-02 | Plan completo, ADR y roadmap | Aprobar Issues y empezar F0-01 |
| 2026-11-02 | F0-01 terminada. F0-02: CI con tres trabajos, Maven, uv y JUnit 6 (ADR 0014) | Abrir los dos PR de F0-02 y seguir con F0-03 |
| 2026-11-02 | F0-02 terminada. PR 1: los tres trabajos en verde en 24 segundos. PR 2: `Java` en rojo por una prueba rota, `TypeScript` y `Python` en verde, y se cerró sin fusionar. `main` en verde en 30 segundos tras fusionar | Terminar F0-03 |
| 2026-11-02 | F0-03 terminada: Gitleaks, OSV-Scanner y Dependabot (ADR 0015), y regla `protect-main` con cinco checks obligatorios. PR 3: seis checks en verde, con 1, 96 y 7 paquetes revisados por OSV-Scanner. PR 4: con un secreto falso, `Secret scan` en rojo, los demás en verde y fusión bloqueada; se cerró sin fusionar | Empezar F0-04 |
| 2026-11-02 | F0-03 en `main`: en verde tras fusionar, con CI en 18 segundos, Repository checks en 7 y Security en 10. Dependabot corrió bien en los cuatro ecosistemas. Su PR 5 se cerró sin fusionar porque rompía la alineación con Spring Boot 4.1.2 | Terminar F0-04 |
| 2026-11-02 | F0-04 terminada: perfil `core` con cuatro servicios y `healthcheck`, Keycloak con base propia (ADR 0016) y `Compose core` como sexto check obligatorio. En local, primer arranque sano en 49 segundos, reinicio en 27 y 907 MiB en reposo. Los datos sobreviven a `down` y `up`. Con una contraseña equivocada, el script falla y los logs no muestran contraseñas. PR 6: siete checks en verde, con `Compose core` en 62 segundos | Empezar F0-05 en una sesión nueva |
| 2026-11-02 | F0-04 en `main`: PR 6 fusionado con el commit `e8b1c2d`, y CI, Repository checks y Security en verde tras fusionar, con `Compose core` en 51 segundos. La primera corrida de Dependabot para `docker-compose` terminó en verde y abrió el PR 7, que subió Redis de 8.8.4 a 8.10.3. El PR 7 ya se fusionó con el commit `59aa130`, con los tres workflows en verde y `Compose core` en 56 segundos | Terminar F0-05 |
| 2026-11-02 | F0-05 en curso, todavía sin código. Decisiones: revisión de salud de Loki y del colector con `busybox` copiado por un servicio de un solo uso, datos de prueba con un script bajo pedido, Grafana con contraseña, y el trabajo `Compose observability` en cada PR y obligatorio tras su primera corrida | Escribir el perfil `observability` y su prueba |
| 2026-11-03 | F0-05 en revisión: perfil `observability` con cinco servicios y `healthcheck`, tablero provisionado y prueba de punta a punta. En local, primer arranque sano en 35 segundos y reinicio en 34. Mauricio midió 1,323 MiB con el tablero en uso y encontró en Grafana una traza lenta y una con error. La prueba falló, como debía, al apagar Tempo, el colector o Prometheus. CI todavía no corre | Abrir el PR y agregar `Compose observability` a `protect-main` |
| 2026-11-03 | F0-05 terminada. PR 8 fusionado en `5def83b`. En `main`, CI en verde con `Compose observability` en 53 segundos y `Compose core` en 51. Al probar una caída real de Tempo se corrigió el panel de pérdidas del colector, que marcaba cero aunque ya se habían perdido datos. En la autoevaluación, Mauricio describió bien la métrica y todavía no domina traza, colector, p95 ni la diferencia entre monitoreo y observabilidad. Claude se los explicó, y la lectura del tablero que pedía la ficha queda por reforzar con datos reales en F0-11 | Empezar F0-06 en una sesión nueva |
| 2026-11-03 | F0-06 en revisión. Mauricio confirmó con captura que `protect-main` ya exige `Compose observability`. Perfiles `automation` (n8n 2.46.4 con SQLite) y `analytics` (FastAPI y dbt v2 OSS con DuckDB, bajo pedido), con ADR 0017. `ci_smoke` quedó reemplazado. En una pila de prueba, `automation` quedó sano en 27 segundos y `analytics` en 6, cada uno sin los demás. `dbt build` pasó 14 de 14, y falló, como debía, con una venta duplicada, un método de pago desconocido y un modelo que mezclaba negocios. Mauricio ejecutó el modelo de ejemplo en su PC y funcionó. CI todavía no corre | Abrir el PR y agregar `Compose automation` y `Compose analytics` a `protect-main` tras su primera corrida |
| 2026-11-03 | F0-06 terminada. PR 9 fusionado en `c14b568`. En `main`, CI en verde con `Compose automation` en 60 segundos y `Compose analytics` en 23, y Repository checks y Security también en verde. El mensaje del commit quedó con el título que GitHub tomó de la rama, y no se corrige porque reescribir `main` no vale la pena por un título. Mauricio confirmó con captura y de palabra que `protect-main` ya exige los dos checks nuevos; la API no lo puede confirmar. Dependabot leyó el Dockerfile y abrió el PR 10, que sube uv a 0.13.7, con sus diez checks en verde. En las preguntas de la ficha, Mauricio pidió que se le explicaran las cinco, y Claude lo hizo; quedan por reforzar en F5-01 y F5-02 | Fusionar el PR 10 y empezar F0-07 en una sesión nueva |
| 2026-11-03 | F0-07 en revisión. Núcleo con Spring Boot 4.1.2 y Spring Modulith 2.1.2, nueve módulos vacíos y `CiSmoke` reemplazado. En local, tres pruebas en verde, y el JAR arrancó en 3.6 segundos con `/actuator/health` en `UP` y `/actuator/env` cerrado. Una violación deliberada de `sales` hacia `inventory.internal` puso el build en rojo. Mauricio confirmó las fechas de soporte en la tabla de Spring y quedaron en el ADR 0008, y decidió que Dependabot también proponga 4.2. El PR 10 ya está fusionado y no hay ningún PR de Maven abierto. CI todavía no corre | Abrir el PR y repetir la violación en CI con un PR que se cierra sin fusionar |
| 2026-11-03 | F0-07 terminada. PR 11 fusionado en `6f1eef9`. En `main`, los diez checks en verde, con `Java` en 37 segundos. En el PR 12, `Java` falló con `Module 'sales' depends on non-exposed type ...StockLedger within module 'inventory'`, los otros nueve quedaron en verde, y se cerró sin fusionar. No hay ningún PR de Maven abierto; la rama de Dependabot que queda es la del PR 5. Una captura de Mauricio del log de `Dependency scan` mostró que Java no se estaba escaneando: se confirmó que el escáner descartaba las 5 dependencias del `pom.xml` por no tener versión. Mauricio pidió que Claude respondiera las cinco preguntas de la ficha; quedan por reforzar en F0-10 | Arreglar el escaneo de Java en un PR aparte |
| 2026-11-03 | Arreglo del escaneo de Java en revisión (ADR 0018): Maven genera la lista real de dependencias y OSV-Scanner la lee, y el script falla si el escáner descarta un paquete. En local, de 0 a 57 paquetes de Java sin vulnerabilidades conocidas. Con Tomcat 11.0.0 falla en `main` y solo avisa en un PR, y al volver a leer `pom.xml` falla la protección. CI todavía no corre | Fusionar el arreglo y empezar F0-08 en una sesión nueva |
| 2026-11-03 | Arreglo del escaneo de Java terminado. PR 13 fusionado en `01214b8`. En `main`, los diez checks en verde, con `Dependency scan` en 25 segundos (antes 6), porque ahora corre Maven. Mauricio decidió empezar por la caja y retomar después el resto de las etapas (ADR 0019). El total de horas no cambia | Empezar F0-23 en una sesión nueva |
| 2026-11-03 | F0-23 en revisión: `packages/contracts` con dos esquemas y 14 casos, y el importe de línea en TypeScript y en Java, fuera de los módulos (ADR 0020). Mauricio agregó el caso de cable: 3.275 m a $12.50 da 4094. En local, 31 pruebas en Vitest y 17 en Maven, 14 de ellas con los casos compartidos. Un resultado esperado equivocado y una cantidad con decimales fallaron en los dos lenguajes. CI todavía no corre | Abrir el PR y fusionarlo |
| 2026-11-03 | F0-23 terminada. PR 14 fusionado en `dfae10f`. En CI, con el caso de cable en 4095, `Java` y `TypeScript` quedaron en rojo y los otros ocho checks en verde. Al revertirlo, los diez quedaron en verde, con `Java` en 28 segundos y `TypeScript` en 23, y `Dependency scan` sin avisos. En `main`, los diez en verde, con `Java` en 30 segundos y `TypeScript` en 13. Mauricio pidió que Claude explicara las cinco preguntas de la ficha; quedan por reforzar en E1-16 y E1-17 | Empezar E1-01 en una sesión nueva |
| 2026-11-03 | E1-01 en revisión: `apps/pos` con Electron 45, React 19 y electron-vite, y la pantalla sin Node, aislada y con `sandbox`. En local, 19 pruebas en Vitest y 7 de arranque con Playwright. Con la caja insegura a propósito fallaron 6 de las 7, y sin el bloqueo de ventanas nuevas falló esa prueba. El código de pantalla que usa `process` o `node:fs` no compila. Se usa Electron 45.2.1 porque 45.2.2 tenía horas de publicada y no pasaba la antigüedad mínima de `pnpm`. Mauricio todavía no ejecuta la caja en su PC ni en Windows 10. CI todavía no corre | Abrir el PR y repetir la rotura en CI |
| 2026-11-03 | E1-01 sigue en revisión, con el PR 15 abierto. En CI, los diez checks en verde, con `TypeScript` en 20 segundos y `Dependency scan` sin avisos. Con la pantalla insegura a propósito, `TypeScript` quedó en rojo y los otros nueve en verde, así que la prueba de arranque sí corre en Linux. Se quitó el reporte `github` de Playwright porque no generó anotaciones. Mauricio abrió la caja en su PC y lo confirmó con captura. La prueba en Windows 10 sigue pendiente, con sus pasos en la nota local. Mauricio pidió que todas las pantallas de la caja se vean cuidadas, sean intuitivas y las personalice el dueño: quedó como RNF-13 y criterio de E1-07, y falta definir qué podrá cambiar el dueño | Fusionar el PR 15 |
