# Entrega 1: Reemplazar a Eleventa

Duración estimada: 170 horas. Reparto: Claude escribe y explica; tú revisas, pruebas y apruebas.

## Hito E1-A: Caja base

### E1-01 · Esqueleto de la caja en Electron
- **Objetivo:** la caja abre con React y TypeScript, con la pantalla separada del proceso principal.
- **Conceptos:** [Electron], [Seguridad en Electron], [Vite]
- **Claude / tú:** Claude crea el proyecto con `contextIsolation`. Tú lo ejecutas en esta PC y en Windows 10.
- **Pruebas:** Vitest y una prueba de arranque con Playwright.
- **Criterios:** la pantalla no accede a Node de forma directa.
- **Depende de:** F0-02 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué hace el proceso principal? (2) ¿Para qué sirve `preload`? (3) ¿Qué riesgo evita `contextIsolation`?
- **Entrevista:** (1) ¿Electron o PWA para un POS? (2) ¿Cómo se comunican procesos en Electron?

### E1-02 · SQLite local y migraciones
- **Objetivo:** la caja crea y actualiza su base local al arrancar.
- **Conceptos:** [SQLite], [WAL]
- **Claude / tú:** Claude escribe `LocalStore` y sus migraciones. Tú apagas la app durante una escritura.
- **Pruebas:** migración de una base vieja y recuperación tras cierre abrupto.
- **Criterios:** modo WAL activo y sin pérdida tras un cierre forzado.
- **Depende de:** E1-01 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué aporta WAL? (2) ¿Qué pasa si falla una migración? (3) ¿Por qué SQLite y no un JSON?
- **Entrevista:** (1) ¿Qué significa ACID? (2) ¿Cómo actualizas el esquema en clientes sin conexión?

### E1-03 · Interfaces de hardware y falsos
- **Objetivo:** la caja funciona sin hardware usando implementaciones falsas.
- **Conceptos:** [Interfaces en TypeScript]
- **Claude / tú:** Claude define `PrinterProvider`, `CashDrawer`, `ScaleProvider` y `CardTerminal`. Tú revisas que la pantalla no dependa del hardware.
- **Pruebas:** unitarias con falsos que registran bytes.
- **Criterios:** la venta completa corre con falsos.
- **Depende de:** E1-01 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Qué ganas con una interfaz? (2) ¿Falso o mock? (3) ¿Cómo agregarías una báscula USB?
- **Entrevista:** (1) Explica la inversión de dependencias. (2) ¿Cómo pruebas código que usa hardware?

### E1-04 · Login con PIN en la caja
- **Objetivo:** cada persona entra con su PIN, con o sin internet.
- **Conceptos:** [Argon2], [Almacenamiento seguro]
- **Claude / tú:** Claude escribe registro y verificación. Tú pruebas con la red apagada.
- **Pruebas:** bloqueo tras 5 errores y entrada sin red.
- **Criterios:** cumple RF-009 y la llave del dispositivo queda protegida.
- **Depende de:** E1-02, F0-15 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Dónde se guarda la credencial del dispositivo? (2) ¿Cuándo aplica una baja? (3) ¿Por qué bloquear intentos?
- **Entrevista:** (1) ¿Cómo autenticas sin servidor disponible? (2) ¿Cómo limitas ataques de fuerza bruta?

## Hito E1-B: Venta

### E1-05 · Dinero y cantidades
- **Objetivo:** TypeScript y Java calculan igual importes por línea.
- **Conceptos:** [BigInt], [multiplyExact]
- **Claude / tú:** Claude escribe ambas librerías. Tú agregas casos de cable y tornillo.
- **Pruebas:** casos compartidos en JUnit y Vitest, incluido $40.94.
- **Criterios:** cumple ADR 0011 y RNF-10.
- **Depende de:** F0-23 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Por qué 3.275 m × $12.50 da 4094 centavos? (2) ¿Qué es redondeo half up? (3) ¿Por qué `BigInt` en la multiplicación?
- **Entrevista:** (1) ¿Cómo representas dinero? (2) ¿Dónde redondeas: por línea o en el total?

### E1-06 · IVA incluido y totales
- **Objetivo:** cada línea guarda subtotal, IVA y total, listos para facturar.
- **Conceptos:** [CFDI 4.0], [Facturapi]
- **Claude / tú:** Claude escribe el cálculo. Tú comparas 10 casos con el contador o con Facturapi en modo de prueba.
- **Pruebas:** casos compartidos con 16%, 0% y exento.
- **Criterios:** el desglose coincide con lo que acepta Facturapi.
- **Depende de:** E1-05 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Cómo extraes el IVA de un precio incluido? (2) ¿Exento o tasa 0%? (3) ¿Por qué guardar el IVA por línea?
- **Entrevista:** (1) ¿Cómo validas cálculos contra un sistema externo? (2) ¿Cómo manejas cambios de tasa en el tiempo?

