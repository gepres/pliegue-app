# 17. Decisiones cerradas y pendientes

> Documento derivado del dossier maestro de Pliegue. Mantener ambos sincronizados cuando cambien decisiones de producto.

## 20. Registro de decisiones cerradas

Estas decisiones se consideran la línea base v0.6. Cambiarlas requiere registrar motivo, impacto, responsable y fecha; las validaciones indicadas pueden ajustar valores, pero no quedar como “pendiente indefinido”.

### 20.1 Mercado, archivos, marca y Drive

**1. Segmento inicial — investigadores y consultores profesionales.** El lanzamiento habla a personas y equipos pequeños que preparan informes, tesis, revisiones, diagnósticos o entregables basados en múltiples fuentes. Estudiantes y empresas grandes pueden usarlo, pero no dirigen el MVP.

**2. Comportamiento de archivo local — predeterminado contextual.** Carpeta de escritorio/web compatible: Vincular. Archivo móvil o permiso no persistente: Importar. Abrir una vez: acción secundaria. Siempre se muestra dónde vive el original y si habrá una copia.

**3. Nombre y marca — Pliegue sigue como nombre de trabajo, no como marca jurídicamente aprobada.** El filtro obligatorio antes de dominio público, tiendas o publicidad incluye:

1. búsqueda exacta, parcial, fonética y conceptual de “Pliegue” y variantes;
2. similitud visual del símbolo en INDECOPI/Quipu Marca y WIPO Global Brand Database;
3. revisión profesional en clases de software descargable, SaaS, educación/contenido y servicios comerciales que correspondan;
4. dominios, handles, App Store, Google Play y nombres societarios;
5. dictamen de abogado/agente de marcas en Perú y países de expansión.

El sistema legal del producto también tendrá un filtro robusto para licencia, dominio público, DRM y permisos, pero ningún clasificador sustituye asesoría jurídica.

**4. Google Drive — Picker + `drive.file` primero.** El alpha usa Google Picker y acceso por archivo elegido. El spike debe probar carpeta personal, compartida y Shared Drive con al menos tres cuentas reales. Si no permite leer de forma duradera todos los descendientes que el usuario seleccionó, Pliegue solicitará `drive.readonly` únicamente en el flujo “Vincular carpeta completa”, con pantalla de justificación, solo lectura, verificación OAuth y evaluación de seguridad presupuestadas. No se solicita permiso de escritura en el MVP.

### 20.2 Región, OCR, corpus y validación

**5. Región y OCR — São Paulo + escalamiento por confianza.** PostgreSQL, objetos y colas se crean en `sa-east-1` cuando el proveedor lo permita. Tesseract es el OCR gratis/local para texto impreso; Google Document AI Enterprise OCR se usa bajo consentimiento cuando la calidad sea baja, haya escritura manuscrita o el diseño sea complejo. Ningún procesador generativo global se usa en un Área con residencia estricta sin advertencia y aprobación.

**6. Corpus de calidad — 100 documentos con licencia segura.** Solo material propio, sintético o de dominio público:

| Grupo | Cantidad |
|---|---:|
| PDF digital: académico, multicolumna, informe con tablas y libro | 20 |
| PDF escaneado: limpio, ruidoso, rotado, mixto y manuscrito | 15 |
| DOCX | 10 |
| EPUB | 10 |
| exportaciones de Google Docs | 8 |
| PPTX | 8 |
| XLSX/CSV | 6 |
| imágenes JPEG/PNG/HEIC | 6 |
| HTML/MHTML | 5 |
| TXT/Markdown | 4 |
| audio/video con transcripción | 4 |
| negativos: cifrado, DRM, corrupto y tamaño extremo | 4 |
| **Total** | **100** |

Distribución lingüística: 40 español, 30 inglés, 15 portugués y 15 mixtos. Cada caso guarda resultado esperado para texto, orden, tablas, imágenes, citas, traducción, anclas, tiempo y memoria.

**7. Prueba con usuarios — compuerta obligatoria.** Antes de móvil/escritorio se realizan 12 pruebas moderadas: 6 investigadores y 6 consultores. Tareas: conectar fuentes, hallar evidencia, retomar, traducir y exportar una captura. Para avanzar: 10/12 completan sin ayuda cada tarea crítica; 12/12 identifican alcance/origen de IA; mediana de primer documento listo menor a 3 minutos; ninguna persona cree que Pliegue modificó sus fuentes.

### 20.3 Desconexión, alcance y personalización

