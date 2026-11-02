# Diagramas del sistema de punto de venta

Diagramas en Mermaid: GitHub los dibuja automáticamente al abrir este archivo.

## 1. Arquitectura general

```mermaid
flowchart TB
  subgraph Tienda["Tienda · funciona sin internet"]
    direction LR
    HW["Lector · impresora<br/>cajón · báscula"] --- POS["Caja<br/>Electron + React + SQLite"]
    MP["Terminal Mercado Pago<br/>Point Smart 2"]
  end
  subgraph Nube["Nube"]
    direction LR
    AUTH["Keycloak<br/>usuarios y roles"] -.-> API["Núcleo · Java 21 + Spring Boot<br/>ventas · inventario · caja · facturas"]
    API --- DB[("PostgreSQL<br/>negocios separados por fila")]
    API --> BUS["Eventos<br/>outbox → Kafka"] --> AI["Analítica e IA<br/>Python + FastAPI"] --> WH[("dbt + DuckDB")]
    AI -->|"sugerencias"| API
  end
  subgraph Externos["Servicios externos"]
    direction LR
    MPO["Mercado Pago<br/>Orders API"]
    FAC["Facturapi<br/>CFDI 4.0"]
  end
  subgraph Canales["Canales"]
    direction LR
    WEB["Panel y tienda web<br/>React / Next.js"]
    N8N["n8n"] --> META["Facebook e Instagram"]
    WA["WhatsApp Cloud API"] <--> N8N
  end
  POS <-->|"sincroniza cuando hay internet"| API
  API <--> MPO <--> MP
  API --> FAC
  WEB --> API
  N8N <--> API
```

## 2. Venta en caja

```mermaid
flowchart TD
  A([Inicia venta]) --> B{¿Cómo entra el producto?}
  B -->|código de barras| C[Escanea]
  B -->|a granel| D[Peso de la báscula<br/>o metros de cable]
  B -->|sin código| E[Busca por nombre]
  C & D & E --> F[Agrega al carrito con su unidad]
  F --> G{¿Más productos?}
  G -->|sí| B
  G -->|no| H[Motor de promociones aplica reglas<br/>desde fase 3; antes no hace nada]
  H --> N[Guarda la venta en SQLite como pending_payment<br/>con UUID y llave de idempotencia]
  N --> I{Forma de pago}
  I -->|efectivo| J[Calcula el cambio]
  I -->|tarjeta| K[[Cobro en terminal<br/>tecleado o integrado]]
  I -->|transferencia| L[Registra referencia]
  I -->|mixto| M[Divide el total entre formas de pago]
  J & K & L & M --> O[Confirma como completed<br/>y registra movimientos de inventario]
  O --> T{¿Hubo efectivo?}
  T -->|sí| U[Abre cajón]
  T -->|no| P[Imprime ticket]
  U --> P
  P --> Q{¿Pide factura?}
  Q -->|sí| R[Factura al sincronizar<br/>o QR de autofactura en el ticket]
  Q -->|no| S([Fin])
  R --> S
```

## 3. Cobro con tarjeta (Mercado Pago Point)

```mermaid
sequenceDiagram
  autonumber
  participant C as Caja
  participant N as Núcleo (nube)
  participant M as Mercado Pago (Orders API)
  participant T as Terminal Point Smart 2
  C->>N: Cobrar total con tarjeta (UUID de la venta)
  N->>M: Crea orden para la terminal (llave de idempotencia)
  M-->>T: La terminal muestra el monto
  T->>M: El cliente paga con su tarjeta
  M-->>N: Webhook: aprobado o rechazado
  N-->>C: Resultado en tiempo real
  alt Aprobado
    C->>C: Cierra la venta e imprime ticket
  else Rechazado
    C->>C: Pide otra forma de pago
  end
  Note over C,T: Respaldo sin internet por confirmar en la tarea E2-01: no está documentado si la terminal integrada acepta cobros tecleados. Hasta la Entrega 2, la terminal queda en modo normal y el cajero captura el folio.
```

## 4. Modo sin internet y sincronización

