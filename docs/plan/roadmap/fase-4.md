# Fase 4: SaaS y heladería

Duración estimada: 110 horas, sin calendario todavía. Reparto: modo mentor; tú escribes la lógica y Claude prepara el andamiaje y revisa.

## Hito F4-A: Alta y planes

### F4-01 · Alta de negocio
- **Objetivo:** una persona crea su negocio en autoservicio.
- **Conceptos:** [Keycloak Admin], [Spring Modulith]
- **Claude / tú:** Claude da el andamiaje. Tú escribes alta, datos iniciales y usuario dueño.
- **Pruebas:** alta completa, repetida y aislamiento.
- **Criterios:** cumple RF-070 en la creación.
- **Depende de:** E2-09 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Qué se crea al inicio? (2) ¿Qué pasa si falla a la mitad? (3) ¿Cómo evitas abuso?
- **Entrevista:** (1) ¿Cómo aprovisionas un nuevo tenant? (2) ¿Cómo manejas fallas entre dos sistemas?

### F4-02 · Asistente por giro
- **Objetivo:** ferretería o heladería arrancan con su configuración.
- **Conceptos:** [React]
- **Claude / tú:** Claude da plantillas. Tú escribes asistente y aplicación.
- **Pruebas:** Playwright por giro.
- **Criterios:** un negocio queda listo en menos de 15 minutos.
- **Depende de:** F4-01 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué cambia por giro? (2) ¿Datos o código? (3) ¿Cómo agregas otro giro?
- **Entrevista:** (1) ¿Configuración o personalización? (2) ¿Cómo evitas ramas por cliente?

### F4-03 · Planes y límites
- **Objetivo:** cada plan habilita módulos y límites sin frenar ventas.
- **Conceptos:** [Feature flags]
- **Claude / tú:** Claude revisa. Tú escribes planes y comprobaciones.
- **Pruebas:** límite y plan vencido.
- **Criterios:** cumple RF-071.
- **Depende de:** F4-01 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Por qué nunca impedir vender? (2) ¿Dónde se valida? (3) ¿Cómo llega a la caja?
- **Entrevista:** (1) ¿Cómo implementas feature flags? (2) ¿Cómo manejas morosos?

### F4-04 · Cobro de suscripción
- **Objetivo:** cada negocio paga su plan mensual.
- **Conceptos:** [Suscripciones de Mercado Pago]
- **Claude / tú:** Claude prepara la sandbox. Tú escribes suscripción y webhooks.
- **Pruebas:** cobro, rechazo y cancelación.
- **Criterios:** no se guardan datos de tarjeta.
- **Depende de:** F4-03 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Qué pasa si falla un cobro? (2) ¿Qué es un periodo de gracia? (3) ¿Quién factura al negocio?
- **Entrevista:** (1) ¿Cómo modelas suscripciones? (2) ¿Qué es la conciliación de cobros?

## Hito F4-B: Operación multi-sucursal

### F4-05 · Sucursales y cajas
- **Objetivo:** un negocio administra varias sucursales y cajas.
- **Conceptos:** [Row-Level Security]
- **Claude / tú:** Claude revisa. Tú escribes alta y permisos.
- **Pruebas:** existencias y cortes por sucursal.
- **Criterios:** cumple RF-072 sin traspasos.
- **Depende de:** F4-01 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué ya existía desde F0? (2) ¿Qué datos se bajan a cada caja? (3) ¿Quién ve qué?
- **Entrevista:** (1) ¿Cómo limitas datos por sucursal? (2) ¿Qué ganas al modelar temprano?

### F4-06 · Traspasos
- **Objetivo:** un traspaso crea salida y entrada ligadas.
- **Conceptos:** [Transacciones en Spring]
- **Claude / tú:** Claude revisa. Tú escribes envío y recepción.
- **Pruebas:** en tránsito, parcial y cancelado.
- **Criterios:** la suma total no cambia.
- **Depende de:** F4-05 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Dónde está en tránsito? (2) ¿Qué pasa con diferencias? (3) ¿Cómo afecta el costo?
- **Entrevista:** (1) ¿Cómo modelas dos pasos? (2) ¿Qué invariante protege?

