# Fase 2: Operación completa

Duración estimada: 104 horas, sin calendario todavía. Reparto: modo mentor; tú escribes la lógica y Claude prepara el andamiaje y revisa.

## Hito F2-A: Factura para clientes

### F2-01 · Portal de autofactura
- **Objetivo:** un cliente factura su ticket con folio y datos fiscales.
- **Conceptos:** [Next.js], [Facturas en Facturapi]
- **Claude / tú:** Claude crea la página y el QR. Tú escribes validación y flujo.
- **Pruebas:** Playwright y RFC inválido.
- **Criterios:** cumple RF-057 para ventas no incluidas en una global.
- **Depende de:** E1-31 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Cómo evitas que alguien adivine folios? (2) ¿Qué datos fiscales pides? (3) ¿Hasta cuándo se puede facturar?
- **Entrevista:** (1) ¿Cómo proteges una página pública sin login? (2) ¿Qué es el rate limiting?

### F2-02 · Autofactura de una venta en global
- **Objetivo:** el sistema aplica el tratamiento validado con el contador.
- **Conceptos:** [Referencia de Facturapi]
- **Claude / tú:** Claude prepara casos. Tú escribes la regla que apruebe el contador.
- **Pruebas:** venta en global, sin global y ya facturada.
- **Criterios:** una venta no queda facturada dos veces.
- **Depende de:** F2-01, E1-32 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Qué estados tiene `invoice_state`? (2) ¿Quién valida la regla? (3) ¿Qué pasa si cambia la norma?
- **Entrevista:** (1) ¿Cómo codificas reglas fiscales cambiantes? (2) ¿Cómo pruebas reglas de negocio con fechas?

### F2-03 · Complementos de pago
- **Objetivo:** una factura a crédito emite complemento al pagarse.
- **Conceptos:** [Facturapi]
- **Claude / tú:** Claude prepara el cliente. Tú escribes la relación con cada abono.
- **Pruebas:** pago total, parcial y varios abonos.
- **Criterios:** cumple RF-058.
- **Depende de:** F2-10, E1-31 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué es PPD? (2) ¿Cuándo se emite? (3) ¿Cómo manejas abonos parciales?
- **Entrevista:** (1) ¿Cómo garantizas orden en procesos externos? (2) ¿Cómo manejas fallos parciales?

## Hito F2-B: Clientes y lealtad

### F2-04 · Clientes y aviso de privacidad
- **Objetivo:** se guardan datos fiscales con aviso de privacidad y acceso restringido.
- **Conceptos:** [Datos personales], [Spring Data JPA]
- **Claude / tú:** Claude da el andamiaje. Tú escribes modelo, validaciones y permisos.
- **Pruebas:** aislamiento y permisos.
- **Criterios:** cumple RF-055 y RNF-12.
- **Depende de:** E1-38 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué datos son personales? (2) ¿Para qué sirve el aviso? (3) ¿Cómo atiendes una solicitud de borrado?
- **Entrevista:** (1) ¿Cómo aplicas privacidad por diseño? (2) ¿Borrado lógico o físico?

### F2-05 · Historial del cliente
- **Objetivo:** se consultan compras y facturas de un cliente.
- **Conceptos:** [Índices]
- **Claude / tú:** Claude revisa la consulta. Tú escribes la API y la pantalla.
- **Pruebas:** paginación con datos sintéticos.
- **Criterios:** responde en menos de 300 ms.
- **Depende de:** F2-04 · **Estimación:** 2 h
- **Autoevaluación:** (1) ¿Qué índice usas? (2) ¿Por qué paginar? (3) ¿Qué ve cada rol?
- **Entrevista:** (1) ¿Qué es un índice compuesto? (2) ¿Cómo detectas consultas lentas?

### F2-06 · Club de maestros
- **Objetivo:** un maestro compra con su lista y acumula puntos.
- **Conceptos:** [Libro inmutable]
- **Claude / tú:** Claude revisa el modelo. Tú escribes el libro de puntos y el canje.
- **Pruebas:** acumular, canjear y devolver.
- **Criterios:** cumple RF-056.
- **Depende de:** F2-04 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Por qué un libro de puntos? (2) ¿Qué pasa al devolver? (3) ¿Funciona sin internet?
- **Entrevista:** (1) ¿Cómo diseñas un sistema de puntos? (2) ¿Cómo evitas gastar puntos dos veces?

## Hito F2-C: Cotizaciones, apartados y crédito

