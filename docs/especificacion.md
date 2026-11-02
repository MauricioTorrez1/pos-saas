# Especificación — Sistema de punto de venta SaaS

Versión 0.2 · noviembre 2026 · Autor: Mauricio Torres García

> **Cambios de la versión 0.2.** La tienda abre con Eleventa como caja provisional y este sistema la reemplaza tras un piloto paralelo. Las decisiones están en [`docs/adr/`](adr/README.md) y el alcance detallado en [`docs/plan/`](plan/00-vision.md). Donde esta especificación y un ADR difieran, manda el ADR.

## 1. Visión
Un sistema de punto de venta profesional, que cobra con o sin internet, construido primero para una tlapalería-ferretería con taller de reparación en México y diseñado desde el inicio como **SaaS multi-negocio y multi-giro**, para ofrecerlo a otros comercios locales que quieran automatizarse. También es proyecto de práctica y pieza central de portafolio.

## 2. Usuarios
| Rol | Qué hace |
| --- | --- |
| Dueño | Configura el negocio, precios y promociones; ve reportes; aprueba promociones sugeridas |
| Cajero | Vende, cobra, hace cortes, da devoluciones |
| Técnico de taller | Recibe equipos, diagnostica, cotiza, repara, entrega |
| Almacenista | Recibe compras, hace ajustes y conteos |
| Cliente final | Compra en tienda, por web o por WhatsApp; se factura; consulta su reparación |
| Administrador del SaaS | Da de alta negocios, planes y soporte |

## 3. Requisitos funcionales por módulo
| Módulo | Requisitos | Fase |
| --- | --- | --- |
| Catálogo | Varios códigos de barras por producto; unidades y conversiones (pieza, caja de 100, kg, metro, litro, rollo de 100 m); listas de precio (público, mayoreo, maestros); IVA 16%, 0% o exento; importación de listas de proveedor (CSV de Truper y Urrea); cambio masivo de precios; impresión de etiquetas | 0 |
| Venta en caja | Escaneo y búsqueda; venta por peso (captura manual o báscula) y por metro; varias formas de pago en una venta (efectivo, tarjeta, transferencia, mixto); ticket ESC/POS y apertura de cajón; devoluciones; **funciona sin internet** | 1 |
| Pagos | Al elegir tarjeta, el monto se envía automáticamente a la terminal Mercado Pago Point Smart 2 (Orders API) y el resultado regresa por webhook; modo de respaldo manual sin internet; links de pago; conciliación con reportes de Mercado Pago | 1 |
| Caja y cortes | Apertura con fondo; entradas y salidas de efectivo; aviso de retiro parcial al pasar un límite; corte parcial y de cierre; cortes periódicos programados; arqueo por denominación; diferencias por cajero y turno; reporte al dueño por WhatsApp | 1 |
| Inventario | Libro de movimientos (altas, bajas, ventas, devoluciones, ajustes, mermas, traspasos); kardex; conteos cíclicos; mínimos, máximos y punto de reorden; costo promedio; lotes, caducidades y números de serie (para otros giros); reservas para pedidos en línea; **se actualiza con cada venta física, web o por WhatsApp** | 1 |
| Cotizaciones, apartados y crédito | Cotización que se convierte en venta; apartados con anticipo; crédito con límite y cuentas por cobrar | 2 |
| Compras y proveedores | Órdenes de compra sugeridas; recepción; cuentas por pagar; comparativo de precios entre proveedores | 2 |
| Facturación CFDI 4.0 | Factura por venta; factura global al público en general; notas de crédito; cancelaciones (fase 1, Entrega 1, ADR 0012). Portal de autofactura y complementos de pago (fase 2). Vía Facturapi, una organización por negocio | 1 y 2 |
| Órdenes de reparación | Recepción con fotos y folio; diagnóstico; cotización aprobada por WhatsApp; refacciones descontadas del inventario; estados con aviso automático; garantía | 2 |
| Clientes y lealtad | Datos fiscales; historial; «Club de maestros» con precios especiales y puntos | 2 |
| Omnicanal | Tienda en línea con existencias en tiempo real; pedidos por WhatsApp (bot específico del negocio); reserva de inventario mientras se paga; entrega a domicilio o para recoger | 3 |
| Promociones | Configurar y reconocer automáticamente: rebajas, 2x1, 3x2, porcentaje, precio por volumen, combos, por categoría o marca, por horario, cupones; prioridades, acumulación y vigencias | 3 |
| Plataforma SaaS | Alta de negocios en autoservicio; asistente por giro; planes y suscripción; sucursales y cajas; roles y permisos; bitácora de auditoría; alertas de fraude; respaldos; API pública y webhooks; importación desde Excel | 4 |
| Módulos por giro | Ferretería (granel, metro, cotizaciones); abarrotes (caducidades); farmacia (lotes y receta); restaurante (mesas, comandas, recetas); productos con restricción de edad | 4 |
| Recomendador de promociones | Sugerencias basadas en estadísticas: rebaja a productos de lento movimiento, combos por productos que se compran juntos, promociones de temporada; respeta un margen mínimo; la IA explica la sugerencia y redacta la publicación; el dueño aprueba; se mide el resultado | 5 |
| Reportes y contabilidad | Ventas por hora, día y cajero; ticket promedio; margen; rotación; análisis ABC; agotados; productos sin venta; pronóstico de demanda; pólizas automáticas; catálogo de cuentas con código agrupador del SAT; balanza; estado de resultados; IVA; exportación para el contador | 1 (básicos) y 5 |
| Redes sociales | Publicación automática de promociones aprobadas en Facebook e Instagram (n8n + Graph API); catálogo de WhatsApp/Instagram sincronizado desde el sistema | 3 |

