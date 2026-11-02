# Requisitos

Formato de cada criterio: **Dado** el contexto, **cuando** ocurre algo, **entonces** el resultado esperado. La columna de fase usa F0, E1, E2, F2, F3, F4 y F5.

## Requisitos funcionales

### Catálogo e identidad (F0)
- **RF-001 Códigos de barras.** Dado un producto con dos códigos, cuando se escanea cualquiera, entonces se encuentra el mismo producto.
- **RF-002 Unidades y conversiones.** Dado un rollo de 100 m con unidad base metro, cuando entra un rollo al inventario, entonces la existencia sube 100.000 m.
- **RF-003 Listas de precio.** Dado un producto con precio público y de mayoreo, cuando se elige la lista de mayoreo, entonces la línea usa ese precio.
- **RF-004 Impuestos y claves SAT.** Dado un producto nuevo, cuando se guarda sin clave de producto o de unidad SAT, entonces queda marcado como no facturable y aparece en un reporte de pendientes.
- **RF-005 Importar catálogo.** Dado un CSV con 2 filas inválidas de 1,000, cuando se importa, entonces entran 998 productos y se descarga un reporte con las 2 fallidas.
- **RF-006 Cambio masivo de precios.** Dado un aumento de 5% a la marca Truper, cuando el dueño lo confirma, entonces los precios cambian, queda registro en la bitácora y las cajas lo reciben al sincronizar.
- **RF-007 Etiquetas.** Dada una selección de productos, cuando se pide imprimir, entonces se genera un PDF con precio, nombre y código de barras.
- **RF-008 Usuarios y roles.** Dado un usuario con rol cajero, cuando intenta cambiar un precio en el panel, entonces recibe 403 y el intento queda registrado.
- **RF-009 Registro de caja y PIN.** Dada una caja registrada una vez en línea, cuando no hay internet y una persona teclea su PIN correcto, entonces entra; tras 5 errores seguidos, ese PIN se bloquea 5 minutos.
- **RF-010 Aislamiento.** Dados dos negocios, cuando el negocio A consulta cualquier tabla de negocio, entonces no ve filas del negocio B, incluso con un error en el `WHERE`.

### Venta en caja (E1)
- **RF-011 Escaneo y búsqueda.** Dado un producto con código, cuando se escanea, entonces se agrega al carrito en menos de 100 ms; si no tiene código, se encuentra por nombre.
- **RF-012 Granel.** Dado cable a $12.50 por metro, cuando se capturan 3.275 m, entonces la línea importa $40.94 y la cantidad queda con unidad metro.
- **RF-013 Artículo varios.** Dado un producto sin alta, cuando un usuario con permiso usa «varios» con precio libre, entonces la venta procede y queda en la bitácora.
- **RF-014 Efectivo.** Dado un total de $40.94 y $50.00 recibidos, cuando se confirma, entonces muestra $9.06 de cambio y la venta queda `completed`.
- **RF-015 Pago mixto y transferencia.** Dado un total de $100, cuando se pagan $60 en efectivo y $40 en transferencia con referencia, entonces cada parte queda registrada y el corte las separa.
- **RF-016 Tarjeta tecleada.** Dada la terminal en modo normal, cuando el cajero cobra en ella y captura el folio, entonces el pago queda como `card_manual` con ese folio.
- **RF-017 Guardar antes de cobrar.** Dado un corte de luz con una venta `pending_payment`, cuando la caja arranca, entonces muestra esa venta para confirmarla o cancelarla.
- **RF-018 Ticket y cajón.** Dada una venta confirmada en efectivo, cuando se completa, entonces se abre el cajón y se imprime el ticket con folio corto; si falla la impresora, la venta no se pierde y se puede reimprimir.
- **RF-019 Devoluciones.** Dado un ticket de hace 10 días, cuando el dueño autoriza, entonces se reintegra por el mismo medio y se crea el movimiento de entrada; con más de 30 días o granel cortado, se rechaza por defecto.
- **RF-020 Venta sin internet.** Dada la caja sin conexión, cuando se vende en efectivo o tarjeta tecleada, entonces el flujo es idéntico y la venta queda pendiente de sincronizar.
- **RF-021 Sincronización idempotente.** Dado un lote enviado dos veces, cuando llega al servidor, entonces cada venta existe una sola vez.
- **RF-022 Discrepancias.** Dada una venta sin internet a precio viejo, cuando se sincroniza, entonces se acepta y se crea una discrepancia para el dueño.
- **RF-023 Catálogo a caja.** Dado un cambio de precio en el panel, cuando la caja sincroniza, entonces aplica el cambio y actualiza su cursor.

