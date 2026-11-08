# Monorepo y backlog

## Estructura del monorepo
```text
pos-saas/
├── apps/
│   ├── pos/                  # Caja: Electron, React, TypeScript y SQLite
│   │   ├── src/main/         # Proceso principal: hardware y base local
│   │   ├── src/preload/      # Puente seguro entre procesos
│   │   ├── src/renderer/     # Pantalla de React, sin acceso directo al hardware
│   │   ├── src/shared/       # Tipos y canales que comparten los dos lados del puente
│   │   └── e2e/              # Prueba de arranque con Playwright
│   └── web/                  # Next.js: panel desde F0 y tienda pública en F3
├── services/
│   ├── core/                 # Núcleo: Java 21, Spring Boot 4.1, Spring Modulith
│   │   └── src/main/java/.../
│   │       ├── identity/     # Negocios, cajas, usuarios y PIN
│   │       ├── catalog/      # Productos, precios y claves SAT
│   │       ├── sales/        # Ventas y devoluciones
│   │       ├── payments/     # Tarjeta tecleada y terminal integrada
│   │       ├── cash/         # Sesiones de caja y cortes
│   │       ├── inventory/    # Libro de movimientos
│   │       ├── invoicing/    # CFDI con Facturapi
│   │       ├── sync/         # Lotes, cursores y discrepancias
│   │       ├── reporting/    # Reportes y bitácora
│   │       └── ../money/     # Dinero y cantidades, fuera de los módulos (ADR 0020)
│   └── analytics/            # Python: FastAPI, Polars, dbt y DuckDB; sin reglas de negocio
├── packages/
│   ├── contracts/            # Esquemas JSON, OpenAPI y casos de cálculo compartidos
│   ├── money/                # Dinero y cantidades en TypeScript
│   └── pos-ui/               # Componentes reutilizables por la caja web de F4
├── infra/
│   ├── compose/              # Perfiles core, observability, automation y analytics
│   ├── terraform/            # Servidor, firewall y DNS, sin secretos
│   ├── keycloak/             # Realm exportado, sin secretos
│   └── grafana/              # Tableros versionados
├── scripts/                  # Revisiones que corren en local y en CI
├── docs/
│   ├── adr/                  # Decisiones de arquitectura
│   └── plan/                 # Requisitos, dominio, roadmap y progreso
├── .github/workflows/        # CI/CD
├── .env.example              # Variables sin valores reales
├── .gitattributes            # Finales de línea iguales en Windows y Linux
├── .gitignore                # Secretos, datos privados y artefactos
├── package.json              # Raíz del workspace de pnpm
├── pnpm-workspace.yaml       # Paquetes de apps/ y packages/
├── LICENSE                   # AGPL-3.0
└── README.md                 # Bilingüe
```

Fuera del repositorio siempre: `.env`, archivos de Eleventa, listas de proveedores, CSD, llaves y respaldos. Los archivos privados que necesites en esta PC van en la carpeta `private/`, que Git ignora.

## Issues en GitHub

### Milestones
| Milestone | Tareas | Horas | Crear ahora |
| --- | --- | --- | --- |
| Fase 0: Base | 25 | 107 | Sí |
| Entrega 1: Reemplazar a Eleventa | 38 | 160 | Sí |
| Entrega 2: Terminal integrada | 9 | 34 | Más adelante |
| Fase 2: Operación completa | 24 | 104 | Más adelante |
| Fase 3: Venta en línea | 19 | 93 | Más adelante |
| Fase 4: SaaS | 23 | 110 | Más adelante |
| Fase 5: IA y analítica | 15 | 72 | Más adelante |

Recomiendo crear solo los primeros dos milestones: 63 Issues. Las fases lejanas cambiarán, y 153 Issues de golpe serían ruido en un repositorio público.

### Etiquetas
- **Fase:** `phase:0`, `phase:e1`, `phase:e2`, `phase:2`, `phase:3`, `phase:4`, `phase:5`
- **Área:** `area:core`, `area:pos`, `area:web`, `area:analytics`, `area:infra`, `area:docs`
- **Tipo:** `type:feature`, `type:spike`, `type:test`, `type:chore`
- **Tamaño:** `size:s` (hasta 3 h), `size:m` (4 h), `size:l` (5 a 6 h)
- **Estado:** `blocked`

### Formato de cada Issue
- **Título:** `[F0-01] Inicializar repositorio y monorepo`, tal como aparece en [progreso.md](progreso.md).
- **Cuerpo:** objetivo, pruebas, criterios y dependencias, tomados de la ficha, con enlace a la ficha completa.
- **Rama:** `feat/f0-01-init-monorepo`.
- **PR:** uno por tarea, con `Closes #N`.

### Cómo se crearían
Nada de esto se ha ejecutado. Requiere instalar `gh` e iniciar sesión.

```bash
gh auth login
```

```bash
gh label create "phase:0" --repo MauricioTorrez1/pos-saas --color 1D76DB
```

```bash
gh api repos/MauricioTorrez1/pos-saas/milestones -f title="Fase 0: Base"
```

```bash
gh issue create --repo MauricioTorrez1/pos-saas --title "[F0-01] Inicializar repositorio y monorepo" --body-file issue.md --label "phase:0,area:infra,type:chore,size:s" --milestone "Fase 0: Base"
```

Una vez aprobada la lista, un script local leerá las fichas y hará estas llamadas. Se puede repetir sin duplicar, porque primero revisa los títulos existentes.