### F2-07 · Cotizaciones
- **Objetivo:** una cotización vigente se convierte en venta.
- **Conceptos:** [Máquina de estados]
- **Claude / tú:** Claude da la plantilla imprimible. Tú escribes modelo y conversión.
- **Pruebas:** vigencia, precios congelados y conversión.
- **Criterios:** cumple RF-046.
- **Depende de:** E1-38 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Se congela el precio? (2) ¿Qué pasa si vence? (3) ¿Reserva inventario?
- **Entrevista:** (1) ¿Copiar o referenciar datos? (2) ¿Cómo modelas documentos con vigencia?

### F2-08 · Apartados
- **Objetivo:** un anticipo reserva mercancía y registra el saldo.
- **Conceptos:** [Transacciones en Spring]
- **Claude / tú:** Claude revisa. Tú escribes reserva, abonos y liberación.
- **Pruebas:** liquidar, cancelar y vencer.
- **Criterios:** cumple RF-047.
- **Depende de:** F2-07 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿La reserva es un movimiento? (2) ¿Qué pasa con el anticipo? (3) ¿Cómo afecta al corte?
- **Entrevista:** (1) ¿Cómo evitas sobrevender con reservas? (2) ¿Bloqueo optimista o pesimista?

### F2-09 · Crédito y límite
- **Objetivo:** se vende a crédito sin rebasar el límite.
- **Conceptos:** [Niveles de aislamiento]
- **Claude / tú:** Claude revisa concurrencia. Tú escribes la regla.
- **Pruebas:** dos ventas simultáneas y límite exacto.
- **Criterios:** cumple RF-048, sin crédito sin internet.
- **Depende de:** F2-04 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Por qué no se ofrece sin internet? (2) ¿Qué condición de carrera existe? (3) ¿Quién aprueba el límite?
- **Entrevista:** (1) ¿Qué nivel de aislamiento usarías? (2) ¿Qué es una lectura fantasma?

### F2-10 · Abonos y cuentas por cobrar
- **Objetivo:** se aplican abonos y se ve la antigüedad de saldos.
- **Conceptos:** [Agregaciones SQL]
- **Claude / tú:** Claude revisa. Tú escribes aplicación y reporte.
- **Pruebas:** abono parcial y excedente.
- **Criterios:** los saldos cuadran con el historial.
- **Depende de:** F2-09 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿A qué documento aplica un abono? (2) ¿Qué es antigüedad de saldos? (3) ¿Cómo corriges un error?
- **Entrevista:** (1) ¿Cómo modelas saldos sin inconsistencias? (2) ¿Doble entrada o saldo simple?

## Hito F2-D: Compras e inventario avanzado

### F2-11 · Proveedores
- **Objetivo:** se registran proveedores y sus costos.
- **Conceptos:** [Spring Data JPA]
- **Claude / tú:** Claude da el andamiaje. Tú escribes modelo y API.
- **Pruebas:** integración y aislamiento.
- **Criterios:** un producto puede tener varios proveedores.
- **Depende de:** E1-38 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Qué relación hay entre producto y proveedor? (2) ¿Dónde vive el último costo? (3) ¿Qué datos son sensibles?
- **Entrevista:** (1) ¿Cómo modelas muchos a muchos con atributos? (2) ¿Qué es la carga perezosa?

### F2-12 · Órdenes de compra sugeridas
- **Objetivo:** productos bajo el punto de reorden generan una sugerencia.
- **Conceptos:** [Spring Scheduling]
- **Claude / tú:** Claude revisa. Tú escribes el cálculo y la orden.
- **Pruebas:** mínimos, máximos y existencia negativa.
- **Criterios:** cumple RF-049.
- **Depende de:** F2-11, F2-16 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué es el punto de reorden? (2) ¿Qué pasa con negativos? (3) ¿Quién aprueba la orden?
- **Entrevista:** (1) ¿Cómo programas tareas en varios nodos? (2) ¿Cómo pruebas tareas programadas?

### F2-13 · Recepción de mercancía
- **Objetivo:** una recepción parcial crea movimientos y actualiza costo.
- **Conceptos:** [Transacciones en Spring]
- **Claude / tú:** Claude revisa. Tú escribes la recepción.
- **Pruebas:** parcial, excedente y costo.
- **Criterios:** cumple RF-050 en la parte de recepción.
- **Depende de:** F2-12, E1-28 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué pasa si llega de más? (2) ¿Cómo cambia el costo promedio? (3) ¿Quién recibe?
- **Entrevista:** (1) ¿Cómo manejas documentos parciales? (2) ¿Cómo garantizas atomicidad?

