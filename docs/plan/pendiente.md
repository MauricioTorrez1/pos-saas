# Estado del proyecto

Actualizado el 2026-11-11 desde `docs/plan/progreso.md` y los roadmaps.

Leyenda: ✅ hecha (incluye las «en revisión» del modo automático, ya fusionadas en `main`) · ⚠️ falta. Las horas son la estimación del plan.


## Fase 0 · Cimientos del servidor y del catálogo

✅ 20 de 26 tareas hechas · ⚠️ 6 faltan (28 h)

- ✅ **F0-01 · Inicializar repositorio y monorepo** (2 h): el repositorio de GitHub tiene la estructura del monorepo y una licencia AGPL-3.0.
- ✅ **F0-02 · CI base en GitHub Actions** (3 h): cada PR compila y prueba Java, TypeScript y Python.
- ✅ **F0-03 · Escaneo de secretos y dependencias** (2 h): CI bloquea secretos filtrados y avisa de dependencias vulnerables.
- ✅ **F0-04 · Compose: perfil `core`** (4 h): PostgreSQL 16, Keycloak, Redis y Redpanda corren con un solo comando.
- ✅ **F0-05 · Compose: perfil `observability`** (5 h): Prometheus, Loki, Tempo y Grafana muestran datos de prueba.
- ✅ **F0-06 · Compose: perfiles `automation` y `analytics`** (4 h): n8n, un servicio FastAPI mínimo y un proyecto dbt con DuckDB corren en local.
- ✅ **F0-07 · Esqueleto de Spring Boot 4.1** (4 h): el núcleo arranca con módulos verificados y las versiones confirmadas.
- ✅ **F0-08 · Flyway y modelo base** (4 h): existen `tenant`, `branch`, `register` y `app_user` con UUIDv7.
- ✅ **F0-09 · RLS y prueba de aislamiento** (5 h): ningún negocio puede leer filas de otro.
- ✅ **F0-10 · Outbox hacia Redpanda** (5 h): un evento de prueba llega a Redpanda solo si la transacción se confirma.
- ✅ **F0-11 · Observabilidad del núcleo** (4 h): cada petición genera traza, métrica y log con `tenant_id`, y los errores llegan a Sentry.
- ✅ **F0-12 · Bitácora de auditoría** (3 h) _(En revisión)_: cada cambio sensible queda registrado sin poder editarse.
- ✅ **F0-13 · Keycloak y login con OIDC** (5 h) _(En revisión)_: el núcleo valida tokens con `tenant_id` como claim.
- ✅ **F0-14 · Roles y autorización** (4 h) _(En revisión)_: dueño, cajero, almacenista y técnico tienen permisos distintos.
- ✅ **F0-15 · Registro de caja y PIN en el servidor** (5 h) _(En revisión)_: una caja se registra una vez y recibe los hashes de PIN.
- ✅ **F0-16 · Productos, códigos y unidades** (6 h) _(En revisión)_: un rollo de 100 m se registra con unidad base metro y varios códigos.
- ✅ **F0-17 · Precios, impuestos y claves SAT** (5 h) _(En revisión)_: cada producto tiene listas de precio, IVA y claves SAT.
- ⚠️ **F0-18 · Importación de catálogo** (6 h): un CSV entra con reporte de errores por fila, incluyendo la plantilla de Eleventa.
- ⚠️ **F0-19 · Cambio masivo de precios** (3 h): el dueño sube 5% a una marca con vista previa.
- ✅ **F0-20 · Panel Next.js con login** (5 h) _(En revisión)_: el dueño entra al panel por Keycloak.
- ⚠️ **F0-21 · Pantallas de catálogo** (6 h): el dueño crea, busca, edita e importa productos.
- ⚠️ **F0-22 · Etiquetas en PDF** (3 h): el dueño imprime etiquetas desde cualquier impresora.
- ✅ **F0-23 · Contratos y casos compartidos** (4 h): `packages/contracts` contiene esquemas y casos de cálculo en JSON.
- ⚠️ **F0-24 · Servidor con Terraform** (5 h): existe un servidor reproducible dentro del presupuesto decidido.
- ⚠️ **F0-25 · Despliegue automático y respaldos** (5 h): un merge a `main` despliega en staging, con HTTPS y respaldo diario.
- ✅ **F0-26 · El rol en `GET /me`** (1 h) _(En revisión)_: el panel decide por el rol que guarda el núcleo, no por roles del realm que nadie mantiene.

## Entrega 1 · Reemplazar a Eleventa

✅ 39 de 44 tareas hechas · ⚠️ 5 faltan (21 h)

