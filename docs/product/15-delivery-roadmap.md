# 15. Roadmap de entrega

> Documento derivado del dossier maestro de Pliegue. Mantener ambos sincronizados cuando cambien decisiones de producto.

## 14. MVP realista

### Debe incluir

- Web responsive con cuenta personal.
- Conexión de una carpeta de Drive y sincronización incremental.
- Apertura e importación de archivos locales; selección de carpeta en navegadores compatibles, con fallback por selector o arrastrar y soltar.
- Un Área de trabajo que combine Drive y local, con alcance Todo/Drive/local/fuentes elegidas para ordenar, buscar y usar IA.
- Favoritos para documentos, fragmentos y libros externos.
- PDF digital/escaneado, Google Docs, DOCX, EPUB, TXT/MD e imágenes.
- Inventario, filtros, categorías sugeridas y corrección manual.
- Búsqueda híbrida y preguntas a documento/carpeta con citas.
- Lector PDF y fluido, progreso, subrayado, notas, guardado de posición y aviso para retomar.
- Ajustes guardados de tema, brillo de app, fuente, tamaño, interlineado, ancho y párrafos, con perfiles Día/Noche/Estudio.
- Traducción de selección, bloque, vista y página con vista Original/Bilingüe y preservación de imágenes.
- Panel multIA con OpenAI y Claude operativos en web; Ollama aparece configurable con estado **Requiere app de escritorio** hasta habilitar el broker local. Incluye rutas para clasificación, embeddings, RAG y traducción.
- Recomendaciones de la propia biblioteca y un catálogo externo inicial con explicación.
- Una fuente inicial de precios/ofertas y búsqueda libre opcional, con físico/digital/audio, condición, país, moneda y fecha de verificación.
- Captura rectangular y tarjeta 1:1/4:5/9:16.
- Centro de sincronización, privacidad y borrado del índice.
- Español completo; inglés preparado mediante i18n.

### No debe incluir todavía

- Edición o reorganización automática de Drive o de carpetas locales.
- Colaboración compleja en tiempo real.
- Agentes que ejecuten acciones externas.
- Garantía de ejecución completamente local para todos los formatos/flujos y sincronización automática de cualquier carpeta móvil; Ollama se activa con la entrega de escritorio.
- Compatibilidad prometida con cualquier archivo.
- Mercado de plugins o flujos empresariales avanzados.
- Comparador de todas las librerías, compra automática o scraping de comercios.
- Garantía de conservación perfecta para todo PDF escaneado o diseño complejo.

### Criterios de aceptación

1. Una biblioteca de 1,000 archivos puede inventariarse sin bloquear la interfaz.
2. Un archivo listo aparece antes de que termine toda la carpeta.
3. Una respuesta factual contiene citas navegables o declara evidencia insuficiente.
4. Un cambio remoto o local reindexa únicamente la versión afectada.
5. La pérdida de permiso en cualquier fuente retira el archivo de recuperación de IA según su política de derivados.
6. Una nota sigue anclada después de una actualización menor o queda marcada para revisión.
7. Desconectar y borrar elimina tokens y datos derivados verificablemente.
8. Los flujos esenciales funcionan con teclado y lector de pantalla.
9. El mismo formato ofrece las mismas funciones de lectura, notas y citas sin importar si procede de Drive o del dispositivo.
10. Una carpeta local desconectada conserva su organización y muestra un estado claro sin generar respuestas nuevas con contenido no autorizado.
11. El alcance separado nunca recupera fragmentos de una fuente excluida; el global distingue Drive y local en cada cita.
12. Favoritos se sincroniza entre dispositivos sin modificar las fuentes.
13. Cada recomendación muestra una razón y acepta feedback negativo.
14. Cada oferta identifica edición, formato, condición, país, moneda, fuente y momento de verificación; un hallazgo web exige confirmación externa.
15. La traducción respeta exactamente el alcance elegido y conserva original, imágenes, cifras, citas y anclas; si pierde diseño usa una vista bilingüe explícita.
16. Un ajuste guardado reaparece al abrir otro dispositivo según su alcance; el brillo específico del equipo permanece local.
17. Los controles de lectura actualizan una previsualización en vivo, funcionan con teclado y muestran valores numéricos.
18. Al cerrar y reabrir un documento se restaura su ancla exacta; un conflicto offline conserva ambas posiciones hasta que se resuelva.
19. Un proveedor/modelo incompatible no puede asignarse al flujo; la configuración indica el motivo.
20. Un flujo marcado local nunca activa un fallback de nube sin consentimiento explícito y registrable.
21. Cada operación de IA deja visible proveedor, modelo, alcance, consumo y fallback efectivo.