### F2-14 · Cuentas por pagar
- **Objetivo:** se registran saldos y pagos a proveedores.
- **Conceptos:** [Agregaciones SQL]
- **Claude / tú:** Claude revisa. Tú escribes saldos y pagos.
- **Pruebas:** pago parcial y vencimiento.
- **Criterios:** cumple RF-050 en la parte de saldos.
- **Depende de:** F2-13 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Cómo se relaciona con caja? (2) ¿Qué es un vencimiento? (3) ¿Quién autoriza?
- **Entrevista:** (1) ¿Cómo evitas pagos dobles? (2) ¿Cómo diseñas un flujo de aprobación?

### F2-15 · Comparativo de proveedores
- **Objetivo:** se compara el último costo por proveedor.
- **Conceptos:** [Window functions]
- **Claude / tú:** Claude revisa la consulta. Tú escribes reporte y pantalla.
- **Pruebas:** datos sintéticos con varios costos.
- **Criterios:** cumple RF-051.
- **Depende de:** F2-13 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Qué función da el último costo? (2) ¿Incluyes flete? (3) ¿Cómo manejas unidades distintas?
- **Entrevista:** (1) Explica `ROW_NUMBER`. (2) ¿Cómo optimizas reportes pesados?

### F2-16 · Conteos cíclicos y reorden
- **Objetivo:** un conteo crea ajustes, y se configuran mínimos y máximos.
- **Conceptos:** [Libro inmutable]
- **Claude / tú:** Claude revisa. Tú escribes conteo y diferencias.
- **Pruebas:** diferencia, ventas durante el conteo y permisos.
- **Criterios:** cumple RF-059.
- **Depende de:** E1-27 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué es un conteo cíclico? (2) ¿Qué pasa con ventas durante el conteo? (3) ¿Quién aprueba?
- **Entrevista:** (1) ¿Cómo tomas una foto consistente de datos? (2) ¿Cómo manejas conteos concurrentes?

## Hito F2-E: Taller

### F2-17 · Orden de reparación y folio
- **Objetivo:** un equipo recibido obtiene un folio.
- **Conceptos:** [Spring Data JPA]
- **Claude / tú:** Claude da el andamiaje. Tú escribes modelo y recepción.
- **Pruebas:** folio único y aislamiento.
- **Criterios:** cumple RF-052 sin fotos.
- **Depende de:** F2-04 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Cómo generas folios sin huecos? (2) ¿Qué datos del cliente pides? (3) ¿Qué es un agregado aquí?
- **Entrevista:** (1) ¿Secuencias con o sin huecos? (2) ¿Cómo evitas duplicados concurrentes?

### F2-18 · Fotos de recepción
- **Objetivo:** las fotos se guardan fuera de la base de datos y con acceso privado.
- **Conceptos:** [S3 API], [Subidas seguras]
- **Claude / tú:** Claude prepara el almacenamiento. Tú escribes subida y URLs firmadas.
- **Pruebas:** tipo inválido, tamaño y acceso cruzado.
- **Criterios:** ninguna foto es pública.
- **Depende de:** F2-17 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Por qué fuera de la base? (2) ¿Qué es una URL firmada? (3) ¿Cómo validas un archivo?
- **Entrevista:** (1) ¿Cómo manejas archivos grandes? (2) ¿Qué riesgos tiene una subida?

### F2-19 · Estados de reparación
- **Objetivo:** solo se permiten transiciones válidas.
- **Conceptos:** [Máquina de estados]
- **Claude / tú:** Claude revisa. Tú escribes los estados del diagrama 8.
- **Pruebas:** tabla de transiciones.
- **Criterios:** una transición inválida devuelve 409.
- **Depende de:** F2-17 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Qué estados son finales? (2) ¿Dónde vive la regla? (3) ¿Qué evento se publica?
- **Entrevista:** (1) ¿Enum o patrón State? (2) ¿Por qué 409?

