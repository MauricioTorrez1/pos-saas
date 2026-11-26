# ADR 0077: Productos equivalentes entre catálogos de proveedores

Estado: Aceptada · Fecha: 2026-11-25 · Concreta E1-63. Se apoya en los ADR 0011 (dinero en enteros), 0047 (`OwnerGate`), 0068 (listas de precios y comparador) y 0069 (catálogos en papel con Claude).

## Contexto
El comparador de E1-52 agrupa por producto: solo compara dos ofertas si las dos están ligadas al mismo producto del catálogo. Pero cada proveedor escribe distinto la misma cosa: uno vende «BROCAS HSS 1/4" P/METAL» y otro «Broca de alta velocidad 6.35 mm», con códigos que no se parecen. El dueño quiere ver sus precios juntos aunque no los haya ligado a un producto y aunque no se escriban igual. Además, los catálogos escaneados casi siempre llegan en PDF y E1-53 solo leía fotos.

## Decisiones

**Las reglas corren en la caja, sin internet.** `shared/catalog-matching.ts` es código puro:
1. **Normaliza** el texto (minúsculas, sin acentos, `½` como `1/2`, `6,35` como `6.35`) y pasa cada palabra a singular (`brocas` → `broca`, `taquetes` → `taquete`, `luces` → `luz`).
2. **Sinónimos:** un diccionario de fábrica (hss = alta velocidad, galv = galvanizado, inox = inoxidable, desarmador = destornillador, rondana = arandela, taquete = ancla plástica, mecha = broca, jgo/set/kit = juego, cruz = phillips, colores en femenino…) más los que el dueño agregue en «Sinónimos» (F5). Las frases se cambian antes que las palabras, así «alta velocidad» se vuelve `hss` una sola vez.
3. **Atributos:** medidas en enteros sin `float`: largos en micrómetros (`1/4"`, `1 1/2"`, `6.35 mm`, `2 m`; una fracción sola se toma como pulgadas), calibres, volumen en ml, peso en mg, watts, volts y amperes; y las piezas de un empaque (`c/100`, `caja con 50`, `25 pzas`).
4. **Puntaje de 0 a 100:** 70 % palabras en común pesadas por qué tan raras son (IDF, frecuencia inversa) y 30 % medidas en común. Da 0 si hay **conflicto**: una medida distinta (con 1 % de tolerancia, así 1/4" = 6.35 mm pero 1/4" ≠ 6 mm) o dos materiales, usos o puntas distintas (HSS contra cobalto, madera contra concreto, phillips contra plano). Si la primera palabra (la clase de producto) cambia, el puntaje se multiplica por 0.6, para que «llave 1/2» no se junte con «broca 1/2».
5. **Propuestas:** desde 60 se propone y desde 80 se marca «Muy probable». Se comparan solo pares que comparten una palabra (y se ignoran las que aparecen en más de 1,500 artículos), y se agrupan de mayor a menor puntaje con a lo más un artículo por proveedor. Los grupos aprobados y los artículos del mismo producto empiezan juntos; dos grupos aprobados nunca se funden solos.