- ✅ **E1-01 · Esqueleto de la caja en Electron** (4 h): la caja abre con React y TypeScript, con la pantalla separada del proceso principal.
- ✅ **E1-02 · SQLite local y migraciones** (4 h): la caja crea y actualiza su base local al arrancar.
- ✅ **E1-03 · Interfaces de hardware y falsos** (3 h): la caja funciona sin hardware usando implementaciones falsas.
- ✅ **E1-04 · Login con PIN en la caja** (4 h): cada persona entra con su PIN, con o sin internet.
- ✅ **E1-05 · Dinero y cantidades** (5 h): TypeScript y Java calculan igual importes por línea.
- ✅ **E1-06 · IVA incluido y totales** (4 h): cada línea guarda subtotal, IVA y total, listos para facturar.
- ✅ **E1-07 · Pantalla de venta** (5 h): escanear o buscar agrega un producto en menos de 100 ms.
- ✅ **E1-08 · Venta por peso y por metro** (4 h): el cajero captura kilos o metros y ve el importe antes de agregar.
- ✅ **E1-09 · Artículo varios y listas de precio** (3 h) _(En revisión (artículo varios; las listas de precio quedan pendientes))_: se vende algo sin alta y se aplica precio de mayoreo con permiso.
- ✅ **E1-10 · Máquina de estados de la venta** (5 h): ninguna venta se pierde si la PC se apaga.
- ✅ **E1-11 · Efectivo, transferencia y pago mixto** (5 h): se cobra con una o varias formas de pago y se calcula el cambio.
- ✅ **E1-12 · Tarjeta tecleada con folio** (2 h): el cajero cobra en la terminal normal y captura el folio.
- ✅ **E1-13 · Ticket ESC/POS** (5 h): se imprime un ticket con folio, IVA y datos del negocio.
- ✅ **E1-14 · Cajón y prueba de hardware** (3 h): el cajón abre solo después de guardar una venta en efectivo.
- ✅ **E1-15 · Devoluciones** (6 h): una devolución con ticket se autoriza y regresa por el mismo medio.
- ✅ **E1-16 · Envío desde la caja** (5 h) _(En revisión)_: la caja sube lotes en orden y reintenta sola.
- ✅ **E1-17 · Recepción en el núcleo** (6 h) _(En revisión)_: el servidor recibe lotes de forma idempotente.
- ✅ **E1-18 · Cambios hacia la caja** (5 h) _(En revisión)_: catálogo, precios y permisos llegan con cursor.
- ✅ **E1-19 · Discrepancias y cuarentena** (4 h) _(En revisión)_: el dueño revisa diferencias sin perder ventas.
- ⚠️ **E1-20 · Prueba de punta a punta sin internet** (4 h): se demuestra que no se duplican ni pierden ventas.
- ✅ **E1-21 · Sesión de caja** (5 h): se abre con fondo y se registran entradas y salidas.
- ✅ **E1-22 · Aviso de retiro parcial** (2 h): la caja avisa al pasar el límite de efectivo, sin frenar la venta.
- ✅ **E1-23 · Corte con arqueo** (5 h): el corte diario compara lo esperado con lo contado.
- ✅ **E1-24 · Reporte por correo** (3 h) _(En revisión)_: el dueño recibe el corte por correo, aunque se envíe tarde.
- ✅ **E1-25 · Movimientos por venta y devolución** (4 h): cada venta crea movimientos, en caja y en servidor.
- ✅ **E1-26 · Ajustes y mermas** (3 h) _(En revisión)_: el almacenista registra ajustes y mermas con motivo.
- ✅ **E1-27 · Kardex y verificación** (4 h) _(En revisión)_: el kardex coincide siempre con la existencia.
- ✅ **E1-28 · Costo promedio** (4 h) _(En revisión)_: el margen usa un costo promedio correcto, incluso con sincronización tardía.
- ✅ **E1-29 · Saldo inicial desde Eleventa** (4 h): existencias y ventas de Eleventa entran sin duplicar.
- ✅ **E1-30 · Cliente de Facturapi** (4 h) _(En revisión)_: el núcleo crea facturas en modo de prueba, con llave cifrada por negocio.
- ✅ **E1-31 · Factura individual** (6 h) _(En revisión)_: una venta sincronizada se factura y se guardan UUID, XML y PDF.
- ⚠️ **E1-32 · Factura global** (5 h): las ventas no facturadas de un periodo van a una global.
- ⚠️ **E1-33 · Cancelación y nota de crédito** (4 h): se cancela una factura o se emite egreso por una devolución.
- ✅ **E1-34 · Reportes básicos** (5 h) _(En revisión)_: el dueño ve ventas, ticket promedio, margen, agotados y productos sin venta.
- ✅ **E1-35 · Respaldo de la caja** (4 h): la base de la caja se copia cada hora a otro dispositivo.
- ✅ **E1-36 · Instalador para Windows** (4 h): tu familia instala y actualiza la caja sin ayuda técnica.
- ⚠️ **E1-37 · Piloto paralelo** (4 h): 1 a 2 semanas registrando en ambos sistemas.
- ⚠️ **E1-38 · Salida de Eleventa** (4 h): la tienda opera solo con este sistema y tiene plan de regreso.
- ✅ **E1-39 · Editar precio de un producto en la caja** (3 h): el dueño cambia el precio de un producto ya dado de alta, sin tocar las ventas hechas ni la que está en curso.
- ✅ **E1-40 · Recepción de cambios de precio en el núcleo** (3 h) _(En revisión)_: el núcleo guarda, audita y anuncia los cambios de precio que hace la caja, aunque todavía no conozca el producto.
- ✅ **E1-41 · Credencial de dispositivo en `/sync/push`** (4 h) _(En revisión)_: solo una caja enrolada puede enviar, y solo sus propios lotes; una caja perdida se da de baja y deja de enviar.
- ✅ **E1-42 · Alta de nuevos productos en la caja** (4 h): el dueño da de alta, desde la venta y sin internet, un producto que no está en el catálogo, con su unidad, precio, impuesto, costo, códigos de barras y existencia inicial.
- ✅ **E1-43 · Panel de modificación de productos** (5 h) _(En revisión)_: el dueño busca un producto y modifica su nombre, códigos, unidad, impuesto, costo y estado, cambia su precio y ajusta su inventario desde una sola pantalla, sin perder el historial.
- ✅ **E1-45 · Tablero de indicadores y más vendidos** (6 h) _(En revisión)_: el dueño ve en la caja, sin internet, cómo va el negocio por día, semana, mes, año o rango contra el periodo anterior, con los más vendidos, lo que no se mueve y el valor del inventario, y lo exporta a Excel y PDF.