### Caja y cortes (E1)
- **RF-024 Apertura.** Dada una caja cerrada, cuando se captura el fondo, entonces se abre la sesión de caja y se permite vender.
- **RF-025 Entradas y salidas.** Dado un pago a proveedor en efectivo, cuando se registra una salida con motivo, entonces reduce el efectivo esperado.
- **RF-026 Aviso de retiro.** Dado un límite de $5,000, cuando el efectivo esperado lo supera, entonces la caja avisa sin bloquear la venta.
- **RF-027 Corte con arqueo.** Dado un corte, cuando se capturan las denominaciones, entonces se calcula la diferencia por forma de pago; si no cuadra, se pide un motivo.
- **RF-028 Reporte al dueño.** Dado un corte cerrado, cuando hay internet, entonces se envía por correo; sin internet, queda en cola.

### Inventario (E1)
- **RF-029 Movimientos automáticos.** Dada una venta o devolución, cuando se confirma, entonces se crean sus movimientos en la misma transacción.
- **RF-030 Ajustes y mermas.** Dado un rollo dañado, cuando se registra merma con motivo, entonces se crea un movimiento y queda en la bitácora.
- **RF-031 Kardex.** Dado un producto, cuando se consulta su kardex, entonces la suma de movimientos coincide con la existencia.
- **RF-032 Existencia negativa.** Dada existencia 0, cuando se vende, entonces la venta procede, queda negativa y se genera una alerta.
- **RF-033 Costo promedio.** Dadas dos compras a distinto costo, cuando se reciben, entonces el costo promedio se recalcula con escala `e6`.
- **RF-034 Saldo inicial.** Dado un archivo de Eleventa, cuando se importa, entonces crea movimientos `opening_balance` con `source = import`, y repetir la importación no los duplica.

### Factura (E1)
- **RF-035 Factura individual.** Dada una venta con datos fiscales válidos, cuando se factura, entonces se timbra con Facturapi y se guardan su UUID, XML y PDF.
- **RF-036 Factura global.** Dado un periodo cerrado, cuando se genera la global, entonces incluye solo ventas no facturadas y las marca como incluidas.
- **RF-037 Cancelación.** Dada una factura timbrada, cuando se cancela con motivo, entonces se registra su estado y queda en la bitácora.
- **RF-038 Nota de crédito.** Dada una devolución de una venta facturada, cuando se autoriza, entonces se emite un CFDI de egreso relacionado.

### Reportes y auditoría (E1)
- **RF-039 Reportes básicos.** Dado un día de ventas, cuando el dueño consulta, entonces ve ventas por hora, día y cajero, ticket promedio, margen, agotados y productos sin venta.
- **RF-040 Bitácora.** Dada una cancelación, devolución, ajuste o cambio de precio, cuando ocurre, entonces queda quién, cuándo, valor anterior y valor nuevo, sin posibilidad de editarla.

### Terminal integrada (E2)
- **RF-041 Cobro integrado.** Dado un total con tarjeta, cuando se confirma, entonces la orden llega a la terminal con llave de idempotencia y la venta pasa a `card_pending`.
- **RF-042 Sin cobro doble.** Dada una orden sin estado final, cuando el cajero intenta otra forma de pago, entonces el sistema lo impide hasta confirmar cancelación o expiración.
- **RF-043 Respaldo.** Dada la caja sin internet, cuando se elige tarjeta, entonces se sigue el procedimiento validado en el spike.
- **RF-044 Reembolso.** Dado un pago con menos de 90 días, cuando se autoriza, entonces se reembolsa por API total o parcial; con más de 90 días, se ofrece otro medio autorizado por el dueño.
- **RF-045 Conciliación.** Dado un reporte de Mercado Pago, cuando se concilia, entonces señala pagos sin venta y ventas sin pago.

