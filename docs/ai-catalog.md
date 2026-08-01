# Catálogo documental asistido por IA

- Estado: incremento web funcional con BYOK de sesión
- Foundry: `03.6 · Índice global, clasificación y deduplicación` y `04.1–04.3 · IA BYOK`

## Objetivo

Después de vincular un archivo o una carpeta, Pliegue puede enriquecer cada documento con
una capa local y filtrable: título canónico, autores, año de publicación, géneros, tipo de
obra, idioma, temas, resumen y confianza. Esta capa no reemplaza el manifiesto ni modifica
el original.

## Flujo eficiente

1. El navegador recorre la carpeta y compara el fingerprint de cada archivo.
2. La extracción local genera hasta 32.000 caracteres normalizados.
3. El catalogador selecciona un extracto de 8.000, 12.000 o 24.000 caracteres, conservando
   el inicio y el cierre del texto.
4. Solo el título observado, formato, ruta relativa y extracto pasan al proveedor elegido.
5. El proveedor devuelve un JSON sujeto a un esquema común y Pliegue vuelve a validar y
   normalizar el resultado.
6. IndexedDB guarda la ficha, proveedor, modelo, fecha, estado y fingerprint de entrada.

El fingerprint incorpora versión del documento, proveedor, modelo y extracto. Una versión
ya catalogada se omite; cambiar el archivo, modelo o proveedor crea trabajo nuevo. La
concurrencia se limita a 1–3 solicitudes y el valor recomendado es 2.

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
| `needs-content` | PDF o imagen sin texto local; requiere extracción PDF/OCR |
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

- PDF e imágenes todavía no generan texto para este flujo; quedan `needs-content`.
- No hay cola durable entre recargas, presupuesto, límites por proveedor ni estimación de
  costo antes de ejecutar.
- No hay embeddings ni búsqueda semántica global.
- Ollama Cloud no se trata como equivalente a un servidor Ollama remoto propio; el flujo
  requiere una instancia que acepte el esquema estructurado y CORS.
- La bóveda persistente y el shell nativo siguen pendientes.

El siguiente bloque recomendado es extracción PDF/OCR con consentimiento y después una
cola durable con presupuesto, reintentos e idempotencia compartida.
