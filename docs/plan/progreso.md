# Progreso

Actualizado: 2026-11-08. Estados: Pendiente, En curso, En revisión, Terminada, Bloqueada.

## Estado actual
- **Tarea en curso:** E1-10, en revisión.
- **Siguiente:** la caja en el orden del [ADR 0019](../adr/0019-caja-primero.md): E1-11, E1-13 y E1-14. F0-08 y las demás se retoman después.
- **Rellenos temporales:** ninguno. E1-05 quitó `ci-smoke`.
- **Bloqueos:** precio del servidor por resolver (F0-24); exportación de Eleventa sin probar; lista de Issues sin aprobar; E1-01 sin probar en Windows 10, porque la PC de la tienda no está a la mano. Los pendientes de la tienda están en una nota local, fuera de Git.

## Pendientes de Mauricio antes del piloto (E1-37)
No detienen el tramo de caja, pero deben estar resueltos antes de vender en paralelo con Eleventa.

- **Comparar el IVA de E1-06 con el contador o con Facturapi en modo de prueba.** El [ADR 0023](../adr/0023-iva-incluido-por-linea.md) saca la base redondeada de cada línea y deja el IVA como la diferencia. Para cada caso, revisar que la base, el IVA y el total sean los que acepta la factura. Si Facturapi da un centavo distinto en algún caso, anotarlo: E1-31 ajusta cómo se le envían los conceptos. Preguntarle también al contador qué productos de la tienda van al 0% y cuáles son exentos.

| # | Caso | Tasa | Base | IVA | Total |
| --- | --- | --- | --- | --- | --- |
| 1 | Cable, 3.275 m a $12.50 | 16% | $35.29 | $5.65 | $40.94 |
| 2 | Martillo, 1 pieza a $116.00 | 16% | $100.00 | $16.00 | $116.00 |
| 3 | Tornillos, 3 piezas a $1.00 | 16% | $2.59 | $0.41 | $3.00 |
| 4 | Piola #4, 2.5 m a $18.90 | 16% | $40.73 | $6.52 | $47.25 |
| 5 | Clavo, 0.125 kg a $45.00 | 16% | $4.85 | $0.78 | $5.63 |
| 6 | Una pieza a $0.01 | 16% | $0.01 | $0.00 | $0.01 |
| 7 | Una pieza a $108.00 | 8% (frontera) | $100.00 | $8.00 | $108.00 |
| 8 | 2.5 kg a $40.00 | 0% | $100.00 | $0.00 | $100.00 |
| 9 | 2 piezas a $35.00 | Exento | $70.00 | Sin IVA | $70.00 |
| 10 | Una venta con dos líneas del caso 3 | 16% | $5.18 | $0.82 | $6.00 |

- **Probar la pantalla de venta (E1-07) con el lector real y en la PC de la tienda.** Hay que conectar el lector y seguir estos pasos:
  1. Abrir la caja con `corepack pnpm --filter @pos-saas/pos start`.
  2. Escanear un artículo real de la tienda. Debe aparecer el aviso «No encontramos» con el número completo de la etiqueta, sin dígitos de menos, y no debe agregarse nada. Si el código se queda en la caja sin avisar, hay que programar el lector para que mande Enter al final (viene en su manual como sufijo CR).
  3. Mostrar el código de barras EAN-13 `2000000000107` en el celular o imprimirlo, con cualquier generador gratis, y escanearlo. Debe agregarse «Martillo uña curva 16 oz» a $116.00. Al escanearlo otra vez debe quedar en 2 piezas y $232.00.
  4. En la PC de la tienda, medir con `corepack pnpm --filter @pos-saas/pos build` y luego `corepack pnpm --filter @pos-saas/pos exec playwright test sale-screen -g "under 100 ms"`. El p95 de «Add a scanned product» debe quedar abajo de 100 ms (RNF-02). En la PC de desarrollo dio 24.5 ms.
  5. Pedirle a alguien de la tienda que haga su primera venta sin explicarle nada y anotar dónde se atoró (RNF-13). Con F9, el dueño revisa que los colores, el tamaño de letra y el tema se vean bien.

