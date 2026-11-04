# Riesgos

Probabilidad e impacto: A (alto), M (medio), B (bajo).

## Técnicos
| Riesgo | Prob. | Impacto | Mitigación |
| --- | --- | --- | --- |
| La terminal no acepta cobros tecleados en modo PDV | M | A | Spike antes de la Entrega 2; plan B con segunda terminal o solo efectivo sin internet |
| Cobro doble por cancelar mientras el cliente paga | M | A | Sin otra forma de pago hasta un estado final; solo el webhook confirma la cancelación |
| Webhook perdido o retrasado (reintentos cada 15 minutos) | M | M | Consulta puntual a los 30 segundos y conciliación |
| Diferencias de cálculo entre TypeScript y Java | M | A | Casos compartidos en CI y discrepancias visibles |
| Pérdida de ventas no sincronizadas por falla del disco | B | A | Copia cada hora en otro dispositivo y sincronización frecuente |
| Filtración entre negocios | B | A | RLS forzado, roles separados y prueba por tabla |
| Impresora o cajón no funcionan como se espera en Windows 10 | M | M | Interfaces con falsos y prueba física apenas llegue el hardware |
| Spring Modulith incompatible con Spring Boot 4.1 | Resuelto | M | Confirmado en F0-07: Modulith 2.1.2 está compilado contra Boot 4.1.2 y las pruebas pasan |
| El objeto `global` de Facturapi no funciona sin e-receipts | M | M | Se prueba en modo de prueba en E1-32; se actualiza el ADR 0012 si falla |
| PC de un negocio sin actualizaciones de seguridad | M | M | Revisar el soporte de su Windows antes de instalar, y migrar si hace falta |
| La actualización de la caja rompe la tienda | B | A | Actualización con reversión, migraciones probadas y plan de regreso |

## De negocio
| Riesgo | Prob. | Impacto | Mitigación |
| --- | --- | --- | --- |
| **La tienda abre antes de que el software esté listo** | Ocurrió | M | Abre con Eleventa; el sistema la reemplaza tras un piloto paralelo |
| Eleventa no exporta catálogo o ventas | M | A | Probar con 10 productos antes de capturar todo; si no exporta, buscar con el proveedor o usar reportes o la plantilla CSV |
| Un negocio no tiene listos sus datos fiscales (RFC, CSD, e.firma) | M | A | Confirmarlos con su contador antes de activar la factura; desarrollar en modo de prueba |
| Reglas fiscales mal interpretadas | M | A | El contador valida global, cancelación y autofactura; no se asume nada en el código |
| El contrato de internet de un negocio no permite uso comercial | M | M | Revisar el contrato y cotizar un plan de negocio si hace falta |
| Se cae el internet de la tienda | M | B | La caja vende sin internet y la terminal tiene 4G |
| Listas de proveedores con restricciones de uso | M | M | Fuera del repositorio; revisar condiciones antes del SaaS |
| Datos personales mal manejados | B | A | Aviso de privacidad antes de capturarlos y acceso por rol |
| La heladería no adopta el sistema | B | M | Piloto corto y módulos específicos; otro negocio como respaldo |
| Soporte a clientes consume tu tiempo | M | M | Alta guiada, documentación y límite de clientes al inicio |

## De tiempo y aprendizaje
| Riesgo | Prob. | Impacto | Mitigación |
| --- | --- | --- | --- |
| Horas menores por titulación y prácticas | A | A | Calendario solo hasta Entrega 2; revisión semanal en `progreso.md` |
| El stack completo retrasa la salida de Eleventa | A | M | 25 a 40 horas previstas; perfiles para no operar todo a la vez |
| El stack completo excede el presupuesto | A | M | Decidir antes de contratar, según [06-infraestructura](06-infraestructura.md) |
| El alcance crece antes de salir de Eleventa | M | A | Todo lo nuevo va a una fase posterior, salvo que impida vender |
| Aprender menos porque Claude escribe el código | A | A | Explicación por cambio, autoevaluación por tarea, sin aprobar lo que no puedas explicar, y modo mentor desde la Entrega 2 |
| No poder defender el código en una entrevista | M | A | Ensayo por hito, y ser transparente sobre el uso de IA |
| Dependencia de una sola persona | A | M | Instrucciones de operación y plan de regreso para tu familia |
| Hardware llega tarde | M | M | Falsos para avanzar, y pruebas físicas agendadas al llegar |

## Plan de regreso
Si algo falla durante el piloto, Eleventa sigue siendo la fuente de verdad. Después de salir de ella, se conserva su instalación y el último respaldo durante 30 días.