## 15. Hoja de ruta sugerida

Estimación orientativa para un equipo pequeño de producto/diseño, dos desarrolladores y apoyo de infraestructura/IA.

### Fase 0 — validación y riesgos, 2–3 semanas

- 12 pruebas moderadas: 6 investigadores y 6 consultores, con las compuertas de éxito del registro de decisiones.
- Prototipo navegable de Hoy, Área de trabajo, Biblioteca, Lector, Descubrir, Captura y Motores de IA, contrastado con las referencias visuales del proyecto.
- Spike de OAuth, carpeta recursiva, Shared Drives y cambios.
- Spike de carpeta local en web, Windows y macOS: permisos, bookmark/sandbox, watcher, disco externo, renombrado y pérdida de acceso.
- Prueba de alcance global/separado, consentimiento de IA y prevención de fuga entre fuentes.
- Validación de Google Books, primer proveedor de ofertas, país/moneda y condiciones de afiliación.
- Corpus de traducción con PDF nativo, escaneado, tablas, diagramas, DOCX y EPUB.
- Corpus cerrado de 100 documentos con licencia segura y matriz esperada de extracción, anclas, traducción y rendimiento.
- Prueba de rutas OpenAI/Claude/Ollama, registro dinámico de capacidades, aislamiento local/nube y presupuesto por 1,000 páginas indexadas y 100 preguntas.

### Fase 1 — web alpha, 8–12 semanas

- Autenticación, Drive, importación local web, cola, parsers Nivel A y modelo de datos común para fuentes.
- Área de trabajo unificada, alcance visible, favoritos, biblioteca, lector, notas, clasificación, búsqueda y reanudación entre sesiones.
- Perfiles de lectura sincronizados y panel de ajustes con previsualización.
- IA con citas, panel de proveedores, rutas por flujo, límites y trazabilidad.
- Traducción de selección/bloque/vista/página y recomendaciones sobre la biblioteca propia.
- Catálogo externo y ofertas de un proveedor inicial.
- Captura social básica.
- Pruebas cerradas con 20–40 usuarios.

### Fase 2 — beta y calidad, 6–8 semanas

- Sincronización robusta, reanclaje y recuperación de fallos.
- Formatos Nivel B prioritarios.
- Traducción de rango/capítulo/documento, trabajo asíncrono, glosarios y control de calidad visual.
- Más catálogos/proveedores, búsqueda libre, comparación normalizada y alertas de precio.
- Accesibilidad, rendimiento, analítica de producto y pagos.
- Preparación/verificación OAuth y políticas públicas.

### Fase 3 — Android/iOS, 8–12 semanas

- Expo development build, biblioteca, lectura offline selectiva.
- Selector de documentos, menú Compartir, cámara, OCR, notificaciones de oferta y audio.
- TestFlight y prueba interna de Google Play.

### Fase 4 — Windows/macOS, 6–8 semanas

- Shell Tauri, selectores de carpeta, watcher recursivo, bookmarks de macOS, reconciliación, enlaces profundos y caché local.
- Bóveda local, broker de Ollama/LibreTranslate, política de derivados y funcionamiento sin enviar el original a la nube.
- Windows: firma de instalador. macOS: firma, notarización, DMG y entitlements; App Store solo después de estabilizar el canal directo. En ambos: telemetría opt-in y modo sin conexión.

Las etapas se solapan solo después de resolver OAuth y el modelo de anclas; ambos afectan a todas las plataformas.
