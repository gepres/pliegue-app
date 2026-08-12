# 07. Modelo de datos

> Documento derivado del dossier maestro de Pliegue. Mantener ambos sincronizados cuando cambien decisiones de producto.

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
