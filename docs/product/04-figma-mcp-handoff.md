# 04. Figma por MCP y handoff a código

> Documento derivado del dossier maestro de Pliegue. Mantener ambos sincronizados cuando cambien decisiones de producto.

Diseño: https://www.figma.com/design/2CFIc5079NMSYinTxXXTpS · File key: `2CFIc5079NMSYinTxXXTpS`.

## 11. Sistema visual

### Concepto creativo

**Editorial cálida: biblioteca personal + mesa de estudio.** La experiencia debe sentirse literaria, artesanal y contemplativa, pensada para novelas, ensayos, poesía y sesiones prolongadas. La lectura tiene prioridad sobre la decoración; las superficies son cálidas, tranquilas y poco saturadas.

Rasgo memorable: una línea vertical de margen acompaña la lectura y se “pliega” para revelar notas, fuentes relacionadas y acciones de La Lente.

### Marca

- Símbolo: una hoja doblada que forma simultáneamente una `P` y el lomo de un libro.
- Logotipo: `Pliegue` en una serif expresiva, sin agregar “AI” al nombre.
- Frase principal: **Tu archivo empieza a pensar.**
- Voz: serena, precisa, curiosa y nunca omnisciente.

![Logo conceptual de Pliegue](images/pliegue-logo-concept.png)

El archivo mostrado es un concepto de dirección, no todavía un master de producción. Antes del lanzamiento se debe reconstruir como SVG, corregir ópticamente símbolo y kerning, probar monocromo/16 px y registrar nombre y marca.

### Paleta clara

| Token | Valor | Uso |
|---|---:|---|
| `parchment-50` | `#FBF6EC` | fondo principal de lectura |
| `parchment-100` | `#F0E5D2` | paneles, tarjetas y separadores |
| `charcoal-900` | `#25231F` | texto principal, títulos e iconos prioritarios |
| `charcoal-600` | `#6B655C` | texto secundario y metadatos |
| `forest-700` | `#365B48` | acción principal, navegación activa y progreso |
| `forest-100` | `#DDE9E0` | selección, citas y estados positivos |
| `ochre-500` | `#C99232` | descubrimientos, puntuaciones y novedades |
| `terracotta-500` | `#B9674F` | captura, alertas y errores recuperables |
| `plum-500` | `#76566F` | colecciones, ensayo y categorías culturales |
| `white` | `#FFFFFF` | superficies elevadas puntuales |

### Paleta oscura

| Token | Valor | Uso |
|---|---:|---|
| `dark-950` | `#171614` | fondo principal de bajo brillo |
| `dark-900` | `#211F1C` | superficies, tarjetas y paneles |
| `dark-800` | `#35312C` | bordes y divisores |
| `parchment-100` | `#F0E5D2` | texto principal |
| `parchment-muted` | `#BEB3A1` | texto secundario y metadatos |
| `forest-300` | `#91B9A0` | acción principal, progreso y navegación activa |
| `ochre-400` | `#DDAE56` | destacados, logros y puntuaciones |
| `terracotta-400` | `#D28A73` | captura y estados de atención |
| `plum-400` | `#A98AA3` | categorías y etiquetas especiales |

En modo oscuro se evita el negro puro y las grandes áreas blancas. El color de categoría se presenta con punto, cinta, icono, etiqueta o borde; nunca como único indicador.

### Colores por categoría

| Categoría | Color |
|---|---|
| Novela | `terracotta-500` |
| Ensayo | `plum-500` |
| Poesía | `ochre-500` |
| Historia | `#A8753E` |
| Filosofía | `forest-700` |
| Fantasía | `#587A70` |
| No ficción | `charcoal-600` |
| Biografía | `#8A6D58` |

### Tipografía

| Rol | Familia | Uso |
|---|---|---|
| Display | **Cormorant Garamond** | marca, portadas, capítulos y frases destacadas; nunca controles ni texto menor a 18 px |
| Interfaz | **Inter** | navegación, botones, filtros, formularios y metadatos |
| Lectura | **Source Serif 4** | texto continuo, sinopsis, citas, notas y concentración |
| Datos | **IBM Plex Mono** | páginas, códigos, tamaños, estados técnicos |

