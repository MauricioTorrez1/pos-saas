# ADR 0041: Cliente de Facturapi detrás de una interfaz, con reintentos solo en lecturas

Estado: Aceptada · Fecha: 2026-11-09 · Desarrolla el ADR 0012.

## Contexto
El núcleo debe timbrar, consultar, cancelar y descargar facturas en Facturapi (E1-31 a E1-33). Timbrar tiene un efecto externo que no se deshace: si la respuesta se pierde y se repite la petición, se puede timbrar dos veces. Además, los errores de Facturapi pueden repetir el RFC o el nombre fiscal, que no deben llegar a los logs, y la llave de la API es un secreto.

## Opciones
1. **SDK oficial o cliente generado.** Menos código, pero una dependencia más sin soporte claro para Boot 4 y menos control de timeouts y de lo que se registra.
2. **`RestClient` de Spring detrás de una interfaz del módulo.** Poco código, sin dependencias nuevas, y el resto del núcleo se prueba con un falso.
3. **Cliente reactivo con circuit breaker (Resilience4j).** Útil con mucho tráfico; para una tlapalería es más complejidad que valor.

## Decisión
Opción 2.
- **Interfaz `FiscalInvoicing`** en la raíz del módulo `invoicing` (su API pública) con sus registros y excepciones. `FacturapiClient`, las propiedades y la configuración viven en `invoicing.facturapi`, que es interno.
- **Llave:** solo de la variable de entorno `FACTURAPI_API_KEY` (`facturapi.api-key`), enviada como `Authorization: Bearer`. Sin llave, el servicio arranca y cada llamada falla con `FacturapiNotConfiguredException` sin tocar la red. `toString` de las propiedades y de los datos fiscales no muestran valores. Cifrar una llave por negocio (SaaS) queda para cuando haya más de un negocio, con `TENANT_SECRETS_MASTER_KEY`; hoy hay una cuenta.
- **Timeouts:** conexión de 3 s y lectura de 20 s, configurables.
- **Reintentos:** solo `GET` (consultar y descargar PDF o XML): 2 reintentos con espera exponencial ante 5xx, 429 o fallo de red. `POST` y `DELETE` se envían una sola vez. Facturapi no documenta una llave de idempotencia, así que E1-31 debe consultar la factura antes de repetir un timbrado dudoso.
- **Errores:** 4xx es `FacturapiRejectedException` (con el estado y el texto del proveedor aparte, porque puede traer datos fiscales); 5xx, 429, timeout y respuesta ilegible son `FacturapiUnavailableException`. Los mensajes y logs llevan operación, estado e intento; nunca cuerpos, llave ni datos fiscales.
- **Montos:** el contrato usa las escalas del ADR 0011 (`unitPriceE4`, `quantityMilli`, IVA en puntos base) y el cliente las convierte a pesos con `BigDecimal`, con `tax_included: true`. El total que regresa Facturapi se pasa a centavos.
- **Pruebas:** un servidor falso con el `HttpServer` del JDK, sin librería nueva (WireMock no se necesita para estos casos y evita el riesgo de compatibilidad con Boot 4). La prueba real contra el modo de prueba de Facturapi no se automatiza: necesita la llave de Mauricio.

## Consecuencias
- E1-31 a E1-33 usan `FiscalInvoicing` y se prueban con un falso, sin red.
- El objeto `global` y las notas de crédito (`type: E`, documentos relacionados) ya viajan en `InvoiceDraft`, pero falta confirmarlos contra el modo de prueba (E1-32).
- Un timbrado con resultado desconocido no se repite solo: lo resuelve el flujo de E1-31 consultando primero.
- Sin circuit breaker: si Facturapi cae, cada llamada espera hasta sus timeouts. Se revisa si se vuelve un problema real.