### Operación completa (F2)
- **RF-046 Cotizaciones.** Dada una cotización vigente, cuando se convierte, entonces crea una venta con sus precios.
- **RF-047 Apartados.** Dado un anticipo, cuando se aparta, entonces se reserva la mercancía y se registra el saldo.
- **RF-048 Crédito.** Dado un límite de $5,000 y un saldo de $4,800, cuando se intenta vender $500 a crédito, entonces se rechaza; sin internet, no se ofrece crédito.
- **RF-049 Órdenes de compra.** Dado un producto bajo su punto de reorden, cuando se abre el reporte, entonces se sugiere una orden.
- **RF-050 Recepción y cuentas por pagar.** Dada una orden, cuando se recibe parcialmente, entonces entra lo recibido y se registra el saldo con el proveedor.
- **RF-051 Comparativo.** Dados dos proveedores de un producto, cuando se consulta, entonces se muestra el último costo de cada uno.
- **RF-052 Orden de reparación.** Dado un equipo recibido, cuando se registra con fotos, entonces se genera un folio.
- **RF-053 Aprobación por WhatsApp.** Dada una cotización de reparación, cuando el cliente aprueba, entonces la orden pasa a `in_repair`.
- **RF-054 Refacciones.** Dada una pieza usada, cuando se agrega a la orden, entonces descuenta inventario.
- **RF-055 Clientes.** Dado un cliente, cuando se consulta, entonces muestra datos fiscales e historial, y sus datos siguen el aviso de privacidad.
- **RF-056 Club de maestros.** Dado un maestro inscrito, cuando compra, entonces aplica su lista y acumula puntos.
- **RF-057 Autofactura.** Dado un ticket no facturado, cuando el cliente captura su folio y datos, entonces recibe su factura; si la venta está en una global, se aplica el tratamiento validado con el contador.
- **RF-058 Complementos de pago.** Dada una factura a crédito, cuando se paga, entonces se emite el complemento.
- **RF-059 Conteos y reorden.** Dado un conteo cíclico, cuando se captura, entonces las diferencias crean movimientos de ajuste; mínimos y máximos alimentan el reporte de reorden.

### Venta en línea (F3)
- **RF-060 Tienda web.** Dado un producto con existencia, cuando se consulta, entonces muestra disponibilidad con margen de seguridad.
- **RF-061 Reserva.** Dado un pedido, cuando se inicia el pago, entonces se reserva por tiempo limitado y se libera al vencer.
- **RF-062 Link de pago.** Dado un pedido, cuando se genera el link, entonces un webhook confirma el pago y la venta.
- **RF-063 Pedido por WhatsApp.** Dado un cliente en WhatsApp, cuando pide un producto, entonces el bot del negocio consulta existencia y crea el pedido.
- **RF-064 Entrega.** Dado un pedido pagado, cuando cambia de estado, entonces se avisa al cliente por domicilio o para recoger.
- **RF-065 Motor de promociones.** Dada una regla vigente, cuando se evalúa en caja y en servidor, entonces ambos dan el mismo resultado con los casos compartidos.
- **RF-066 Tipos de promoción.** Dado un 3x2 en clavos, cuando hay tres en el carrito, entonces se descuenta el de menor precio.
- **RF-067 Cupones.** Dado un cupón de un solo uso sin internet, cuando se captura, entonces se rechaza con un mensaje claro.
- **RF-068 Redes sociales.** Dada una promoción aprobada, cuando se activa, entonces n8n la publica en Facebook e Instagram.
- **RF-069 Catálogo en canales.** Dado un cambio de precio, cuando se sincroniza, entonces el catálogo de WhatsApp e Instagram se actualiza.