```mermaid
sequenceDiagram
  participant UI as Caja (pantalla)
  participant L as SQLite local
  participant S as Sincronizador
  participant N as Núcleo (nube)
  UI->>L: Guarda venta y movimientos (pendiente)
  loop Cada pocos segundos o al volver el internet
    S->>L: Lee pendientes en orden
    S->>N: Envía lote con llaves de idempotencia
    N-->>S: Aceptados (los repetidos se ignoran)
    S->>L: Marca como sincronizados
    S->>N: Pide cambios desde el último cursor
    N-->>S: Catálogo, precios y promociones nuevas
    S->>L: Aplica cambios (manda el servidor)
  end
  Note over S,N: La existencia es la suma de movimientos:<br/>ventas de varias cajas hechas sin internet<br/>se juntan sin conflicto.
```

## 5. Pedidos por WhatsApp o web

```mermaid
flowchart TD
  A[Cliente pide por WhatsApp o tienda web] --> B[Consulta existencias]
  B --> C{¿Hay existencias?}
  C -->|no| D[Ofrece alternativa<br/>o aviso cuando llegue]
  C -->|sí| E[Reserva el inventario por tiempo limitado]
  E --> F[Link de pago Mercado Pago]
  F --> G{¿Pagó?}
  G -->|no, venció| H[Libera la reserva]
  G -->|sí| I[Venta confirmada<br/>descuenta inventario]
  I --> J{Entrega}
  J -->|domicilio| K[Ruta y aviso por WhatsApp]
  J -->|recoger| L[Aviso: listo en mostrador]
  K & L --> M[Pide reseña]
```

## 6. Corte de caja

```mermaid
flowchart TD
  A([Apertura con fondo de caja]) --> B[Ventas, entradas y salidas de efectivo]
  B --> C{¿Efectivo arriba del límite?}
  C -->|sí| D[Aviso: retiro parcial a caja fuerte]
  D --> B
  C -->|no| E{¿Fin de turno o corte programado?}
  E -->|no| B
  E -->|sí| F[El sistema calcula lo esperado<br/>por forma de pago]
  F --> G[El cajero cuenta el efectivo<br/>por denominación]
  G --> H{¿Cuadra?}
  H -->|sí| I[Cierra el turno]
  H -->|no| J[Registra diferencia y motivo<br/>alerta al dueño]
  J --> I
  I --> K[Reporte al dueño por correo<br/>WhatsApp desde fase 3 y póliza contable en fase 5]
```

## 7. Recomendación de promociones

```mermaid
flowchart TD
  V[Ventas e inventario] & T[Temporadas] & M[Costos y margen mínimo] --> A[Servicio de IA en Python]
  A --> A1[Lento movimiento → rebaja]
  A --> A2[Se compran juntos → combo]
  A --> A3[Temporada → promoción anticipada]
  A1 & A2 & A3 --> F{¿Respeta el margen mínimo?}
  F -->|no| X[Se descarta]
  F -->|sí| S[Sugerencia con explicación redactada por Claude]
  S --> R{¿El dueño aprueba?}
  R -->|no| X
  R -->|sí| P[Regla JSON activa en caja, web y WhatsApp]
  P --> PUB[Publicación automática en redes]
  P --> MED[Mide el resultado contra lo esperado]
  MED -->|aprende| A
```

## 8. Orden de reparación

```mermaid
stateDiagram-v2
  state "Recibido (folio y fotos)" as Recibido
  state "En diagnóstico" as Diagnostico
  state "Cotizado" as Cotizado
  state "En reparación" as Reparacion
  state "Esperando refacción" as Espera
  state "Listo" as Listo
  state "Entregado (cobro y garantía)" as Entregado
  state "Devuelto (cobra diagnóstico)" as Devuelto
  [*] --> Recibido
  Recibido --> Diagnostico
  Diagnostico --> Cotizado: aviso por WhatsApp
  Cotizado --> Reparacion: el cliente aprueba
  Cotizado --> Devuelto: no aprueba
  Reparacion --> Espera: falta pieza
  Espera --> Reparacion: llega la pieza (descuenta inventario)
  Reparacion --> Listo: aviso por WhatsApp
  Listo --> Entregado
  Entregado --> [*]
  Devuelto --> [*]
```
