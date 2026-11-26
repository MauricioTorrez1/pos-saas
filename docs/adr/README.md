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
| [0023](0023-iva-incluido-por-linea.md) | IVA incluido, con la base redondeada por línea y el IVA por diferencia | Aceptada |
| [0024](0024-pantalla-de-venta.md) | Pantalla de venta con búsqueda FTS5 y apariencia acotada | Aceptada |
| [0025](0025-maquina-de-estados-de-la-venta.md) | Máquina de estados de la venta, con reglas también en la base | Aceptada |
| [0026](0026-cobro-con-efectivo-transferencia-y-mixto.md) | Cobro con efectivo, transferencia y pago mixto | Aceptada |
| [0027](0027-ticket-escpos-y-folio-corto.md) | Ticket ESC/POS, folio corto y reimpresión | Aceptada |
| [0028](0028-tarjeta-tecleada-cajon-y-cantidades-medidas.md) | Tarjeta tecleada, cajón por la impresora y cantidades medidas | Aceptada |
| [0029](0029-acceso-con-pin-y-sesion-de-caja.md) | Acceso con PIN, sesión de caja y corte con arqueo | Aceptada |
| [0030](0030-devoluciones-como-registro-compensatorio.md) | Devoluciones como registro compensatorio | Aceptada |
| [0031](0031-inventario-importacion-respaldo-e-instalador.md) | Inventario por movimientos, carga desde Eleventa, respaldo cifrado e instalador | Aceptada |
| [0032](0032-ajustes-kardex-bitacora-y-reporte-del-dia.md) | Ajustes, mermas, kardex, bitácora y reporte del día | Aceptada |
| [0033](0033-articulo-varios-con-precio-libre.md) | Artículo varios con precio libre | Aceptada |
| [0034](0034-flyway-y-modelo-base.md) | Flyway, UUIDv7 generado por el núcleo y modelo base | Aceptada |
| [0035](0035-rls-rol-de-aplicacion-y-tenant-por-transaccion.md) | RLS, rol de aplicación y `tenant_id` fijado en cada transacción | Aceptada |
| [0036](0036-outbox-con-modulith-y-redpanda.md) | Outbox con Spring Modulith, tabla por Flyway y eventos con contrato | Aceptada |
| [0037](0037-observabilidad-del-nucleo.md) | Observabilidad del núcleo con OpenTelemetry, `tenant_id` y Sentry | Aceptada |
| [0038](0038-bitacora-de-auditoria-solo-agregar.md) | Bitácora de auditoría de solo agregar | Aceptada |
| [0039](0039-keycloak-oidc-y-tenant-en-el-token.md) | Keycloak con OIDC, `tenant_id` en el token y tenant fijado por petición | Aceptada |
| [0040](0040-envio-desde-la-caja-con-outbox.md) | Envío desde la caja con outbox local, lotes en orden y reintentos con retroceso | Aceptada |
| [0041](0041-cliente-de-facturapi.md) | Cliente de Facturapi detrás de una interfaz, con reintentos solo en lecturas | Aceptada |
| [0042](0042-roles-y-permisos-por-endpoint.md) | Roles y permisos por endpoint, con rol leído de la base | Aceptada |
| [0044](0044-panel-next-con-login-oidc.md) | Panel Next.js con login OIDC del lado del servidor y sesión en cookie cifrada | Aceptada |
| [0043](0043-registro-de-caja-y-pin-en-el-servidor.md) | Registro de caja con código de un solo uso y PIN con Argon2id en el servidor | Aceptada |
| [0046](0046-recepcion-idempotente-en-el-nucleo.md) | Recepción idempotente de lotes en el núcleo, una transacción por operación | Aceptada |
| [0047](0047-editar-precio-de-un-producto-en-la-caja.md) | Editar el precio de un producto en la caja, con PIN del dueño, bitácora y outbox en una transacción | Aceptada |
| [0050](0050-factura-individual.md) | Factura individual con un intento registrado antes de timbrar y consulta antes de repetir | Aceptada |
| [0052](0052-reporte-del-corte-por-correo.md) | Reporte del corte por correo, asíncrono desde el outbox y sin duplicados | Aceptada |
| [0053](0053-recepcion-de-cambios-de-precio.md) | Recepción de cambios de precio en el núcleo, sin rechazar lo que aún no se conoce | Aceptada |
| [0051](0051-catalogo-de-productos-codigos-y-unidades.md) | Catálogo de productos, códigos únicos por negocio y unidad base fija | Aceptada |
| [0048](0048-cambios-hacia-la-caja-con-cursor.md) | Cambios hacia la caja con cursor numerado por negocio, tombstones y aplicación atómica | Aceptada |
| [0054](0054-credencial-de-dispositivo-en-sync-push.md) | Credencial de dispositivo `<tenantId>.<secreto>` en `/sync/push`, con revocación | Aceptada |
| [0049](0049-costo-promedio-en-el-servidor.md) | Costo promedio ponderado móvil, recalculado en el servidor desde el libro | Aceptada |
| [0055](0055-revision-de-cuarentena-y-discrepancias.md) | Revisión de cuarentena y discrepancias con resoluciones de solo agregar y aviso por el pull | Aceptada |
| [0056](0056-precio-impuesto-y-claves-sat-del-producto.md) | Precio con IVA incluido, impuesto y claves SAT del producto, publicados a las cajas | Aceptada |
| [0057](0057-alta-de-productos-en-la-caja.md) | Alta de productos en la caja, con PIN del dueño, existencia como movimiento y outbox en una transacción | Aceptada |
| [0058](0058-panel-de-modificacion-de-productos.md) | Panel de modificación de productos: borrado lógico, revisión optimista, unidad bloqueada con movimientos y precio e inventario por sus servicios | Aceptada |
| [0060](0060-tablero-de-indicadores-y-mas-vendidos.md) | Tablero «Resumen del negocio» en la caja: periodos en America/Mexico_City, costo promedio, permisos por turno, gráficas SVG y exportación sin librerías | Aceptada |
| [0059](0059-pedido-al-proveedor-en-la-caja.md) | Pedido al proveedor en la caja: documento local sin movimiento de inventario, borrador y enviado inmutable, códigos del proveedor, Excel con `exceljs` y PDF con la impresión de Electron | Aceptada |
| [0061](0061-rediseno-de-la-caja-y-herramientas-del-dueno.md) | Rediseño de la caja y herramientas del dueño | Aceptada |
| [0062](0062-importacion-de-catalogo-y-cambio-masivo-de-precios.md) | Importación de catálogo y cambio masivo de precios en el núcleo | Aceptada |
| [0063](0063-bitacora-de-faltantes-y-letra-del-ticket.md) | Bitácora de faltantes con PDF y gráficas, y fuente y tamaño de letra del ticket | Aceptada |
| [0064](0064-pantallas-de-catalogo-del-panel.md) | Pantallas de catálogo del panel: Server Components y Server Actions, paginación por desplazamiento, importación en dos pasos y cambio masivo con vista previa | Aceptada |
| [0065](0065-etiquetas-de-anaquel-en-pdf.md) | Etiquetas de anaquel en PDF: `POST /labels` con OpenPDF, EAN-13 o Code 128 y formato detrás de `LabelLayout` | Aceptada |
| [0066](0066-prueba-de-punta-a-punta-sin-internet.md) | Prueba de punta a punta sin internet: Java levanta el núcleo con PostgreSQL, Node ejecuta la sincronización real de la caja con cortes de red y reenvíos | Aceptada |
| [0067](0067-proveedores-en-el-producto-faltantes-editables-y-busqueda-de-ventas.md) | Proveedores y «Pedir más» en el producto, faltantes editables, nombre y moneda del ticket, y búsqueda de ventas en «Resumen» | Aceptada |
| [0068](0068-listas-de-precios-de-proveedores-y-comparador.md) | Listas de precios de proveedores y comparador: lista vigente reemplazada en una transacción, columnas recordadas, IVA preguntado, ligado por código, barras o a mano, comparación por unidad base y un borrador por proveedor con PDF | Aceptada |
| [0069](0069-lectura-de-catalogos-en-papel-con-claude.md) | Lectura de catálogos de proveedor en papel con Claude, revisión humana de cada fila y CSV para la caja | Aceptada |
| [0070](0070-fondo-de-caja-al-entrar-y-corte-al-salir.md) | Fondo de caja al entrar, «Solo administrar» para el dueño y pregunta de corte al cerrar la caja, decidida en el proceso principal | Aceptada |
| [0071](0071-exportacion-del-catalogo-completo.md) | Exportación del catálogo completo en PDF, Excel y CSV: solo el dueño, margen bruto y neto con enteros, CSV con BOM y PDF horizontal desde un archivo temporal | Aceptada |
| [0072](0072-estado-de-resultados-y-gastos-de-operacion.md) | Estado de resultados antes de ISR y sin IVA, gastos de operación inmutables con anulación, pagados de la caja sin contarlos dos veces, y «Resumen» por grupos | Aceptada |
| [0073](0073-reporte-ilustrado-del-negocio-en-pdf.md) | Reporte ilustrado del negocio en un solo PDF: solo el dueño, datos del mismo servicio del tablero, gráficas SVG a mano con enteros, «qué significa» bajo cada una y carta vertical desde un archivo temporal | Aceptada |
| [0074](0074-modificar-y-eliminar-el-proveedor-de-un-producto.md) | Modificar y eliminar el proveedor de un producto desde su panel: cambio de proveedor en una transacción, borradores intactos salvo que el dueño pida quitarlo y pedidos enviados nunca tocados | Aceptada |
| [0075](0075-preguntar-si-imprimir-el-ticket.md) | Preguntar si imprimir el ticket después de cada venta: preferencia en el diseño del ticket («Preguntar siempre» de fábrica), venta guardada antes de la pregunta, impresión anotada en la bitácora y ticket impreso después desde «Reimprimir» o «Ventas» | Aceptada |
| [0076](0076-captura-de-ventas-de-un-dia-atrasado.md) | Captura de las ventas de un día atrasado: el día se elige al entrar con autorización del dueño, caja aparte con corte suplementario, `business_day` en la venta y el inventario, `businessDate` opcional en el contrato y la regla del SAT | Aceptada; la caja aparte y el día ya cortado los reemplaza la 0078 |
| [0077](0077-cotizaciones-en-la-caja.md) | Cotizaciones en la caja: panel propio, tablas aparte sin inventario ni ventas, precios copiados, vigencia de 15 días calculada, historial de solo agregar, precio cotizado al convertir mientras esté vigente y ticket «COTIZACIÓN» | Aceptada |
| [0078](0078-retomar-la-caja-sin-corte-de-un-dia-atrasado.md) | Retomar la caja sin corte de un día atrasado: cada sesión guarda su día, elegir un día con caja sin corte retoma esa misma sesión (mismo id y fondo), un día ya cortado pide marcar una captura suplementaria ligada a su corte con el corte corregido del día, y la caja de hoy nunca se mezcla | Aceptada |
| [0079](0079-productos-equivalentes-entre-catalogos.md) | Productos equivalentes entre catálogos: reglas sin internet (sinónimos, medidas en enteros, conflictos y puntaje), decisiones de solo agregar por proveedor y código, IA opcional que nunca recibe costos ni decide, comparador por grupo y PDF de hasta 4 hojas en el lector | Aceptada |
| [0080](0080-factura-global.md) | Factura global mensual con vista previa: un periodo vivo por global, una venta en una sola global (índice parcial y candado compartido con la individual), ventas tardías a la siguiente y la factura propia posterior marcada para cancelar con motivo 04 | Aceptada |
| [0081](0081-productos-dados-de-baja-liberan-nombre-y-codigos.md) | Un producto dado de baja libera sus códigos a un historial de solo agregar, el nombre sigue sin ser único, reactivar nunca roba un código y pide otro nombre si choca, y la pantalla «Dados de baja» solo para el dueño | Aceptada |
