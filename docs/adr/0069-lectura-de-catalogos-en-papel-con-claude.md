# ADR 0069: Lectura de catálogos de proveedor en papel con Claude

Estado: Aceptada · Fecha: 2026-11-18 · Concreta E1-53. Se apoya en los ADR 0011 (dinero en enteros), 0039 y 0042 (sesión del panel y roles) y 0064 (pantallas del panel). Produce el CSV que importa la lista de precios del proveedor de E1-51 (ADR 0068).

## Contexto
Muchos proveedores de la tienda solo entregan un catálogo impreso. Capturar cada línea a mano en la caja es lento y propicia errores. El dueño quiere tomar fotos de las hojas y que el sistema le proponga las filas para revisarlas e importarlas en la caja.

## Decisiones

**Dónde se lee.** El servicio de analítica (`services/analytics`, Python) tiene `POST /catalog-pages/read`. La foto llega como el cuerpo crudo de la petición (`image/jpeg` o `image/png`), sin multipart, así que nunca se escribe a disco. Se rechaza si pesa más de 5 MB (el límite de una imagen en la API de Claude) o si sus primeros bytes no son de JPEG o PNG. El panel la achica en el navegador a 2000 px por lado antes de mandarla, para que las fotos del celular quepan.

**Quién puede.** Solo el dueño, porque cada hoja cuesta dinero. El servicio no tiene usuarios propios: le pregunta al núcleo `GET /me` con el mismo token del panel (variable `ANALYTICS_CORE_API_URL`) y deja pasar solo `role = owner`. Si el núcleo no contesta, o la variable falta, responde 503: falla cerrado. El navegador nunca habla con el servicio: la ruta `POST /catalog/paper/read` del panel reenvía la foto con el token de la sesión, y además rechaza peticiones de otro origen (`Origin`) para que otro sitio no gaste el crédito del dueño. `/catalog/paper` está en la tabla de rutas del panel solo para el dueño.

**Modelo.** `claude-opus-5-5` por defecto, configurable con `CATALOG_READER_MODEL`. Es el modelo más capaz de la línea Opus y el más barato de esa línea ($4 de entrada y $20 de salida por millón de tokens). Leer tablas mal impresas, con columnas pegadas y precios con o sin IVA, pide buen juicio visual; un error de precio cuesta más que la llamada. Se usa con `effort: "medium"`, salida estructurada (`output_config.format` con esquema JSON) y `fallbacks: "default"`, que reintenta en otro modelo si el primero se niega por política. La llave sale solo de `ANTHROPIC_API_KEY` del entorno; sin ella el servicio responde 503 `reader_not_configured`.

**Costo por hoja.** Una foto de 2000 px son unos 2,000 a 5,000 tokens de entrada con las instrucciones; la respuesta (razonamiento y JSON de unas 40 líneas) son unos 3,000 a 8,000 tokens de salida. Eso da entre 0.07 y 0.18 dólares por hoja, unos 1.5 a 3.5 pesos. La respuesta trae `usage` con los tokens reales para medirlo en la tienda; si el costo real se aleja de esta estimación, se ajusta `effort` o el modelo con la variable, sin cambiar código.

**Claude copia, Python decide.** El modelo copia el precio tal como está impreso (`price_text`) y nunca calcula. Python lo convierte a millonésimas de peso con enteros: acepta `$1,234.50`, pero `12,50`, `1.234,50` o más de seis decimales salen como dudosos. El modelo además marca lo que no pudo leer (precio borroso, varias líneas mezcladas, varios precios, IVA dudoso) y su confianza. Cada fila sale con `issues`: `price_unreadable`, `price_format_unclear`, `price_includes_vat`, `vat_unclear`, `multiple_prices`, `merged_lines`, `text_unclear`, `code_missing`, `pieces_missing` y `low_confidence`. `cost_e6` viaja como texto de dígitos para que JavaScript nunca lo guarde en un `double`.

**Un humano aprueba cada fila.** Un precio mal leído llega al costo, al margen y a los pedidos. Por eso el panel muestra la foto junto a sus filas, pinta de amarillo las dudosas, y el dueño edita, elimina o aprueba cada una. Ninguna fila entra al CSV sin aprobarla, ni siquiera las limpias, y no se aprueba una fila sin código, descripción, piezas y costo válidos. El CSV usa las columnas acordadas con E1-51, `supplier_code,description,purchase_unit,pieces_per_unit,cost` (costo en pesos sin IVA, hasta seis decimales), para que la caja lo importe en su lista de precios del proveedor.

**Privacidad y retención.** Nada se guarda del lado del servidor. La foto y las filas viven en la memoria de esa petición del servicio y de la ruta del panel, y no se registran en los logs. La revisión vive solo en la memoria de la página del navegador: al cerrarla se pierde todo, y la página avisa antes de salir. La foto sí viaja a Anthropic para leerla; según sus condiciones comerciales de la API, no la usa para entrenar y la retiene un tiempo limitado. Un catálogo impreso de proveedor no tiene datos personales de clientes. Si algún día se requiere retención cero, se pide a Anthropic para la organización y no cambia el código.

## Alternativas descartadas
- **OCR tradicional (Tesseract) y reglas:** gratis, pero se pierde con tablas sin líneas, columnas mezcladas y precios con IVA. Habría que escribir reglas por proveedor.
- **Guardar las fotos y filas en el núcleo:** permitiría retomar una revisión, pero obliga a cuidar fotos en el servidor sin necesidad. Se puede agregar después con su propio ADR.
- **Aprobar en automático las filas sin dudas:** más rápido, pero un error silencioso en un precio es justo lo que la revisión evita.
- **Validar el JWT en el servicio de analítica:** el rol vive en `app_user` del núcleo y no en el token, así que habría que preguntar al núcleo de todos modos.

## Consecuencias
- El dueño necesita una llave de la API de Claude en el servicio de analítica y la dirección del núcleo; el panel, la dirección del servicio (`PANEL_ANALYTICS_API_URL`).
- Las pruebas usan un cliente falso y no tocan la red: pytest del lector, de la conversión de precios y del endpoint; Vitest de las filas y el CSV; Playwright del flujo completo contra un servicio falso.
- Falta probarlo con un catálogo real de la tienda y medir el costo real por hoja.
