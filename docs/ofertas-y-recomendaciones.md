# Dónde conseguir un libro (06.2)

Desde el menú de cualquier libro de la Biblioteca, «Dónde conseguirlo» abre un panel con
Buscalibre y los libros digitales de Google Play. Las recomendaciones (06.1) usan el mismo
panel.

## Sitios que se consultan

Ninguno más. Si se añade una tienda, se añade aquí.

| Sitio | Para qué | Cómo |
|---|---|---|
| `www.buscalibre.pe`, `.com.co`, `.cl`, `.com.mx`, `.com.ar`, `.us` | Enlace a la búsqueda del libro en la tienda del país | **Solo un enlace** que abre la persona. Pliegue no pide nada a Buscalibre |
| `www.googleapis.com/books/v1/volumes` | Precio de los libros digitales de Google Play | Petición desde el navegador, con la clave pública de Google de Pliegue |

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
