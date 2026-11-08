# Dónde conseguir un libro (06.2) y «Para ti» (06.1)

Desde el menú de cualquier libro de la Biblioteca, «Dónde conseguirlo» abre un panel con
Buscalibre y los libros digitales de Google Play. Las recomendaciones (06.1) usan el mismo
panel.

## Sitios que se consultan

Ninguno más. Si se añade una tienda, se añade aquí.

| Sitio | Para qué | Cómo |
|---|---|---|
| `www.buscalibre.pe`, `.com.co`, `.cl`, `.com.mx`, `.com.ar`, `.us` | Enlace a la búsqueda del libro en la tienda del país | **Solo un enlace** que abre la persona. Pliegue no pide nada a Buscalibre |
| `www.googleapis.com/books/v1/volumes` | Precio de los libros digitales de Google Play | Petición desde el navegador, con la clave pública de Google de Pliegue |
| `openlibrary.org/search.json` | Recomendaciones (06.1): libros por tema o autor, y comprobar las sugerencias de la IA | Petición desde el navegador, sin clave |
| `covers.openlibrary.org` | Portadas de lo recomendado | Imagen, sin clave |

## Qué sale del equipo

El título, el primer autor o el ISBN, y el país. Nunca el archivo, el texto ni la biblioteca.
Si el libro no tiene ficha, el título y el autor salen del nombre del archivo, con la
convención «Título - Autor».

## Buscalibre

- **Sin API pública.** Su `robots.txt`, para cualquier programa (`User-agent: *`), dice
  `Disallow: /libros/search*?*` y `Disallow: /*?*`: no se pueden recorrer sus búsquedas. Por
  eso Pliegue **no lee sus precios** (validado el 8-nov-2026: sin scraping).
- **El enlace** lleva a `https://<tienda>/libros/search?q=<ISBN o título y autor>` y se abre en
  otra pestaña, con `noopener noreferrer`. El precio, el formato, el envío y las promociones se
  ven en Buscalibre, y el panel lo dice.
- **El país** sale del idioma del navegador (`es-PE` → Perú; Puerto Rico → la tienda de EE.
  UU.). Se cambia en el propio panel y se recuerda en este equipo (`pliegue-book-store-v1`).
  Sin país conocido, el panel pide elegirlo.
- **Afiliación: ninguna.** Pliegue no gana nada con estos enlaces, y el panel lo dice. Si un
  día se usa el programa de afiliados de Buscalibre (buscalibre.us/afiliados), el enlace lo
  dirá. Ese programa es también la vía para pedirles precios y promociones con permiso.

## Google Play Libros (Books API)

- **Qué se pide:** `volumes?q=isbn:<ISBN>` o `intitle:"…" inauthor:"…"`, con `country` y
  `fields` recortados a lo que se usa. Solo lo que está en venta (`saleability: FOR_SALE`) y con
  enlace `https`.
- **Qué se enseña:** precio en la moneda y con el formato del país, el precio de antes si hay
  rebaja, el formato (eBook, sin envío), el país y **la fecha de la consulta**.
- **Frecuencia:** se consulta al abrir el panel y se recuerda **24 horas** por libro y país
  (`pliegue-book-offers-v1`, hasta 200). Pasado un día se vuelve a preguntar.
- **Requisito:** la cuota anónima de la Books API es 0, así que hace falta la clave pública de
  Google de Pliegue (`NEXT_PUBLIC_GOOGLE_API_KEY`) con la Books API activada. En Google Cloud:
  APIs y servicios → activar «Books API» y añadirla a las restricciones de API de la clave. Sin
  eso, el panel dice que los precios digitales no están disponibles, y Buscalibre funciona
  igual.
- **Términos:** el uso de la Books API se rige por los Términos de las API de Google. Se
  muestran sus datos con su enlace de compra, sin guardarlos más de un día.

## Código

`library/book-stores.ts` (tiendas, enlaces y lectura de la Books API, con pruebas),
`library/book-offers-store.ts` (país y lo consultado, con pruebas) y
`components/books/book-offers.tsx`. e2e: `apps/web/e2e/ofertas-libros.mjs`.

## «Para ti»: recomendaciones con su porqué (06.1)

