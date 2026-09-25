# 12. Seguridad, privacidad y derechos

> Documento derivado del dossier maestro de Pliegue. Mantener ambos sincronizados cuando cambien decisiones de producto.

## 3. Principios de producto

1. **La fuente manda.** Una afirmación factual de IA debe señalar una fuente verificable.
2. **Las fuentes permanecen intactas.** Drive y los archivos locales son de solo lectura por defecto; la organización inteligente vive en Pliegue.
3. **Primero leer, luego conversar.** La IA complementa al lector; no lo reemplaza.
4. **Toda automatización se puede explicar y deshacer.**
5. **Privado hasta que el usuario decida compartir.**
6. **La misma biblioteca, una experiencia propia por dispositivo.** No forzar una pantalla web idéntica en móvil.
7. **“Todos los formatos” se entrega por niveles.** Un archivo puede tener lectura completa, vista previa, extracción parcial o apertura externa; nunca se promete compatibilidad inexistente.
8. **El alcance de IA siempre es visible.** Pliegue nunca mezcla nube y local de forma silenciosa.

## 18. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Alcance OAuth demasiado amplio | Picker primero, solo lectura, spike temprano y proceso de verificación presupuestado |
| Acceso local demasiado amplio o rutas privadas filtradas | raíz elegida, permisos de solo lectura, scopes Tauri, bookmarks macOS, referencias opacas y logs sin rutas |
| Mezclar nube y local sin intención | alcance persistente y visible, consentimiento previo y pruebas de aislamiento |
| Calidad desigual entre formatos | niveles públicos de soporte y corpus de prueba versionado |
| Respuestas convincentes sin respaldo | recuperación híbrida, validación de citas y abstención explícita |
| Costos altos de OCR/IA | deduplicar por checksum, caché por versión y modelos por dificultad |
| Archivos maliciosos | parsers aislados, antivirus, límites y bloqueo de contenido activo |
| Notas rotas por actualizaciones | anclas dobles y flujo visible de reanclaje |
| Compartir información privada | sensibilidad, PII, redacción y bloqueo por defecto |
| Promesa multiplataforma demasiado temprana | web primero; móvil y escritorio Windows/macOS después de estabilizar dominio |
| DRM y archivos protegidos | detectar, explicar y abrir externamente; no intentar evadir protección |
| Recomendaciones repetitivas o invasivas | gustos declarados, diversidad, explicación y feedback negativo inmediato |
| Oferta obsoleta o edición equivocada | ISBN/edición/formato, país, moneda, timestamp y confirmación en el comercio |
| Búsqueda web incumple condiciones o se rompe | APIs/feeds primero, allowlist legal/técnica, caché corta y resultado web no verificado |
| Pérdida de formato al traducir | original inmutable, capas por bloque, QA estructural y fallback bilingüe |
| Derechos sobre traducciones y catálogos | uso privado por defecto, límites de exportación y APIs/feeds autorizados |
| Modelo asignado sin la capacidad necesaria | registro dinámico de capacidades, prueba por flujo y bloqueo previo a guardar |
| Fallback filtra contenido local a nube | frontera explícita, política por Área, consentimiento y auditoría |
| Ollama no está disponible o el modelo fue borrado | detección local, estado accionable, cola pausada y fallback solo autorizado |
| Claves de proveedor expuestas | BYOK cifrado, proxy/bóveda, redacción de logs, rotación y mínimos privilegios |
| Dos dispositivos sobrescriben el progreso | historial corto, sesión más reciente, detección offline y resolución visible |
| Distribución macOS bloqueada | entitlements probados temprano, firma/notarización automatizadas y canal DMG antes de App Store |

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
