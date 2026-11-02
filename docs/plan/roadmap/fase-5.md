# Fase 5: IA, analítica y contabilidad

Duración estimada: 72 horas, sin calendario todavía. Reparto: modo mentor; tú escribes la lógica y Claude prepara el andamiaje y revisa. Python solo contiene analítica e IA; las reglas de negocio siguen en el núcleo.

## Hito F5-A: Datos

### F5-01 · Consumidor de eventos
- **Objetivo:** las ventas llegan de Redpanda a DuckDB.
- **Conceptos:** [Redpanda], [DuckDB], [Polars]
- **Claude / tú:** Claude da el andamiaje. Tú escribes consumidor y carga idempotente.
- **Pruebas:** pytest con Testcontainers y evento repetido.
- **Criterios:** ningún dato personal llega al almacén.
- **Depende de:** E1-38 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Cómo evitas duplicados? (2) ¿Qué es un grupo de consumidores? (3) ¿Qué datos excluyes?
- **Entrevista:** (1) ¿Batch o streaming? (2) ¿Cómo reprocesas eventos?

### F5-02 · Modelos dbt
- **Objetivo:** existen tablas limpias de ventas por producto, día y negocio.
- **Conceptos:** [dbt]
- **Claude / tú:** Claude revisa. Tú escribes modelos y pruebas.
- **Pruebas:** `dbt test` de nulos, únicos y totales.
- **Criterios:** los totales coinciden con el núcleo.
- **Depende de:** F5-01 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Qué es un modelo incremental? (2) ¿Qué es la capa `staging`? (3) ¿Cómo aíslas negocios?
- **Entrevista:** (1) ¿Esquema estrella o tabla ancha? (2) ¿Cómo pruebas datos?

## Hito F5-B: Recomendador

### F5-03 · Lento movimiento
- **Objetivo:** se detectan productos sin rotación con inventario alto.
- **Conceptos:** [Polars]
- **Claude / tú:** Claude revisa. Tú escribes el cálculo.
- **Pruebas:** pytest con datos sintéticos, incluido granel.
- **Criterios:** cumple RF-081.
- **Depende de:** F5-02 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Cómo defines lento? (2) ¿Y un producto nuevo? (3) ¿Qué pasa con productos de temporada?
- **Entrevista:** (1) ¿Polars o Pandas? (2) ¿Cómo validas una regla analítica?

### F5-04 · Se compran juntos
- **Objetivo:** se proponen combos por asociación.
- **Conceptos:** [scikit-learn]
- **Claude / tú:** Claude da una base de referencia. Tú escribes soporte, confianza y lift.
- **Pruebas:** canastas sintéticas con asociación conocida.
- **Criterios:** cumple RF-082.
- **Depende de:** F5-02 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Qué es lift? (2) ¿Por qué no basta el soporte? (3) ¿Cómo limitas ruido?
- **Entrevista:** (1) Explica reglas de asociación. (2) ¿Cómo evalúas un recomendador?

### F5-05 · Temporadas
- **Objetivo:** se anticipan temporadas con historial.
- **Conceptos:** [Polars]
- **Claude / tú:** Claude revisa. Tú escribes detección y calendario.
- **Pruebas:** serie sintética con temporada de lluvias.
- **Criterios:** avisa con anticipación configurable.
- **Depende de:** F5-02 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Cuánto historial necesitas? (2) ¿Qué es estacionalidad? (3) ¿Qué pasa sin historial?
- **Entrevista:** (1) ¿Cómo tratas datos insuficientes? (2) ¿Tendencia o estacionalidad?

### F5-06 · Filtro de margen
- **Objetivo:** ninguna sugerencia rompe el margen mínimo.
- **Conceptos:** [FastAPI]
- **Claude / tú:** Claude revisa. Tú escribes la validación en el núcleo.
- **Pruebas:** límite exacto y sin costo.
- **Criterios:** el núcleo decide, no Python.
- **Depende de:** F5-03, F5-04, F5-05 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Por qué en el núcleo? (2) ¿Qué pasa sin costo? (3) ¿Cómo calculas el margen?
- **Entrevista:** (1) ¿Cómo limitas el poder de un modelo? (2) ¿Qué es un guardarraíl?

### F5-07 · Explicación con Claude
- **Objetivo:** cada sugerencia tiene explicación y texto de publicación.
- **Conceptos:** [API de Claude], [Prompt caching]
- **Claude / tú:** Claude da la plantilla. Tú escribes llamada, validación y límite de costo.
- **Pruebas:** respuesta simulada, salida inválida y evaluación.
- **Criterios:** solo usa datos enviados y sin datos personales.
- **Depende de:** F5-06 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Qué datos envías? (2) ¿Cómo validas la salida? (3) ¿Cómo controlas costo?
- **Entrevista:** (1) ¿Cómo evitas alucinaciones? (2) ¿Cómo pruebas un sistema con LLM?

### F5-08 · Aprobación del dueño
- **Objetivo:** una sugerencia aprobada se vuelve regla activa.
- **Conceptos:** [Next.js]
- **Claude / tú:** Claude revisa. Tú escribes bandeja y conversión.
- **Pruebas:** aprobar, rechazar y editar.
- **Criterios:** nada se activa sin aprobación.
- **Depende de:** F5-07, F3-16 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Quién aprueba? (2) ¿Qué queda registrado? (3) ¿Puede editarse?
- **Entrevista:** (1) ¿Qué es human-in-the-loop? (2) ¿Cómo diseñas confianza en IA?