### F4-07 · Roles configurables
- **Objetivo:** el dueño crea roles con permisos.
- **Conceptos:** [Autorización en Spring]
- **Claude / tú:** Claude revisa. Tú escribes modelo y panel.
- **Pruebas:** matriz y sincronización a caja.
- **Criterios:** cumple RF-073.
- **Depende de:** F4-05 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Dónde vive el permiso? (2) ¿Cómo llega a la caja? (3) ¿Qué es el mínimo privilegio?
- **Entrevista:** (1) ¿Cómo diseñas un RBAC configurable? (2) ¿Cómo auditas cambios de permisos?

### F4-08 · Credenciales por negocio
- **Objetivo:** cada negocio conecta su Mercado Pago y su Facturapi.
- **Conceptos:** [OAuth de Mercado Pago], [Organizaciones de Facturapi]
- **Claude / tú:** Claude revisa seguridad. Tú escribes cifrado y conexión.
- **Pruebas:** cifrado, rotación y acceso cruzado.
- **Criterios:** cumple RF-080.
- **Depende de:** F4-01 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Dónde vive la llave maestra? (2) ¿Cómo rotas? (3) ¿Cómo enruta un webhook?
- **Entrevista:** (1) ¿Qué es cifrado de sobre? (2) ¿Cómo guardas secretos de clientes?

### F4-09 · Alertas de fraude
- **Objetivo:** patrones sospechosos avisan al dueño.
- **Conceptos:** [Agregaciones SQL]
- **Claude / tú:** Claude propone umbrales. Tú escribes reglas y alertas.
- **Pruebas:** datos sintéticos y falsos positivos.
- **Criterios:** cumple RF-074.
- **Depende de:** F4-07 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué patrones vigilas? (2) ¿Qué es un falso positivo? (3) ¿Quién ve la alerta?
- **Entrevista:** (1) ¿Reglas o aprendizaje automático? (2) ¿Cómo mides una alerta?

## Hito F4-C: Integraciones

### F4-10 · API pública
- **Objetivo:** un negocio consulta su API con una llave.
- **Conceptos:** [OpenAPI], [API Security]
- **Claude / tú:** Claude genera la documentación. Tú escribes llaves y límites.
- **Pruebas:** aislamiento, tasa y llave revocada.
- **Criterios:** cumple RF-075.
- **Depende de:** F4-03 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Cómo guardas la llave? (2) ¿Cómo se versiona? (3) ¿Qué limita la tasa?
- **Entrevista:** (1) ¿Cómo diseñas una API pública? (2) ¿Token bucket o ventana fija?

### F4-11 · Webhooks salientes
- **Objetivo:** un negocio recibe eventos firmados.
- **Conceptos:** [Patrón Retry]
- **Claude / tú:** Claude revisa. Tú escribes firma, reintentos y registro.
- **Pruebas:** receptor caído y firma.
- **Criterios:** entrega «al menos una vez» y bloqueo de SSRF.
- **Depende de:** F4-10 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Cómo firmas? (2) ¿Cuántos reintentos? (3) ¿Qué es SSRF?
- **Entrevista:** (1) ¿Cómo diseñas webhooks confiables? (2) ¿Cómo evitas SSRF?

### F4-12 · Importar Excel
- **Objetivo:** un negocio trae su catálogo desde Excel.
- **Conceptos:** [Apache POI]
- **Claude / tú:** Claude revisa. Tú reutilizas el importador con Excel.
- **Pruebas:** archivo inválido y filas con error.
- **Criterios:** cumple RF-076.
- **Depende de:** F4-02 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué reutilizas? (2) ¿Qué riesgo tiene Excel? (3) ¿Cómo limitas tamaño?
- **Entrevista:** (1) ¿Cómo procesas archivos grandes? (2) ¿Qué es un ataque de descompresión?

## Hito F4-D: Módulos por giro

### F4-13 · Recetas e ingredientes
- **Objetivo:** vender una crepa de fresa descuenta sus ingredientes.
- **Conceptos:** [Eventos en Modulith]
- **Claude / tú:** Claude revisa. Tú escribes recetas y movimientos en caja y servidor.
- **Pruebas:** receta, sin existencia y casos compartidos.
- **Criterios:** cumple RF-077 en ingredientes.
- **Depende de:** F4-02 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿La crepa tiene existencia? (2) ¿Qué costo tiene? (3) ¿Funciona sin internet?
- **Entrevista:** (1) ¿Cómo modelas una lista de materiales? (2) ¿Cómo extiendes sin tocar el núcleo?