Escala base: 12, 14, 16, 18, 22, 28, 36 y 52 px. Pesos: 400 para cuerpo; 500 para navegación, introducciones y datos destacados; 600 para botones y encabezados; 700 solo para estados críticos o cifras puntuales. El lector usa 18 px/1.65 por defecto y permite 14–32 px.

### Forma, profundidad y movimiento

- Radios: botones 8 px, búsquedas 10 px, tarjetas 12 px, paneles 16 px, chips 999 px y portadas 4–6 px.
- Bordes claros `#DDD2C0`; bordes oscuros `dark-800`.
- Sombra clara: `0 4px 16px rgba(37, 35, 31, 0.08)`; oscura: `0 6px 20px rgba(0, 0, 0, 0.28)`; solo para capas temporales.
- Fondo con grano de papel casi imperceptible y líneas de margen, desactivables en modo accesible.
- Animación principal: al abrir un archivo, la tarjeta se expande y se convierte en el lienzo de lectura.
- Duraciones: 120 ms para respuesta, 220 ms para panel, 360 ms para transición editorial.
- Respetar `prefers-reduced-motion` y evitar que el movimiento comunique información exclusiva.

### Accesibilidad mínima

- Objetivo WCAG 2.2 AA.
- Navegación completa por teclado y foco siempre visible.
- Lectura con VoiceOver, TalkBack y NVDA.
- Etiquetas accesibles para botones de icono.
- Alto contraste, reducción de movimiento y opción de fuente de lectura alternativa.
- Zoom hasta 200 % sin pérdida de función.
- Objetivos táctiles mínimos de 44 × 44 px.
- El lector permite tema, brillo, fuente, tamaño, interlineado, ancho, párrafos y espaciado.
- OCR y texto alternativo de IA se presentan como sugerencias editables, nunca como verdad garantizada.

### Variables CSS base

```css
:root {
  --parchment-50: #fbf6ec;
  --parchment-100: #f0e5d2;
  --charcoal-900: #25231f;
  --charcoal-600: #6b655c;
  --forest-700: #365b48;
  --forest-100: #dde9e0;
  --ochre-500: #c99232;
  --terracotta-500: #b9674f;
  --plum-500: #76566f;
  --background: var(--parchment-50);
  --surface: var(--parchment-100);
  --text-primary: var(--charcoal-900);
  --text-secondary: var(--charcoal-600);
  --primary: var(--forest-700);
  --font-display: "Cormorant Garamond", Georgia, serif;
  --font-interface: "Inter", system-ui, sans-serif;
  --font-reading: "Source Serif 4", Georgia, serif;
  --font-data: "IBM Plex Mono", monospace;
}

[data-theme="dark"] {
  --background: #171614;
  --surface: #211f1c;
  --surface-elevated: #35312c;
  --text-primary: #f0e5d2;
  --text-secondary: #beb3a1;
  --primary: #91b9a0;
  --accent: #ddae56;
  --warning: #d28a73;
  --category-special: #a98aa3;
}
```

## 12. Catálogo y contratos de componentes

Cada componente debe documentarse en Storybook o equivalente con estados normal, hover, foco, activo, cargando, vacío, error, sin permiso y offline cuando corresponda.

### Fundamentos

| Componente | Contrato clave |
|---|---|
| `Button` | variantes primary, secondary, quiet, danger; loading conserva ancho |
| `IconButton` | `aria-label` obligatorio; tooltip en escritorio |
| `TextField` | etiqueta persistente, ayuda, error y contador opcional |
| `Tag` | faceta, color, origen IA/humano y acción de quitar |
| `StatusBadge` | texto + icono + color; nunca solo color |
| `Progress` | valor conocido o indeterminado; texto de etapa asociado |
| `Tooltip` | ayuda complementaria, nunca contenido esencial |
| `Skeleton` | refleja la forma final y no roba foco |

### Navegación y biblioteca

