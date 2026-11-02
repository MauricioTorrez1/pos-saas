# ADR 0008: Spring Boot 4.1 en lugar de 3

Estado: Aceptada · Fecha: 2026-11-02 · Modifica la especificación y `CLAUDE.md`.

## Contexto
Fuentes secundarias indican que el soporte open source de Spring Boot 3.5 terminó el 30 de junio de 2026, y que la línea 4.1 tiene soporte hasta julio de 2027. La página oficial de Spring muestra 4.1.2 como versión actual, pero no pude leer su tabla de fechas.

## Opciones
1. **Spring Boot 3.5.** Más tutoriales, sin parches gratuitos.
2. **Spring Boot 4.1.** Con soporte, con menos ejemplos disponibles.

## Decisión
Spring Boot 4.1 con Java 21. La primera tarea del núcleo confirma las fechas de soporte y la versión compatible de Spring Modulith; si hay incompatibilidad, se documenta aquí antes de seguir.

## Consecuencias
- Código de portafolio en una versión vigente.
- Algunos tutoriales de Boot 3 necesitarán adaptación.
- Hay que planear la subida de versión antes de que termine el soporte de 4.1.
