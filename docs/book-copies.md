# Un libro, varias copias

El mismo libro puede estar en una carpeta local, en Google Drive o importado como copia. Pliegue
lo muestra **una sola vez** y guarda lo que la persona hace con él —avance, notas, favoritos,
traducciones, ficha IA y par de idiomas— en **una sola copia**, la principal. Así no hay dos
estados que se contradigan, y quitar una copia no se lleva por delante lo que vale para las otras.

## Cuándo dos archivos son el mismo libro

Solo cuando su contenido es idéntico byte a byte: mismo SHA-256 y mismo tamaño.

- **Drive** da el SHA-256 de cada archivo (`sha256Checksum`) sin descargarlo.
- **En local**, Pliegue lo calcula leyendo el archivo, pero solo si otra copia tiene su mismo
  tamaño. Lo guarda por huella en IndexedDB (`pliegue-content-hashes`) y no lo repite mientras el
  archivo no cambie. Sin permiso de lectura no se calcula: esa copia sigue aparte hasta que lo haya.

Dos ediciones distintas (un EPUB y un PDF, o dos escaneos) siguen siendo libros distintos: sus
notas van ancladas a posiciones de su propio archivo y no valdrían en el otro. Para marcarlas
como duplicado está `duplicateOf` en el índice JSON. Mismo criterio que KOReader en modo binario
y que las «ediciones» de Plex.

## Qué copia es la principal

- Un grupo nuevo elige la copia que **ya tiene estado**. Si no tiene ninguna, la preferida para
  leer.
- Si varias tienen estado, se juntan en la preferida:
  - favorito, si lo era cualquiera;
  - el mayor avance;
  - todas las notas;
  - las traducciones que falten;
  - la ficha IA de la principal, si tiene una.
- Una vez elegida, **no cambia** mientras exista. Llegue la copia que llegue, nada se mueve.

Los grupos se guardan en `localStorage` (`pliegue-copias-v1`).

## Qué copia se lee

La preferida que se pueda abrir en ese momento:
1. la carpeta local con permiso;
2. el archivo vinculado;
3. la copia importada;
4. Drive con sesión.

Si la preferida pide permiso, el lector ofrece abrir la otra copia («Abrir la copia de Google
Drive»). El archivo sale de esa copia; el estado, siempre de la principal.

## Quitar copias

Desvincular una carpeta o un archivo, quitar algo de Drive o borrar una copia importada llama
antes a `releaseCopies`. Si la copia era la principal de un libro que conserva otras, su estado
pasa a una de ellas antes de borrar nada, y el aviso de confirmación lo dice.

Si una copia desaparece sin pasar por ahí (al buscar cambios, por ejemplo), el conciliador hace
el mismo traslado en su siguiente vuelta.

## El conciliador

`components/book-copies-sync.tsx` lo lanza 1,5 s después de cada cambio, y **solo con todos los
almacenes cargados y sin errores**: un almacén que aún carga parecería una copia borrada.

Hace cuatro cosas:
1. completa el SHA-256 de Drive que falte;
2. calcula el de las copias locales candidatas;
3. agrupa y traslada estado (`planCopyGroups`);
4. da a las copias de Drive el índice de la copia local, para no descargarlas.

Mientras compara, la indexación de Drive no descarga ningún archivo que tenga el mismo tamaño
que una copia local.

## Entre equipos

La sincronización identifica los libros por nombre y tamaño (`cloud/sync/document-key.ts`), y
los de Drive también. Así, el progreso del móvil leyendo desde Drive y el del PC leyendo desde
la carpeta local se juntan. Solo un Documento de Google, sin tamaño, usa su id de Drive.

## Código

- `library/book-copies.ts`: las reglas, puras y con pruebas.
- `library/book-copies-store.ts`: los grupos, el SHA-256, el traslado y el conciliador.
- Traslados en cada almacén: `transferFavorite`, `transferReadingProgress`, `transferAnnotations`,
  `transferTranslations`, `transferDocumentCatalogRecord` y `transferTranslationPreference`.
- e2e (scratchpad de la sesión): `e2e-copias.mjs`, con Google simulado.