| Componente | Responsabilidad |
|---|---|
| `AppRail` | destino global, cuenta y estado de conexión |
| `MobileTabBar` | cinco destinos; cámara como acción contextual separada |
| `WorkspaceSwitcher` | Área activa, creación, cambio y política de privacidad |
| `ScopeSelector` | Todo, Drive, local o fuentes elegidas; siempre visible al usar IA |
| `SourceScopePills` | procedencia incluida y exclusiones de la operación actual |
| `CommandPalette` | buscar, navegar y ejecutar acciones con teclado |
| `LibraryToolbar` | vista, orden, filtros y selección múltiple |
| `DocumentCard` | portada/miniatura, título, tipo, progreso, categorías y estado |
| `DocumentRow` | variante densa con columnas configurables |
| `FavoriteButton` | alterna favorito, confirma estado accesible y permite nota opcional |
| `ContinueReadingCard` | portada, última ubicación, progreso, dispositivo y acción Retomar |
| `ResumeReadingDialog` | Retomar, empezar de nuevo, ahora no o no preguntar en este libro |
| `ReadingPositionSyncStatus` | guardado local/nube, conflicto y elección entre ubicaciones |
| `SmartSpaceCard` | regla del espacio, conteo y explicación de cambios |
| `FacetFilter` | filtros combinables con chips y conteos |
| `SyncStatus` | última sincronización, cola y errores accionables |
| `EmptyState` | explica el valor y ofrece una acción primaria concreta |

### Fuentes e indexación

| Componente | Responsabilidad |
|---|---|
| `SourceTypePicker` | elegir Drive, carpeta local, archivo, cámara o importación |
| `DriveConnectionCard` | cuenta, alcance, estado y desconexión |
| `LocalSourceCard` | dispositivo, raíz, disponibilidad, modo y última reconciliación |
| `SourceRootPicker` | carpeta o archivos elegidos, exclusiones y tipo de fuente |
| `PermissionNotice` | permiso solicitado explicado antes de OAuth |
| `LocalProcessingNotice` | explica lectura puntual, vínculo, importación y destino del procesamiento |
| `ImportModeDecisionSheet` | aplica el predeterminado contextual y explica original, copia, proceso y retirada |
| `IndexJobPanel` | progreso por etapas, archivos listos y fallos |
| `FormatSupportList` | completo, parcial, externo o no compatible |
| `ReauthorizeBanner` | pérdida de acceso sin ocultar la biblioteca restante |

### Lector e IA

| Componente | Responsabilidad |
|---|---|
| `ReaderShell` | coordinación de paneles, atajos y modo concentración |
| `OriginalCanvas` | página/diapositiva, zoom, selección y superposición OCR |
| `ReflowReader` | tipografía, ancho, tema, búsqueda y anclas |
| `TranslationModeSwitch` | Original, Bilingüe o Traducido sin perder posición |
| `TranslationToolbar` | idioma, alcance, glosario, calidad y progreso |
| `TranslationScopePicker` | selección, bloque, vista, página, rango, capítulo o documento con estimación |
| `TranslationPlanSelector` | Gratis, Rápida o Personalizada; cuota/costo, privacidad y calidad esperada |
| `BilingualBlock` | alinea bloque original y traducción con ancla compartida |
| `TranslatedOverlay` | superposición reversible sobre PDF o imagen con geometría |
| `ReaderSettingsSheet` | tema, brillo, tipografía, ancho, párrafos y movimiento con vista previa |
| `ReadingPresetCard` | aplicar, renombrar, duplicar o eliminar un perfil guardado |
| `BrightnessControl` | luminancia de app y, solo en móvil autorizado, brillo de actividad |
| `TypographyPreview` | muestra un fragmento real antes de guardar cambios |
| `PreferenceScopeSelector` | aplicar a documento, Área de trabajo o cuenta |
| `SettingsSaveStatus` | guardando, guardado, sin conexión o conflicto; anunciado accesiblemente |
| `OutlinePanel` | índice semántico, miniaturas y resultados internos |
| `AnnotationToolbar` | subrayar, nota, dibujar, enlazar y capturar |
| `LensPopover` | explicar, relacionar, preguntar, crear ficha o compartir |
| `AssistantPanel` | alcance explícito, conversación y estado de recuperación |
| `CitationChip` | archivo + ubicación; activa navegación exacta |
| `SourceDrawer` | evidencia usada, fragmento y contexto ampliable |
| `ReadAloudBar` | reproducir, velocidad, voz y seguimiento |

### Configuración de IA