### F2-20 · WhatsApp Cloud API
- **Objetivo:** el sistema envía avisos con plantillas aprobadas.
- **Conceptos:** [WhatsApp Cloud API]
- **Claude / tú:** Claude da la guía de cuenta. Tú creas la app y escribes el cliente.
- **Pruebas:** WireMock y un número de prueba.
- **Criterios:** avisos enviados fuera de la transacción.
- **Depende de:** F2-19 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Qué es una plantilla? (2) ¿Qué costo tiene un mensaje? (3) ¿Por qué fuera de la transacción?
- **Entrevista:** (1) ¿Cómo integras un canal de mensajería? (2) ¿Cómo evitas envíos duplicados?

### F2-21 · Aprobación por WhatsApp
- **Objetivo:** el cliente aprueba o rechaza su cotización de reparación.
- **Conceptos:** [Webhooks de WhatsApp]
- **Claude / tú:** Claude revisa seguridad. Tú escribes receptor y transición.
- **Pruebas:** firma, respuesta repetida y número incorrecto.
- **Criterios:** cumple RF-053.
- **Depende de:** F2-20 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Cómo sabes quién aprobó? (2) ¿Qué pasa con una respuesta tardía? (3) ¿Qué queda registrado?
- **Entrevista:** (1) ¿Cómo validas identidad en un canal externo? (2) ¿Cómo manejas respuestas fuera de orden?

### F2-22 · Refacciones
- **Objetivo:** las piezas usadas descuentan inventario.
- **Conceptos:** [Eventos en Modulith]
- **Claude / tú:** Claude revisa. Tú escribes uso y devolución de piezas.
- **Pruebas:** usar, devolver y sin existencia.
- **Criterios:** cumple RF-054.
- **Depende de:** F2-19, E1-25 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Cuándo se descuenta? (2) ¿Qué tipo de movimiento usa? (3) ¿Cómo afecta el costo?
- **Entrevista:** (1) ¿Evento o llamada directa entre módulos? (2) ¿Qué es la consistencia eventual?

### F2-23 · Entrega, cobro y garantía
- **Objetivo:** al entregar se cobra y se registra la garantía.
- **Conceptos:** [Transacciones en Spring]
- **Claude / tú:** Claude revisa. Tú escribes cobro, devolución de equipo y garantía.
- **Pruebas:** entrega, devolución con cargo de diagnóstico y garantía vigente.
- **Criterios:** cada entrega genera una venta o queda justificada.
- **Depende de:** F2-22, F2-21 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Cómo se cobra el diagnóstico? (2) ¿Qué cubre la garantía? (3) ¿Cómo se liga a una venta?
- **Entrevista:** (1) ¿Cómo integras dos contextos? (2) ¿Qué es un evento de dominio?

### F2-24 · Consulta pública del folio
- **Objetivo:** el cliente consulta el estado de su reparación.
- **Conceptos:** [Next.js]
- **Claude / tú:** Claude revisa seguridad. Tú escribes la página.
- **Pruebas:** folio inválido y datos mínimos.
- **Criterios:** no expone datos personales.
- **Depende de:** F2-19 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Qué datos muestras? (2) ¿Cómo evitas enumeración? (3) ¿Qué es un folio no adivinable?
- **Entrevista:** (1) ¿Qué es IDOR? (2) ¿Cómo limitas tasa en un endpoint público?

[Next.js]: https://nextjs.org/docs
[Facturas en Facturapi]: https://docs.facturapi.io/docs/guides/invoices/ingreso/
[Referencia de Facturapi]: https://docs.facturapi.io/api/
[Facturapi]: https://docs.facturapi.io/
[Datos personales]: https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf
[Spring Data JPA]: https://docs.spring.io/spring-data/jpa/reference/
[Índices]: https://www.postgresql.org/docs/16/indexes.html
[Libro inmutable]: https://martinfowler.com/eaaDev/AccountingEntry.html
[Máquina de estados]: https://refactoring.guru/design-patterns/state
[Transacciones en Spring]: https://docs.spring.io/spring-framework/reference/data-access/transaction.html
[Niveles de aislamiento]: https://www.postgresql.org/docs/16/transaction-iso.html
[Agregaciones SQL]: https://www.postgresql.org/docs/16/tutorial-agg.html
[Spring Scheduling]: https://docs.spring.io/spring-framework/reference/integration/scheduling.html
[Window functions]: https://www.postgresql.org/docs/16/tutorial-window.html
[S3 API]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html
[Subidas seguras]: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
[WhatsApp Cloud API]: https://developers.facebook.com/docs/whatsapp/cloud-api/
[Webhooks de WhatsApp]: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks/
[Eventos en Modulith]: https://docs.spring.io/spring-modulith/reference/events.html