### SaaS (F4)
- **RF-070 Alta en autoservicio.** Dada una persona nueva, cuando completa el asistente, entonces se crea un negocio con catálogo inicial por giro.
- **RF-071 Planes.** Dado un plan vencido, cuando pasa el periodo de gracia, entonces se limita el panel, pero nunca se impide vender.
- **RF-072 Sucursales y cajas.** Dado un traspaso, cuando se confirma, entonces crea salida y entrada ligadas.
- **RF-073 Roles configurables.** Dado un rol nuevo, cuando se asignan permisos, entonces aplica en panel y caja.
- **RF-074 Alertas de fraude.** Dadas muchas cancelaciones de un cajero, cuando superan un umbral, entonces avisa al dueño.
- **RF-075 API pública.** Dada una llave de API, cuando se consulta, entonces solo ve su negocio y queda limitada por tasa.
- **RF-076 Importar Excel.** Dado un archivo de otro sistema, cuando se importa, entonces valida y reporta errores por fila.
- **RF-077 Recetas y modificadores.** Dada una crepa de fresa, cuando se vende, entonces descuenta sus ingredientes y cobra sus toppings.
- **RF-078 Lotes y caducidades.** Dado un producto con lote, cuando se vende, entonces descuenta el que caduca primero.
- **RF-079 Caja web.** Dado un negocio sin hardware, cuando abre la caja en el navegador, entonces vende con las reglas comunes.
- **RF-080 Credenciales por negocio.** Dado un negocio nuevo, cuando conecta Mercado Pago y Facturapi, entonces sus credenciales quedan cifradas y aisladas.

### IA y analítica (F5)
- **RF-081 Lento movimiento.** Dado un producto sin ventas en 90 días, cuando se analiza, entonces se sugiere una rebaja que respete el margen mínimo.
- **RF-082 Combos.** Dados productos que se compran juntos, cuando superan un umbral, entonces se sugiere un combo.
- **RF-083 Aprobación y medición.** Dada una sugerencia, cuando el dueño aprueba, entonces se activa y se mide contra lo esperado.
- **RF-084 Pronóstico.** Dado un historial suficiente, cuando se calcula, entonces se muestra demanda con su margen de error.
- **RF-085 Contabilidad.** Dado un corte, cuando se procesa, entonces genera una póliza y alimenta balanza y estado de resultados.
- **RF-086 Análisis ABC.** Dado un periodo, cuando se consulta, entonces clasifica productos y muestra rotación.

## Requisitos no funcionales
| ID | Atributo | Requisito medible | Cómo se verifica |
| --- | --- | --- | --- |
| RNF-01 | Sin internet | La caja vende 7 días sin conexión y sincroniza sin duplicar ni perder ventas | Prueba end-to-end con red cortada |
| RNF-02 | Respuesta en caja | Agregar un producto: p95 menor a 100 ms; cerrar en efectivo sin impresión: p95 menor a 300 ms, con 5,000 productos | Prueba de rendimiento en la PC de la tienda |
| RNF-03 | Respuesta de API | Lectura p95 menor a 300 ms; lote de 100 ventas menor a 2 s | Métricas en Grafana |
| RNF-04 | Disponibilidad | Nube a 99.5% mensual; la venta no depende de ella | Monitoreo externo |
| RNF-05 | Sincronización | Tras reconectar, 1,000 ventas pendientes suben en menos de 5 minutos | Prueba de carga |
| RNF-06 | Aislamiento | 100% de las tablas de negocio con RLS y prueba negativa | Prueba automática en CI |
| RNF-07 | Auditoría | 100% de cancelaciones, devoluciones, ajustes y cambios de precio con usuario y hora | Prueba de integración |
| RNF-08 | Seguridad | Sin datos de tarjeta ni secretos en el repositorio; escaneo de secretos y dependencias en CI | CI |
| RNF-09 | Respaldos | Nube diaria con retención de 30 días, RPO 24 h y RTO 4 h; copia local cada hora en otro dispositivo | Simulacro trimestral de restauración |
| RNF-10 | Exactitud | Cero diferencias entre caja y servidor en los casos compartidos | CI |
| RNF-11 | Compatibilidad | La caja corre en Windows 10 y 11 con 4 GB de RAM como mínimo | Prueba manual por versión |
| RNF-12 | Cumplimiento | CFDI 4.0 válido y aviso de privacidad publicado antes de capturar datos personales | Revisión con el contador |