**8. Derivados desconectados — continuidad mínima, contenido controlado.** Se conservan metadatos, notas, favoritos, progreso, miniaturas e índice local cifrado mientras la fuente siga vinculada. No se generan respuestas nuevas si el original no está disponible. Quitar vínculo conserva datos personales; Eliminar de Pliegue purga activos en 24 horas, índices/colas en 7 días y backups en 35 días.

**9. Alcance — amplio para biblioteca, estrecho para IA.** Biblioteca/búsqueda empieza en Todo; Preguntar empieza en documento/selección; Traducción empieza en selección; clasificación usa la política completa del Área. Se vuelve a pedir consentimiento únicamente cuando cambia la frontera de datos o proveedor.

**10. Recomendaciones — gustos explícitos primero.** Se usan gustos, favoritos, Quiero leer, Ya lo leí y No es para mí. Historial es opt-in. Notas, subrayados y texto documental están desactivados por defecto y requieren consentimiento separado. El perfil se puede explicar, editar, reiniciar y exportar.

### 20.4 Ofertas, traducción y lectura

**11. Ofertas — Perú/PEN primero.** Catálogo: Google Books + Open Library de bajo volumen. Comercio objetivo: BuscaLibre Perú mediante afiliación y acuerdo de feed/API; Google Books `saleInfo` aporta ofertas digitales. Amazon Creators API, Mercado Libre u otras librerías se habilitan solo tras verificar acceso y términos. Catálogo se cachea 7 días; precios 6 horas; alerta máxima cada 6 horas. Siempre se conserva moneda original y se confirma precio final en la tienda.

**12. Traducción — una ruta gratis y una rápida de pago.** Gratis local: LibreTranslate autoalojado/Ollama. Gratis con cuota: DeepL API Free cuando esté disponible. Pago recomendado: DeepL API Pro. Documento complejo: Google Cloud Translation Advanced como fallback autorizado. Glosarios por Área, caché cifrado y versionado; exportación completa solo para obra propia, dominio público o permiso confirmado.

**13. Perfiles de lectura — Día, Noche y Estudio.** Tamaño inicial 18 px, rango 14–32 px; brillo de app 40–100 %; línea 1.65; ancho 65 caracteres. Precedencia tipográfica documento → Área → cuenta → predeterminado. Brillo físico/luminancia por dispositivo nunca se sincroniza. Los 12 tests pueden ajustar valores, pero no la regla de precedencia.

### 20.5 Cuenta, portabilidad y conflictos

**14. Cuenta y recuperación — local sin cuenta, nube con identidad.** Windows/macOS permiten bóveda local sin registro. Drive, web sincronizada y colaboración requieren Google o enlace mágico. La clave de bóveda usa el almacén seguro del SO; sincronización cifrada genera código de recuperación. Si se pierden código y dispositivos autorizados, el contenido cifrado no es recuperable.

**15. Exportación y backup — salida completa y borrado demostrable.** Exportación ZIP incluye catálogo CSV/JSON, notas Markdown/JSON, favoritos, posiciones, glosarios, ajustes y originales importados opcionales. Backups cifrados diarios con retención rotativa de 35 días; restauración probada trimestralmente. El borrado emite comprobante y respeta los plazos 24 h/7 d/35 d.

**16. Conflictos offline — reglas por entidad.** Progreso conserva ambas posiciones si hubo avance concurrente; notas usan versiones y crean copia de conflicto si no hay merge seguro; favoritos usan eventos add/remove con tombstone; categorías manuales ganan a IA y las adiciones concurrentes se unen; traducciones humanas nunca se sobrescriben y crean variante; preferencias usan última edición con historial de deshacer de 30 días.

### 20.6 IA, macOS, fuentes comerciales, derechos y SLA

**17. Matriz IA — Equilibrado como predeterminado.** Tesseract/Google para OCR; OpenAI para clasificación, embeddings y visión; Claude para RAG/síntesis; DeepL para traducción; Ollama para contenido confidencial/local. Los modelos se descubren dinámicamente por capacidad. BYOK cifrado; región y retención visibles; alerta de presupuesto al 80 %, límite al 100 %; un fallback entre proveedores o local→nube solo ocurre si fue preautorizado en esa fila.

**18. macOS — DMG firmado y notarizado primero.** Es el canal beta/GA inicial porque permite probar carpetas, bookmarks, watcher y Ollama con menor fricción. Mac App Store se evalúa después de estabilizar sandbox/entitlements; no se mantienen dos canales antes de tener actualizaciones y soporte maduros.

**19. Allowlist de ofertas — denegar por defecto.** Solo APIs, feeds, programas afiliados o páginas cuya extracción esté expresamente permitida. Cada conector guarda términos revisados, fecha, campos permitidos, caché, atribución y método de baja. BuscaLibre puede recibir enlaces afiliados desde el MVP, pero el precio automatizado espera autorización. Revisión legal/técnica trimestral y baja inmediata al cambiar términos.

