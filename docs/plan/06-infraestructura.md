# Infraestructura

## Entornos
| Entorno | Dónde | Datos | Uso |
| --- | --- | --- | --- |
| Local | Docker Compose con perfiles | Sintéticos | Desarrollo |
| Staging | Servidor con el stack completo o por perfiles | Sintéticos | Pruebas de integración y demostraciones |
| Producción | Servidor con respaldos | Reales | Tienda |

Mientras el presupuesto no alcance para dos servidores, staging y producción comparten equipo con bases y dominios separados. Es un riesgo aceptado hasta tener un segundo negocio.

## Perfiles de Docker Compose
| Perfil | Servicios | Cuándo |
| --- | --- | --- |
| `core` | PostgreSQL 16, Keycloak, Redis, Redpanda, núcleo | Siempre |
| `observability` | Colector OpenTelemetry, Prometheus, Loki, Tempo, Grafana | Al diagnosticar |
| `automation` | n8n | Al trabajar con WhatsApp y redes |
| `analytics` | FastAPI, dbt, DuckDB | Al trabajar con datos |

Tu PC tiene 16 GB de RAM: levanta solo lo que uses.

## CI/CD con GitHub Actions
1. **Cada PR:** compila, formatea, corre pruebas (JUnit y Testcontainers, Vitest, pytest), verifica módulos, corre casos compartidos, y escanea secretos y dependencias.
2. **Merge a `main`:** construye imágenes, las sube a GitHub Container Registry y despliega en staging.
3. **Etiqueta de versión:** despliega en producción tras aprobación manual, y publica el instalador de la caja.
4. **Migraciones:** corren con Flyway antes de arrancar la versión nueva y con el rol `app_migrator`.

## Terraform
El repositorio define servidor, firewall y DNS en `infra/terraform`, con estado remoto cifrado fuera de Git. El proveedor se elige en la tarea F0-24.

## Observabilidad
- **Trazas, métricas y logs:** OpenTelemetry hacia Tempo, Prometheus y Loki, con tableros en Grafana versionados en Git.
- **Errores:** Sentry en núcleo, panel y caja, sin datos personales.
- **Alertas iniciales:** núcleo caído, sincronización atrasada más de 1 hora, respaldo fallido, disco arriba de 80%, y errores de Facturapi o Mercado Pago.
- **Caja sin internet:** guarda logs locales y sube sus errores al reconectar.

## Secretos
- `.env.example` sin valores reales, y `.env` en `.gitignore`.
- Secretos de CI en GitHub Actions. En el servidor, en archivos con permisos restringidos, fuera del repositorio.
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
Cifras aproximadas en MXN. Deben confirmarse en la tarea F0-24.

| Concepto | Fase 0 | Entregas 1 y 2 | Fase 2 y 3 | Fase 4 y 5 |
| --- | --- | --- | --- | --- |
| Servidor | Ver alerta | Ver alerta | Ver alerta | Se recalcula al migrar |
| Dominio | ~$25 | ~$25 | ~$25 | ~$25 |
| Almacenamiento de respaldos | ~$20 | ~$50 | ~$100 | ~$200 |
| Sentry y correo | $0 en nivel gratuito | $0 en nivel gratuito | Por revisar | Por revisar |
| Facturapi, lo paga el negocio | $0 en modo de prueba | $299 + $0.60 por timbre | Igual | Sigue el modelo por negocio |
| Comisiones de Mercado Pago | $0 | Por venta | Por venta | Por negocio |
| WhatsApp, lo paga el negocio | $0 | $0 | Por mensaje | Por negocio |
| API de Claude | $0 | $0 | $0 | Por uso, con límite |

### Alerta: el servidor sigue sin resolverse
Tu presupuesto de infraestructura es de $300 a $700 al mes. Las fuentes del servidor de 16 GB no coinciden:

- Un agregador listaba un CPX42 en unos 26 USD al mes, con datos previos a un ajuste de precios de abril de 2026.
- La [página oficial de Hetzner](https://www.hetzner.com/cloud/regular-performance/) muestra el CPX41 en €120.99 al mes y lo marca como no disponible.

Si ese precio oficial es correcto, el stack completo en un solo servidor excede tu presupuesto varias veces. La tarea F0-24 no se cierra hasta elegir una de estas salidas:

1. **Otro proveedor** con 16 GB dentro del presupuesto, revisando su confiabilidad.
2. **Subir el presupuesto**, si el negocio lo aprueba.
3. **Producción solo con `core`** en un servidor menor, y los demás perfiles en tu PC y en niveles gratuitos administrados. Sigue siendo stack completo para el portafolio.

## Requisitos de la PC de la tienda
Mínimo: Windows 10 o 11 de 64 bits, 4 GB de RAM, 20 GB libres de disco, y USB para impresora y lector. Recomendado: 8 GB de RAM y SSD. Antes de instalar, hay que revisar sus especificaciones y que reciba actualizaciones de seguridad.

## Red de la tienda
Lo más estable es cable Ethernet hasta un router o punto de acceso en la tienda, con una red solo para el negocio. La terminal conserva su propio 4G. Cada negocio debe revisar que su contrato de internet permita uso comercial.