### E1-07 · Pantalla de venta
- **Objetivo:** escanear o buscar agrega un producto en menos de 100 ms.
- **Conceptos:** [React], [FTS5]
- **Claude / tú:** Claude escribe la pantalla y la búsqueda local. Tú pruebas con tu lector.
- **Pruebas:** Playwright y medición con 5,000 productos.
- **Criterios:** cumple RF-011, RNF-02 y RNF-13, y se opera con teclado.
- **Depende de:** E1-02, E1-05 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Cómo distingues escaneo de tecleo? (2) ¿Qué es un índice FTS? (3) ¿Por qué medir en la PC de la tienda?
- **Entrevista:** (1) ¿Cómo mides rendimiento en un cliente? (2) ¿Qué causa renders innecesarios en React?

### E1-08 · Venta por peso y por metro
- **Objetivo:** el cajero captura kilos o metros y ve el importe antes de agregar.
- **Conceptos:** [Patrón Strategy]
- **Claude / tú:** Claude escribe `ManualScaleProvider` y la confirmación. Tú pruebas teclear 125 en lugar de 1.25.
- **Pruebas:** unitarias con límites e integración de la línea.
- **Criterios:** cumple RF-012 y pide confirmar cantidades fuera del límite.
- **Depende de:** E1-07, E1-03 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué pasa si se teclea 125 kg? (2) ¿Por qué mostrar el importe? (3) ¿Qué cambia con una báscula USB?
- **Entrevista:** (1) ¿Cómo aplicarías Strategy aquí? (2) ¿Cómo diseñas una interfaz a prueba de errores?

### E1-09 · Artículo varios y listas de precio
- **Objetivo:** se vende algo sin alta y se aplica precio de mayoreo con permiso.
- **Conceptos:** [Autorización en la caja]
- **Claude / tú:** Claude escribe la opción y la bitácora. Tú decides quién tiene permiso.
- **Pruebas:** unitarias de permisos y registro.
- **Criterios:** cumple RF-003 y RF-013.
- **Depende de:** E1-07, E1-04 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Qué riesgo tiene el precio libre? (2) ¿Cómo se revisa después? (3) ¿Qué pasa con su clave SAT al facturar?
- **Entrevista:** (1) ¿Cómo equilibras flexibilidad y control? (2) ¿Cómo detectas abuso de permisos?

### E1-10 · Máquina de estados de la venta
- **Objetivo:** ninguna venta se pierde si la PC se apaga.
- **Conceptos:** [Máquina de estados], [Transacciones en SQLite]
- **Claude / tú:** Claude escribe los estados y la recuperación. Tú apagas la PC en mitad de un cobro.
- **Pruebas:** transiciones válidas e inválidas, y recuperación al arrancar.
- **Criterios:** cumple RF-017 y ADR 0010.
- **Depende de:** E1-06 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Por qué guardar antes de cobrar? (2) ¿Una venta pendiente cuenta en el corte? (3) ¿Qué ve el cajero al reiniciar?
- **Entrevista:** (1) ¿Cuándo usas una máquina de estados? (2) ¿Cómo garantizas consistencia ante fallas?

### E1-11 · Efectivo, transferencia y pago mixto
- **Objetivo:** se cobra con una o varias formas de pago y se calcula el cambio.
- **Conceptos:** [Teclado en React]
- **Claude / tú:** Claude escribe la pantalla de cobro. Tú simulas compras reales.
- **Pruebas:** suma de pagos igual al total y Playwright.
- **Criterios:** cumple RF-014 y RF-015.
- **Depende de:** E1-10 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Cómo se valida la suma? (2) ¿Quién recibe el cambio en un pago mixto? (3) ¿Qué se guarda de una transferencia?
- **Entrevista:** (1) ¿Cómo modelas pagos múltiples? (2) ¿Qué invariante protege un agregado de venta?

### E1-12 · Tarjeta tecleada con folio
- **Objetivo:** el cajero cobra en la terminal normal y captura el folio.
- **Conceptos:** [PCI DSS]
- **Claude / tú:** Claude escribe `ManualTerminal`. Tú haces un cobro real pequeño cuando tengas la terminal.
- **Pruebas:** folio obligatorio y separación en el corte.
- **Criterios:** cumple RF-016 y no se captura ningún dato de tarjeta.
- **Depende de:** E1-11, E1-03 · **Estimación:** 2 h
- **Autoevaluación:** (1) ¿Qué datos no se guardan nunca? (2) ¿Qué pasa si el folio está mal? (3) ¿Cómo se concilia después?
- **Entrevista:** (1) ¿Qué es el alcance PCI? (2) ¿Cómo lo reduces?

