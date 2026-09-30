# 10. Sincronización: Drive, local y offline

> Documento derivado del dossier maestro de Pliegue. Mantener ambos sincronizados cuando cambien decisiones de producto.

## 8. Fuentes: Google Drive y archivos locales

### 8.1 Google Drive

#### Flujo de autorización

1. Iniciar sesión en Pliegue.
2. Explicar con lenguaje simple qué se leerá y qué no se modificará.
3. Abrir Google Picker.
4. Elegir carpeta o archivos.
5. Mostrar estimación de cantidad, formatos y tiempo antes de iniciar.
6. Indexar en segundo plano y permitir empezar con los primeros documentos listos.

#### Decisión crítica de OAuth

Google recomienda combinar Picker con `drive.file` por seguridad y mejor experiencia. Ese alcance concede acceso por archivo. La hipótesis de acceso recursivo a todos los descendientes de una carpeta existente debe comprobarse en un **spike técnico con cuentas personales y Shared Drives** antes de cerrar la arquitectura.

Si el producto necesita leer permanentemente una carpeta arbitraria completa y `drive.file` no cubre sus descendientes, podría requerir `drive.readonly`, que Google clasifica como alcance restringido. Una aplicación pública que almacene o transmita esos datos puede necesitar verificación y evaluación de seguridad. Por eso el MVP no debe pedir permisos de escritura y el calendario debe reservar este trámite desde el inicio.

#### Sincronización

- Guardar cursor de cambios por usuario y, cuando aplique, por Shared Drive.
- Recibir notificaciones mediante webhook y consultar el registro de cambios.
- Comparar versión conocida con estado actual; una notificación no contiene necesariamente el delta completo.
- Renovar canales antes de expirar.
- Tratar pérdida de acceso y eliminación como estados distintos cuando sea posible.
- Reindexar solo el archivo afectado y mantener trabajos idempotentes.

### 8.2 Archivos locales

Los archivos locales usan el mismo modelo documental, parsers, categorías, lector, anotaciones y citas que Drive. La diferencia está en cómo cada plataforma concede y conserva el acceso.

| Plataforma | Selección | Comportamiento recomendado |
|---|---|---|
| Windows | selector nativo de archivo o carpeta | lectura recursiva limitada a la raíz elegida, vigilancia de cambios y opción de índice totalmente local |
| macOS | selector nativo + bookmark de seguridad | acceso persistente limitado a lo elegido, watcher, sandbox/entitlements y opción de índice totalmente local |
| Web | File System Access API cuando esté disponible | permiso explícito para archivo/carpeta; al volver puede requerir autorización; fallback mediante selector, arrastrar y soltar o importación |
| Android/iOS | selector de documentos, menú Compartir y cámara | acceso solo a elementos elegidos por el usuario; copia temporal o a la bóveda privada de la app cuando el sistema lo requiera |

#### Estados de una fuente local

- `available`: carpeta montada y permiso vigente.
- `indexing`: inventario o extracción en curso.
- `ready`: índice actualizado.
- `detached`: disco externo, unidad de red o carpeta no disponible.
- `permission_required`: el sistema operativo o navegador exige volver a autorizar.
- `moved`: la raíz cambió de ubicación y requiere confirmación.

La biblioteca conserva el título, las categorías, las notas y el último estado cuando una unidad está desconectada. El contenido no debe usarse para una nueva respuesta de IA si el usuario eligió no conservar texto derivado o si la política de la fuente exige disponibilidad en vivo.

#### Seguridad local

- Pedir lectura, nunca acceso global al disco.
- Limitar el alcance a la carpeta elegida y sus descendientes autorizados.
- No seguir enlaces simbólicos que salgan de la raíz permitida.
- No ejecutar macros, scripts, binarios ni contenido activo.
- Aplicar límites contra archivos comprimidos maliciosos, rutas circulares y archivos excesivos.
- Guardar una referencia opaca a la ruta; no exponer rutas privadas en analítica, logs o tarjetas compartidas.
- Detectar cambios con watcher en Windows/macOS y reconciliar periódicamente el inventario por si se pierde un evento.
- En macOS sandboxed, crear y renovar bookmarks de seguridad solo para las raíces elegidas, liberar el recurso al terminar y mostrar una acción clara si el permiso queda obsoleto.

#### Tres modos de incorporación

1. **Abrir:** lectura puntual; no queda en la biblioteca al cerrar salvo que el usuario lo guarde.
2. **Vincular:** Pliegue conserva permiso y sincroniza los cambios mientras la fuente esté disponible.
3. **Importar:** crea una copia privada administrada por Pliegue para disponer del documento entre dispositivos.

La decisión UX queda cerrada con un **predeterminado contextual**:

- Carpeta en Windows/macOS o navegador compatible: **Vincular**, porque evita duplicados y conserva la fuente como autoridad.
- Archivo individual en móvil o navegador sin permiso persistente: **Importar**, porque garantiza que reaparezca.
- **Abrir una vez** permanece como acción secundaria para revisar algo sin agregarlo.

Antes de indexar se muestra una hoja breve con Fuente original, Qué conservará Pliegue, Dónde se procesará y Cómo retirarlo. El usuario confirma el modo, pero no debe elegir entre tres conceptos técnicos en cada apertura.
