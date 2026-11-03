# Progreso

Actualizado: 2026-11-02. Estados: Pendiente, En curso, En revisión, Terminada, Bloqueada.

## Estado actual
- **Tarea en curso:** ninguna.
- **Siguiente:** F0-05.
- **Rellenos temporales:** `CiSmoke` lo reemplaza F0-07, `ci_smoke` lo reemplaza F0-06 y `ci-smoke` lo reemplaza E1-05.
- **Bloqueos:** precio del servidor por resolver (F0-24); exportación de Eleventa sin probar; lista de Issues sin aprobar. Los pendientes de la tienda están en una nota local, fuera de Git.

## Fase 0
| Tarea | Título | Horas | Estado |
| --- | --- | --- | --- |
| F0-01 | Inicializar repositorio y monorepo | 2 | Terminada |
| F0-02 | CI base en GitHub Actions | 3 | Terminada |
| F0-03 | Escaneo de secretos y dependencias | 2 | Terminada |
| F0-04 | Compose: perfil `core` | 4 | Terminada |
| F0-05 | Compose: perfil `observability` | 5 | Pendiente |
| F0-06 | Compose: perfiles `automation` y `analytics` | 4 | Pendiente |
| F0-07 | Esqueleto de Spring Boot 4.1 | 4 | Pendiente |
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
| F0-23 | Contratos y casos compartidos | 4 | Pendiente |
| F0-24 | Servidor con Terraform | 5 | Pendiente |
| F0-25 | Despliegue automático y respaldos | 5 | Pendiente |

## Entrega 1
| Tarea | Título | Horas | Estado |
| --- | --- | --- | --- |
| E1-01 | Esqueleto de la caja en Electron | 4 | Pendiente |
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
