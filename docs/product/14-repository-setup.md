# 14. Estructura de repositorio y arranque

> Documento derivado del dossier maestro de Pliegue. Mantener ambos sincronizados cuando cambien decisiones de producto.

## 9. Arquitectura técnica recomendada

### Enfoque

Un monorepo TypeScript con experiencias específicas por plataforma y contratos compartidos. Compartir dominio, tokens, iconos y API; no forzar el 100 % del código visual entre web y móvil.

```text
pliegue/
├── apps/
│   ├── web/              # Next.js App Router
│   ├── mobile/           # Expo + React Native, Android/iOS
│   └── desktop/          # Tauri para Windows y macOS
├── packages/
│   ├── domain/           # entidades, casos de uso y permisos
│   ├── api-client/       # cliente tipado
│   ├── design-tokens/    # color, tipografía, espacio y movimiento
│   ├── ui-web/           # componentes web accesibles
│   ├── ui-native/        # componentes nativos equivalentes
│   ├── reader-core/      # anclas, progreso y anotaciones
│   └── schemas/          # contratos de validación
├── services/
│   ├── control-plane/    # conexiones, biblioteca, notas y shares
│   ├── indexer/          # inventario, exportación y sincronización
│   └── document-workers/ # parsing, OCR, transcripción e IA
└── infrastructure/
    ├── database/
    ├── queues/
    └── observability/
```

### Stack sugerido

| Capa | Elección | Motivo |
|---|---|---|
| Web | Next.js App Router + TypeScript | panel y lector web, rutas compartibles, buen modelo servidor/cliente |
| Móvil | Expo + React Native con development builds | Android/iOS, cámara, share sheet, archivos y notificaciones nativas |
| Escritorio | Tauri para Windows/macOS | selector nativo, lectura local con alcance limitado, vigilancia recursiva e instaladores sin duplicar toda la UI |
| Datos | PostgreSQL/Supabase + RLS | modelo relacional, autenticación y control por usuario/equipo |
| Búsqueda | texto completo + pgvector | recuperación híbrida en una primera etapa |
| Trabajos | cola durable + workers aislados | indexación larga, reintentos e idempotencia |
| Archivos derivados | almacenamiento de objetos cifrado | miniaturas, OCR y exportaciones temporales |
| Observabilidad | logs estructurados, métricas y trazas | depurar cada etapa de un documento |

Tauri también soporta móvil, pero se recomienda Expo para Android/iOS porque el producto necesita cámara, compartir, gestos, descarga y lectura móvil de alta calidad. Tauri queda enfocado en Windows y macOS.

### Matriz de entrega por plataforma

| Plataforma | Paquete | Archivos locales | Integración destacada |
|---|---|---|---|
| Web | PWA/web responsive | abrir, importar y vincular cuando el navegador lo permita | Drive, enlaces compartibles y administración |
| Windows | instalador Tauri firmado | carpetas persistentes, watcher y bóveda local | share target, protocolo propio y funcionamiento offline |
| macOS | DMG y, después, Mac App Store | carpeta persistente mediante sandbox/bookmarks | firma, notarización, entitlements y share extension posterior |
| Android | Expo/React Native | Storage Access Framework, compartir e importar | cámara, notificaciones y lectura offline |
| iOS/iPadOS | Expo/React Native | document picker y copias administradas | cámara, share sheet, archivos y lectura offline |

### Modos de privacidad

1. **Nube privada:** el servidor procesa y guarda texto derivado y embeddings cifrados. Es la opción más consistente para web y sincronización entre dispositivos.
2. **Vinculado al dispositivo:** el archivo original permanece local; Pliegue guarda derivados cifrados para búsqueda y continuidad entre dispositivos, solo con consentimiento.
3. **Bóveda local:** la app de Windows/macOS mantiene contenido, índice y, progresivamente, modelos locales. Puede sincronizar únicamente metadatos o notas elegidas. El MVP web admite archivos locales, pero el modo completamente local se entrega con la app de escritorio.

### Región, identidad y recuperación

- Región primaria de base de datos y objetos: **São Paulo (`sa-east-1`)**, cercana al mercado inicial peruano. Metadatos y derivados de un Área se mantienen en la misma región cuando el proveedor lo permita.
- Los proveedores externos de IA se tratan como subencargados independientes; región y retención se muestran por ruta. Un requisito de residencia incompatible desactiva esa ruta en lugar de degradarla silenciosamente.
- Web con Drive/sincronización: cuenta obligatoria mediante Google o enlace mágico por correo. Escritorio: **modo local sin cuenta** disponible desde el inicio.
- La bóveda local se cifra con una clave guardada en el almacén seguro del sistema. Al activar sincronización cifrada se genera un código de recuperación; sin ese código ni un dispositivo autorizado, Pliegue no promete recuperar el contenido cifrado.
- Una biblioteca local puede convertirse en cuenta conservando identificadores y notas, sin duplicar originales.

### Derivados, desconexión y borrado