### E1-13 · Ticket ESC/POS
- **Objetivo:** se imprime un ticket con folio, IVA y datos del negocio.
- **Conceptos:** [ESC/POS]
- **Claude / tú:** Claude escribe el generador de bytes y la salida hacia Windows. Tú pruebas con la TM-T20.
- **Pruebas:** bytes esperados con el falso y prueba manual en hardware.
- **Criterios:** cumple RF-018 y permite reimprimir.
- **Depende de:** E1-10 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué es un comando ESC/POS? (2) ¿Qué pasa si falta papel? (3) ¿Por qué un folio corto?
- **Entrevista:** (1) ¿Cómo pruebas una salida binaria? (2) ¿Cómo manejas fallas de un periférico?

### E1-14 · Cajón y prueba de hardware
- **Objetivo:** el cajón abre solo después de guardar una venta en efectivo.
- **Conceptos:** [Comando de cajón]
- **Claude / tú:** Claude escribe el comando. Tú pruebas caja, impresora, cajón y lector juntos.
- **Pruebas:** orden de llamadas con falsos y lista de comprobación física.
- **Criterios:** el cajón no abre si la venta no se guardó.
- **Depende de:** E1-13, E1-11 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Por qué el cajón pasa por la impresora? (2) ¿Quién puede abrirlo sin venta? (3) ¿Cómo se audita esa apertura?
- **Entrevista:** (1) ¿Cómo pruebas integración con hardware? (2) ¿Qué harías si falla solo en la tienda?

### E1-15 · Devoluciones
- **Objetivo:** una devolución con ticket se autoriza y regresa por el mismo medio.
- **Conceptos:** [Transacción compensatoria]
- **Claude / tú:** Claude escribe el flujo con la regla estándar. Tú revisas los casos con tu familia.
- **Pruebas:** parcial, mixta, más de 30 días y granel cortado.
- **Criterios:** cumple RF-019 y nunca devuelve más de lo vendido.
- **Depende de:** E1-11 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Por qué no se edita la venta? (2) ¿Cómo se reparte un pago mixto? (3) ¿Qué pasa con el inventario?
- **Entrevista:** (1) ¿Qué es una transacción compensatoria? (2) ¿Cómo modelas una devolución parcial?

### E1-39 · Editar precio de un producto en la caja
- **Objetivo:** el dueño cambia el precio de un producto ya dado de alta, sin tocar las ventas hechas ni la que está en curso.
- **Conceptos:** [Autorización en la caja], [Transacciones en SQLite]
- **Claude / tú:** Claude escribe el diálogo (F7, y F8 desde el inventario), la regla de permisos y el contrato `product.price_changed`. Tú pruebas con productos reales y decides si el cajero puede pedirlo con el PIN del dueño.
- **Pruebas:** permisos por rol, precios inválidos (cero, negativo, demasiados decimales), bitácora con intentos negados, outbox en la misma transacción, ventas cerradas intactas y total de una venta nueva con el precio nuevo.
- **Criterios:** cumple RF-040 y ADR 0047; escalas del ADR 0011; el servidor lo procesa en E1-17.
- **Depende de:** E1-07, E1-04, E1-16 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Por qué la venta en curso conserva el precio de sus líneas? (2) ¿Qué se anota cuando un cajero se equivoca de PIN? (3) ¿Por qué el precio anterior viaja en la operación?
- **Entrevista:** (1) ¿Cómo cambias un precio sin reescribir la historia? (2) ¿Cómo evitas que dos cambios se pisen?

### E1-40 · Recepción de cambios de precio en el núcleo
- **Objetivo:** el núcleo guarda, audita y anuncia los cambios de precio que hace la caja, aunque todavía no conozca el producto.
- **Conceptos:** [Idempotencia], [Outbox transaccional]
- **Claude / tú:** Claude escribe la tabla, el recorder y las pruebas. Tú decides qué ves en la revisión de discrepancias (E1-19).
- **Pruebas:** Testcontainers: aceptado, duplicado por `op_id` y por `changeId`, concurrencia, producto desconocido, discrepancia, aislamiento entre negocios, auditoría atómica y los casos de `packages/contracts`.
- **Criterios:** cumple RF-022 y RF-040; ADR 0053.
- **Depende de:** E1-17, E1-39 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Por qué no se rechaza un cambio de un producto desconocido? (2) ¿Qué marca una discrepancia? (3) ¿Por qué el registro no se actualiza?
- **Entrevista:** (1) ¿Cómo garantizas idempotencia con dos llaves? (2) ¿Cómo evitas que dos escritores concurrentes se pisen?

