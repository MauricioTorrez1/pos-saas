# Roadmap

La ficha de cada tarea está en un archivo por fase, porque un solo documento sería difícil de leer y de mantener.

| Etapa | Resultado | Tareas | Horas | Archivo |
| --- | --- | --- | --- | --- |
| Fase 0 | Base técnica, stack completo, catálogo y panel | 26 | 108 | [fase-0.md](roadmap/fase-0.md) |
| Entrega 1 | Reemplaza a Eleventa | 44 | 185 | [entrega-1.md](roadmap/entrega-1.md) |
| Entrega 2 | Terminal integrada | 9 | 34 | [entrega-2.md](roadmap/entrega-2.md) |
| Fase 2 | Operación completa | 24 | 104 | [fase-2.md](roadmap/fase-2.md) |
| Fase 3 | Venta en línea y promociones | 19 | 93 | [fase-3.md](roadmap/fase-3.md) |
| Fase 4 | SaaS y heladería | 23 | 110 | [fase-4.md](roadmap/fase-4.md) |
| Fase 5 | IA, analítica y contabilidad | 15 | 72 | [fase-5.md](roadmap/fase-5.md) |

Las horas son estimaciones de tu tiempo: revisar, probar, operar y, desde la fase 2, escribir. Solo la Fase 0 y las Entregas 1 y 2 tienen calendario.

## Calendario estimado
Calculado con 25 horas por semana hasta diciembre y 12 desde enero. La titulación de diciembre puede reducir esas horas.

| Etapa | Inicio | Fin estimado |
| --- | --- | --- |
| Fase 0 | Noviembre 2026 | Diciembre 2026 |
| Entrega 1, construcción | Diciembre 2026 | Febrero 2027 |
| Piloto paralelo | Febrero 2027 | Febrero o marzo de 2027 |
| Entrega 2 | Marzo 2027 | Marzo o abril de 2027 |

## Orden de trabajo
Desde F0-07, el orden lo marca el [ADR 0019](../adr/0019-caja-primero.md):

1. **Tramo de caja, unas 47 horas:** F0-23, E1-01, E1-02, E1-03, E1-05, E1-06, E1-07, E1-10, E1-11, E1-13 y E1-14. Termina con una caja que vende en efectivo sin internet.
2. **Lo demás:** las tareas pendientes de Fase 0 y Entrega 1, según las dependencias de cada ficha.

Las tareas de Fase 0 y Entrega 1 se intercalan, pero el total de horas no cambia, así que el fin estimado de la Entrega 1 tampoco.

## Cómo leer una ficha
Cada tarea tiene ID, objetivo, conceptos con enlaces oficiales, reparto de trabajo, pruebas, criterios, dependencias, estimación, 3 preguntas de autoevaluación y 2 de entrevista.

**Reparto de trabajo:**
- **Hasta salir de Eleventa (Fase 0 y Entrega 1):** Claude escribe y te explica cada cambio. Tú revisas, pruebas y apruebas.
- **Desde la Entrega 2:** vuelve el modo mentor. Tú escribes la lógica y Claude prepara el andamiaje y revisa.

**Regla de término:** criterios cumplidos, pruebas en verde en CI, documentación actualizada y revisión hecha.