- **Apagar la PC en mitad de un cobro (E1-10, RF-017).** Las pruebas automáticas matan el proceso, pero eso no es un corte de luz ([ADR 0025](../adr/0025-maquina-de-estados-de-la-venta.md)). Se puede hacer cuando E1-11 traiga el botón de cobro:
  1. Abrir la caja con `corepack pnpm --filter @pos-saas/pos start`, agregar dos productos y entrar al cobro sin terminarlo.
  2. Cortar la luz de verdad: desconectar la PC de la pared. En una laptop, sacar la batería o mantener oprimido el botón de encendido.
  3. Encender la PC y abrir la caja. Debe aparecer «¿Se cobró esta venta?» con los dos productos y el total correcto, sin dejar vender.
  4. Oprimir F2. Debe volver a la pantalla de venta. Al cerrar y abrir la caja, ya no debe preguntar.
  5. Repetir los pasos 1 a 3 y oprimir F4. La venta no debe volver a aparecer.
  6. Si la caja no abre o la venta no aparece, anotar lo que muestre y avisar, porque E1-37 no debe empezar así.

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
| E1-01 | Esqueleto de la caja en Electron | 4 | Terminada |
| E1-02 | SQLite local y migraciones | 4 | Terminada |
| E1-03 | Interfaces de hardware y falsos | 3 | Terminada |
| E1-04 | Login con PIN en la caja | 4 | Pendiente |
| E1-05 | Dinero y cantidades | 5 | Terminada |
| E1-06 | IVA incluido y totales | 4 | Terminada |
| E1-07 | Pantalla de venta | 5 | Terminada |
| E1-08 | Venta por peso y por metro | 4 | Pendiente |
| E1-09 | Artículo varios y listas de precio | 3 | Pendiente |
| E1-10 | Máquina de estados de la venta | 5 | En revisión |
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
| 2026-11-03 | E1-01 terminada. PR 15 fusionado en `3e097ca`. Con la seguridad restaurada, los diez checks quedaron en verde en el PR. En `main`, los diez en verde, con `TypeScript` en 27 segundos y `Dependency scan` sin avisos. La prueba en Windows 10 sigue pendiente. Las preguntas de la ficha se le entregaron a Mauricio y siguen sin responder | Empezar E1-02 en una sesión nueva |
| 2026-11-03 | E1-02 en curso, sin PR. Mauricio eligió `node:sqlite` en lugar de `better-sqlite3` (ADR 0021). `LocalStore` abre la base en la carpeta de datos de la app antes de cualquier ventana, con WAL obligatorio y `synchronous = FULL`, y cada migración corre en su propia transacción. No hay tablas de negocio todavía. Se detectó que el primer cierre forzado de las pruebas no probaba nada: en Windows, Playwright entrega un lanzador, y al matarlo la caja seguía viva. Ahora matan el proceso real y fallan si sobrevive. En el ensayo de Claude del simulacro, con cierre real, de 367 ventas confirmadas no se perdió ninguna. En local, las 39 pruebas de Vitest pasan. Con Playwright, una corrida pasó 11 de 11 y la siguiente 10 de 11: en `keeps every confirmed sale`, la caja reabierta se cerró antes de mostrar su ventana, y falta averiguar la causa. Mauricio todavía no corre el simulacro. CI todavía no corre | Averiguar esa falla, que Mauricio corra el simulacro, abrir el PR y repetir la rotura en CI |
| 2026-11-04 | E1-02 en revisión. La falla era un error real de la caja en Windows: tras un cierre forzado, el archivo `-shm` queda ocupado entre 0.2 y 4.9 segundos, y al reabrir enseguida la caja daba `disk I/O error` en 8 de 30 intentos. Ahora reintenta hasta 15 segundos solo con ese error, y falló 0 de 30. En local, 45 pruebas en Vitest y 11 con Playwright. Al borrar el WAL a propósito fallaron dos pruebas de Vitest, y al confirmar ventas que la base no tiene fallaron la prueba de Playwright y el simulacro, con `Confirmed sales lost: 1000`. La base real queda en `%APPDATA%\@pos-saas\pos`. Mauricio todavía no corre el simulacro. CI todavía no corre | Abrir el PR, repetir la rotura en CI y fusionar |
| 2026-11-07 | E1-02 sigue en revisión, con el PR 16 abierto. Mauricio corrió el simulacro en su PC, mató la caja mientras guardaba ventas y salió PASSED, sin ventas perdidas. En CI, los diez checks en verde, con `TypeScript` en 49 segundos y `Dependency scan` sin avisos. Con una rotura a propósito, que apunta como confirmadas ventas que la base no tiene, `TypeScript` quedó en rojo en el paso de pruebas, con el type-check en verde, y los otros nueve en verde. Así que la prueba del cierre forzado también corre y detecta la pérdida en Linux. Se quitó la rotura | Fusionar el PR 16 |
| 2026-11-07 | E1-02 terminada. PR 16 fusionado con squash en `0406b7b`. Sin la rotura, los diez checks volvieron a verde en el PR. En `main`, los diez en verde, con `TypeScript` en 22 segundos y `Dependency scan` sin avisos. CI corre en Linux y no cubre la espera del `-shm` de Windows. Las preguntas de la ficha se le entregaron a Mauricio | Empezar E1-03 en una sesión nueva |
| 2026-11-07 | E1-03 en revisión. Mauricio decidió que las interfaces vivan en `src/main/hardware` y que la pantalla solo pida operaciones de venta, nunca órdenes a un aparato. `PrinterProvider`, `CashDrawer`, `ScaleProvider` y `CardTerminal` tienen un falso cada uno: la impresora guarda los bytes, el cajón cuenta aperturas, la báscula devuelve pesos en milésimas y la terminal cobra una sola vez por llave de idempotencia. `SaleCheckout` corre la venta completa con los cuatro falsos, en el orden del ADR 0010. `window.pos` no cambia hasta E1-11. En local, 70 pruebas en Vitest (antes 45). Con la pantalla importando el falso de la impresora, falló la prueba de frontera; con el cajón abierto antes de cobrar, fallaron 6 pruebas de cobro, incluida la de tarjeta rechazada. Playwright no se corrió en local porque la app empaquetada no cambia. CI todavía no corre | Abrir el PR, repetir la rotura en CI y fusionar |
| 2026-11-07 | E1-03 sigue en revisión, con el PR 17 abierto. En CI, los diez checks en verde, con `TypeScript` en 34 segundos y `Dependency scan` sin avisos. Con la pantalla importando el falso de la impresora, `TypeScript` quedó en rojo en el paso de pruebas, con el type-check en verde, y los otros nueve en verde. Así que la prueba de frontera también corre en CI: el type-check solo no la habría detectado. Se quitó la rotura | Fusionar el PR 17 |
| 2026-11-07 | E1-03 terminada. PR 17 fusionado con squash en `bdc0541`. Sin la rotura, los diez checks volvieron a verde en el PR. En `main`, los diez en verde, con `TypeScript` en 28 segundos y `Dependency scan` sin avisos. Los falsos solo los usan las pruebas, hasta que E1-08, E1-12, E1-13 y E1-14 traigan las implementaciones reales y E1-11 conecte el cobro al puente. Las preguntas de la ficha se le entregaron a Mauricio | Empezar E1-05 en una sesión nueva |
| 2026-11-07 | E1-05 en revisión. Mauricio decidió que `packages/money` exporte su código fuente, que las piezas sean enteras y que el texto tecleado se lea en los dos lenguajes sin `float` (ADR 0022). Hay `Quantity` con unidad, suma de líneas, lectura de texto y formato `$1,234.56` en TypeScript, y `Money`, `UnitPrice` y `Quantity` en Java, con el mismo código de error en los dos lenguajes. Los casos compartidos pasan de 14 a 54, en tres archivos. La caja ya usa el paquete, y el build lo empaca dentro del proceso principal. `ci-smoke` quedó reemplazado. En local, 70 pruebas en money, 18 en contracts, 72 en Vitest de la caja y 61 en Maven (antes 17). Mauricio agregó sus casos de piola (2.5 m a $18.90 da 4725) y tornillo (3 a $1.00 da 300). En su primera versión, los dos lenguajes rechazaron el archivo: los casos estaban en la lista de errores, la piola esperaba 3074 y un precio llevaba un cero a la izquierda, que JSON no permite. Playwright no se corrió en local porque la app empaquetada no cambia. CI todavía no corre | Abrir el PR y repetir la rotura en CI |
| 2026-11-07 | E1-05 sigue en revisión, con el PR 18 abierto. En CI, los diez checks en verde, con `Java` en 39 segundos, `TypeScript` en 27 y `Dependency scan` sin avisos. Con la piola esperando 4726, `Java` y `TypeScript` quedaron en rojo y los otros ocho en verde. TypeScript marcó `expected 4725 to be 4726`; la API pública no da el log de Java. Sin la rotura, los diez volvieron a verde, con `Java` en 34 segundos y `TypeScript` en 31 | Fusionar el PR 18 |
| 2026-11-07 | E1-05 terminada. PR 18 fusionado con squash en `87d9d9d`. En `main`, los diez checks en verde, con `Java` en 33 segundos, `TypeScript` en 26 y `Dependency scan` sin avisos. La caja ya puede calcular líneas, sumarlas y leer lo que se teclea; E1-06 agrega el IVA y produce el `totalCents` que recibe `SaleCheckout`. Las preguntas de la ficha se le entregaron a Mauricio | Empezar E1-06 en una sesión nueva |
| 2026-11-07 | E1-06 en revisión, en modo automático. ADR 0023: la base de cada línea se redondea hacia arriba desde medio centavo y el IVA es la diferencia, así que la base más el IVA siempre da lo cobrado. La tasa es un factor (`rate` o `exempt`) con `rate_bp`, y el exento se distingue del 0% como en el CFDI. La venta suma sus líneas y agrupa el IVA por tasa. El cálculo nunca se desborda, porque solo multiplica el residuo de la división. En TypeScript, `taxRateOf`, `lineTotals`, `splitIncludedTax` y `saleTotals`; en Java, `TaxRate`, `LineTotals`, `TaxGroup` y `SaleTotals`, con el nuevo código `invalid_tax_rate` en los dos. Los casos compartidos pasan de 54 a 81, en cinco archivos. Una prueba revisa que el IVA de cada total de $0 a $1,000, al 16% y al 8%, quede dentro de la tolerancia del Anexo 20. En local, 115 pruebas en money (antes 70), 30 en contracts (antes 18) y 91 en Maven (antes 61). La comparación de 10 casos con el contador o Facturapi quedó en «Pendientes de Mauricio antes del piloto». CI todavía no corre | Abrir el PR, repetir la rotura en CI y fusionar |
| 2026-11-07 | E1-06 sigue en revisión, con el PR 19 abierto con GitHub CLI, que ya tiene sesión. En CI, los diez checks en verde, con `Java` en 36 segundos, `TypeScript` en 32 y `Dependency scan` sin avisos. Con el IVA del cable esperando 566 centavos, `Java` y `TypeScript` quedaron en rojo y los otros ocho en verde. Ahora `gh` sí da los logs: Java marcó `expected: 566L but was: 565L`, y TypeScript falló en el mismo caso y en la revisión de que la base más el IVA da el total (`expected 4095 to be 4094`). Sin la rotura, los diez volvieron a verde, con `Java` en 29 segundos y `TypeScript` en 21 | Fusionar el PR 19 |
| 2026-11-07 | E1-06 terminada. PR 19 fusionado con squash en `6d86ea0` con `gh pr merge`, con el título revisado. En `main`, los diez checks en verde, con `Java` en 28 segundos, `TypeScript` en 31 y `Dependency scan` sin avisos. La caja ya puede sacar la base y el IVA de cada línea y sumar la venta con su IVA por tasa; E1-10 arma la venta con sus líneas y le pasa a `SaleCheckout` el total de `saleTotals`. La comparación de 10 casos con el contador o Facturapi sigue pendiente, antes del piloto. Las preguntas de la ficha se le entregaron a Mauricio | Empezar E1-07 en una sesión nueva |
| 2026-11-08 | E1-07 en revisión, en modo automático. ADR 0024: búsqueda con FTS5, lector distinguido por velocidad (al menos 4 caracteres con hasta 50 ms entre ellos) y apariencia acotada a nombre, seis colores, tres tamaños y dos temas. Hay productos de prueba con `tenant_id`, UUIDv7 y las escalas del ADR 0011, y la pantalla se opera solo con teclado. El total es una etiqueta de precio colgante y los colores se eligen como en un muestrario de pintura. Con 5,000 productos y 200 lecturas, agregar un producto tardó 24.5 ms de p95 y buscar por nombre 4.0 ms. No hizo falta un `worker`. En local, 192 pruebas en Vitest de la caja (antes 72), 124 en money (antes 115) y 22 con Playwright (antes 11). La prueba con el lector y en la PC de la tienda quedó en «Pendientes de Mauricio antes del piloto». CI todavía no corre | Abrir el PR, repetir la rotura en CI y fusionar |
| 2026-11-08 | E1-07 sigue en revisión, con el PR 20 abierto. En CI, los diez checks en verde en `cb6f099`, con `TypeScript` en 52 segundos. Con 150 ms de espera agregados a `findByCode`, `TypeScript` quedó en rojo en 78 segundos y los otros nueve en verde: agregar un producto tardó 155.4 ms de p95 contra el límite de 100, y de las 22 pruebas de Playwright solo falló esa. Sin la rotura, los diez volvieron a verde en `bffaad5`, con `TypeScript` en 51 segundos | Fusionar el PR 20 |
| 2026-11-08 | E1-07 terminada. PR 20 fusionado con squash en `72b347c` con `gh pr merge`, con el título revisado. En `main`, los diez checks en verde, con `Java` en 26 segundos y `TypeScript` en 51. La caja ya puede buscar y agregar productos con lector o teclado, y el dueño puede ajustar su apariencia; E1-10 guarda la venta partiendo de `SaleState` y `uuidV7`. La prueba con el lector y en la PC de la tienda sigue pendiente, antes del piloto. Las preguntas de la ficha se le entregaron a Mauricio | Empezar E1-10 en una sesión nueva |
| 2026-11-08 | E1-10 en revisión, en modo automático. ADR 0025: la venta va de `pending_payment` a `completed` o `cancelled`, con la regla en TypeScript y también en 12 disparadores de la base, cada uno con una prueba que falla si se quita. `sale`, `sale_line` y `payment` usan las escalas del ADR 0011, UUIDv7, llave de idempotencia y `tenant_id`. La pantalla manda productos, cantidades y el total que ve, y el proceso principal pone los precios; si el total no coincide, no guarda nada. `card_pending` es de la Entrega 2 y no se construyó. Al arrancar, la caja pregunta por cada venta pendiente, con F2 o F4, y no deja vender hasta responder. En local, 298 pruebas en Vitest de la caja (antes 192) y 28 con Playwright (antes 22), incluida una que mata el proceso con una venta pendiente y la confirma al reabrir. Apagar la PC de verdad quedó en «Pendientes de Mauricio antes del piloto». CI todavía no corre | Abrir el PR, repetir la rotura en CI y fusionar |
