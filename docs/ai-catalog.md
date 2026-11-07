# Catálogo documental asistido por IA

- Estado: incremento web funcional con BYOK de sesión
- Foundry: `03.6 · Índice global, clasificación y deduplicación` y `04.1–04.3 · IA BYOK`

## Objetivo

Después de vincular un archivo o una carpeta, Pliegue puede enriquecer cada documento con
una capa local y filtrable: título canónico, autores, año de publicación, géneros, tipo de
obra, idioma, temas, sinopsis y confianza. Esta capa no reemplaza el manifiesto ni modifica
el original.

La ficha se deriva del **contenido** del documento, no de su nombre: el extracto es la
evidencia principal y el título y la ruta solo actúan como pistas secundarias. Biblioteca
filtra por autor, género, tipo de obra y año a partir de esa capa, y la confianza declarada
permite revisar los casos dudosos.

## Flujo eficiente

1. El navegador recorre la carpeta y compara el fingerprint de cada archivo.
2. La extracción local genera hasta 32.000 caracteres normalizados.
3. El catalogador selecciona un extracto de 8.000, 12.000 o 24.000 caracteres, conservando
   el inicio y el cierre del texto.
4. Solo el título observado, formato, ruta relativa y extracto pasan al proveedor elegido.
5. El proveedor devuelve un JSON sujeto a un esquema común y Pliegue vuelve a validar y
   normalizar el resultado.
6. IndexedDB guarda la ficha, proveedor, modelo, fecha, estado y fingerprint de entrada.

El fingerprint incorpora versión del documento, proveedor, modelo, **versión del prompt** y
extracto. Una versión ya catalogada se omite; cambiar el archivo, modelo, proveedor o el
contrato de ficha crea trabajo nuevo. La concurrencia admite de 1 a 6 solicitudes y el valor
recomendado sigue siendo 2.

### Versión del contrato de ficha

`catalogPromptVersion` versiona las instrucciones y la forma de la ficha, como exige
ADR-0002 al pedir que los prompts se versionen aparte del binario. Subirla invalida los
fingerprints anteriores, de modo que los documentos ya catalogados se vuelven a analizar en
lugar de conservar fichas creadas con instrucciones antiguas. **Tiene coste**: un cambio de
versión implica volver a pagar el análisis de toda la biblioteca.

| Versión | Cambio |
| --- | --- |
| 1 | ficha inicial con síntesis factual de 280 caracteres |
| 2 | sinopsis de hasta 700 caracteres centrada en de qué trata la obra; se prioriza el extracto del documento sobre el nombre del archivo |

## Activación y estados

El análisis automático está apagado por defecto. El usuario puede:

- activar **Analizar después de vincular o detectar cambios**;
- ejecutar **Analizar pendientes** desde `/app/ia`;
- reanalizar un documento concreto desde Biblioteca.

Estados visibles:

| Estado | Significado |
| --- | --- |
| `analyzing` | existe una solicitud activa para esa versión |
| `analyzed` | ficha estructurada disponible para búsqueda y filtros |
| `needs-content` | imagen o PDF escaneado sin capa de texto; requiere OCR |
| `error` | credencial, red, modelo o respuesta inválida; se puede reintentar |

## Proveedores y credenciales

| Proveedor | Transporte actual | Secreto |
| --- | --- | --- |
| OpenAI | ruta fija de servidor → Responses API con Structured Outputs | API key solo en memoria de la pestaña |
| Anthropic | ruta fija de servidor → Messages API con JSON Schema | API key solo en memoria de la pestaña |
| Ollama local | navegador → `http://localhost:11434/api/chat` | no requiere API key |
| Ollama remoto | navegador → URL HTTP(S) configurada | el servidor debe permitir CORS para Pliegue |

OpenAI y Anthropic reciben la API key en un header de la solicitud a Pliegue; la ruta la
reenvía al proveedor y no persiste ni registra la clave o el cuerpo. Esto es una credencial
de sesión, no una bóveda web: en un despliegue hospedado la clave y el extracto atraviesan
el servidor de Pliegue. La bóveda persistente, cifrado y recuperación siguen pendientes en
`02.5`.

Los ajustes no sensibles viven en la clave versionada `pliegue-ai-settings-v1` de
`localStorage`. Las claves no entran en `localStorage`, IndexedDB, variables
`NEXT_PUBLIC_`, repositorio o telemetría.

## Modelos de partida (04.2b)