### F4-14 · Modificadores
- **Objetivo:** waffles y dorilocos admiten toppings con precio.
- **Conceptos:** [React]
- **Claude / tú:** Claude revisa. Tú escribes modelo, pantalla y ticket.
- **Pruebas:** obligatorio, opcional e IVA.
- **Criterios:** cumple RF-077 en modificadores.
- **Depende de:** F4-13 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿El topping es producto? (2) ¿Cómo sale en el ticket? (3) ¿Cómo se factura?
- **Entrevista:** (1) ¿Cómo modelas variantes? (2) ¿Cómo evitas una explosión de productos?

### F4-15 · Piloto en la heladería
- **Objetivo:** la heladería opera con el SaaS.
- **Conceptos:** [Postmortem]
- **Claude / tú:** Claude prepara la lista. Tú acompañas una semana y registras fallos.
- **Pruebas:** cortes reales.
- **Criterios:** sin cambios al núcleo fuera de sus módulos.
- **Depende de:** F4-14, F4-08 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué funcionó sin cambios? (2) ¿Qué fue específico? (3) ¿Qué cambiarías?
- **Entrevista:** (1) ¿Cómo validas un producto multi-giro? (2) ¿Cómo priorizas retroalimentación?

### F4-16 · Lotes y caducidades
- **Objetivo:** abarrotes vende primero lo que caduca primero.
- **Conceptos:** [Libro inmutable]
- **Claude / tú:** Claude revisa. Tú escribes lotes y regla.
- **Pruebas:** primero en caducar y vencido.
- **Criterios:** cumple RF-078.
- **Depende de:** F4-02 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Cómo se liga un lote a un movimiento? (2) ¿Y sin internet? (3) ¿Qué pasa con un vencido?
- **Entrevista:** (1) ¿PEPS o FEFO? (2) ¿Cómo modelas trazabilidad?

### F4-17 · Números de serie
- **Objetivo:** un equipo se rastrea por serie.
- **Conceptos:** [UNIQUE en PostgreSQL]
- **Claude / tú:** Claude revisa. Tú escribes captura y garantía.
- **Pruebas:** serie duplicada y devolución.
- **Criterios:** una serie no se vende dos veces.
- **Depende de:** F4-16 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Cantidad o serie? (2) ¿Qué pasa con duplicados sin internet? (3) ¿Cómo se liga a la garantía?
- **Entrevista:** (1) ¿Cómo resuelves unicidad sin conexión? (2) ¿Cuándo aplica un índice parcial?

### F4-18 · Caja web
- **Objetivo:** un negocio sin hardware vende desde el navegador.
- **Conceptos:** [PWA], [OPFS]
- **Claude / tú:** Claude revisa. Tú implementas `LocalStore` y la versión web de hardware.
- **Pruebas:** Playwright sin red y mismos casos.
- **Criterios:** cumple RF-079 y actualiza el ADR 0002.
- **Depende de:** F4-05 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Qué interfaces cambian? (2) ¿Qué limita al navegador? (3) ¿Cómo imprime?
- **Entrevista:** (1) ¿Qué es un service worker? (2) ¿Qué ganaste separando el hardware?

### F4-19 · Mesas y comandas
- **Objetivo:** un restaurante abre mesas y envía comandas.
- **Conceptos:** [WebSocket]
- **Claude / tú:** Claude revisa. Tú escribes mesas y comandas.
- **Pruebas:** mesa abierta y división de cuenta.
- **Criterios:** solo se activa para ese giro.
- **Depende de:** F4-14 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Cuándo se vuelve venta? (2) ¿Y sin internet? (3) ¿Cómo divides la cuenta?
- **Entrevista:** (1) ¿Cómo sincronizas dispositivos en una red local? (2) ¿Cómo aíslas un módulo opcional?

