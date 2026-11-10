# Permisos por rol

Este documento es para que Mauricio lo revise con su familia: quién puede hacer qué en el sistema. La tabla se genera desde el código (`EndpointPermissions` y `Permission` en `services/core`) y una prueba rompe CI si este archivo y el código dejan de coincidir. Decisión: [ADR 0042](adr/0042-roles-y-permisos-por-endpoint.md).

## Los tres roles

| Rol | Quién es | Idea general |
| --- | --- | --- |
| Dueño (`owner`) | El dueño del negocio | Todo, incluido cambiar precios y los roles de los demás |
| Encargado (`manager`) | Almacenista o encargado de turno de confianza | La operación diaria: productos, importaciones, facturas y reportes. No cambia precios ni roles |
| Cajero (`cashier`) | Quien atiende el mostrador | Consulta productos y vende. No cambia precios ni ve reportes |

El técnico de taller todavía no tiene rol propio: llega con el módulo de taller. Mientras tanto, quien repare equipos y no deba tocar precios entra como cajero.

## Tabla de permisos

Cada fila es un endpoint de la API. «Sí» quiere decir que el rol puede llamarlo; «—» que recibe 403 (y el intento queda en la bitácora). Un endpoint que no está en la tabla se rechaza para todos hasta que alguien decida quién lo puede usar. Los endpoints de productos, importaciones, precios, facturas y reportes se construyen en tareas posteriores; se listan desde ahora para que la familia decida con tiempo.

<!-- matrix:begin -->
| Endpoint | Permiso | Dueño | Encargado | Cajero |
| --- | --- | :---: | :---: | :---: |
| `GET /me` | (authenticated) | Sí | Sí | Sí |
| `POST /sync/push` | `sync.push` | Sí | Sí | Sí |
| `PUT /users/{id}/role` | `user.role.change` | Sí | — | — |
| `GET /products` | `product.read` | Sí | Sí | Sí |
| `POST /products` | `product.write` | Sí | Sí | — |
| `PATCH /products/{id}` | `product.write` | Sí | Sí | — |
| `POST /imports/catalog` | `catalog.import` | Sí | Sí | — |
| `POST /price-changes` | `price.change` | Sí | — | — |
| `GET /discrepancies` | `discrepancy.view` | Sí | Sí | — |
| `POST /invoices` | `invoice.issue` | Sí | Sí | — |
| `POST /invoices/global` | `invoice.issue` | Sí | Sí | — |
| `POST /invoices/{id}/cancel` | `invoice.cancel` | Sí | — | — |
| `GET /reports/sales` | `report.view` | Sí | Sí | — |
<!-- matrix:end -->

## Qué significa cada permiso

| Permiso | En palabras sencillas |
| --- | --- |
| `sync.push` | Subir a la nube las ventas y movimientos que hizo una caja |
| `product.read` | Ver productos, sus códigos y sus precios |
| `product.write` | Dar de alta y editar productos (no su precio: eso es `price.change`) |
| `catalog.import` | Cargar el catálogo desde un archivo, por ejemplo el de Eleventa |
| `price.change` | Cambiar un precio, uno por uno o en bloque |
| `discrepancy.view` | Ver las diferencias entre lo que dice la caja y lo que dice el servidor |
| `invoice.issue` | Emitir una factura |
| `invoice.cancel` | Cancelar una factura ante el SAT |
| `report.view` | Ver los reportes de ventas |
| `user.role.change` | Cambiar el rol de una persona |

## Reglas que no están en la tabla

- Un negocio siempre tiene al menos un dueño activo: el último dueño no puede bajarse el rol (el sistema responde 409).
- Un cambio de rol y cada acceso denegado quedan en la bitácora de auditoría, que nadie puede editar.
- El rol se lee de la base de datos en cada petición, no del token de inicio de sesión: un cambio de rol aplica de inmediato.
- Una persona desactivada, o con sesión pero sin registro en el negocio, no puede llamar nada protegido; solo `GET /me`.
- Las cajas se identifican con credenciales de dispositivo, no con estos roles (se agregan con el registro de cajas).

## Preguntas para la familia

1. ¿El encargado debe poder cambiar precios? Hoy no (RF-008 solo prohíbe al cajero, pero «mínimo privilegio» pide empezar cerrado).
2. ¿El cajero debe ver reportes de ventas? Hoy no.
3. ¿Quién cancela facturas? Hoy solo el dueño.
4. ¿Hace falta un rol de técnico distinto del cajero?