### E1-41 · Credencial de dispositivo en `/sync/push`
- **Objetivo:** solo una caja enrolada puede enviar, y solo sus propios lotes; una caja perdida se da de baja y deja de enviar.
- **Conceptos:** [Autenticación de dispositivos], [Revocación de credenciales]
- **Claude / tú:** Claude escribe el filtro, la revocación y las pruebas, y el cambio mínimo de la caja para guardar y enviar la credencial. Tú das de baja una caja de prueba y compruebas que deja de enviar.
- **Pruebas:** Testcontainers con las pruebas de E1-17 reescritas con la credencial real, y casos de credencial válida, inválida, revocada, de otro negocio, `registerId` que no coincide y aislamiento entre negocios; Vitest del transporte de la caja.
- **Criterios:** cumple RF-021; ADR 0054. Retira el permiso temporal `sync.push` por rol.
- **Depende de:** E1-17, F0-15 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Por qué el negocio viaja dentro de la credencial? (2) ¿Por qué un 403 y no un 401 cuando el lote nombra otra caja? (3) ¿Qué pasa con las ventas de una caja dada de baja?
- **Entrevista:** (1) ¿Cómo autenticas un dispositivo sin usuario? (2) ¿Cómo revocas una credencial sin esperar a que caduque?

### E1-42 · Alta de nuevos productos en la caja
- **Objetivo:** el dueño da de alta, desde la venta y sin internet, un producto que no está en el catálogo, con su unidad, precio, impuesto, costo, códigos de barras y existencia inicial.
- **Conceptos:** [Libro de movimientos], [Autorización en la caja], [Transacciones en SQLite]
- **Claude / tú:** Claude escribe el formulario (F5, y «Dar de alta» cuando la búsqueda no encuentra nada), la regla de permisos, el movimiento de saldo inicial y el contrato `product.created`. Tú pruebas con productos reales y con el lector de códigos.
- **Pruebas:** validaciones, permisos por rol y PIN, código repetido (también de un producto dado de baja), existencia inicial como movimiento del libro, bitácora, outbox en la misma transacción con reversa, ventas cerradas intactas, venta nueva con el producto recién creado, y un flujo de pantalla de punta a punta.
- **Criterios:** cumple RF-040 y ADR 0057; escalas del ADR 0011; unidad explícita; el servidor lo recibe en una tarea posterior.
- **Depende de:** E1-29, E1-39 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Por qué la existencia inicial es un movimiento y no una columna? (2) ¿Por qué el producto nace con su UUIDv7 en la caja? (3) ¿Por qué se revisa el código repetido antes de pedir el PIN?
- **Entrevista:** (1) ¿Cómo creas una entidad offline sin que dos dispositivos choquen? (2) ¿Cómo mantienes atómico un cambio que toca cuatro tablas?

### E1-43 · Panel de modificación de productos
- **Objetivo:** el dueño busca un producto y modifica su nombre, códigos, unidad, impuesto, costo y estado, cambia su precio y ajusta su inventario desde una sola pantalla, sin perder el historial.
- **Conceptos:** [Control de concurrencia optimista], [Borrado lógico], [Autorización en la caja]
- **Claude / tú:** Claude escribe el panel (F10 en la venta y desde el inventario), las reglas de cada campo y el contrato `product.updated`; el precio y el inventario reutilizan los servicios de E1-39 y E1-26. Tú decides qué ve un cajero y pruebas con productos reales.
- **Pruebas:** validaciones, permisos por rol y PIN, código repetido, unidad bloqueada con movimientos, bitácora con valor anterior y nuevo, outbox en la misma transacción con reversa, producto que cambió mientras se editaba, borrado lógico, ventas cerradas intactas y un flujo de pantalla de punta a punta.
- **Criterios:** cumple RF-008, RF-040 y ADR 0058; nunca se borra un producto ni se edita la existencia; el precio sigue usando `product.price_changed`.
- **Depende de:** E1-26, E1-39, E1-42 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Por qué la unidad no se puede cambiar cuando hay movimientos? (2) ¿Cómo sabe el panel que el producto cambió mientras lo editabas? (3) ¿Por qué se da de baja en lugar de borrar?
- **Entrevista:** (1) ¿Qué es el control de concurrencia optimista y cuándo lo prefieres? (2) ¿Cómo modelas un borrado lógico sin romper la historia?

## Hito E1-C: Sincronización

### E1-16 · Envío desde la caja
- **Objetivo:** la caja sube lotes en orden y reintenta sola.
- **Conceptos:** [Retroceso exponencial]
- **Claude / tú:** Claude escribe `sync_outbox` y el sincronizador. Tú desconectas la red durante un envío.
- **Pruebas:** reintentos, orden y corte de red.
- **Criterios:** ninguna operación se pierde tras reconectar.
- **Depende de:** E1-10 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Por qué `device_seq` y no el reloj? (2) ¿Qué es retroceso exponencial? (3) ¿Qué pasa si se envía dos veces?
- **Entrevista:** (1) ¿Cómo diseñas un cliente sin conexión? (2) ¿Qué es la consistencia eventual?

