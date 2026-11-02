# ADR 0012: Factura en la Entrega 1 y terminal integrada en la 2

Estado: Aceptada · Fecha: 2026-11-02 · Modifica las fases de la especificación.

## Contexto
La tienda abre con Eleventa y queremos reemplazarla lo antes posible. La especificación ponía la factura en fase 2 y la terminal integrada en fase 1, pero sin factura no se puede dejar Eleventa sin facturar por fuera. Además, no está confirmado si la terminal acepta cobros tecleados una vez integrada.

## Opciones
1. **Todo en una entrega.** Eleventa se queda más tiempo.
2. **Terminal primero, factura después.** Se sigue facturando por fuera.
3. **Factura primero, terminal después.** Permite salir de Eleventa con la terminal en modo normal; requiere los CSD.

## Decisión
La fase 1 se divide en dos:
- **Entrega 1:** venta con efectivo, transferencia y tarjeta tecleada con folio, ticket y cajón, inventario recortado, corte diario, reportes básicos, y factura individual y global.
- **Entrega 2:** terminal integrada con Orders API, después del spike de cobro tecleado.

Se usa el plan API de Facturapi ($299 MXN al mes más $0.60 por timbre, según su página de precios). Su referencia de API documenta un objeto `global` en `POST /invoices`, sin usar e-receipts; falta probarlo en modo de prueba. El portal de autofactura queda para fase 2, sobre la misma API.

## Consecuencias
- Los CSD del negocio son un bloqueo real para facturar en producción.
- Cada venta guarda claves SAT e impuestos por línea desde el inicio.
- Una venta incluida en una factura global no se factura de nuevo sin el tratamiento correcto. Hay que validarlo con el contador.
- Cotizaciones, crédito, compras, taller y clientes siguen en fase 2.
