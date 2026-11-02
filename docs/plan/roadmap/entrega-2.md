# Entrega 2: Terminal integrada

Duración estimada: 34 horas. Empieza después de salir de Eleventa, así que vuelve el modo mentor: tú escribes la lógica y Claude prepara el andamiaje y revisa. La tienda sigue vendiendo con la terminal en modo normal durante esta entrega.

### E2-01 · Spike de la terminal real
- **Objetivo:** saber si en modo PDV se puede teclear un cobro y cómo volver a `STANDALONE`.
- **Conceptos:** [Configurar terminal]
- **Claude / tú:** Claude prepara el guion y las llamadas. Tú ejecutas en la terminal fuera de horario y anotas el resultado.
- **Pruebas:** prueba manual documentada en el ADR 0012.
- **Criterios:** decisión escrita: respaldo tecleado, segunda terminal o solo efectivo sin internet.
- **Depende de:** E1-38 · **Estimación:** 2 h
- **Autoevaluación:** (1) ¿Qué es el modo PDV? (2) ¿Qué harías si no permite teclear? (3) ¿Por qué probar antes de diseñar?
- **Entrevista:** (1) ¿Qué es un spike? (2) ¿Cómo reduces riesgo con un proveedor externo?

### E2-02 · Aplicación y cliente de Mercado Pago
- **Objetivo:** el núcleo se autentica y lista la terminal.
- **Conceptos:** [Mercado Pago Point], [RestClient]
- **Claude / tú:** Claude prepara la configuración. Tú creas la aplicación y escribes el cliente.
- **Pruebas:** WireMock y una llamada con credenciales de prueba.
- **Criterios:** credenciales solo en variables de entorno.
- **Depende de:** E2-01 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué credencial usa cada entorno? (2) ¿Qué datos nunca se registran? (3) ¿Cómo manejas un error 429?
- **Entrevista:** (1) ¿Cómo diseñas un cliente HTTP robusto? (2) ¿Qué son timeouts y reintentos seguros?

### E2-03 · Crear orden en la terminal
- **Objetivo:** el total de la venta aparece en la terminal.
- **Conceptos:** [Procesar pagos]
- **Claude / tú:** Claude da el ejemplo mínimo. Tú escribes `POST /card-orders` con su idempotencia.
- **Pruebas:** simulador con dispositivo virtual y WireMock.
- **Criterios:** cumple RF-041, y repetir no crea otra orden.
- **Depende de:** E2-02 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué llave de idempotencia usas? (2) ¿Qué expiración eliges y por qué? (3) ¿Qué pasa si no hay respuesta?
- **Entrevista:** (1) ¿Qué haces ante un timeout en un cobro? (2) ¿Cómo evitas cobros dobles?

### E2-04 · Webhook con firma
- **Objetivo:** el núcleo recibe resultados verificados y responde rápido.
- **Conceptos:** [Notificaciones]
- **Claude / tú:** Claude prepara el túnel de desarrollo. Tú escribes la validación y el procesamiento.
- **Pruebas:** firma inválida, evento repetido y desordenado.
- **Criterios:** responde en menos de 22 segundos y cada evento se procesa una vez.
- **Depende de:** E2-03 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué valida `x-signature`? (2) ¿Por qué responder antes de procesar? (3) ¿Qué pasa con eventos desordenados?
- **Entrevista:** (1) ¿Cómo diseñas un receptor de webhooks? (2) ¿Cómo evitas ataques de repetición?

### E2-05 · Avisos a la caja y consulta puntual
- **Objetivo:** la caja conoce el resultado en tiempo real o con una consulta puntual.
- **Conceptos:** [Server-Sent Events]
- **Claude / tú:** Claude da el andamiaje de SSE. Tú escribes la reconexión y la consulta a los 30 segundos.
- **Pruebas:** SSE caído y webhook perdido.
- **Criterios:** la caja llega al estado final sin sondeo continuo.
- **Depende de:** E2-04 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿SSE o WebSocket? (2) ¿Por qué no sondear siempre? (3) ¿Qué pasa si se reinicia la caja?
- **Entrevista:** (1) ¿Cómo entregas eventos en tiempo real? (2) ¿Cómo manejas reconexiones?

