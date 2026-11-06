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
- No hay cola durable entre recargas, presupuesto, límites por proveedor ni estimación de
  costo antes de ejecutar.
- No hay embeddings ni búsqueda semántica global.
- Ollama Cloud no se trata como equivalente a un servidor Ollama remoto propio; el flujo
  requiere una instancia que acepte el esquema estructurado y CORS.
- La bóveda persistente y el shell nativo siguen pendientes.

El siguiente bloque recomendado es OCR con consentimiento y después una
cola durable con presupuesto, reintentos e idempotencia compartida.