## Entrega 2 · Terminal de tarjeta integrada

✅ 0 de 9 tareas hechas · ⚠️ 9 faltan (34 h)

- ⚠️ **E2-01 · Spike de la terminal real** (2 h): saber si en modo PDV se puede teclear un cobro y cómo volver a `STANDALONE`.
- ⚠️ **E2-02 · Aplicación y cliente de Mercado Pago** (4 h): el núcleo se autentica y lista la terminal.
- ⚠️ **E2-03 · Crear orden en la terminal** (4 h): el total de la venta aparece en la terminal.
- ⚠️ **E2-04 · Webhook con firma** (4 h): el núcleo recibe resultados verificados y responde rápido.
- ⚠️ **E2-05 · Avisos a la caja y consulta puntual** (5 h): la caja conoce el resultado en tiempo real o con una consulta puntual.
- ⚠️ **E2-06 · Espera, cancelación y sin cobro doble** (5 h): ninguna venta admite otra forma de pago sin un estado final.
- ⚠️ **E2-07 · Reembolsos** (3 h): las devoluciones con tarjeta se reembolsan por API.
- ⚠️ **E2-08 · Conciliación** (4 h): el dueño ve diferencias entre ventas y pagos.
- ⚠️ **E2-09 · Cobro real y piloto** (3 h): la terminal integrada opera en la tienda con riesgo bajo.

## Fase 2 · Clientes, crédito, compras y reparaciones

✅ 0 de 24 tareas hechas · ⚠️ 24 faltan (104 h)