«Para ti» está en el menú lateral (y en la barra de abajo del móvil). En Inicio, la tarjeta
«Libros para ti» aparece tras lo que se está leyendo. Sin gustos, invita a elegirlos. Con
recomendaciones hechas, enseña las primeras portadas, sacadas de lo guardado en el equipo sin
volver a buscar. La persona elige temas (22, en una lista
fija) y autores, y Pliegue busca en Open Library libros en español que encajen. Cada tarjeta
dice **por qué** se recomienda («Porque te gusta el realismo mágico», «Porque lees a Julio
Cortázar»), con «Dónde conseguirlo» (el panel de arriba), «No me interesa» y «Ver en Open
Library».

### Qué se pregunta y qué sale del equipo

- **Por defecto, solo los gustos declarados.** Hasta 4 temas (en inglés, como los etiqueta Open
  Library: `subject:"magic realism" language:spa`, por valoración) y hasta 3 autores
  (`author=<nombre>`). Nada de la biblioteca.
- **«Usar también mi biblioteca»** (interruptor, apagado de inicio): añade los autores y los
  géneros de los libros que se tienen; los favoritos pesan el doble. **Nunca un título**, y
  **nunca** los libros marcados como confidenciales o personales (ni los de una fuente marcada
  así).
- **Lo que ya se tiene** (por título normalizado) y lo descartado no se recomiendan. Como mucho
  dos libros por autor, para que haya variedad.
- **Frecuencia:** lo recomendado se recuerda **24 horas** mientras no cambien los gustos
  (`pliegue-recommendations-v1`). Al cambiarlos, o pasado un día, se vuelve a preguntar. Si
  Open Library no responde, se dice y no se recuerda.

### Afinar con IA

Opcional, con su propia IA: Ajustes → IA → «Recomendaciones» (`recommendProvider` y
`recommendModels`). Por defecto, el proveedor de catalogar. «Para ti» dice con cuál se afina y
enlaza a ese ajuste. Antes de enviar, un aviso dice **con qué modelo** y **qué temas y qué
autores** van a la IA; ningún título.

**El modelo** (decidido el 8-nov-2026): para recomendar cuenta lo que el modelo sabe de
libros, no cuánto texto lee. Los modelos pequeños inventan más títulos; lo inventado se
descarta, pero entonces quedan menos recomendaciones. Por eso, de partida, la gama media de cada
proveedor:

| Proveedor | Modelo | Precio (USD por millón, entrada / salida) |
|---|---|---|
| OpenAI | `gpt-6.1-sol` | 2 / 10 |
| Anthropic | `claude-sonnet-5-5` | 2 / 10 |
| Gemini | `gemini-3.8-flash` | 0,75 / 3,75 hasta el 31-dic-2026; 1,50 / 7,50 desde 2027 |
| Ollama | `qwen3:8b` | en el equipo, sin coste |

- Cada «Afinar» manda unos cientos de tokens y recibe como mucho 4.000, razonamiento
  incluido. Con OpenAI o Anthropic sale por unos 0,01–0,04 USD.
- Gemini 3.6 Flash se retira el 19-nov-2026; por eso se usa 3.8 Flash.
- Precios tomados de las páginas oficiales de OpenAI y de Google el 8-nov-2026. El
  presupuesto cuenta Gemini 3.8 Flash al precio de 2027, para no quedarse corto.
- Quien quiera gastar menos puede poner el modelo barato del proveedor (`gpt-6-luna`,
  `claude-haiku-5-5`, `gemini-3.5-flash-lite`). La IA propone hasta 8 libros y **solo se enseñan los que existen en Open Library**
(se buscan por título y autor): lo inventado se descarta. Cuenta para el presupuesto de la
IA. No va al registro de procesamiento, que es por libro: aquí no sale nada de ninguno.

### Dónde se guarda y cómo se quita

Los gustos y los descartes viven **solo en este equipo** (`pliegue-taste-v1`), sin
sincronizarse. «Desactivar recomendaciones» deja de recomendar y olvida lo recomendado (los
gustos se quedan por si vuelve); «Borrar mis gustos» lo borra todo.

### Código

`library/recommendations.ts` (temas, consultas, lectura de Open Library y orden, con pruebas),
`library/taste-store.ts` (gustos, señales de la biblioteca y lo recomendado, con pruebas),
`ai/book-suggestions.ts` y `ai/recommend-with-ai.ts` (afinar con IA), la ruta
`api/ai/recommend` y `components/books/for-you.tsx`. e2e: `apps/web/e2e/para-ti.mjs`.