- Si una unidad queda temporalmente `detached`, se conservan metadatos, notas, favoritos, progreso, miniaturas y el índice local cifrado. No se generan respuestas nuevas desde contenido inaccesible; las respuestas previas se muestran como históricas.
- El original vinculado nunca se copia a nube sin activar **Sincronizar contenido**. En modo importado, Pliegue administra una copia cifrada.
- **Quitar vínculo** conserva notas/progreso y elimina el permiso. **Eliminar de Pliegue** retira original importado y derivados del sistema activo en 24 horas, del índice/colas en 7 días y de backups rotativos en un máximo de 35 días.
- El usuario recibe un comprobante de borrado con categorías afectadas y fecha máxima de purga. Los eventos mínimos de auditoría se conservan sin texto documental cuando la ley lo exija.

## 10. Modelo de datos inicial

| Entidad | Responsabilidad |
|---|---|
| `accounts` | usuario, equipo, plan y región |
| `workspaces` | Área de trabajo, propietario, políticas de privacidad e idioma |
| `workspace_sources` | fuentes vinculadas y reglas de inclusión en el alcance global |
| `saved_scopes` | Todo, Drive, local o selección explícita reutilizable |
| `connections` | proveedor (`google_drive`, `local_web`, `local_windows`, `local_macos`, `device_picker`), scopes y estado; secretos cifrados fuera de columnas públicas |
| `source_roots` | carpeta, conjunto de archivos o importación; referencia opaca, modo de incorporación y política de retención |
| `source_access_grants` | alcance autorizado, plataforma, permiso y última validación |
| `documents` | identidad canónica, metadatos normalizados y huella de contenido |
| `document_instances` | ubicación concreta en Drive/local, identificador del proveedor, ruta opaca y disponibilidad |
| `document_versions` | checksum, versión remota y estado de indexación |
| `content_blocks` | títulos, párrafos, tablas, imágenes y anclas |
| `chunks` | fragmentos recuperables y metadatos de contexto |
| `embeddings` | vector, modelo y versión del chunk |
| `categories` | faceta, nombre, color y origen humano/IA |
| `document_categories` | relación, confianza, explicación y confirmación |
| `annotations` | tipo, ancla, cuerpo, color y visibilidad |
| `favorites` | sujeto favorito, tipo, orden, nota y disponibilidad offline |
| `reading_progress` | posición vigente por usuario, documento y dispositivo |
| `reading_sessions` | inicio, fin, tiempo activo, modo, dispositivo y última ancla significativa |
| `reading_position_history` | historial corto para conflicto offline, relectura y recuperación |
| `resume_preferences` | preguntar siempre/global/por documento y opciones de reanudación |
| `reading_profiles` | perfil nombrado, tema, tipografía, espaciado y alcance predeterminado |
| `reader_preferences` | overrides por cuenta, Área de trabajo o documento |
| `device_display_preferences` | brillo de app y ajustes que no deben sincronizarse entre pantallas |
| `conversations` / `messages` | alcance consultado, respuesta y mapa de citas |
| `reading_preferences` | gustos declarados, señales permitidas, exclusiones, idioma y presupuesto |
| `recommendation_events` | explicación, impresión, apertura y feedback del usuario |
| `catalog_books` / `book_editions` | obra externa, autores, ISBN, idioma, formato y portada |
| `book_offers` | proveedor, país, moneda, precio, envío, URL y fecha de verificación |
| `offer_sources` / `offer_search_runs` | API/feed/web, autorización de extracción, consulta, país, estado y frescura |
| `price_alerts` | edición/formato, país, precio objetivo y canal de aviso |
| `translations` | documento/versión, idiomas, motor, glosario, estado y calidad |
| `translation_blocks` | ancla original, texto traducido, geometría y corrección humana |
| `glossary_terms` | término, traducción preferida y alcance de Área de trabajo |
| `ai_providers` | OpenAI, Anthropic, Ollama o adaptador futuro; endpoint y estado |
| `ai_credentials` | referencia cifrada, propietario, alcance y rotación; nunca la clave en claro |
| `ai_models` / `ai_capabilities` | catálogo dinámico, modalidades, contexto, funciones y fecha de refresco |
| `ai_workflow_routes` | flujo, proveedor/modelo, parámetros, límite, privacidad y prioridad |
| `ai_fallbacks` | cadena autorizada y límite de cruce local/nube |
| `ai_usage_events` / `ai_budgets` | tokens/unidades, costo estimado, latencia, error y presupuesto por Área/flujo |
| `share_cards` | plantilla, redacciones, fuente y estado público |
| `sync_cursors` | cursor remoto, checkpoint de inventario o estado del watcher por fuente |
| `jobs` / `job_attempts` | etapa, progreso, errores y reintentos |
| `audit_events` | acceso, exportación, compartido y borrado |
| `local_vaults` / `recovery_kits` | referencia de clave del SO, dispositivos autorizados y estado del código; nunca la clave en claro |
| `export_jobs` / `deletion_receipts` | alcance, artefactos, progreso, checksum y fechas 24 h/7 d/35 d |
| `rights_assessments` | licencia, país, DRM, dominio público, declaración, confianza y acciones permitidas |
| `vendor_terms_registry` | fuente comercial/IA, versión de términos, campos permitidos, caché, revisión y baja |

Todas las tablas de usuario o equipo deben aplicar RLS. Las claves de proveedor y refresh tokens requieren cifrado administrado por KMS o un almacén de secretos.
