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
- ninguna copia se envía a Drive, Supabase o un proveedor de IA.

## Importar frente a vincular

La aplicación web ofrece dos contratos diferentes. **Importar una copia** funciona con el
selector estándar. **Vincular una carpeta** se activa progresivamente cuando el navegador
expone `showDirectoryPicker`, handles serializables y permisos de lectura del
[File System Access API](https://wicg.github.io/file-system-access/):

| Acción | Uso recomendado | Comportamiento |
| --- | --- | --- |
| Importar copia | portabilidad y uso web | guarda un Blob privado en IndexedDB |
| Vincular archivo | biblioteca viva | queda cubierto por el manifiesto de una carpeta vinculada |
| Vincular carpeta | corpus mantenido fuera de Pliegue | guarda handle + metadatos; no copia el contenido |

La interfaz explica esta diferencia antes del selector.

## Carpetas vinculadas en web

- El selector se abre únicamente por una acción explícita del usuario y solicita lectura.
- El `FileSystemDirectoryHandle` se guarda en una base IndexedDB separada junto con el
  manifiesto; no se conoce ni se muestra la ruta absoluta.
- Después de recargar, `queryPermission({mode: "read"})` decide si la fuente continúa
  disponible. Un handle recuperado desde IndexedDB puede volver a `prompt`, tal como
  advierte la especificación; en ese caso la UI solicita renovar acceso.
- **Buscar cambios** recorre subcarpetas y compara `ruta relativa + nombre + tamaño + última
  modificación`. Informa altas, modificaciones y eliminaciones y reemplaza únicamente el
  manifiesto de Pliegue.
- **Desvincular** elimina handle y metadatos. Nunca borra ni modifica archivos originales.
- Si la capacidad no existe, el bloque queda deshabilitado con explicación y “Importar
  copia” continúa disponible.

No se promete vigilancia en tiempo real. En web la sincronización es manual y bajo demanda;
los watchers del sistema operativo corresponden al shell de escritorio.

## Formatos y límites actuales

- PDF, EPUB, DOCX, PPTX, XLSX, TXT, Markdown, PNG y JPG.
- El lector muestra TXT y Markdown como texto plano seguro, sin interpretar HTML embebido.
- PDF utiliza el visor nativo del navegador; PNG y JPG conservan su proporción y contenido.
- EPUB, DOCX, PPTX y XLSX muestran un fallback explícito hasta integrar los conversores.
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

## Privacidad y recuperación

IndexedDB no es una bóveda criptográfica. Puede guardar documentos porque pertenecen al
perfil del navegador, pero nunca se usa para claves BYOK o tokens OAuth. Esos secretos
siguen bloqueados por `02.5`. Las copias pueden descargarse nuevamente desde Biblioteca;
backup, exportación masiva y restauración corresponden a `06.4`.

## Pendientes multiplataforma

- Tauri: diálogo nativo, scopes mínimos, permisos persistentes y file watchers en tiempo real.
- Expo: document picker, almacenamiento sandbox y permisos por plataforma.
- Extracción estructural de PDF/EPUB/Office, tablas, imágenes y archivos protegidos.
- Eliminación, cuota, exportación y recuperación de errores.