Los más baratos de cada proveedor para catalogar y traducir (decisión del dueño del 6-nov-2026).
Precios verificados ese día en [Artificial Analysis](https://artificialanalysis.ai/), en dólares
por millón de tokens (entrada / salida), con su índice de inteligencia:

| Proveedor | Modelo | Precio | Índice |
| --- | --- | --- | --- |
| OpenAI | `gpt-6-luna` | 0,10 / 0,50 | 28 |
| Claude | `claude-haiku-5-5` | 0,10 / 0,50 | 36 |
| Gemini | `gemini-3.5-flash-lite` | 0,30 / 2,50 | 12 |
| Ollama | `qwen3:8b` | gratis, en el equipo | — |

- **Antes eran** `gpt-5.6-luna` (0,20 / 1,20, obsoleto), `claude-sonnet-5` al catalogar y
  `claude-haiku-4-5` al traducir (1 / 5).
- **Migración:** quien sigue con un modelo de partida antiguo pasa al de ahora
  (`legacyDefaultModels` en `ai-settings.ts`). Lo elegido a mano se conserva. Ajustes lo avisa
  hasta que se guardan los ajustes («Entendido»).
- **Ollama:** Ajustes recomienda `qwen3:8b` (unos 5,2 GB, mejor con 16 GB de memoria; con
  menos, `qwen3:4b`). Comprueba con `/api/show` si el modelo elegido está y, si no, lo descarga
  con `/api/pull` y su avance (`ai/ollama-pull.ts`). Si Ollama no responde, lo dice: hay que
  abrirlo y permitir esta web (`OLLAMA_ORIGINS`).
- La tabla de precios del presupuesto (04.6) trae estos precios y los de los modelos anteriores.

## Interfaz común (04.2)

`apps/web/app/ai/adapters.ts` da un mismo contrato a los cuatro proveedores para tres
operaciones, y es donde se engancharán la búsqueda semántica (04.4) y «describir figura»:

| Operación | OpenAI | Anthropic | Gemini | Ollama |
| --- | --- | --- | --- | --- |
| `generateJson` (JSON por esquema) | `/v1/responses` | `/v1/messages` | `generateContent` | `/api/chat` con `format` |
| `describeImage` (imagen + instrucción) | `input_image` | `image` en base64 | `inlineData` | `images` |
| `embed` (un vector por texto) | `/v1/embeddings` | no hay: falla con aviso | `batchEmbedContents` | `/api/embed` |

- `adapterFor({ provider, model, apiKey?, baseUrl?, fetch? })` devuelve el adaptador. Recibe el
  `fetch`: con clave se usa en las rutas de servidor, como catalogar y traducir; Ollama, desde el
  navegador.
- Antes de llamar mira las capacidades del modelo (`model-capabilities.ts`): si consta que no
  puede, `UnsupportedOperationError` sin gastar nada; si no se sabe, lo intenta.
- Los fallos son los de siempre (`ProviderFailureError`, con `retryable` y `retryAfter`), así
  que los reintentos y «Por qué fallaron» funcionan igual. `generateJson` con clave reutiliza
  `requestStructuredJsonWith` de `hosted-json.ts`: catalogar y traducir no cambian.

## Sensibilidad (04.3)

Decisión del 6-nov en Foundry (04.3). Los cuatro niveles de 01-product-scope §4.3.

- **Dónde se marca:**
  - en la fuente, en Ajustes → Fuentes, «Sensibilidad» (cada carpeta, cada carpeta de Drive, los
    archivos sueltos, las copias importadas y los archivos de Drive sueltos), y la heredan sus
    libros;
  - cada libro puede cambiarla en su menú, «Sensibilidad: …».
  - Sin marcar es «interno»: nada cambia. Se guarda en este equipo (`pliegue-sensitivity-v1`):
    las fuentes y los ids de libro son de cada equipo.
- **Qué hace:**
  - *Público* e *interno*: como siempre.
  - *Personal*: antes de enviarlo a un proveedor en la nube se pregunta una vez por libro y flujo
    (catalogar, traducir), y el «sí» se recuerda. Al catalogar varios se pregunta por todos
    juntos. Al retomar una traducción sin pulsar nada no se pregunta: espera al botón.
  - *Confidencial*: solo en el equipo, con Ollama en modo local o el traductor del navegador.
    Con un proveedor en la nube, catalogar lo salta (y lo cuenta) y traducir se bloquea,
    ofreciendo «Traducir en este equipo» y «Usar Ollama».
- **En el equipo** cuenta Ollama local (o en `localhost`) y un LibreTranslate en `localhost`;
  Ollama remoto y el resto, fuera (`providerPlace`).
- **Dónde se aplica:** dentro de la cola del catálogo, así que también vale para el catálogo
  automático tras vincular, y al empezar a traducir (`use-book-translation`).
- **Código:** `library/sensitivity.ts` (modelo y reglas, con pruebas),
  `library/sensitivity-store.ts`, `components/library/sensitivity-picker.tsx` y
  `components/ai/sensitive-consent.ts`. e2e: `apps/web/e2e/sensibilidad.mjs`.

## Proveedor por tarea (04.3)

Cada tarea que puede sacar el texto de un libro del equipo tiene su proveedor:

| Tarea | Ajuste | Por defecto |
|---|---|---|
| Catalogar | `provider` + `models` | OpenAI |
| Traducir | `translationProvider` + `translationModels` | el traductor del navegador |
| Buscar por significado | `indexProvider`: `catalog`, `openai`, `gemini`, `ollama` u `off` | el de catalogar |
| Preguntar | `askProvider`: `catalog` o un proveedor, + `askModels` | el de catalogar |

- **Buscar** no ofrece Claude, que no calcula embeddings. Con `off` se busca solo por palabras y
  no sale nada. Cambiarlo cambia la firma de los vectores (`embeddingKey`): hay que volver a
  indexar para buscar por significado.
- **Preguntar** tiene su propio modelo. Responder con citas pide más que una ficha, y así se
  puede pagar un modelo mejor solo para esto. Los ajustes de antes, sin `askModels`, siguen
  preguntando con el modelo de catalogar.
- **Cada tarea, su clave.** En Ajustes → IA, «Buscar y preguntar» enseña la clave o el Ollama
  de esos proveedores solo si no salen ya arriba. El panel de `/app/ia` manda a cada ruta la
  clave de su proveedor.
- **«Quién hace cada tarea»** (Ajustes → IA) enseña el router entero con lo guardado:
  - por cada tarea, quién la hace, con qué modelo y dónde (en este equipo, en tu servidor de
    Ollama o en la nube del proveedor, con la región de Azure);
  - qué pasa con un libro de cada nivel. Lo calculan las mismas reglas que se aplican al enviar
    (`routeFor`, `providerPlace`) en `ai/flow-router.ts`, que tiene pruebas.
- **Sin respaldo automático** (decisión `f8c90d3b`): si el proveedor de una tarea falla, no se
  prueba con otro. Se dice y la persona elige, así que un libro nunca acaba en un proveedor que
  no eligió.
- **Región:** Pliegue no elige la región en la que procesa cada proveedor; la fija el proveedor
  o la cuenta de la persona con él. Azure usa la de su recurso.
- **Código:** `ai/ai-settings.ts` (`indexProviderOf`, `askProviderOf`, `askModelOf`),
  `ai/flow-router.ts` y `components/ai/ai-router-matrix.tsx`. e2e:
  `apps/web/e2e/router-flujo.mjs`. Simula Claude y Ollama: Claude cataloga y responde, Ollama
  busca. Comprueba que, si Claude falla, no se llama a nadie más, y que con `off` no se pide
  ningún vector.

## Presupuesto y gasto (04.6)

Decisión del 6-nov en Foundry (04.6). Ajustes → IA, «Gasto y presupuesto».

- **Qué se cuenta:** cada llamada apunta sus tokens (o caracteres en DeepL y Azure) por
  proveedor y modelo. Se cuenta al catalogar y al traducir con «Tu IA», lo que diga la respuesta
  del proveedor, sin estimar. Ollama y LibreTranslate se cuentan, pero no tienen límite.
- **Dólares estimados:** con una tabla de precios por millón de tokens (o de caracteres),
  editable. Los precios de partida son los de `translation-options.ts` (29-sep-2026). Un modelo
  sin precio cuenta tokens, no dólares, y el panel lo dice.
- **Límites del mes:** global (dólares y tokens) y por proveedor. Se avisa al 80 % con un aviso
  (`BudgetAlerts`). Al 100 %:
  - catalogar para la cola; la ficha en curso termina;
  - traducir para antes de la sección siguiente, con «Seguir con este libro» (solo ese libro y
    ese mes) y «Cambiar el límite».
- **Dónde vive:**
  - límites y precios, en `AiSettings.budget`, que se sincroniza con los ajustes;
  - el gasto, en `ai-usage-store.ts` (`localStorage`, por mes, sin textos);
  - con la cuenta, la colección `ai-usage` sube el contador de cada equipo (`equipo/mes`) y el
    total es la suma: nadie escribe la fila de otro, así que no hay conflictos.
- **Código:** `ai/ai-budget.ts` (cuentas y precios, con pruebas), `ai/ai-usage-store.ts` (el
  contador y el freno `assertWithinBudget`), `components/ai/ai-budget-panel.tsx`. e2e:
  `apps/web/e2e/presupuesto-ia.mjs`.
- **Registros:** las rutas `/api/ai/*` no escriben en la consola (`api/ai/no-logs.test.ts`):
  reciben textos de libros y claves.

## Registro de la IA (04.6)

Ajustes → IA, «Registro de la IA». Cierra el criterio «retención y fallback auditables y borrado
de derivados» de 04.6.

- **Qué apunta:** por libro, flujo (catalogar, traducir), proveedor, modelo y día: cuándo,
  dónde se procesó (en el equipo o fuera), su sensibilidad, qué decidió el router (enviado,
  enviado con permiso, no salió por confidencial, no salió por ser personal sin permiso) y
  cuánto se envió (fichas o páginas, caracteres, tokens si el proveedor los da, fallos).
- **Qué no apunta:** textos, títulos ni claves. El título se busca al enseñarlo, en la
  biblioteca de este equipo; si el libro ya no está, se dice. Lo que se cancela («Detener»)
  no cuenta como fallo.
- **Retención:** 90 días y 1.000 entradas como mucho, en `localStorage`
  (`pliegue-ai-processing-v1`). Lo caducado se va al escribir y al abrir el panel. No viaja con
  la cuenta. «Borrar los datos de este navegador» se lo lleva, por su prefijo.
- **Fallback:** no hay cambios automáticos de proveedor. Si uno falla, se para y queda el fallo;
  si el router no deja salir un libro, queda con su razón. Ningún flujo cruza del equipo a la
  nube sin que lo pida la persona.
- **Borrado de derivados:** desde cada fila, «Borrar la ficha» (la de la IA; el libro vuelve a
  la cola) o «Borrar lo traducido» (solo lo de ese motor, a cualquier idioma). Borrar
  derivados no borra el registro: sigue diciendo qué se envió. También se puede borrar el
  registro entero y descargarlo en JSON (con el título de hoy de cada libro).
- **Código:** `ai/processing-log.ts` (modelo, retención y el traductor que cuenta, con pruebas),
  `ai/processing-log-store.ts`, `components/ai/ai-processing-log.tsx`. Se apunta en la cola del
  catálogo (`catalog-analysis.ts`) y al traducir (`use-book-translation.ts`). e2e:
  `apps/web/e2e/registro-ia.mjs`.

## Buscar en los libros (04.4)

`/app/ia`, «Buscar en tus libros». Búsqueda híbrida en el texto de los libros: por palabras,
siempre y en el equipo, y por significado, con embeddings del proveedor de catalogar.

- **Indexar, en dos pasos:**
  1. *Trocear*, en el equipo: se lee el archivo y se parte en fragmentos de ~1.200 caracteres
     (2.000 como mucho) que siguen la estructura: un título abre fragmento y un párrafo solo se
     parte si es enorme (por frases). Con esto ya se busca por palabras.
  2. *Vectores*: antes de enviar nada se dice a quién, cuántos fragmentos, caracteres y tokens
     (y dólares, si el modelo tiene precio). Personal pide su permiso (flujo «indexar», aparte
     de catalogar y traducir); confidencial con un proveedor en la nube no sale: se busca solo
     por palabras y no cuenta como pendiente.
- **Dónde está cada fragmento:**
  - PDF: página, tramo del texto de la página (`start`, `end`) y rectángulos por renglón,
    normalizados de 0 a 1 desde arriba a la izquierda (`extractPdfLayout`). No cruza de página.
  - EPUB, DOCX, PPTX, XLSX: sección (índice, id y título) y bloques, contados como las anclas
    de lectura (sin imágenes). No cruza de sección. TXT y MD, como una sección (en MD, `#` son
    títulos).
- **Reindexación incremental:** cada libro guarda la versión que se troceó (`fingerprint`, o
  fecha del índice y longitud) y cada fragmento la huella de su texto. Si el libro no cambió,
  no se vuelve a leer; si cambió, un fragmento con el mismo texto conserva su vector. Cambiar
  de modelo de embeddings pide vectores nuevos.
- **Modelos:** OpenAI `text-embedding-3-small` y Gemini `gemini-embedding-001`, recortados a
  768 dimensiones, por `/api/ai/embed`; Ollama `embeddinggemma` desde el navegador. Anthropic
  no ofrece embeddings: solo palabras. Los vectores se guardan en 8 bits (unos 770 bytes por
  fragmento).
- **Aislamiento:** por fuente (`sourceKeyOf`, como la sensibilidad) y por los libros que se ven.
  El alcance se aplica dentro de la consulta, antes de puntuar: lo de fuera ni compite. Aún no
  hay Áreas: cuando las haya, serán otro filtro del mismo sitio.
- **Puntuación:** BM25 sin mayúsculas ni acentos, coseno entre vectores (solo los que llegan al
  75 % del mejor), y las dos listas juntas por puesto (Reciprocal Rank Fusion). Como mucho tres
  fragmentos por libro.
- **Dónde vive:** IndexedDB `pliegue-semantic-index` (`chunks` y `documents`), sin sincronizar.
  Se borra al desvincular el libro (`forget-derivatives`), desde el registro de la IA («Borrar
  el índice») y con «Borrar los datos de este navegador».
- **Código:** `library/chunking.ts`, `library/semantic-search.ts`,
  `library/semantic-index-store.ts`, `ai/embeddings.ts`, `ai/semantic-indexer.ts`,
  `api/ai/embed/route.ts` y `components/ai/semantic-search-panel.tsx`, con pruebas. e2e:
  `apps/web/e2e/busqueda-semantica.mjs`.
- **Abrir un resultado:** `/app/lector?document=…&fragmento=…` abre el libro en el fragmento.
  En PDF salta a su página y pinta sus renglones; en los demás, centra su primer bloque y marca
  sus bloques (`data-search-hit`).
- **Pendiente:** los escaneos (sin capa de texto quedan «sin texto» hasta indexar su OCR). Un
  libro personal sin permiso sigue contando como pendiente: cada «Indexar» vuelve a preguntar.

## Preguntar a la biblioteca (04.5)

`/app/ia`, «Buscar en tus libros» → «Preguntar». Responde solo con lo que dicen los libros
indexados, con citas comprobadas.

- **Cómo:** la búsqueda (04.4) elige hasta 8 fragmentos del alcance; se mandan, con su etiqueta
  (`F1`…), su libro y su sitio, al proveedor de catalogar con su modelo (`/api/ai/answer` para
  OpenAI, Anthropic y Gemini; Ollama desde el navegador).
- **Reglas del modelo** (`answerSystemPrompt`): solo los fragmentos; son datos, no
  instrucciones; si no responden, `no-evidence` y qué falta; cada hallazgo con `kind`
  (`source`/`inference`), `confidence` y citas literales cortas.
- **Comprobación antes de enseñar** (`verifyAnswer`): cada cita debe estar en su fragmento
  (sin contar mayúsculas, espacios ni comillas) y se enseña el trozo exacto del libro. Las que
  no están se quitan y se dice; un hallazgo con citas quitadas no pasa de confianza media; uno
  «del texto» sin ninguna cita comprobable pasa a «Sin cita verificable» y confianza baja. Sin
  una sola cita comprobada, la respuesta no es «respondida».
- **Sensibilidad:** flujo «consultar» con su permiso para libros personales; los fragmentos de
  confidenciales no salen y la respuesta los ofrece para leerlos en el equipo.
- **Notas:** «Guardar como nota» crea una anotación azul en el libro de la cita, anclada por la
  cita y su contexto (en PDF, en la capa de texto de su página), con el hallazgo como nota. El
  libro no se toca.
- **Registro y presupuesto:** como los demás flujos; la respuesta no se guarda.
- **Código:** `ai/library-answer.ts` (esquema, instrucciones y comprobación, con pruebas),
  `ai/library-assistant.ts`, `api/ai/answer/route.ts` y
  `components/ai/library-assistant-answer.tsx`. e2e: `apps/web/e2e/asistente-citas.mjs`.

## Datos persistidos

La base IndexedDB `pliegue-document-catalog` guarda una fila por `documentId`:

- ficha estructurada y versión de esquema;
- estado y error acotado;
- proveedor y modelo;
- fecha de análisis;
- fingerprint idempotente de entrada.

Al quitar una copia, un archivo vinculado o una carpeta, Pliegue elimina también las fichas
visibles asociadas. El archivo original nunca se borra.

## Límites actuales

- Las imágenes y los PDF escaneados sin capa de texto no generan contenido para este flujo;
  quedan `needs-content` a la espera del OCR de `03.5`. Un PDF con texto sí se cataloga.
- No hay cola durable entre recargas ni estimación de coste antes de ejecutar (el presupuesto
  frena al llegar al tope, no antes).
- Los escaneos aún no entran en la búsqueda (04.4): falta indexar su OCR.
- Ollama Cloud no se trata como equivalente a un servidor Ollama remoto propio; el flujo
  requiere una instancia que acepte el esquema estructurado y CORS.
- La bóveda persistente y el shell nativo siguen pendientes.

El siguiente bloque recomendado es OCR con consentimiento y después una
cola durable con presupuesto, reintentos e idempotencia compartida.