### F5-09 · Medición de resultados
- **Objetivo:** se compara lo esperado contra lo ocurrido.
- **Conceptos:** [dbt]
- **Claude / tú:** Claude revisa el método. Tú escribes la medición.
- **Pruebas:** datos sintéticos con efecto conocido.
- **Criterios:** cumple RF-083 y muestra incertidumbre.
- **Depende de:** F5-08 · **Estimación:** 5 h
- **Autoevaluación:** (1) ¿Contra qué comparas? (2) ¿Qué es un grupo de control? (3) ¿Qué te confunde el resultado?
- **Entrevista:** (1) ¿Correlación o causalidad? (2) ¿Cómo mides una promoción sin A/B?

## Hito F5-C: Pronóstico y reportes

### F5-10 · Pronóstico de demanda
- **Objetivo:** se estima la demanda con su margen de error.
- **Conceptos:** [scikit-learn]
- **Claude / tú:** Claude da una base ingenua. Tú escribes el modelo y su evaluación.
- **Pruebas:** validación temporal, sin fuga de datos.
- **Criterios:** cumple RF-084 y supera la base ingenua, o no se publica.
- **Depende de:** F5-02 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Por qué validación temporal? (2) ¿Qué es fuga de datos? (3) ¿Qué métrica usas?
- **Entrevista:** (1) ¿Cómo evalúas series de tiempo? (2) ¿Cuándo no usar aprendizaje automático?

### F5-11 · ABC y rotación
- **Objetivo:** se clasifican productos por su aporte.
- **Conceptos:** [dbt]
- **Claude / tú:** Claude revisa. Tú escribes modelo y reporte.
- **Pruebas:** totales conocidos.
- **Criterios:** cumple RF-086.
- **Depende de:** F5-02 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿Qué es la clase A? (2) ¿Valor o unidades? (3) ¿Cómo se calcula la rotación?
- **Entrevista:** (1) ¿Cómo escribes este análisis en SQL? (2) ¿Cómo lo presentas a un dueño?

## Hito F5-D: Contabilidad

### F5-12 · Catálogo de cuentas y pólizas
- **Objetivo:** cada corte genera una póliza con código agrupador del SAT.
- **Conceptos:** [Libro inmutable]
- **Claude / tú:** Claude revisa. Tú escribes catálogo y generación con el contador.
- **Pruebas:** partida doble siempre cuadrada.
- **Criterios:** cumple RF-085 en pólizas.
- **Depende de:** E1-38 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Qué es partida doble? (2) ¿Qué es el código agrupador? (3) ¿Cómo corriges una póliza?
- **Entrevista:** (1) ¿Cómo modelas contabilidad en SQL? (2) ¿Qué invariante protege?

### F5-13 · Balanza y estado de resultados
- **Objetivo:** el sistema emite balanza y estado de resultados.
- **Conceptos:** [Agregaciones SQL]
- **Claude / tú:** Claude revisa. Tú escribes reportes y validas con el contador.
- **Pruebas:** periodo cerrado y totales.
- **Criterios:** cumple RF-085 en reportes.
- **Depende de:** F5-12 · **Estimación:** 6 h
- **Autoevaluación:** (1) ¿Qué muestra la balanza? (2) ¿Qué es cierre de periodo? (3) ¿Qué pasa con cambios tardíos?
- **Entrevista:** (1) ¿Cómo cierras un periodo? (2) ¿Cómo garantizas exactitud?

### F5-14 · IVA y exportación
- **Objetivo:** el contador recibe el IVA y un archivo para su sistema.
- **Conceptos:** [Apache POI]
- **Claude / tú:** Claude revisa. Tú escribes el reporte con lo que pida el contador.
- **Pruebas:** totales contra CFDI.
- **Criterios:** el contador lo importa sin ajustes.
- **Depende de:** F5-13 · **Estimación:** 4 h
- **Autoevaluación:** (1) ¿IVA cobrado o causado? (2) ¿Qué formato pide? (3) ¿Cómo validas?
- **Entrevista:** (1) ¿Cómo diseñas exportaciones? (2) ¿Cómo manejas cambios de formato?

### F5-15 · Evaluación de sugerencias
- **Objetivo:** un conjunto fijo detecta si la calidad empeora.
- **Conceptos:** [Evaluaciones de Claude]
- **Claude / tú:** Claude revisa criterios. Tú escribes casos y calificación.
- **Pruebas:** corre en CI, sin depender de la red para lo determinista.
- **Criterios:** un cambio de prompt o modelo se compara antes de publicar.
- **Depende de:** F5-07 · **Estimación:** 3 h
- **Autoevaluación:** (1) ¿Qué mide? (2) ¿Qué es no determinista? (3) ¿Cómo eliges casos?
- **Entrevista:** (1) ¿Cómo evalúas prompts? (2) ¿Cómo evitas regresiones con LLM?

[Redpanda]: https://docs.redpanda.com/
[DuckDB]: https://duckdb.org/docs/
[Polars]: https://docs.pola.rs/
[dbt]: https://docs.getdbt.com/
[scikit-learn]: https://scikit-learn.org/stable/
[FastAPI]: https://fastapi.tiangolo.com/
[API de Claude]: https://docs.claude.com/
[Prompt caching]: https://docs.claude.com/en/docs/build-with-claude/prompt-caching
[Next.js]: https://nextjs.org/docs
[Libro inmutable]: https://martinfowler.com/eaaDev/AccountingEntry.html
[Agregaciones SQL]: https://www.postgresql.org/docs/16/tutorial-agg.html
[Apache POI]: https://poi.apache.org/
[Evaluaciones de Claude]: https://docs.claude.com/en/docs/test-and-evaluate/develop-tests
