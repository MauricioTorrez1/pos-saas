# Fase 3: Venta en línea y promociones

Duración estimada: 93 horas, sin calendario todavía. Reparto: modo mentor; tú escribes la lógica y Claude prepara el andamiaje y revisa.

## Hito F3-A: Tienda en línea

### F3-01 · Catálogo público
- **Objetivo:** los productos se ven en línea con SEO básico.
- **Conceptos:** [Next.js], [Caché en Next.js]
- **Claude / tú:** Claude crea el andamiaje. Tú escribes páginas y datos públicos.
- **Pruebas:** Playwright y que no se exponga el costo.
- **Criterios:** cada negocio muestra solo sus productos.
- **Depende de:** E1-38 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Qué datos son públicos? (2) ¿Qué revalidación usas? (3) ¿Cómo identificas al negocio?
- **Entrevista:** (1) ¿SSR, SSG o ISR? (2) ¿Cómo cacheas datos que cambian?

### F3-02 · Existencia web con margen
- **Objetivo:** la web no promete lo que quizá ya se vendió sin internet.
- **Conceptos:** [Consistencia eventual]
- **Claude / tú:** Claude revisa. Tú escribes el margen por producto.
- **Pruebas:** existencia baja y caja sin sincronizar.
- **Criterios:** cumple RF-060.
- **Depende de:** F3-01 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Por qué un margen? (2) ¿Qué pasa si la caja lleva días sin conexión? (3) ¿Cómo eliges el margen?
- **Entrevista:** (1) Explica el teorema CAP. (2) ¿Cómo comunicas datos aproximados?

### F3-03 · Carrito y pago
- **Objetivo:** el cliente arma un pedido y elige entrega.
- **Conceptos:** [React]
- **Claude / tú:** Claude da componentes base. Tú escribes carrito y validación del servidor.
- **Pruebas:** precio manipulado y Playwright.
- **Criterios:** el servidor recalcula siempre los precios.
- **Depende de:** F3-02 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Por qué no confiar en el cliente? (2) ¿Dónde vive el carrito? (3) ¿Qué pasa si cambió el precio?
- **Entrevista:** (1) ¿Cómo evitas manipular precios? (2) ¿Qué es CSRF?

### F3-04 · Reserva con expiración
- **Objetivo:** el inventario se reserva durante el pago y se libera al vencer.
- **Conceptos:** [SKIP LOCKED], [Redis]
- **Claude / tú:** Claude revisa concurrencia. Tú escribes reserva y liberación.
- **Pruebas:** último producto, concurrencia y vencimiento.
- **Criterios:** cumple RF-061.
- **Depende de:** F3-03 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿La reserva cambia la existencia? (2) ¿Quién libera? (3) ¿Qué pasa con un pago tardío?
- **Entrevista:** (1) ¿Cómo implementas una reserva con tiempo? (2) ¿Qué hace `SKIP LOCKED`?

### F3-05 · Link de pago
- **Objetivo:** un pedido se paga con un link y se confirma por webhook.
- **Conceptos:** [Checkout Pro]
- **Claude / tú:** Claude prepara la sandbox. Tú escribes creación y webhook.
- **Pruebas:** pago, rechazo, repetido y vencido.
- **Criterios:** cumple RF-062.
- **Depende de:** F3-04 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Qué confirma el pago? (2) ¿Qué pasa si paga tras vencer? (3) ¿Qué llave de idempotencia usas?
- **Entrevista:** (1) ¿Cómo manejas pagos asíncronos? (2) ¿Cómo reconcilias un pago tardío?

### F3-06 · Pedido a venta
- **Objetivo:** un pedido pagado se vuelve venta y descuenta inventario.
- **Conceptos:** [Eventos en Modulith]
- **Claude / tú:** Claude revisa. Tú escribes la conversión.
- **Pruebas:** idempotencia y movimientos.
- **Criterios:** existencia, reporte y factura ven la venta.
- **Depende de:** F3-05 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué evento dispara? (2) ¿Qué hace con la reserva? (3) ¿Cómo se factura?
- **Entrevista:** (1) ¿Qué es un saga? (2) ¿Orquestación o coreografía?

### F3-07 · Entrega y avisos
- **Objetivo:** el cliente recibe avisos de entrega o recolección.
- **Conceptos:** [WhatsApp Cloud API]
- **Claude / tú:** Claude revisa. Tú escribes estados y avisos.
- **Pruebas:** transiciones y aviso repetido.
- **Criterios:** cumple RF-064.
- **Depende de:** F3-06, F2-20 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué estados hay? (2) ¿Quién los cambia? (3) ¿Cómo evitas spam?
- **Entrevista:** (1) ¿Cómo diseñas notificaciones? (2) ¿Cómo manejas preferencias del usuario?

