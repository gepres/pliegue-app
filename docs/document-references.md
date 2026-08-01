# Referencias documentales y carga diferida

## Decisión

Pliegue no debe duplicar un archivo local o de Drive para incorporarlo a la Biblioteca.
La entidad de producto es un documento indexado que apunta a una fuente revocable. El
binario se recupera desde esa fuente únicamente al analizar una versión nueva o al abrirlo.

## Contrato común

Cada `LibraryDocument` contiene una referencia discriminada:

| `kind` | Dirección persistida | Resolución al abrir |
| --- | --- | --- |
| `local-file` | `referenceId` → `FileSystemFileHandle` en IndexedDB | `queryPermission()` y `handle.getFile()` |
| `local-folder` | `sourceId + relativePath` → handles de carpeta/archivo | permiso de carpeta y `handle.getFile()` |
| `google-drive` | `fileId` y, cuando aplica, `driveId` | Drive API con token recuperado de la bóveda |
| `local-copy` | `storageId` → Blob en IndexedDB | fallback heredado o de compatibilidad |

Los handles son opacos: el navegador no entrega la ruta absoluta. Esto evita exponer rutas
privadas y permite que el usuario revoque permisos. Chrome documenta que los handles de
archivo y directorio son serializables en IndexedDB y que sus permisos deben comprobarse de
nuevo después de restaurarlos:
<https://developer.chrome.com/docs/capabilities/web-apis/file-system-access>

## Capa derivada

El manifiesto guarda solo:

- id, nombre, formato, tamaño, modificación y fingerprint;
- procedencia, disponibilidad y descriptor de referencia;
- estado/fecha del índice y hasta 32.000 caracteres de texto normalizado;
- ficha de catálogo IA en una base derivada separada, con proveedor, modelo, confianza y
  fingerprint de entrada;
- favoritos y progreso en sus almacenes versionados.

No guarda el binario, miniaturas ni secretos. PDF e imágenes empiezan como `metadata-only`;
DOCX, PPTX, XLSX, EPUB, TXT y Markdown usan extracción local. Un error de análisis no rompe
la referencia: el original puede seguir abriéndose.

El catálogo IA recibe únicamente un extracto configurable del índice y devuelve título,
autores, año, género, tipo, idioma, temas y resumen. La ficha es regenerable y nunca cambia
la dirección del original. Véase [`ai-catalog.md`](./ai-catalog.md).

## Resolución Google Drive

La futura integración conservará `fileId`, `driveId`, `modifiedTime`, versión/fingerprint y
capacidad de descarga. Para binarios, Drive resuelve el contenido con `files.get` y
`alt=media`; Google Docs, Sheets y Slides requieren `files.export`. El token OAuth no forma
parte del documento ni del índice y debe salir de la bóveda de credenciales.

- <https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get>
- <https://developers.google.com/workspace/drive/api/guides/manage-downloads>

## Ciclo de vida

1. El usuario vincula un archivo/carpeta o autoriza una ubicación de Drive.
2. Pliegue guarda la referencia y analiza la versión disponible.
3. Búsqueda opera sobre el índice derivado, sin cargar originales.
4. Abrir resuelve referencia, permiso y versión; luego lee el original.
5. Reescaneo compara fingerprint y reindexa solo cambios.
6. Desvincular elimina referencia, manifiesto, índice y progreso; nunca borra el original.

Las copias ya importadas no pueden migrarse automáticamente a handles porque el selector
HTML no conserva la ruta ni una identidad persistente del archivo original. La UI las marca
como copias de compatibilidad y permite eliminarlas después de volver a vincular su fuente.
