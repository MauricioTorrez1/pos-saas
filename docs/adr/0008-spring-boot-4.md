# ADR 0008: Spring Boot 4.1 en lugar de 3

Estado: Aceptada · Fecha: 2026-11-02 · Modifica la especificación y `CLAUDE.md`.

## Contexto
Fuentes secundarias indican que el soporte open source de Spring Boot 3.5 terminó el 30 de junio de 2026, y que la línea 4.1 tiene soporte hasta julio de 2027. La página oficial de Spring muestra 4.1.2 como versión actual, pero no pude leer su tabla de fechas.

## Opciones
1. **Spring Boot 3.5.** Más tutoriales, sin parches gratuitos.
2. **Spring Boot 4.1.** Con soporte, con menos ejemplos disponibles.

## Decisión
Spring Boot 4.1 con Java 21. La primera tarea del núcleo confirma las fechas de soporte y la versión compatible de Spring Modulith; si hay incompatibilidad, se documenta aquí antes de seguir.

## Confirmación (F0-07, 2026-11-03)
Mauricio confirmó estas fechas en la [tabla de soporte de Spring](https://spring.io/projects/spring-boot#support):

| Línea | Salida | Fin del soporte OSS | Fin del soporte enterprise |
| --- | --- | --- | --- |
| 3.5.x | 2025-05 | 2026-06 | 2032-06 |
| 4.1.x | 2026-06 | 2027-07 | 2028-07 |
| 4.2.x | 2026-11 | 2027-12 | 2028-12 |

Spring Modulith 2.1.2 está [compilado contra Spring Boot 4.1.2](https://repo1.maven.org/maven2/org/springframework/modulith/spring-modulith-core/2.1.2/spring-modulith-core-2.1.2.pom), y las pruebas del núcleo pasan con esa pareja. Cada línea de Modulith va con una de Boot, así que se suben juntas. La [tabla de compatibilidad](https://docs.spring.io/spring-modulith/reference/appendix.html) de Modulith llega solo a la 2.0, por eso no sirve como fuente.

## Consecuencias
- Código de portafolio en una versión vigente.
- Algunos tutoriales de Boot 3 necesitarán adaptación.
- Dependabot propondrá 4.2 junto con Modulith 2.2. Cambiar de línea se decide con un ADR nuevo, aunque CI esté en verde.
- Hay que subir de línea antes del 31 de julio de 2027, cuando termina el soporte OSS de 4.1.