| Componente | Responsabilidad |
|---|---|
| `AIProviderPanel` | proveedores conectados, privacidad, salud, consumo y acciones globales |
| `ProviderCard` | credencial/endpoint, estado, latencia y modelos descubiertos |
| `ProviderConnectionTest` | prueba autenticación, disponibilidad y respuesta sin usar documentos privados |
| `ModelPicker` | filtra por capacidad y muestra contexto, modalidad y costo conocido |
| `CapabilityBadge` | texto, visión, embeddings, estructurado, herramientas, local u otras capacidades |
| `WorkflowRoutingTable` | asigna modelo y parámetros a clasificación, RAG, traducción y demás flujos |
| `FallbackChainEditor` | orden y condiciones; bloquea cruces de privacidad no autorizados |
| `PrivacyBoundaryBadge` | local, nube, región y datos enviados con texto además de color |
| `AIBudgetMeter` | consumo estimado/real por Área y flujo, alertas y límite duro opcional |

### Descubrir y ofertas

| Componente | Responsabilidad |
|---|---|
| `RecommendationShelf` | separa biblioteca propia de catálogo externo y explica el contexto |
| `BookRecommendationCard` | portada, motivo, afinidad, formato, idioma y acciones de feedback |
| `TasteProfileEditor` | gustos declarados, señales permitidas, exclusiones y presupuesto |
| `OfferCard` | edición, vendedor, formato, precio, moneda, país y verificación |
| `OfferSourceBadge` | API/feed verificado o hallazgo web pendiente de confirmar |
| `FreeWebSearchToggle` | activa búsqueda libre y explica fuentes, privacidad y posibles resultados incompletos |
| `PriceHistory` | evolución comparable de una misma edición y proveedor |
| `PriceAlertForm` | precio objetivo, formato, país y canal de aviso |
| `ExternalCatalogNotice` | identifica datos externos y qué consulta se enviará |

### Captura y compartir

| Componente | Responsabilidad |
|---|---|
| `CaptureOverlay` | selección rectangular accesible y reajustable |
| `QuoteCardEditor` | jerarquía, tema, comentario y fuente |
| `AspectRatioPicker` | 1:1, 4:5, 9:16 y tamaño personalizado |
| `PrivacyCheck` | sensibilidad, PII detectada y redacción |
| `RightsGate` | licencia, DRM, país, longitud, atribución y acción permitida/bloqueada |
| `SharePreview` | vista final exacta y texto alternativo editable |
| `ShareDestinationSheet` | guardar, copiar, enlace y share sheet nativo |

### Reglas de contenido

- “La IA sugiere…” en lugar de “La IA decidió…”.
- “No pudimos leer 3 páginas” en lugar de “Error de OCR”.
- Los estados siempre indican qué ocurrió, qué permanece seguro y qué puede hacer el usuario.
- Una cifra de archivos nunca debe aparecer sin contexto de carpeta o filtro.

## 22. Referencias visuales del proyecto

Las dos láminas proporcionadas son la referencia primaria para la dirección móvil. No se copian como especificación literal: se convierten en tokens, componentes y comportamientos verificables.

### Prototipo claro

![Referencia móvil de Pliegue en modo claro](images/proto-light.png)

### Prototipo oscuro

![Referencia móvil de Pliegue en modo oscuro](images/proto-dark.png)

### Decisiones extraídas de las referencias

- Se conservan la calidez de papel, jerarquía editorial, divisores finos y acentos bosque/ocre/terracota/ciruela.
- La navegación móvil usa cinco destinos y mantiene cámara, traducción y apariencia como acciones contextuales.
- **Continúa leyendo** se vuelve una pieza principal de Hoy, no un detalle escondido en la ficha del libro.
- El lector prioriza Source Serif 4, progreso discreto, contador de página y una acción central `Aa` para apariencia.
- Notas, destacados y favoritos comparten el mismo sistema de anclas y filtros.
- Perfil reúne racha, estadísticas, metas, géneros y ajustes, pero evita convertir la lectura en una competencia agresiva.
- El modo oscuro usa negro cálido, texto pergamino y líneas doradas atenuadas; no invierte colores de manera automática.
- La textura botánica/editorial es ambiental y desactivable; nunca reduce contraste ni legibilidad.