### F4-20 · Restricción de edad
- **Objetivo:** ciertos productos piden confirmar la edad.
- **Conceptos:** [Patrón Strategy]
- **Claude / tú:** Claude revisa. Tú escribes bandera y confirmación.
- **Pruebas:** con y sin confirmación.
- **Criterios:** queda en la bitácora.
- **Depende de:** F4-02 · **Estimación:** 2 h
- **Autoevaluación:** (1) ¿Qué guardas? (2) ¿Quién confirma? (3) ¿Qué no guardas?
- **Entrevista:** (1) ¿Cómo agregas una regla sin ensuciar el flujo? (2) ¿Qué es privacidad por diseño?

### F4-21 · Farmacia y receta
- **Objetivo:** productos controlados registran su receta.
- **Conceptos:** [Datos personales]
- **Claude / tú:** Claude revisa. Tú validas requisitos con un experto y escribes el registro.
- **Pruebas:** bloqueo sin receta y lote.
- **Criterios:** solo se ofrece tras validar la norma.
- **Depende de:** F4-16 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué datos son sensibles? (2) ¿Qué norma aplica? (3) ¿Cuánto se conserva?
- **Entrevista:** (1) ¿Cómo manejas datos sensibles? (2) ¿Cómo abordas un dominio regulado?

## Hito F4-E: Plataforma

### F4-22 · Firma de código
- **Objetivo:** el instalador se ejecuta sin advertencias.
- **Conceptos:** [Firma en Electron]
- **Claude / tú:** Claude compara opciones. Tú eliges y configuras.
- **Pruebas:** instalación limpia en Windows.
- **Criterios:** costo documentado.
- **Depende de:** E1-36 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Qué demuestra una firma? (2) ¿Cuánto cuesta? (3) ¿Dónde vive el certificado?
- **Entrevista:** (1) ¿Cómo proteges una llave de firma? (2) ¿Qué es un ataque a la cadena de suministro?

### F4-23 · Escalar infraestructura
- **Objetivo:** existe un plan probado para pasar a AWS.
- **Conceptos:** [AWS Well-Architected], [Terraform]
- **Claude / tú:** Claude revisa. Tú escribes los módulos y migras staging.
- **Pruebas:** restauración y carga.
- **Criterios:** costo por negocio medido.
- **Depende de:** F4-15 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Cuándo vale la pena? (2) ¿Qué migras primero? (3) ¿Cuál es el costo por negocio?
- **Entrevista:** (1) ¿Cómo migras sin tiempo fuera? (2) ¿Vertical u horizontal?

[Keycloak Admin]: https://www.keycloak.org/docs-api/latest/rest-api/index.html
[Spring Modulith]: https://docs.spring.io/spring-modulith/reference/
[React]: https://react.dev/learn
[Feature flags]: https://martinfowler.com/articles/feature-toggles.html
[Suscripciones de Mercado Pago]: https://www.mercadopago.com.mx/developers/es/docs/subscriptions/overview
[Row-Level Security]: https://www.postgresql.org/docs/16/ddl-rowsecurity.html
[Transacciones en Spring]: https://docs.spring.io/spring-framework/reference/data-access/transaction.html
[Autorización en Spring]: https://docs.spring.io/spring-security/reference/servlet/authorization/index.html
[OAuth de Mercado Pago]: https://www.mercadopago.com.mx/developers/es/docs/security/oauth
[Organizaciones de Facturapi]: https://docs.facturapi.io/docs/guides/organizations/
[Agregaciones SQL]: https://www.postgresql.org/docs/16/tutorial-agg.html
[OpenAPI]: https://spec.openapis.org/oas/latest.html
[API Security]: https://owasp.org/API-Security/
[Patrón Retry]: https://learn.microsoft.com/en-us/azure/architecture/patterns/retry
[Apache POI]: https://poi.apache.org/
[Eventos en Modulith]: https://docs.spring.io/spring-modulith/reference/events.html
[Postmortem]: https://sre.google/sre-book/postmortem-culture/
[Libro inmutable]: https://martinfowler.com/eaaDev/AccountingEntry.html
[UNIQUE en PostgreSQL]: https://www.postgresql.org/docs/16/ddl-constraints.html
[PWA]: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps
[OPFS]: https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
[WebSocket]: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
[Patrón Strategy]: https://refactoring.guru/design-patterns/strategy
[Datos personales]: https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf
[Firma en Electron]: https://www.electronjs.org/docs/latest/tutorial/code-signing
[AWS Well-Architected]: https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html
[Terraform]: https://developer.hashicorp.com/terraform/docs