## Hito F3-B: Bot de WhatsApp

### F3-08 · Bot: consultas
- **Objetivo:** el bot del negocio responde precio y existencia.
- **Conceptos:** [n8n], [Políticas de WhatsApp]
- **Claude / tú:** Claude crea el flujo en n8n. Tú escribes la API que consulta.
- **Pruebas:** producto, sin existencia y mensaje ambiguo.
- **Criterios:** la lógica vive en el núcleo, no en n8n.
- **Depende de:** F2-20, F3-02 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Qué vive en n8n? (2) ¿Qué hace si no entiende? (3) ¿Cómo pasa a una persona?
- **Entrevista:** (1) ¿Cuándo usar una herramienta de automatización? (2) ¿Cómo manejas ambigüedad?

### F3-09 · Bot: pedidos
- **Objetivo:** el cliente arma un pedido y recibe link de pago por WhatsApp.
- **Conceptos:** [WhatsApp Cloud API]
- **Claude / tú:** Claude revisa. Tú escribes el estado de conversación y el pedido.
- **Pruebas:** pedido completo, abandono y repetición.
- **Criterios:** cumple RF-063.
- **Depende de:** F3-08, F3-05 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Dónde guardas la conversación? (2) ¿Qué pasa si abandona? (3) ¿Cómo confirmas el pedido?
- **Entrevista:** (1) ¿Cómo modelas conversaciones? (2) ¿Cómo usas Redis con expiración?

## Hito F3-C: Promociones

### F3-10 · Modelo de promociones
- **Objetivo:** las reglas se guardan con vigencia, prioridad y acción.
- **Conceptos:** [JSON Logic], [JSONB]
- **Claude / tú:** Claude revisa el esquema. Tú escribes modelo y validación.
- **Pruebas:** regla inválida y vigencia.
- **Criterios:** cumple ADR 0007.
- **Depende de:** E1-38 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué es condición y qué acción? (2) ¿Por qué validar el JSON? (3) ¿Cómo se versiona?
- **Entrevista:** (1) ¿JSONB o columnas? (2) ¿Cómo diseñas un motor de reglas?

### F3-11 · Evaluador en TypeScript
- **Objetivo:** la caja evalúa reglas sin internet.
- **Conceptos:** [JSON Logic]
- **Claude / tú:** Claude da casos iniciales. Tú escribes el evaluador.
- **Pruebas:** casos compartidos.
- **Criterios:** evalúa 100 reglas en menos de 50 ms.
- **Depende de:** F3-10 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Por qué solo enteros? (2) ¿Qué datos ve la regla? (3) ¿Qué pasa con una regla inválida?
- **Entrevista:** (1) ¿Cómo evitas ejecutar código arbitrario? (2) ¿Cómo mides rendimiento?

### F3-12 · Evaluador en Java
- **Objetivo:** el servidor evalúa igual que la caja.
- **Conceptos:** [JSON Logic]
- **Claude / tú:** Claude revisa. Tú escribes el evaluador o adaptas una librería.
- **Pruebas:** mismos casos compartidos.
- **Criterios:** cero diferencias con TypeScript.
- **Depende de:** F3-10 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué diferencia numérica puede haber? (2) ¿Librería o propio? (3) ¿Cómo detectas diferencias?
- **Entrevista:** (1) ¿Cómo mantienes dos implementaciones iguales? (2) ¿Qué son las pruebas basadas en propiedades?

### F3-13 · Repartidor de descuentos
- **Objetivo:** 3x2, combos, volumen y acumulación se reparten igual en ambos.
- **Conceptos:** [jqwik]
- **Claude / tú:** Claude propone casos difíciles. Tú escribes el algoritmo en ambos lenguajes.
- **Pruebas:** casos compartidos y propiedades.
- **Criterios:** cumple RF-065 y RF-066.
- **Depende de:** F3-11, F3-12 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿A qué línea va el descuento? (2) ¿Cómo aplican las prioridades? (3) ¿Cómo afecta al IVA?
- **Entrevista:** (1) ¿Cómo resuelves reglas en conflicto? (2) ¿Qué propiedad probarías?

### F3-14 · Promociones en caja
- **Objetivo:** las promociones se aplican al cobrar y el servidor las revalida.
- **Conceptos:** [Patrón Strategy]
- **Claude / tú:** Claude revisa. Tú reemplazas la implementación vacía.
- **Pruebas:** regla vencida y discrepancia.
- **Criterios:** una diferencia crea una discrepancia.
- **Depende de:** F3-13, E1-19 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué pasa con un carrito ya armado? (2) ¿Qué ve el cliente en el ticket? (3) ¿Y si la regla venció sin internet?
- **Entrevista:** (1) ¿Cómo agregas un comportamiento sin romper lo existente? (2) ¿Qué es un feature flag?

