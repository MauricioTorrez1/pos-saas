# ADR 0017: n8n con SQLite y dbt v2 OSS bajo pedido

Estado: Aceptada · Fecha: 2026-11-03.

## Contexto
F0-06 agrega los perfiles `automation` y `analytics`, y cada uno debe arrancar sin exigir los demás. Ningún documento decía dónde guarda n8n sus datos, qué versión de dbt usar ni cuándo corre dbt. Además, dbt ya instala su v2 de forma predeterminada, y existe en dos paquetes con licencias distintas.

## Opciones
**Datos de n8n**
1. **SQLite en un volumen propio.** El perfil arranca solo. Hay que respaldar ese volumen aparte y migrar la base si n8n llega a producción.
2. **Base propia en PostgreSQL.** Se respaldaría con el resto, igual que Keycloak (ADR 0016), pero exigiría encender `core` y rompería el criterio de la tarea.

**Versión de dbt**
1. **dbt Core 1.12.** Todas sus piezas quedan en `uv.lock`, pero las funciones nuevas llegarán solo a la v2.
2. **dbt v2, paquete `dbt`.** Trae análisis de SQL, `dbt lint` y soporte para editores. Usa un contrato de licencia propio, que se acepta al descargarlo, y activa la telemetría de forma predeterminada.
3. **dbt v2, paquete `dbt-oss`.** Licencia Apache 2.0 y los comandos estándar, sin aquellas funciones adicionales.

**Cuándo corre dbt**
1. **Bajo pedido.** No gasta RAM ni tiempo al encender el perfil, y una prueba rota no detiene la API. Hay que acordarse de correrlo.
2. **Al encender el perfil.** Los datos quedan al día sin pensarlo, a cambio de arranques más lentos y de decidir qué hace la API cuando falla una prueba.

## Decisión
n8n guarda sus datos en SQLite, en el volumen `n8n-data`, y usa la versión que n8n marca como `stable`, no el número más alto, porque sus prereleases se publican en Docker con etiquetas de aspecto normal.

Mauricio eligió dbt v2. Se usa el paquete `dbt-oss` porque no requiere aceptar un contrato propietario y no se necesitan sus funciones adicionales. Corre en Docker, bajo pedido, con `docker compose run --rm dbt build`, y sin telemetría.

Los trabajos `Compose automation` y `Compose analytics` corren en cada PR, sin filtros de ruta, como indica el ADR 0016. Las pruebas de dbt corren dentro de `Compose analytics`.

## Consecuencias
- `uv.lock` fija el paquete fuente de `dbt-oss`, que descarga el programa desde GitHub y verifica su SHA-256. El controlador de DuckDB se descarga de `public.cdn.getdbt.com` al construir la imagen, y después dbt corre sin red.
- `dbt-oss` no puede compartir entorno con `dbt` ni con `dbt-core`.
- Si dbt falla por un dato, el dato queda en el volumen hasta el siguiente `dbt build` con datos correctos.
- Las pruebas unitarias de dbt solo aceptan tipos primitivos, así que `stg_sales` convierte los UUID a texto.
- Dependabot ignora los saltos mayores de n8n y de Python. Antes de fusionar una actualización de n8n hay que revisar que `stable` apunte a esa versión.
- **Licencia de n8n por revisar antes de la Fase 4.** Su Sustainable Use License permite el uso interno del propio negocio y limita ofrecerlo a terceros. La publicación en redes de la tlapalería (RF-068) parece encajar, pero conectar las cuentas de otros negocios en el SaaS puede requerir otra licencia o reemplazar n8n. Esta lectura no es asesoría legal.