**20. Derechos — Perú primero, sin evasión de DRM.** Pliegue detecta restricciones y abre externamente lo no procesable. Traducción completa, exportación de página o imagen y captura extensa requieren obra propia, dominio público o permiso. Una tarjeta breve con atribución sigue siendo una regla conservadora de producto, no garantía legal. El filtro combina licencia, país, autor/fecha, DRM, restricciones de descarga, sensibilidad y declaración del usuario; los casos dudosos se bloquean para exportación y se remiten a revisión.

**21. SLA — objetivos realistas por fase.** Beta: disponibilidad nube 99.5 % mensual. GA de pago: 99.9 %. Guardado local de progreso menor a 500 ms; sincronización de posición conectada p95 menor a 5 s; cambios Drive p95 visibles en 5 min; RPO de metadatos 15 min y RTO 4 h; restauración de objetos en 24 h. Soporte Profesional acusa incidentes críticos en 8 horas hábiles y Personal en 1 día hábil. Los originales vinculados permanecen bajo backup del usuario; Pliegue responde solo por copias importadas y derivados administrados.

## 21. Fuentes oficiales consultadas

- [Google Drive API: alcances OAuth](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Picker](https://developers.google.com/workspace/drive/api/guides/picker)
- [Google Drive API: registro de cambios](https://developers.google.com/workspace/drive/api/guides/about-changes)
- [Google Drive API: notificaciones push](https://developers.google.com/workspace/drive/api/guides/push)
- [Google Drive API v3](https://developers.google.com/drive/api/reference/rest/v3)
- [NotebookLM: tipos de fuente](https://support.google.com/notebooklm/answer/16215270?hl=en)
- [NotebookLM: descripción](https://support.google.com/notebooklm/answer/16164461?hl=en)
- [Readwise Reader: descripción](https://docs.readwise.io/reader/docs)
- [Readwise Reader: anotaciones](https://docs.readwise.io/reader/docs/faqs/highlights-tags-notes)
- [Zotero: About](https://www.zotero.org/about/)
- [Fabric](https://fabric.so/)
- [mymind](https://mymind.com/)
- [Adobe Acrobat AI Assistant en móvil](https://helpx.adobe.com/acrobat/mobile/acrobat-ai/ask-questions.html)
- [Expo](https://docs.expo.dev/)
- [Tauri](https://v2.tauri.app/start/)
- [Tauri: distribución](https://v2.tauri.app/distribute/)
- [Tauri: bundle de aplicación macOS](https://v2.tauri.app/distribute/macos-application-bundle/)
- [Apple: bookmarks y acceso con alcance de seguridad](https://developer.apple.com/documentation/professional-video-applications/enabling-security-scoped-bookmark-and-url-access)
- [Next.js App Router](https://nextjs.org/docs/app)
- [Supabase: AI y vectores](https://supabase.com/docs/guides/ai)
- [Supabase: regiones disponibles](https://supabase.com/docs/guides/platform/regions)
- [Chrome: File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Expo DocumentPicker](https://docs.expo.dev/versions/latest/sdk/document-picker/)
- [Tauri: acceso al sistema de archivos y vigilancia de cambios](https://v2.tauri.app/plugin/file-system/)
- [Google Books API: búsqueda, disponibilidad y venta](https://developers.google.com/books/docs/v1/using)
- [Google Books API: recurso Volume y `saleInfo`](https://developers.google.com/books/docs/v1/reference/volumes)
- [Open Library Developer Center](https://openlibrary.org/developers)
- [Open Library: uso y límites de APIs](https://openlibrary.org/developers/api)
- [BuscaLibre Perú: programa de afiliados](https://www.buscalibre.pe/afiliados)
- [Amazon Creators API](https://affiliate-program.amazon.com/creatorsapi/docs/)
- [Google Cloud: traducción de documentos](https://docs.cloud.google.com/translate/docs/advanced/translate-documents)
- [DeepL API: traducción de documentos](https://developers.deepl.com/api-reference/document)
- [DeepL API: glosarios](https://developers.deepl.com/api-reference/multilingual-glossaries)
- [DeepL API: uso y límites](https://developers.deepl.com/docs/resources/usage-limits)
- [LibreTranslate: repositorio oficial](https://github.com/LibreTranslate/LibreTranslate)
- [Tesseract OCR: repositorio oficial](https://github.com/tesseract-ocr/tesseract)
- [Google Document AI: procesadores y OCR](https://docs.cloud.google.com/document-ai/docs/processors-list)
- [Expo Brightness: brillo de pantalla en Android/iOS](https://docs.expo.dev/versions/latest/sdk/brightness/)
- [MDN: filtro CSS `brightness()`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/filter-function/brightness)
- [OpenAI API: catálogo de modelos](https://developers.openai.com/api/docs/models)
- [OpenAI API: modelos de embeddings](https://developers.openai.com/api/docs/models/text-embedding-3-large)
- [OpenAI API: controles y retención de datos](https://platform.openai.com/docs/models/default-usage-policies-by-endpoint)
- [Anthropic API: Messages](https://platform.claude.com/docs/en/api/messages/create)
- [Anthropic API: listar modelos](https://platform.claude.com/docs/en/api/models/list)
- [Anthropic API: retención de datos](https://platform.claude.com/docs/es/manage-claude/api-and-data-retention)
- [Ollama API: listar modelos locales](https://docs.ollama.com/api/tags)
- [Ollama API: generar embeddings](https://docs.ollama.com/api/embed)
- [WIPO: Global Brand Database](https://www.wipo.int/en/web/global-brand-database)
- [INDECOPI: servicios de búsqueda de marca](https://repositorio.indecopi.gob.pe/backend/api/core/bitstreams/4f06b923-e6bf-41ad-a733-45553ae82673/content)
- [Perú: Reglamento de la Ley de Protección de Datos Personales](https://www.gob.pe/institucion/anpd/normas-legales/6554453-n-016-2024-jus)
- [Perú: inscripción del banco de datos personales](https://www.gob.pe/8060)
- [INDECOPI: dominio público](https://www.gob.pe/institucion/indecopi/noticias/808331-indecopi-elabora-guia-informativa-de-derecho-de-autor-sobre-uso-de-obras-liberadas-en-dominio-publico)
- [WIPO: copyright y DRM](https://www.wipo.int/en/web/copyright/protection)

## 23. Qué falta validar antes de construir

Las decisiones están cerradas. Lo pendiente son pruebas con resultado verificable y aprobaciones externas.

### P0 — compuertas para iniciar implementación completa

1. **Marca:** ejecutar búsqueda INDECOPI/WIPO, clases, logo, dominios y dictamen profesional. Si falla, renombrar antes de publicar.
2. **OAuth:** demostrar acceso recursivo y renovación con My Drive, carpeta compartida y Shared Drive; documentar si se requiere scope restringido.
3. **Archivos locales:** probar Vincular/Importar, pérdida de permiso, disco externo, renombrado y borrado en web, Windows y macOS.
4. **Corpus:** adquirir/generar los 100 documentos con licencia y resultados esperados versionados.
5. **Prototipo:** completar las 12 pruebas con las tasas de éxito definidas; iterar hasta alcanzar la compuerta.
6. **Privacidad Perú:** evaluación de impacto, banco de datos, contratos con subencargados, flujo ARCO, incidentes y revisión del Reglamento de la Ley 29733.
7. **Proveedores:** prueba comparativa real de costo, latencia, calidad y retención para Tesseract/Document AI, OpenAI, Claude, Ollama, LibreTranslate, DeepL y Google Translation.
8. **Ofertas:** obtener términos/afiliación de BuscaLibre y confirmar si existe feed/API autorizado; sin eso, mantener solo enlace.
9. **Economía:** fijar cuotas de cada plan después de medir 1,000 páginas, 100 preguntas y 100 páginas traducidas.

### P1 — compuertas para beta pública

1. Restaurar un backup completo y verificar los plazos de borrado 24 h/7 d/35 d.
2. Auditoría WCAG 2.2 AA con teclado, VoiceOver, TalkBack y NVDA.
3. Pentest de OAuth, carga de archivos, parsers, bóveda, BYOK y aislamiento entre Áreas.
4. Prueba de conflictos offline y reanclaje con dos equipos por cuenta.
5. Automatizar firma/actualización Windows y firma/notarización/actualización DMG.
6. Publicar privacidad, términos, copyright, subencargados, estado del servicio y soporte.

### P2 — fuera del MVP

- Comunidad, reseñas públicas, clubes de lectura y perfiles sociales.
- Compra dentro de la app, marketplace o agentes que actúan sin confirmación.
- Mac App Store antes de estabilizar DMG, plugins y automatizaciones complejas.
- Muchos conectores empresariales; después de Drive se priorizan por evidencia OneDrive/SharePoint, Dropbox, iCloud, Calibre o Zotero.

El siguiente entregable correcto es un **prototipo navegable de validación**, no todavía la aplicación completa. Debe cubrir conexión, Biblioteca, Continúa leyendo, lector, traducción gratis/paga, pregunta con citas, motores de IA y captura social.