### E1-17 · Recepción en el núcleo
- **Objetivo:** el servidor recibe lotes de forma idempotente.
- **Conceptos:** [Idempotencia], [UNIQUE en PostgreSQL]
- **Claude / tú:** Claude escribe `POST /sync/push` y el registro de ventas. Tú reenvías un lote a mano.
- **Pruebas:** Testcontainers: lote duplicado y concurrente.
- **Criterios:** cumple RF-021.
- **Depende de:** E1-16, F0-10, F0-09 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Dónde se aplica la unicidad? (2) ¿Por qué responder por operación? (3) ¿Qué pasa si falla la mitad?
- **Entrevista:** (1) ¿Cómo implementas idempotencia? (2) ¿Una o varias transacciones por lote?

### E1-18 · Cambios hacia la caja
- **Objetivo:** catálogo, precios y permisos llegan con cursor.
- **Conceptos:** [Paginación por cursor]
- **Claude / tú:** Claude escribe `GET /sync/pull` y su aplicación. Tú cambias un precio en el panel.
- **Pruebas:** cursor, reanudación y borrado lógico.
- **Criterios:** cumple RF-023.
- **Depende de:** E1-17, F0-19 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué guarda el cursor? (2) ¿Por qué aplicarlo en una transacción? (3) ¿Cómo llega un producto dado de baja?
- **Entrevista:** (1) ¿Cursor o timestamp para sincronizar? (2) ¿Cómo manejas la replicación incremental?

### E1-19 · Discrepancias y cuarentena
- **Objetivo:** el dueño revisa diferencias sin perder ventas.
- **Conceptos:** [Dead letter queue]
- **Claude / tú:** Claude escribe la detección y la pantalla. Tú revisas una venta a precio viejo.
- **Pruebas:** discrepancia detectada y operación inválida en cuarentena.
- **Criterios:** cumple RF-022.
- **Depende de:** E1-17, E1-18 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Por qué no rechazar la venta? (2) ¿Discrepancia o cuarentena? (3) ¿Quién resuelve cada una?
- **Entrevista:** (1) ¿Qué es una dead letter queue? (2) ¿Cómo resuelves conflictos en sistemas distribuidos?

### E1-20 · Prueba de punta a punta sin internet
- **Objetivo:** se demuestra que no se duplican ni pierden ventas.
- **Conceptos:** [Playwright], [Testcontainers]
- **Claude / tú:** Claude escribe el escenario. Tú lo ejecutas y lees el resultado.
- **Pruebas:** 1,000 ventas sin red, reconexión y comparación de totales.
- **Criterios:** cumple RF-020, RNF-01 y RNF-05.
- **Depende de:** E1-19 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué simula la prueba? (2) ¿Qué comparas al final? (3) ¿Qué no cubre?
- **Entrevista:** (1) ¿Cómo pruebas fallas de red? (2) ¿Qué es ingeniería del caos?

## Hito E1-D: Caja y cortes

### E1-21 · Sesión de caja
- **Objetivo:** se abre con fondo y se registran entradas y salidas.
- **Conceptos:** [DDD: agregados]
- **Claude / tú:** Claude escribe `CashSession`. Tú simulas un día.
- **Pruebas:** una sola sesión abierta y cálculo del esperado.
- **Criterios:** cumple RF-024 y RF-025.
- **Depende de:** E1-11, E1-04 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Por qué una sola sesión? (2) ¿Qué afecta el efectivo esperado? (3) ¿Quién autoriza una salida?
- **Entrevista:** (1) ¿Qué invariantes protege este agregado? (2) ¿Cómo evitas una doble apertura?

### E1-22 · Aviso de retiro parcial
- **Objetivo:** la caja avisa al pasar el límite de efectivo, sin frenar la venta.
- **Conceptos:** [Eventos en React]
- **Claude / tú:** Claude escribe el aviso. Tú defines el límite con tu familia.
- **Pruebas:** umbral exacto y salida que baja el nivel.
- **Criterios:** cumple RF-026.
- **Depende de:** E1-21 · **Estimación:** 2 h
- **Autoevaluación:** (1) ¿Por qué no bloquear? (2) ¿Cómo se registra el retiro? (3) ¿Por qué es configurable?
- **Entrevista:** (1) ¿Qué riesgo de negocio mitiga? (2) ¿Cómo diseñas alertas útiles?

### E1-23 · Corte con arqueo
- **Objetivo:** el corte diario compara lo esperado con lo contado.
- **Conceptos:** [Proyecciones]
- **Claude / tú:** Claude escribe el cálculo y la pantalla. Tú comparas con el corte de Eleventa.
- **Pruebas:** casos compartidos y diferencia con motivo.
- **Criterios:** cumple RF-027 y funciona sin internet.
- **Depende de:** E1-21, E1-12 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Cómo se calcula el esperado? (2) ¿Qué es un arqueo? (3) ¿Por qué pedir motivo?
- **Entrevista:** (1) ¿Cómo garantizas que el corte sea correcto? (2) ¿Cómo reconcilias dos fuentes?