### F3-15 · Cupones
- **Objetivo:** un cupón se valida en línea y se rechaza sin internet si es de un solo uso.
- **Conceptos:** [Redis]
- **Claude / tú:** Claude revisa. Tú escribes generación y canje.
- **Pruebas:** doble canje concurrente y sin red.
- **Criterios:** cumple RF-067.
- **Depende de:** F3-14 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Por qué se rechaza sin internet? (2) ¿Cómo evitas doble uso? (3) ¿Cómo generas códigos?
- **Entrevista:** (1) ¿Cómo garantizas un solo uso? (2) ¿Cómo evitas fraude con cupones?

### F3-16 · Panel de promociones
- **Objetivo:** el dueño crea promociones sin ver JSON.
- **Conceptos:** [React]
- **Claude / tú:** Claude da componentes. Tú escribes formularios y vista previa.
- **Pruebas:** Playwright con un 3x2.
- **Criterios:** muestra el efecto antes de activar.
- **Depende de:** F3-13 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Cómo traduces el formulario a la regla? (2) ¿Qué validas? (3) ¿Cómo la desactivas?
- **Entrevista:** (1) ¿Cómo diseñas formularios complejos? (2) ¿Cómo pruebas una UI con muchos estados?

## Hito F3-D: Redes y canales

### F3-17 · Publicación en redes
- **Objetivo:** una promoción aprobada se publica en Facebook e Instagram.
- **Conceptos:** [Graph API], [n8n]
- **Claude / tú:** Claude da el flujo. Tú escribes el evento y la revisión de la cuenta.
- **Pruebas:** evento consumido una vez y simulador.
- **Criterios:** cumple RF-068.
- **Depende de:** F3-16 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué permisos pide Meta? (2) ¿Qué pasa si falla? (3) ¿Quién aprueba?
- **Entrevista:** (1) ¿Cómo manejas tokens que expiran? (2) ¿Cómo integras con límites de tasa?

### F3-18 · Catálogo en Meta
- **Objetivo:** el catálogo de WhatsApp e Instagram se sincroniza.
- **Conceptos:** [Catálogos de Meta]
- **Claude / tú:** Claude revisa. Tú escribes el envío por lotes.
- **Pruebas:** alta, cambio y baja.
- **Criterios:** cumple RF-069.
- **Depende de:** F3-17 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué dispara la sincronización? (2) ¿Lote o evento? (3) ¿Cómo manejas errores?
- **Entrevista:** (1) ¿Cómo sincronizas con un sistema externo? (2) ¿Qué es la reconciliación periódica?

### F3-19 · Reseñas
- **Objetivo:** tras la entrega se solicita una reseña.
- **Conceptos:** [Spring Scheduling]
- **Claude / tú:** Claude revisa. Tú escribes solicitud y registro.
- **Pruebas:** una sola solicitud por pedido.
- **Criterios:** respeta la preferencia del cliente.
- **Depende de:** F3-07 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Cuándo se envía? (2) ¿Cómo evitas molestar? (3) ¿Qué datos guardas?
- **Entrevista:** (1) ¿Cómo programas tareas diferidas? (2) ¿Qué es una cola de retraso?

[Next.js]: https://nextjs.org/docs
[Caché en Next.js]: https://nextjs.org/docs/app/guides/caching
[Consistencia eventual]: https://www.allthingsdistributed.com/2008/12/eventually_consistent.html
[React]: https://react.dev/learn
[SKIP LOCKED]: https://www.postgresql.org/docs/16/sql-select.html
[Redis]: https://redis.io/docs/latest/
[Checkout Pro]: https://www.mercadopago.com.mx/developers/es/docs/checkout-pro/overview
[Eventos en Modulith]: https://docs.spring.io/spring-modulith/reference/events.html
[WhatsApp Cloud API]: https://developers.facebook.com/docs/whatsapp/cloud-api/
[n8n]: https://docs.n8n.io/
[Políticas de WhatsApp]: https://business.whatsapp.com/policy
[JSON Logic]: https://jsonlogic.com/
[JSONB]: https://www.postgresql.org/docs/16/datatype-json.html
[jqwik]: https://jqwik.net/docs/current/user-guide.html
[Patrón Strategy]: https://refactoring.guru/design-patterns/strategy
[Graph API]: https://developers.facebook.com/docs/graph-api/
[Catálogos de Meta]: https://developers.facebook.com/docs/marketing-api/catalog/
[Spring Scheduling]: https://docs.spring.io/spring-framework/reference/integration/scheduling.html
