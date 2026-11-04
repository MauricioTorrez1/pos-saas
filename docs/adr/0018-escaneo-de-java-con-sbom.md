# ADR 0018: Escaneo de Java con la lista real de Maven

Estado: Aceptada · Fecha: 2026-11-03 · Modifica el [ADR 0015](0015-escaneo-de-seguridad.md).

## Contexto
Al cerrar F0-07, el log de `Dependency scan` decía `pom.xml ... found 5 packages` y `Filtered 5 local/unscannable package/s`, y terminaba con `No known vulnerabilities`. Las pruebas con OSV-Scanner 2.7.0 mostraron esto:

- Los 5 paquetes descartados son las 5 dependencias del `pom.xml`. Ninguna escribe su versión porque la hereda de Spring Boot, y el escáner descarta un paquete sin versión sin fallar.
- Escanear la carpeta, o usar `--data-source=native` y `--maven-registry`, da el mismo resultado. La documentación dice que las transitivas se resuelven por defecto, pero aquí no ocurrió.

Java no tenía cobertura y el check se veía en verde. Lo más probable es que fuera así desde F0-03, porque JUnit tampoco escribía su versión.

## Opciones
1. **Maven genera un SBOM (lista de materiales del software) en formato CycloneDX, y OSV-Scanner lo lee.** Trae las transitivas con versión exacta, y Spring Boot ya configura el plugin y gestiona su versión. A cambio, el trabajo necesita Java y tarda más.
2. **Escribir las versiones en `pom.xml`.** No necesita Java, pero solo cubre 5 paquetes directos, y esas versiones se pueden desalinear de las de Spring Boot.
3. **Enviar las dependencias a GitHub con su API.** Dependabot avisaría de las transitivas, pero el workflow necesita permiso de escritura y no da un check en CI.

## Decisión
Opción 1. `scripts/scan-dependencies.sh` corre Maven hasta `generate-resources` y le pasa el SBOM a OSV-Scanner. Además, el script falla si el escáner descarta un paquete, para que un hueco así no vuelva a parecer un resultado limpio.

## Consecuencias
- En local, el escáner pasó de 0 a 57 paquetes de Java.
- El SBOM no incluye dependencias de prueba como JUnit, porque no llegan a producción.
- Spring Boot guarda el SBOM dentro del JAR y ofrece `/actuator/sbom`. Queda cerrado, porque solo se expone `health`, y no debe abrirse al público porque muestra versiones exactas.
- La protección busca el texto `local/unscannable` en la salida del escáner. Al subir OSV-Scanner a mano (ADR 0015), hay que comprobar que siga apareciendo, escaneando un `pom.xml` sin versiones.