## 4. Requisitos no funcionales (objetivos propuestos, a validar en el plan)
- **Sin internet:** la caja vende en efectivo y registra pagos manuales de tarjeta sin conexión; sincroniza sola al volver la conexión sin duplicar ni perder ventas.
- **Rapidez en caja:** agregar un producto escaneado y cerrar una venta en efectivo debe sentirse instantáneo (operación local).
- **Aislamiento:** ningún negocio puede ver datos de otro (Row-Level Security + pruebas automáticas que lo verifiquen).
- **Auditoría:** toda cancelación, devolución, ajuste y cambio de precio queda registrado con usuario y hora.
- **Seguridad:** sin datos de tarjeta en el sistema; secretos fuera del repositorio; roles mínimos necesarios.
- **Respaldos:** diarios en la nube y copia local de la caja.
- **Cumplimiento en México:** CFDI 4.0 (SAT), aviso de privacidad (datos personales), precios visibles (Profeco).

## 5. Hardware de la primera tienda
| Equipo | Modelo | Integración |
| --- | --- | --- |
| Lector de código de barras | USB 2D | Funciona como teclado (HID) |
| Báscula | Rhino BAR-7 (sin puerto de datos) | Captura manual del peso; interfaz `ScaleProvider` para conectar después una báscula USB |
| Impresora de tickets | Epson TM-T20 (80 mm) | Comandos ESC/POS por USB |
| Cajón de dinero | EC Line, conector RJ11 | Se abre con un comando ESC/POS enviado a la impresora |
| Impresora de etiquetas | Por definir. La 3nStar RPT001 aparece como impresora de tickets de 58 mm; no comprar hasta confirmar | Etiquetas de precio y de granel; PDF mientras tanto |
| Terminal de tarjeta | Mercado Pago Point Smart 2 | Orders API + webhooks |

## 6. Stack
| Capa | Tecnología |
| --- | --- |
| Núcleo | Java 21 + Spring Boot 4.1, monolito modular |
| Analítica e IA | Python + FastAPI, Polars, scikit-learn, API de Claude |
| Caja | Electron + React + TypeScript + SQLite |
| Web | React / Next.js |
| Datos | PostgreSQL 16 (RLS), Redis; eventos con outbox y Redpanda desde el inicio; dbt + DuckDB |
| Identidad | Keycloak (OpenID Connect) |
| Infra | Docker, GitHub Actions, Terraform; VPS al inicio y AWS después |
| Observabilidad | OpenTelemetry, Grafana (Prometheus, Loki, Tempo), Sentry |
| Integraciones | Mercado Pago, Facturapi, WhatsApp Cloud API, Graph API de Meta, n8n |

## 7. Decisiones de diseño
1. Inventario como libro de movimientos inmutable; la existencia es la suma.
2. UUIDv7 generado en la caja + llave de idempotencia en toda operación sincronizada.
3. Totales y pagos en centavos enteros; precios y costos unitarios en enteros con mayor escala; cantidades con 3 decimales y unidad explícita.
4. Promociones como reglas JSON (JSON Logic más acciones tipadas) evaluables igual en la caja y en el servidor; el servidor revalida y registra discrepancias, sin rechazar una venta cerrada.
5. Una base de datos para todos los negocios, `tenant_id` en cada tabla y Row-Level Security.
6. La lógica de negocio vive en el núcleo Java, salvo lo que la caja debe calcular sin internet, que vive en TypeScript con casos de prueba compartidos; Python solo para analítica e IA.
7. La tarjeta nunca toca el sistema.
8. Monorepo: `apps/`, `services/`, `packages/`, `infra/`, `docs/`.

## 8. Fases
0. Base: repositorio, CI, modelo de datos, usuarios, catálogo e importación de listas.
1. Reemplazar a Eleventa. Entrega 1: venta sin internet, efectivo y tarjeta tecleada, ticket y cajón, inventario, cortes, reportes básicos, factura individual y global. Entrega 2: terminal integrada.
2. Operación completa: autofactura, cotizaciones, crédito, compras, taller, clientes.
3. Venta en línea: tienda web, pedidos por WhatsApp, promociones, redes sociales.
4. SaaS: alta de otros negocios, planes, módulos por giro (validar con un segundo negocio de otro giro).
5. IA y analítica: recomendador de promociones, pronósticos, contabilidad completa.

## 9. Restricciones
- Desarrollador principal: una persona, con prácticas profesionales desde enero de 2027; el plan debe ajustarse a las horas reales disponibles.
- La tienda abre con Eleventa como caja provisional; el sistema debe permitir importar después las ventas e inventario iniciales.
