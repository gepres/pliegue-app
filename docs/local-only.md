# Modo local-only e importación web

- Estado: Implementación web inicial
- Foundry: `02.4 · Cuenta, recuperación y modo local-only` y `03.2 · Archivos locales`

## Contrato visible

Pliegue puede utilizarse sin correo, contraseña ni backend. El usuario confirma el modo
local-only desde Ajustes y el shell muestra ese estado. En esta modalidad:

- preferencias y confirmación de modo viven en el almacenamiento del sitio;
- los metadatos y copias importadas viven en IndexedDB;
- no existe sincronización entre dispositivos ni recuperación remota;
- borrar los datos del sitio o el perfil del navegador elimina la biblioteca local;
- ninguna copia binaria se envía a Drive, Supabase o un proveedor de IA; un extracto
  textual solo sale cuando el usuario inicia o activa expresamente el catálogo IA.

## Importar frente a vincular

La aplicación web ofrece dos contratos diferentes. **Importar una copia** funciona con el
selector estándar. **Vincular una carpeta** se activa progresivamente cuando el navegador
expone `showDirectoryPicker`, handles serializables y permisos de lectura del
[File System Access API](https://wicg.github.io/file-system-access/):

| Acción | Uso recomendado | Comportamiento |
| --- | --- | --- |
| Vincular archivo | documento individual | guarda un `FileSystemFileHandle`, metadatos e índice derivado; no guarda el binario |
| Vincular carpeta | corpus mantenido fuera de Pliegue | guarda handle + metadatos; no copia el contenido |
| Importar copia | compatibilidad excepcional | guarda un Blob privado en IndexedDB cuando el navegador no admite handles |

La interfaz explica esta diferencia antes del selector.

La web no puede leer ni persistir una ruta absoluta como `C:\Documentos\archivo.pdf`. El
navegador entrega un handle opaco y revocable. Ese handle es la “dirección” segura: se puede
serializar en IndexedDB, pero no revela la estructura privada del sistema de archivos.

## Carpetas vinculadas en web

- El selector se abre únicamente por una acción explícita del usuario y solicita lectura.
- El `FileSystemDirectoryHandle` se guarda en una base IndexedDB separada junto con el
  manifiesto; no se conoce ni se muestra la ruta absoluta.
- Después de recargar, `queryPermission({mode: "read"})` decide si la fuente continúa
  disponible. Un handle recuperado desde IndexedDB puede volver a `prompt`, tal como
  advierte la especificación; en ese caso la UI solicita renovar acceso.
- **Buscar cambios** recorre subcarpetas y compara `ruta relativa + nombre + tamaño + última
  modificación`. Informa altas, modificaciones y eliminaciones, vuelve a analizar solo los
  elementos nuevos/modificados y reemplaza únicamente el manifiesto e índice de Pliegue.
- **Desvincular** elimina handle y metadatos. Nunca borra ni modifica archivos originales.
- Si la capacidad no existe, el bloque queda deshabilitado con explicación y “Importar
  copia” continúa disponible.

No se promete vigilancia en tiempo real. En web la sincronización es manual y bajo demanda;
los watchers del sistema operativo corresponden al shell de escritorio.

## Formatos y límites actuales

- PDF, EPUB, DOCX, PPTX, XLSX, TXT, Markdown, PNG y JPG.
- El lector muestra TXT y Markdown como texto plano seguro, sin interpretar HTML embebido.
- PDF utiliza el visor nativo del navegador; PNG y JPG conservan su proporción y contenido.
- EPUB preserva el orden del `spine` y convierte capítulos en secciones editoriales.
- DOCX recupera encabezados, párrafos y listas; PPTX ordena las diapositivas y XLSX
  reconstruye hojas y celdas compartidas en tablas desplazables.
- La vista textual se limita a 1 MB para proteger la fluidez; la copia original permanece intacta.
- Máximo 50 MB por archivo durante esta primera etapa.
- Un fingerprint `nombre + tamaño + última modificación` evita copias duplicadas.
- El archivo vacío, demasiado grande o con extensión desconocida se rechaza antes de
  escribir en IndexedDB.
- Un escaneo de carpeta admite inicialmente hasta 5.000 entradas compatibles; los archivos
  vacíos o con extensión desconocida no entran al manifiesto.

El límite no sustituye una política de cuota. La siguiente iteración debe consultar la
estimación de almacenamiento, avisar cuando quede poco espacio y permitir eliminar o
exportar copias de forma verificable.

## Apertura desde Biblioteca

Cada copia importada y cada documento de una carpeta vinculada tiene una URL estable del
lector (`/app/lector?document=…`). La ruta de Next.js solo interpreta el identificador; el
archivo se recupera en un componente cliente desde IndexedDB y nunca cruza una frontera de
servidor.

Las carpetas vinculadas consultan el permiso antes de abrir. Si el navegador vuelve a estado
`prompt` o `denied`, el lector ofrece una acción explícita para renovarlo. La solicitud es la
primera operación asíncrona del clic para conservar la activación de usuario exigida por el
navegador. Perder o negar el permiso no elimina el manifiesto ni toca el archivo original.

## Datos reales y progreso de lectura

Las rutas `/app`, `/app/biblioteca` y `/app/lector` no cargan documentos, métricas ni texto
de demostración. Con la Biblioteca vacía muestran un onboarding explícito; después de una
importación o vínculo, Inicio calcula documentos, favoritos, lecturas activas y recientes a
partir de IndexedDB y de los permisos recuperados en el navegador.

El progreso usa la clave versionada `pliegue-reading-progress-v1` y guarda únicamente id,
título, formato, origen, porcentaje y fecha. Se actualiza al desplazar contenido textual o
estructurado, emite cambios entre pestañas y nunca guarda el cuerpo del documento en
`localStorage`. Inicio ofrece **Retomar lectura** cuando existe una posición válida.

La reconciliación ignora actualizaciones antiguas y evita que un avance nuevo reduzca el
porcentaje guardado por accidente. Solo **Empezar desde el inicio** permite una regresión
explícita. En esta etapa, el visor PDF nativo no expone su desplazamiento interno; Pliegue
registra que el archivo se abrió, pero no puede medir cada página dentro del plugin del
navegador.

## Índice derivado sin copia del archivo

Al vincular un archivo o escanear una carpeta, Pliegue abre temporalmente cada original,
extrae texto con el mismo pipeline seguro del lector y conserva como máximo 32.000
caracteres normalizados por documento. TXT, Markdown, EPUB, Office y PDF con capa de texto
pueden quedar `indexed`; las imágenes y los PDF escaneados quedan `metadata-only` hasta
incorporar OCR.

Las copias importadas se indexan igual que los archivos vinculados. El índice guarda la
versión del extractor que lo produjo (`contentIndexVersion`): al ampliar la extracción, lo
indexado con una versión anterior se rehace aunque el archivo no haya cambiado. Sin esa
versión, «Buscar cambios» compara solo nombre, tamaño y fecha, y un documento ya vinculado
conservaría para siempre un índice vacío. Para las copias importadas existe **Actualizar
índice local**, que las rehace desde el binario ya guardado sin pedir permisos nuevos.

El índice sirve para búsqueda local y no contiene el `Blob` original. Al abrir un resultado,
el lector resuelve su referencia, comprueba permiso y ejecuta `handle.getFile()` contra la
ubicación original. Si el archivo cambió, **Buscar cambios** renueva fingerprint e índice.
Si fue movido, eliminado o se revocó el permiso, la tarjeta permanece trazable como
desconectada y solicita relink/permiso.

## Catálogo IA opcional

Sobre ese índice local, Pliegue puede solicitar una ficha estructurada a OpenAI, Anthropic
u Ollama. El flujo está apagado por defecto, limita el extracto y omite versiones sin
cambios. Autor, título canónico, año, género, tipo, idioma, temas, resumen y confianza se
guardan en una base IndexedDB separada y alimentan búsqueda y filtros de Biblioteca.

Las imágenes y los PDF escaneados quedan `needs-content` hasta incorporar OCR. El contrato,
privacidad, credenciales de sesión y límites están documentados en
[`ai-catalog.md`](./ai-catalog.md).

## Extracción de PDF

El texto de los PDF se extrae con [`pdf.js`](https://mozilla.github.io/pdf.js/), cargado bajo
demanda igual que `fflate`: ninguna otra ruta paga su peso y el chunk solo se descarga al
indexar el primer PDF. La extracción ocurre íntegramente en el navegador, sin ruta de
servidor ni subida temporal.

- Se piden fuentes, WASM y recursos auxiliares desactivados: extraer texto no los necesita y
  así la operación no genera ninguna petición de red.
- Límites: 50 MB de entrada, 300 páginas y 1.000.000 de caracteres en el lector; la
  indexación pide un tope menor porque solo conserva 32.000 caracteres.
- Un PDF protegido con contraseña o dañado se informa como tal y no interrumpe la
  vinculación del resto de archivos.
- Se conserva el número de página de cada fragmento, base para las citas verificables de
  `04.5` y para medir el progreso dentro del documento.
- Un PDF **escaneado** no tiene capa de texto: sus páginas salen vacías y el documento queda
  `metadata-only`, esperando el OCR de `03.5`. No es un error.

## Extracción de EPUB y Office

Los cuatro formatos son contenedores ZIP. El lector carga
[`fflate`](https://github.com/101arrowz/fflate) únicamente cuando abre uno de ellos y ejecuta
la descompresión dentro del navegador. No hay ruta de servidor ni subida temporal.

La primera versión aplica estas defensas:

- máximo 50 MB de entrada, 5 MB por XML y 16 MB de salida XML acumulada;
- máximo 5.000 entradas detectadas y 800 entradas seleccionadas;
- rechazo de rutas relativas inseguras, ratios de compresión anómalos y ZIP dañados;
- máximo 1.000.000 de caracteres renderizados, 300 secciones, 1.000 filas y 64 columnas;
- scripts, estilos, SVG y navegación EPUB no entran al texto extraído.

El resultado es una vista de lectura, no una réplica visual completa. En esta etapa no se
renderizan imágenes embebidas, comentarios, macros, animaciones, fórmulas evaluadas ni estilos
de Office. El archivo original siempre permanece disponible sin modificación.

## Privacidad y recuperación

IndexedDB no es una bóveda criptográfica. Puede guardar documentos y fichas derivadas
porque pertenecen al perfil del navegador, pero nunca se usa para claves BYOK o tokens
OAuth. OpenAI y Anthropic aceptan una clave temporal que vive únicamente en memoria de la
pestaña; la bóveda persistente sigue bloqueada por `02.5`. Las copias pueden descargarse
nuevamente desde Biblioteca; backup, exportación masiva y restauración corresponden a
`06.4`.

## Pendientes multiplataforma

- Tauri: diálogo nativo, scopes mínimos, permisos persistentes y file watchers en tiempo real.
- Expo: document picker, almacenamiento sandbox y permisos por plataforma.
- Estructura de PDF más allá del texto plano: encabezados, columnas, tablas y coordenadas.
- OCR para imágenes y PDF escaneados, imágenes embebidas y archivos protegidos.
- Eliminación, cuota, exportación y recuperación de errores.