- ⚠️ **F2-01 · Portal de autofactura** (6 h): un cliente factura su ticket con folio y datos fiscales.
- ⚠️ **F2-02 · Autofactura de una venta en global** (3 h): el sistema aplica el tratamiento validado con el contador.
- ⚠️ **F2-03 · Complementos de pago** (5 h): una factura a crédito emite complemento al pagarse.
- ⚠️ **F2-04 · Clientes y aviso de privacidad** (5 h): se guardan datos fiscales con aviso de privacidad y acceso restringido.
- ⚠️ **F2-05 · Historial del cliente** (2 h): se consultan compras y facturas de un cliente.
- ⚠️ **F2-06 · Club de maestros** (5 h): un maestro compra con su lista y acumula puntos.
- ⚠️ **F2-07 · Cotizaciones** (5 h): una cotización vigente se convierte en venta.
- ⚠️ **F2-08 · Apartados** (5 h): un anticipo reserva mercancía y registra el saldo.
- ⚠️ **F2-09 · Crédito y límite** (6 h): se vende a crédito sin rebasar el límite.
- ⚠️ **F2-10 · Abonos y cuentas por cobrar** (4 h): se aplican abonos y se ve la antigüedad de saldos.
- ⚠️ **F2-11 · Proveedores** (3 h): se registran proveedores y sus costos.
- ⚠️ **F2-12 · Órdenes de compra sugeridas** (5 h): productos bajo el punto de reorden generan una sugerencia.
- ⚠️ **F2-13 · Recepción de mercancía** (5 h): una recepción parcial crea movimientos y actualiza costo.
- ⚠️ **F2-14 · Cuentas por pagar** (4 h): se registran saldos y pagos a proveedores.
- ⚠️ **F2-15 · Comparativo de proveedores** (3 h): se compara el último costo por proveedor.
- ⚠️ **F2-16 · Conteos cíclicos y reorden** (5 h): un conteo crea ajustes, y se configuran mínimos y máximos.
- ⚠️ **F2-17 · Orden de reparación y folio** (5 h): un equipo recibido obtiene un folio.
- ⚠️ **F2-18 · Fotos de recepción** (4 h): las fotos se guardan fuera de la base de datos y con acceso privado.
- ⚠️ **F2-19 · Estados de reparación** (3 h): solo se permiten transiciones válidas.
- ⚠️ **F2-20 · WhatsApp Cloud API** (6 h): el sistema envía avisos con plantillas aprobadas.
- ⚠️ **F2-21 · Aprobación por WhatsApp** (4 h): el cliente aprueba o rechaza su cotización de reparación.
- ⚠️ **F2-22 · Refacciones** (3 h): las piezas usadas descuentan inventario.
- ⚠️ **F2-23 · Entrega, cobro y garantía** (5 h): al entregar se cobra y se registra la garantía.
- ⚠️ **F2-24 · Consulta pública del folio** (3 h): el cliente consulta el estado de su reparación.

## Fase 3 · Venta en línea, bot y promociones

✅ 0 de 19 tareas hechas · ⚠️ 19 faltan (93 h)

- ⚠️ **F3-01 · Catálogo público** (6 h): los productos se ven en línea con SEO básico.
- ⚠️ **F3-02 · Existencia web con margen** (3 h): la web no promete lo que quizá ya se vendió sin internet.
- ⚠️ **F3-03 · Carrito y pago** (6 h): el cliente arma un pedido y elige entrega.
- ⚠️ **F3-04 · Reserva con expiración** (5 h): el inventario se reserva durante el pago y se libera al vencer.
- ⚠️ **F3-05 · Link de pago** (6 h): un pedido se paga con un link y se confirma por webhook.
- ⚠️ **F3-06 · Pedido a venta** (4 h): un pedido pagado se vuelve venta y descuenta inventario.
- ⚠️ **F3-07 · Entrega y avisos** (4 h): el cliente recibe avisos de entrega o recolección.
- ⚠️ **F3-08 · Bot: consultas** (6 h): el bot del negocio responde precio y existencia.
- ⚠️ **F3-09 · Bot: pedidos** (6 h): el cliente arma un pedido y recibe link de pago por WhatsApp.
- ⚠️ **F3-10 · Modelo de promociones** (4 h): las reglas se guardan con vigencia, prioridad y acción.
- ⚠️ **F3-11 · Evaluador en TypeScript** (5 h): la caja evalúa reglas sin internet.
- ⚠️ **F3-12 · Evaluador en Java** (5 h): el servidor evalúa igual que la caja.
- ⚠️ **F3-13 · Repartidor de descuentos** (6 h): 3x2, combos, volumen y acumulación se reparten igual en ambos.
- ⚠️ **F3-14 · Promociones en caja** (4 h): las promociones se aplican al cobrar y el servidor las revalida.
- ⚠️ **F3-15 · Cupones** (4 h): un cupón se valida en línea y se rechaza sin internet si es de un solo uso.
- ⚠️ **F3-16 · Panel de promociones** (5 h): el dueño crea promociones sin ver JSON.
- ⚠️ **F3-17 · Publicación en redes** (5 h): una promoción aprobada se publica en Facebook e Instagram.
- ⚠️ **F3-18 · Catálogo en Meta** (5 h): el catálogo de WhatsApp e Instagram se sincroniza.
- ⚠️ **F3-19 · Reseñas** (4 h): tras la entrega se solicita una reseña.

## Fase 4 · SaaS multi-negocio y otros giros

✅ 0 de 23 tareas hechas · ⚠️ 23 faltan (110 h)