**El dueño decide cada propuesta.** «Productos equivalentes» (F7 en proveedores, solo el dueño) muestra cada propuesta con su puntaje, la razón («Coinciden: broca, hss, 1/4" = 6.35 mm»), una casilla por artículo y el nombre del grupo. «Aprobar», «No son iguales» y «Quitar» se guardan en `catalog_match_decision` (migración 24): una tabla **de solo agregar** (disparadores rechazan `UPDATE` y `DELETE`), con `join`, `leave`, `reject` y `name`. El estado actual sale de dos vistas que leen la última decisión de cada artículo. Cada artículo se identifica por **proveedor + código del proveedor**, no por el id del renglón, así que al reimportar la lista del proveedor el grupo y los rechazos siguen valiendo. Cada decisión va también a la bitácora (`catalog_equivalence.approve`, `.reject`, `.remove`, `catalog_synonym.add`, `.remove`).

**La IA es opcional y nunca decide.** Con internet y con `POS_ANALYTICS_URL` y `POS_ANALYTICS_TOKEN` configurados, «Pedir ayuda a la IA» (F4) manda al servicio de analítica hasta 120 artículos que las reglas no agruparon: solo descripción, unidad y piezas, con el proveedor como letra (P1, P2…). **Nunca viajan costos ni nombres de proveedores.** `POST /catalog-matching/group` pregunta a `claude-opus-5-5` con salida JSON estructurada y devuelve grupos con su razón en español; el servicio quita grupos imposibles y la caja **veta** los que las reglas ven en conflicto, los rechazados por el dueño y los que repiten proveedor. Lo que queda se muestra como «Propuesta de la IA» y se aprueba igual que las demás. Sin internet o sin llave, el botón no aparece o dice por qué, y las reglas siguen funcionando.

**La caja se identifica con una llave de dispositivo.** La caja no tiene la sesión del dueño en el núcleo, así que llama con `Authorization: Device <token>` y el servicio lo compara en tiempo constante contra `ANALYTICS_REGISTER_TOKEN`. Si el servicio no tiene esa variable, rechaza (503); el panel puede seguir llamando con el token del dueño.

**El comparador junta los grupos.** «Comparar precios» busca también con los sinónimos (buscar «broca alta velocidad» encuentra «HSS»), y une en una sección los artículos del mismo producto y del mismo grupo equivalente, con el nombre del grupo, el precio por unidad base, el más barato en verde y la diferencia. Si un artículo sin ligar no trae piezas pero su descripción dice «c/100», el precio por pieza se calcula con esas piezas y la tabla lo avisa («100 piezas, según la descripción»). El carrito sigue siendo por producto: solo los artículos ligados al producto del grupo se pueden pedir, para no crear pedidos de algo que no existe en el catálogo.

**PDF en el lector de catálogos.** El panel y `POST /catalog-pages/read` aceptan `application/pdf` (firma `%PDF-`) de hasta 20 MB y 4 hojas; se manda a Claude como bloque `document`. Un PDF más largo se rechaza con «Mándalo por partes» (413), porque la respuesta de una sola petición alcanza para unas 4 hojas densas. Las hojas se cuentan buscando `/Type /Page` sin interpretar el PDF; si están comprimidas la cuenta sale baja, nunca alta, y los límites de Claude (32 MB, 600 páginas) siguen aplicando.

## Alternativas descartadas
- **Solo IA:** cuesta por cada búsqueda, no funciona sin internet y no se puede explicar ni probar con casos fijos. Las reglas resuelven la mayoría gratis y la IA queda para lo que no alcanzan.
- **Embeddings (vectores de significado) en la caja:** necesitan un modelo de cientos de MB en la PC de la tienda y confunden medidas («1/4» y «3/8» se ven casi iguales), que es justo lo que no se puede confundir.
- **Ligar automáticamente desde 80 puntos:** un grupo equivocado hace que el dueño pida al proveedor equivocado; aprobar cuesta un clic.
- **Guardar el grupo con el id del renglón:** cada importación reemplaza la lista (ADR 0068) y perdería todo lo decidido.
- **Una tabla de grupos con `UPDATE`:** rompería la regla de libros inmutables y la auditoría; las vistas dan el estado actual igual de rápido.
- **Convertir el PDF a imágenes en el panel:** necesita una librería pesada en el navegador; Claude ya lee PDF directo.

## Consecuencias
- El comparador muestra juntos productos que nunca se ligaron, con nombre y razón, y lo decidido sobrevive a cada nueva lista.
- La migración 24 solo agrega tablas, vistas, índices y disparadores; una base vieja se lee igual.
- La ayuda de la IA cuesta unos centavos por petición y solo se usa cuando el dueño la pide.
- Una descripción sin medida ni palabras raras («tornillo») no se propone: las reglas prefieren callar a equivocarse.