### E2-06 · Espera, cancelación y sin cobro doble
- **Objetivo:** ninguna venta admite otra forma de pago sin un estado final.
- **Conceptos:** [Estados de la orden]
- **Claude / tú:** Claude revisa todos los caminos. Tú escribes los estados `card_pending` y la cancelación asíncrona.
- **Pruebas:** tabla completa de estados, cancelación con pago en curso y expiración.
- **Criterios:** cumple RF-042 y RF-043.
- **Depende de:** E2-05 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Por qué un 202 no es definitivo? (2) ¿Qué ve el cajero mientras espera? (3) ¿Qué pasa si se va la luz?
- **Entrevista:** (1) ¿Cómo modelas un proceso asíncrono externo? (2) ¿Qué es una condición de carrera?

### E2-07 · Reembolsos
- **Objetivo:** las devoluciones con tarjeta se reembolsan por API.
- **Conceptos:** [Procesar pagos]
- **Claude / tú:** Claude revisa. Tú escribes reembolso total, parcial y el caso de más de 90 días.
- **Pruebas:** simulador y límite de 90 días.
- **Criterios:** cumple RF-044.
- **Depende de:** E2-06, E1-15 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Qué pasa después de 90 días? (2) ¿Cómo afecta al corte? (3) ¿Quién autoriza?
- **Entrevista:** (1) ¿Cómo manejas reembolsos parciales? (2) ¿Cómo garantizas no reembolsar de más?

### E2-08 · Conciliación
- **Objetivo:** el dueño ve diferencias entre ventas y pagos.
- **Conceptos:** [Reportes de Mercado Pago]
- **Claude / tú:** Claude da un archivo sintético. Tú escribes el cruce.
- **Pruebas:** pago sin venta, venta sin pago y montos distintos.
- **Criterios:** cumple RF-045.
- **Depende de:** E2-06 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué llave cruza los datos? (2) ¿Qué es una comisión? (3) ¿Qué haces con una diferencia?
- **Entrevista:** (1) ¿Cómo diseñas una conciliación? (2) ¿Cómo manejas datos que llegan tarde?

### E2-09 · Cobro real y piloto
- **Objetivo:** la terminal integrada opera en la tienda con riesgo bajo.
- **Conceptos:** [Salir a producción]
- **Claude / tú:** Claude prepara la lista. Tú haces un cobro real pequeño con reembolso y supervisas una semana.
- **Pruebas:** cobro, reembolso y corte reales.
- **Criterios:** una semana sin cobros dobles.
- **Depende de:** E2-07, E2-08 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Por qué un cobro real? (2) ¿Cómo vuelves al modo normal? (3) ¿Qué vigilas en Grafana?
- **Entrevista:** (1) ¿Qué es un lanzamiento gradual? (2) ¿Cómo monitoreas pagos?

[Configurar terminal]: https://www.mercadopago.com.mx/developers/en/docs/mp-point/configure-terminal.md
[Mercado Pago Point]: https://www.mercadopago.com.mx/developers/es/docs/mp-point/overview.md
[RestClient]: https://docs.spring.io/spring-framework/reference/integration/rest-clients.html
[Procesar pagos]: https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing.md
[Notificaciones]: https://www.mercadopago.com.mx/developers/en/docs/mp-point/notifications.md
[Server-Sent Events]: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
[Estados de la orden]: https://www.mercadopago.com.mx/developers/en/docs/mp-point/resources/status-order-transaction.md
[Reportes de Mercado Pago]: https://www.mercadopago.com.mx/developers/es/docs
[Salir a producción]: https://www.mercadopago.com.mx/developers/en/docs/mp-point/integration-test.md
