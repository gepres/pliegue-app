# 16. Calidad, operación y soporte

> Documento derivado del dossier maestro de Pliegue. Mantener ambos sincronizados cuando cambien decisiones de producto.

## 16. Métricas de éxito

### Activación

- Porcentaje que conecta una carpeta.
- Tiempo hasta el primer documento listo.
- Porcentaje que abre, pregunta o anota en la primera sesión.

### Valor recurrente

- Lectores activos semanales.
- Documentos reabiertos gracias a búsqueda o recomendación.
- Reanudaciones aceptadas y lecturas terminadas después de usar **Continúa leyendo**.
- Áreas que usan Drive y local en una misma semana.
- Favoritos que terminan en lectura, nota o ruta.
- Recomendaciones guardadas/abiertas y tasa de “No es para mí”.
- Alertas creadas y ofertas abiertas con precio vigente.
- Bloques traducidos, correcciones humanas y reanudación bilingüe.
- Distribución, éxito, latencia y costo de IA por proveedor/flujo; fallbacks y límites de presupuesto activados.
- Preguntas con cita abierta por el usuario.
- Notas y capturas creadas por lector activo.
- Correcciones de categoría aceptadas por el sistema.

### Confianza

- Tasa de respuestas marcadas como no respaldadas.
- Citas que llevan a una ubicación correcta.
- Archivos con extracción parcial o fallida.
- Desconexiones por preocupación de permisos.
- Incidentes de acceso indebido: objetivo cero.
- Cruces local → nube sin consentimiento: objetivo cero.
- Conflictos de posición resueltos sin perder una sesión: objetivo 100 %.

La métrica norte recomendada es **documentos comprendidos por usuario activo semanal**, definida como abrir y completar al menos una acción de valor: avanzar lectura, crear nota, verificar cita o añadir a una ruta.

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
