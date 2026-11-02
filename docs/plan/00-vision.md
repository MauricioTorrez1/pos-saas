# Visión

## Problema
Una tlapalería vende por pieza, por metro y por kilo, y un mismo cliente puede pedir clavo a granel, cable cortado y factura. Abre con Eleventa como caja provisional. Los sistemas genéricos no combinan bien venta sin internet, granel, factura y, más adelante, tienda en línea y taller. Otros comercios locales tienen problemas parecidos.

## Meta actual
Reemplazar a Eleventa lo antes posible y sin riesgo, después de un piloto paralelo de 1 a 2 semanas. Después, ofrecer el sistema como SaaS a otros negocios, empezando por una heladería familiar.

## Usuarios
| Rol | Necesita | Ejemplo |
| --- | --- | --- |
| Dueño | Configurar precios, ver reportes y revisar discrepancias | Ver el corte y el margen del día |
| Cajero | Vender rápido, con o sin internet | Cobrar 3.275 m de cable y un kilo de clavo |
| Almacenista | Registrar compras, ajustes y mermas | Dar de baja un rollo dañado |
| Técnico de taller | Dar seguimiento a reparaciones (fase 2) | Registrar un folio de reparación |
| Cliente final | Comprar, facturar y consultar su reparación | Pedir factura o el estado de su equipo |
| Administrador del SaaS | Dar de alta negocios y dar soporte (fase 4) | Activar la heladería |

Hoy la familia cubre los roles de la tienda. Cada persona entra con su PIN para que ventas y cortes queden a su nombre.

## Propuesta de valor
- Vende aunque se caiga el internet, sin duplicar ni perder ventas al reconectar.
- Maneja granel con precisión: una venta de 3.275 m descuenta exactamente eso.
- Factura desde el mismo sistema.
- Se adapta a otros giros sin rehacer el núcleo.

## Alcance por fase
| Fase | Resultado | Incluye |
| --- | --- | --- |
| 0. Base | Base técnica y catálogo | Repositorio, CI, stack completo, modelo de datos, usuarios, catálogo, importación, panel mínimo |
| 1. Entrega 1 | Reemplaza a Eleventa | Venta sin internet, efectivo, transferencia y tarjeta tecleada, ticket y cajón, inventario recortado, corte diario, factura individual y global, reportes básicos |
| 1. Entrega 2 | Terminal integrada | Spike de la terminal, Orders API, webhook, reembolsos y conciliación |
| 2. Operación completa | Tienda completa | Autofactura, complementos de pago, cotizaciones, apartados, crédito, compras, taller, clientes, lealtad |
| 3. Venta en línea | Más canales | Tienda web, WhatsApp, reservas, links de pago, promociones, redes sociales |
| 4. SaaS | Segundo negocio | Alta en autoservicio, planes, sucursales, roles, módulos por giro, recetas para la heladería, caja web |
| 5. IA y analítica | Decisiones con datos | Recomendador de promociones, pronósticos, contabilidad completa |

## Fuera de alcance
- Datos de tarjeta dentro del sistema: la terminal los maneja por completo.
- Lotes, caducidades, series, traspasos y reservas antes de la fase que los use.
- Nómina, aplicación móvil nativa y entrega con rutas optimizadas.
- Cumplimiento específico de farmacia con receta hasta validar ese giro.
- Datos reales de la tienda o listas de proveedores en el repositorio público.

## Cómo sabremos que funcionó
- **Entrega 1:** dos semanas de piloto con cortes que coinciden con Eleventa y ninguna venta perdida.
- **Entrega 2:** cobro integrado sin cobros dobles durante el piloto.
- **SaaS:** la heladería opera sin cambios al núcleo fuera de sus módulos.
- **Portafolio:** repositorio con CI en verde, ADR y pruebas que puedas defender en una entrevista de Java.