### E1-24 · Reporte por correo
- **Objetivo:** el dueño recibe el corte por correo, aunque se envíe tarde.
- **Conceptos:** [Spring Mail]
- **Claude / tú:** Claude escribe el envío. Tú configuras un proveedor con nivel gratuito.
- **Pruebas:** evento consumido una vez y correo simulado.
- **Criterios:** cumple RF-028, sin datos personales innecesarios.
- **Depende de:** E1-23, E1-17 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Quién dispara el correo? (2) ¿Cómo evitas enviarlo dos veces? (3) ¿Por qué no WhatsApp ahora?
- **Entrevista:** (1) ¿Cómo diseñas notificaciones confiables? (2) ¿Qué es un consumidor idempotente?

## Hito E1-E: Inventario

### E1-25 · Movimientos por venta y devolución
- **Objetivo:** cada venta crea movimientos, en caja y en servidor.
- **Conceptos:** [Libro inmutable]
- **Claude / tú:** Claude escribe el libro y sus proyecciones. Tú vendes cable y revisas la existencia.
- **Pruebas:** suma igual a existencia y duplicados ignorados.
- **Criterios:** cumple RF-029 y RF-032.
- **Depende de:** E1-17, E1-15 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Por qué no un `UPDATE`? (2) ¿Qué es la proyección? (3) ¿Por qué permitir negativos?
- **Entrevista:** (1) ¿Libro de movimientos o columna de saldo? (2) ¿Qué es event sourcing?

### E1-26 · Ajustes y mermas
- **Objetivo:** el almacenista registra ajustes y mermas con motivo.
- **Conceptos:** [Control de acceso]
- **Claude / tú:** Claude escribe el flujo. Tú das de baja un rollo dañado de prueba.
- **Pruebas:** permisos y bitácora.
- **Criterios:** cumple RF-030.
- **Depende de:** E1-25, F0-12 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Ajuste o merma? (2) ¿Cómo se corrige un ajuste erróneo? (3) ¿Quién puede hacerlo?
- **Entrevista:** (1) ¿Cómo auditas inventario? (2) ¿Cómo evitas fraude interno?

### E1-27 · Kardex y verificación
- **Objetivo:** el kardex coincide siempre con la existencia.
- **Conceptos:** [Window functions]
- **Claude / tú:** Claude escribe la consulta y la verificación nocturna. Tú lees el kardex de un producto.
- **Pruebas:** proyección reconstruida igual a la original.
- **Criterios:** cumple RF-031.
- **Depende de:** E1-25 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué muestra un kardex? (2) ¿Cómo calculas el saldo acumulado? (3) ¿Qué haces si difiere?
- **Entrevista:** (1) Explica una window function. (2) ¿Cómo optimizas una tabla que solo crece?

### E1-28 · Costo promedio
- **Objetivo:** el margen usa un costo promedio correcto, incluso con sincronización tardía.
- **Conceptos:** [Costo promedio ponderado]
- **Claude / tú:** Claude escribe el cálculo en el servidor. Tú revisas un ejemplo con dos compras.
- **Pruebas:** escala `e6` y venta recibida tarde.
- **Criterios:** cumple RF-033.
- **Depende de:** E1-25 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Cómo se calcula? (2) ¿Por qué en el servidor? (3) ¿Qué pasa con una venta tardía?
- **Entrevista:** (1) ¿Promedio, PEPS o UEPS? (2) ¿Cómo corriges datos derivados?

### E1-29 · Saldo inicial desde Eleventa
- **Objetivo:** existencias y ventas de Eleventa entran sin duplicar.
- **Conceptos:** [ETL]
- **Claude / tú:** Claude escribe el importador. Tú das los archivos reales, fuera del repositorio.
- **Pruebas:** sintéticos, doble importación y totales.
- **Criterios:** cumple RF-034 y los totales coinciden.
- **Depende de:** E1-25, F0-18 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué es `opening_balance`? (2) ¿Cómo marcas datos importados? (3) ¿Qué haces con filas inválidas?
- **Entrevista:** (1) ¿Cómo migras datos de un sistema heredado? (2) ¿Cómo validas una migración?

## Hito E1-F: Factura

### E1-30 · Cliente de Facturapi
- **Objetivo:** el núcleo crea facturas en modo de prueba, con llave cifrada por negocio.
- **Conceptos:** [Facturapi], [RestClient]
- **Claude / tú:** Claude escribe el cliente. Tú creas la cuenta y das la llave de prueba por variable de entorno.
- **Pruebas:** WireMock con errores y una prueba real en modo de prueba.
- **Criterios:** ninguna llave en el repositorio ni en logs.
- **Depende de:** F0-07 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Dónde vive la llave? (2) ¿Cómo manejas un error 5xx? (3) ¿Qué diferencia hay entre test y live?
- **Entrevista:** (1) ¿Cómo integras una API externa de forma confiable? (2) ¿Qué es un circuit breaker?

