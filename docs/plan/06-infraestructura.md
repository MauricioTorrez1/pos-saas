# Infraestructura

## Entornos
| Entorno | Dónde | Datos | Uso |
| --- | --- | --- | --- |
| Local | Docker Compose con perfiles | Sintéticos | Desarrollo |
| Producción | Núcleo en Cloud Run, PostgreSQL en Supabase Free, respaldos en Cloudflare R2 ([ADR 0081](../adr/0081-nucleo-en-cloud-run-y-base-en-supabase.md)) | Reales | Tienda |

Con costo de $0 no hay staging: el entorno `production` de GitHub, con aprobación manual, es el freno antes de cada despliegue. Es un riesgo aceptado hasta tener un segundo negocio. En producción solo corre el núcleo; el resto del stack sigue en Docker Compose local (ADR 0013).

## Perfiles de Docker Compose
| Perfil | Servicios | Cuándo |
| --- | --- | --- |
| `core` | PostgreSQL 16, Keycloak, Redis, Redpanda, núcleo | Siempre |
| `observability` | Colector OpenTelemetry, Prometheus, Loki, Tempo, Grafana | Al diagnosticar |
| `automation` | n8n | Al trabajar con WhatsApp y redes |
| `analytics` | FastAPI, y dbt con DuckDB bajo pedido | Al trabajar con datos |

Tu PC tiene 16 GB de RAM: levanta solo lo que uses. Docker Desktop ve 7.6 GiB de esos 16 GB, y el perfil `core`, todavía sin el núcleo, usa unos 900 MiB en reposo ([medición](../../infra/compose/README.md#measured-resources)).

## CI/CD con GitHub Actions
1. **Cada PR:** compila, formatea, corre pruebas (JUnit y Testcontainers, Vitest, pytest), verifica módulos, corre casos compartidos, y escanea secretos y dependencias.
2. **Merge a `main`:** construye imágenes, las sube a GitHub Container Registry y despliega en staging.
3. **Etiqueta de versión:** despliega en producción tras aprobación manual, y publica el instalador de la caja.
4. **Migraciones:** corren con Flyway antes de arrancar la versión nueva y con el rol `app_migrator`.

## Terraform
`infra/terraform` define Cloud Run, Artifact Registry, Secret Manager, la federación de identidades con GitHub, el proyecto de Supabase y el bucket R2 (ADR 0081). El estado vive fuera de Git: local o en un bucket de Cloud Storage con versiones. La guía del dueño está en [docs/despliegue-en-la-nube.md](../despliegue-en-la-nube.md).

## Observabilidad
- **Trazas, métricas y logs:** OpenTelemetry hacia Tempo, Prometheus y Loki, con tableros en Grafana versionados en Git.
- **Errores:** Sentry en núcleo, panel y caja, sin datos personales.
- **Alertas iniciales:** núcleo caído, sincronización atrasada más de 1 hora, respaldo fallido, disco arriba de 80%, y errores de Facturapi o Mercado Pago.
- **Caja sin internet:** guarda logs locales y sube sus errores al reconectar.

## Secretos
- `.env.example` sin valores reales, y `.env` en `.gitignore`.
- Secretos de CI en GitHub Actions. En producción, en Secret Manager, legibles solo por la cuenta de servicio del núcleo.
- Llaves de terceros por negocio, cifradas en la base con una llave maestra fuera de ella.
- Rotación documentada, y revocación inmediata si hay una filtración.

## Respaldos
| Qué | Frecuencia | Retención | Dónde |
| --- | --- | --- | --- |
| PostgreSQL | Diario, con cifrado | 30 días | Almacenamiento externo al servidor |
| Keycloak | Diario, con su base | 30 días | Igual |
| Caja (SQLite) | Cada hora | 7 días | USB u otro dispositivo en la tienda |
| Terraform | Por versión | Indefinida | Estado remoto |

Se ensaya una restauración cada trimestre, porque un respaldo sin probar no es un respaldo.

## Costos mensuales estimados
Cifras aproximadas en MXN, confirmadas en F0-24 (ADR 0081).

| Concepto | Fase 0 | Entregas 1 y 2 | Fase 2 y 3 | Fase 4 y 5 |
| --- | --- | --- | --- | --- |
| Servidor (Cloud Run y Supabase) | $0 en nivel gratuito | $0 en nivel gratuito | Supabase Pro si pasa de 500 MB (~$500) | Se recalcula al migrar |
| Dominio (opcional: Cloud Run da HTTPS en `*.run.app`) | $0 | ~$25 | ~$25 | ~$25 |
| Almacenamiento de respaldos (R2, 10 GB gratis) | $0 | $0 | ~$20 | ~$100 |
| Sentry y correo | $0 en nivel gratuito | $0 en nivel gratuito | Por revisar | Por revisar |
| Facturapi, lo paga el negocio | $0 en modo de prueba | $299 + $0.60 por timbre | Igual | Sigue el modelo por negocio |
| Comisiones de Mercado Pago | $0 | Por venta | Por venta | Por negocio |
| WhatsApp, lo paga el negocio | $0 | $0 | Por mensaje | Por negocio |
| API de Claude | $0 | $0 | $0 | Por uso, con límite |

### Servidor: resuelto en F0-24
El VPS de 16 GB excedía el presupuesto. El dueño eligió servicios administrados en nivel gratuito, con $0 al mes: Cloud Run para el núcleo, Supabase Free para PostgreSQL y Cloudflare R2 para los respaldos. Los límites y el camino de crecimiento están en el [ADR 0081](../adr/0081-nucleo-en-cloud-run-y-base-en-supabase.md).

## Requisitos de la PC de la tienda
Mínimo: Windows 10 o 11 de 64 bits, 4 GB de RAM, 20 GB libres de disco, y USB para impresora y lector. Recomendado: 8 GB de RAM y SSD. Antes de instalar, hay que revisar sus especificaciones y que reciba actualizaciones de seguridad.

## Red de la tienda
Lo más estable es cable Ethernet hasta un router o punto de acceso en la tienda, con una red solo para el negocio. La terminal conserva su propio 4G. Cada negocio debe revisar que su contrato de internet permita uso comercial.
