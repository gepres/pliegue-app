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
- No hay embeddings ni búsqueda semántica global.
- Ollama Cloud no se trata como equivalente a un servidor Ollama remoto propio; el flujo
  requiere una instancia que acepte el esquema estructurado y CORS.
- La bóveda persistente y el shell nativo siguen pendientes.

El siguiente bloque recomendado es OCR con consentimiento y después una
cola durable con presupuesto, reintentos e idempotencia compartida.
