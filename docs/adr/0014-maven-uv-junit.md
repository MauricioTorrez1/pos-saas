# ADR 0014: Maven, uv y JUnit 6

Estado: Aceptada · Fecha: 2026-11-02 · Modifica `CLAUDE.md`.

## Contexto
El CI de F0-02 necesita compilar y probar Java y Python, pero ningún documento elegía cómo construir el núcleo ni cómo manejar las dependencias de Python. Además, `CLAUDE.md` pedía JUnit 5, mientras que Spring Boot 4.1.2 gestiona JUnit 6.0.3.

## Opciones
**Java**
1. **Maven con wrapper.** Configuración declarativa y muy común en vacantes empresariales. El wrapper de solo scripts no agrega binarios al repositorio.
2. **Gradle con Kotlin DSL.** Compilaciones incrementales más rápidas y un build más flexible, con más que aprender y un JAR binario en el repositorio.

**Python**
1. **uv con `uv.lock`.** Consigue el intérprete por su cuenta y congela versiones con hashes.
2. **pip con `requirements.txt`.** Viene con Python, pero no tiene lockfile nativo.

**Pruebas en Java**
1. **JUnit 6.** Es la versión que traerá Spring Boot en F0-07.
2. **JUnit 5.** Habría que forzarla contra lo que gestiona Spring Boot o cambiarla en F0-07.

## Decisión
Maven 3.9 con wrapper de solo scripts y checksum de la distribución, uv con `uv.lock`, y JUnit 6.

## Consecuencias
- Nadie necesita instalar Maven: basta con el JDK 21 y `mvnw`.
- `mvnw` debe conservar su bit de ejecución en Git, porque Windows no lo guarda por sí solo.
- CI usa `uv sync --locked`, igual que `pnpm install --frozen-lockfile`: un lockfile desactualizado rompe el trabajo.
- Las versiones de JUnit y de los plugins de Maven coinciden con Spring Boot 4.1.2, así que F0-07 debe revisarlas si elige otra versión.
- El wrapper baja un `.tar.gz` si falta `unzip`, y el checksum, calculado para el `.zip`, falla. Los runners de GitHub y Git Bash traen `unzip`.