### E1-31 · Factura individual
- **Objetivo:** una venta sincronizada se factura y se guardan UUID, XML y PDF.
- **Conceptos:** [CFDI 4.0], [Facturas en Facturapi]
- **Claude / tú:** Claude escribe el flujo y la pantalla. Tú validas una factura con el contador.
- **Pruebas:** datos fiscales inválidos, reintento e idempotencia.
- **Criterios:** cumple RF-035, y producción queda bloqueada solo por los CSD.
- **Depende de:** E1-30, E1-17, E1-06 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Qué datos exige CFDI 4.0? (2) ¿Por qué requiere estar sincronizada? (3) ¿Qué hace `invoice_state`?
- **Entrevista:** (1) ¿Cómo manejas una tarea con efectos externos? (2) ¿Cómo garantizas no timbrar dos veces?

### E1-32 · Factura global
- **Objetivo:** las ventas no facturadas de un periodo van a una global.
- **Conceptos:** [Referencia de Facturapi]
- **Claude / tú:** Claude prueba el objeto `global` y escribe el flujo. Tú confirmas periodicidad con el contador.
- **Pruebas:** excluye ventas ya facturadas y no incluye una venta dos veces.
- **Criterios:** cumple RF-036; si la API no lo permite, se actualiza el ADR 0012.
- **Depende de:** E1-31 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué es una factura global? (2) ¿Qué ventas incluye? (3) ¿Qué pasa si un cliente pide factura después?
- **Entrevista:** (1) ¿Cómo manejas procesos por lotes con efectos externos? (2) ¿Cómo evitas doble procesamiento?

### E1-33 · Cancelación y nota de crédito
- **Objetivo:** se cancela una factura o se emite egreso por una devolución.
- **Conceptos:** [Cancelación CFDI]
- **Claude / tú:** Claude escribe ambos flujos. Tú revisas los motivos con el contador.
- **Pruebas:** estados de cancelación y egreso relacionado.
- **Criterios:** cumple RF-037 y RF-038.
- **Depende de:** E1-31, E1-15 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Cancelar o nota de crédito? (2) ¿Por qué es asíncrono? (3) ¿Qué queda en la bitácora?
- **Entrevista:** (1) ¿Cómo modelas estados de un proceso externo? (2) ¿Cómo manejas webhooks fallidos?

## Hito E1-G: Reportes y salida

### E1-34 · Reportes básicos
- **Objetivo:** el dueño ve ventas, ticket promedio, margen, agotados y productos sin venta.
- **Conceptos:** [Agregaciones SQL], [Índices]
- **Claude / tú:** Claude escribe consultas y pantallas. Tú comparas con Eleventa.
- **Pruebas:** datos sintéticos con totales conocidos.
- **Criterios:** cumple RF-039 y RNF-03.
- **Depende de:** E1-28, E1-23 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué es ticket promedio? (2) ¿Cómo calculas margen? (3) ¿Qué índice ayuda aquí?
- **Entrevista:** (1) ¿Cómo lees un `EXPLAIN`? (2) ¿Cuándo usas una vista materializada?

### E1-35 · Respaldo de la caja
- **Objetivo:** la base de la caja se copia cada hora a otro dispositivo.
- **Conceptos:** [SQLite backup]
- **Claude / tú:** Claude escribe la copia cifrada. Tú conectas la USB y restauras una copia.
- **Pruebas:** copia válida durante escrituras y restauración.
- **Criterios:** cumple RNF-09 en la parte local.
- **Depende de:** E1-02 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Por qué no copiar el archivo a mano? (2) ¿Dónde va la copia? (3) ¿Qué pasa si se daña el disco?
- **Entrevista:** (1) ¿Cómo diseñas respaldos de clientes? (2) ¿Por qué probar la restauración?

### E1-36 · Instalador para Windows
- **Objetivo:** tu familia instala y actualiza la caja sin ayuda técnica.
- **Conceptos:** [electron-builder]
- **Claude / tú:** Claude configura instalador y actualización. Tú lo instalas en la PC de la tienda.
- **Pruebas:** instalar y actualizar en Windows 10, con migración de datos.
- **Criterios:** cumple RNF-11 y documenta la advertencia de SmartScreen.
- **Depende de:** E1-20, E1-14 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Por qué firmar un instalador? (2) ¿Qué pasa si falla una actualización? (3) ¿Cómo la reviertes?
- **Entrevista:** (1) ¿Cómo distribuyes actualizaciones de escritorio? (2) ¿Cómo haces una reversión segura?