- ⚠️ **F4-01 · Alta de negocio** (6 h): una persona crea su negocio en autoservicio.
- ⚠️ **F4-02 · Asistente por giro** (5 h): ferretería o heladería arrancan con su configuración.
- ⚠️ **F4-03 · Planes y límites** (5 h): cada plan habilita módulos y límites sin frenar ventas.
- ⚠️ **F4-04 · Cobro de suscripción** (6 h): cada negocio paga su plan mensual.
- ⚠️ **F4-05 · Sucursales y cajas** (5 h): un negocio administra varias sucursales y cajas.
- ⚠️ **F4-06 · Traspasos** (4 h): un traspaso crea salida y entrada ligadas.
- ⚠️ **F4-07 · Roles configurables** (5 h): el dueño crea roles con permisos.
- ⚠️ **F4-08 · Credenciales por negocio** (5 h): cada negocio conecta su Mercado Pago y su Facturapi.
- ⚠️ **F4-09 · Alertas de fraude** (4 h): patrones sospechosos avisan al dueño.
- ⚠️ **F4-10 · API pública** (6 h): un negocio consulta su API con una llave.
- ⚠️ **F4-11 · Webhooks salientes** (5 h): un negocio recibe eventos firmados.
- ⚠️ **F4-12 · Importar Excel** (4 h): un negocio trae su catálogo desde Excel.
- ⚠️ **F4-13 · Recetas e ingredientes** (6 h): vender una crepa de fresa descuenta sus ingredientes.
- ⚠️ **F4-14 · Modificadores** (5 h): waffles y dorilocos admiten toppings con precio.
- ⚠️ **F4-15 · Piloto en la heladería** (4 h): la heladería opera con el SaaS.
- ⚠️ **F4-16 · Lotes y caducidades** (6 h): abarrotes vende primero lo que caduca primero.
- ⚠️ **F4-17 · Números de serie** (3 h): un equipo se rastrea por serie.
- ⚠️ **F4-18 · Caja web** (6 h): un negocio sin hardware vende desde el navegador.
- ⚠️ **F4-19 · Mesas y comandas** (6 h): un restaurante abre mesas y envía comandas.
- ⚠️ **F4-20 · Restricción de edad** (2 h): ciertos productos piden confirmar la edad.
- ⚠️ **F4-21 · Farmacia y receta** (4 h): productos controlados registran su receta.
- ⚠️ **F4-22 · Firma de código** (3 h): el instalador se ejecuta sin advertencias.
- ⚠️ **F4-23 · Escalar infraestructura** (5 h): existe un plan probado para pasar a AWS.

## Fase 5 · Analítica, IA y contabilidad

✅ 0 de 15 tareas hechas · ⚠️ 15 faltan (72 h)

- ⚠️ **F5-01 · Consumidor de eventos** (5 h): las ventas llegan de Redpanda a DuckDB.
- ⚠️ **F5-02 · Modelos dbt** (6 h): existen tablas limpias de ventas por producto, día y negocio.
- ⚠️ **F5-03 · Lento movimiento** (5 h): se detectan productos sin rotación con inventario alto.
- ⚠️ **F5-04 · Se compran juntos** (6 h): se proponen combos por asociación.
- ⚠️ **F5-05 · Temporadas** (4 h): se anticipan temporadas con historial.
- ⚠️ **F5-06 · Filtro de margen** (3 h): ninguna sugerencia rompe el margen mínimo.
- ⚠️ **F5-07 · Explicación con Claude** (5 h): cada sugerencia tiene explicación y texto de publicación.
- ⚠️ **F5-08 · Aprobación del dueño** (4 h): una sugerencia aprobada se vuelve regla activa.
- ⚠️ **F5-09 · Medición de resultados** (5 h): se compara lo esperado contra lo ocurrido.
- ⚠️ **F5-10 · Pronóstico de demanda** (6 h): se estima la demanda con su margen de error.
- ⚠️ **F5-11 · ABC y rotación** (4 h): se clasifican productos por su aporte.
- ⚠️ **F5-12 · Catálogo de cuentas y pólizas** (6 h): cada corte genera una póliza con código agrupador del SAT.
- ⚠️ **F5-13 · Balanza y estado de resultados** (6 h): el sistema emite balanza y estado de resultados.
- ⚠️ **F5-14 · IVA y exportación** (4 h): el contador recibe el IVA y un archivo para su sistema.
- ⚠️ **F5-15 · Evaluación de sugerencias** (3 h): un conjunto fijo detecta si la calidad empeora.

## Total

✅ 58 de 159 tareas hechas (238 h de 700 h) · ⚠️ 101 faltan (462 h).