### E1-37 · Piloto paralelo
- **Objetivo:** 1 a 2 semanas registrando en ambos sistemas.
- **Conceptos:** [Runbook]
- **Claude / tú:** Claude prepara el guion y la comparación. Tú y tu familia operan y anotan los fallos.
- **Pruebas:** cortes diarios comparados con Eleventa.
- **Criterios:** dos semanas sin ventas perdidas y diferencias explicadas.
- **Depende de:** E1-36, E1-29, E1-33, E1-34, E1-35, E1-24, E1-26, E1-27, E1-22, E1-09, E1-08 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué comparas cada día? (2) ¿Qué detiene el piloto? (3) ¿Cómo registras un fallo?
- **Entrevista:** (1) ¿Cómo lanzas un sistema crítico con riesgo bajo? (2) ¿Qué es un despliegue en paralelo?

### E1-38 · Salida de Eleventa
- **Objetivo:** la tienda opera solo con este sistema y tiene plan de regreso.
- **Conceptos:** [Postmortem]
- **Claude / tú:** Claude prepara la lista de salida. Tú decides la fecha con tu familia.
- **Pruebas:** ensayo de regreso a Eleventa y restauración.
- **Criterios:** datos finales importados, CSD activos y modo mentor retomado.
- **Depende de:** E1-37 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué datos conservas de Eleventa? (2) ¿Cuándo vuelves atrás? (3) ¿Qué aprendiste del piloto?
- **Entrevista:** (1) Cuenta una migración sin interrumpir el negocio. (2) ¿Qué incluye un buen postmortem?

[Electron]: https://www.electronjs.org/docs/latest/
[Seguridad en Electron]: https://www.electronjs.org/docs/latest/tutorial/security
[Vite]: https://vite.dev/guide/
[SQLite]: https://www.sqlite.org/docs.html
[WAL]: https://www.sqlite.org/wal.html
[Interfaces en TypeScript]: https://www.typescriptlang.org/docs/handbook/2/objects.html
[Argon2]: https://www.rfc-editor.org/rfc/rfc9106
[Almacenamiento seguro]: https://www.electronjs.org/docs/latest/api/safe-storage
[BigInt]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt
[multiplyExact]: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Math.html#multiplyExact(long,long)
[CFDI 4.0]: https://www.sat.gob.mx/
[Facturapi]: https://docs.facturapi.io/
[React]: https://react.dev/learn
[FTS5]: https://www.sqlite.org/fts5.html
[Patrón Strategy]: https://refactoring.guru/design-patterns/strategy
[Autorización en la caja]: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
[Máquina de estados]: https://refactoring.guru/design-patterns/state
[Transacciones en SQLite]: https://www.sqlite.org/lang_transaction.html
[Teclado en React]: https://react.dev/learn/responding-to-events
[PCI DSS]: https://www.pcisecuritystandards.org/standards/
[ESC/POS]: https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/
[Comando de cajón]: https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/esc_lp.html
[Transacción compensatoria]: https://learn.microsoft.com/en-us/azure/architecture/patterns/compensating-transaction
[Retroceso exponencial]: https://learn.microsoft.com/en-us/azure/architecture/patterns/retry
[Idempotencia]: https://www.rfc-editor.org/rfc/rfc9110#name-idempotent-methods
[UNIQUE en PostgreSQL]: https://www.postgresql.org/docs/16/ddl-constraints.html
[Paginación por cursor]: https://www.postgresql.org/docs/16/queries-limit.html
[Dead letter queue]: https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-dead-letter-queues
[Playwright]: https://playwright.dev/docs/intro
[Testcontainers]: https://java.testcontainers.org/
[DDD: agregados]: https://martinfowler.com/bliki/DDD_Aggregate.html
[Eventos en React]: https://react.dev/learn/responding-to-events
[Proyecciones]: https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view
[Spring Mail]: https://docs.spring.io/spring-framework/reference/integration/email.html
[Libro inmutable]: https://martinfowler.com/eaaDev/AccountingEntry.html
[Control de acceso]: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
[Window functions]: https://www.postgresql.org/docs/16/tutorial-window.html
[Costo promedio ponderado]: https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/
[ETL]: https://docs.getdbt.com/terms/etl
[RestClient]: https://docs.spring.io/spring-framework/reference/integration/rest-clients.html
[Facturas en Facturapi]: https://docs.facturapi.io/docs/guides/invoices/ingreso/
[Referencia de Facturapi]: https://docs.facturapi.io/api/
[Cancelación CFDI]: https://docs.facturapi.io/api/
[Agregaciones SQL]: https://www.postgresql.org/docs/16/tutorial-agg.html
[Índices]: https://www.postgresql.org/docs/16/indexes.html
[SQLite backup]: https://www.sqlite.org/backup.html
[electron-builder]: https://www.electron.build/
[Runbook]: https://sre.google/workbook/canarying-releases/
[Postmortem]: https://sre.google/sre-book/postmortem-culture/
