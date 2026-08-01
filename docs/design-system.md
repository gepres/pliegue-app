# Sistema visual de Pliegue

## Fuente de verdad

- Diseño: [Pliegue — Prototipo de validación v0.1](https://www.figma.com/design/2CFIc5079NMSYinTxXXTpS/Pliegue-%E2%80%94-Prototipo-de-validaci%C3%B3n-v0.1?node-id=0-1&p=f&t=t23Jxpn0Xyc2ouRm-0)
- Fundamentos en Figma: nodo `16:2`
- Portada en Figma: nodo `12:2`
- Tokens implementados: `packages/tokens/src/tokens.css`
- Componentes: `packages/ui/src`
- Catálogo ejecutable: `/design-system`
- Style frame de referencia: Figma `16:2` (`Foundations`)

Figma define la intención visual. El código define el contrato consumible y debe conservar nombres semánticos estables aunque cambien los valores de marca.

## Tipografía

| Rol | Familia | Peso | Tamaño base |
| --- | --- | --- | --- |
| Marca | Cormorant Garamond | 600 | 40 px |
| Título | Cormorant Garamond | 600 | 28 px |
| Sección | Cormorant Garamond | 600 | 22 px |
| Lectura | Source Serif 4 | 400 | 18 px |
| Interfaz | Inter | 400/500/600 | 11–15 px |
| Datos | IBM Plex Mono | 500 | 11 px |

## Reutilización

1. Buscar primero un componente existente en `@pliegue/ui`.
2. Componer variantes antes de crear un componente nuevo.
3. Añadir al paquete cualquier patrón repetido en dos o más vistas.
4. Usar exclusivamente tokens semánticos dentro de componentes.
5. Documentar propósito, API, estados, accesibilidad y ejemplos en el catálogo.
6. Verificar Light/Dark y anchos móvil/escritorio.

## Accesibilidad mínima

- Objetivo táctil mínimo de 44 × 44 px.
- Foco visible con contraste suficiente.
- Navegación completa por teclado.
- Etiquetas accesibles para controles sin texto.
- Movimiento reducido respetado con `prefers-reduced-motion`.

## Catálogo de componentes

### Button

- Propósito: acciones primarias, secundarias o discretas.
- API: `variant="primary|secondary|quiet"`, `size="sm|md"` y atributos nativos.
- Estados: reposo, hover, foco visible, desactivado.
- Responsive: mantiene un objetivo táctil mínimo de 44 px (`sm` usa 40 px solo en barras compactas).

### Card

- Propósito: agrupar contenido relacionado como `article` o `section`.
- API: `as="article|section"` y `tone="surface|subtle"`.
- Estados: superficie elevada o fondo sutil; no añade interacción por sí misma.
- Responsive: el contenedor consumidor define la cuadrícula, no la tarjeta.

### Tag

- Propósito: procedencia, estado o categoría breve.
- API: atributos nativos de `span`.
- Accesibilidad: no se usa como único indicador de un estado crítico.

### Field + Input/Select

- Propósito: asociar etiqueta visible, ayuda opcional y control nativo.
- API de `Field`: `label`, `labelFor`, `description`; `Input` y `Select` conservan atributos nativos.
- Estados: reposo, foco visible y desactivado; el navegador conserva teclado y lector de pantalla.
- Responsive: ocupa el ancho del contenedor y mantiene 44 px de altura mínima.

### Patrón de lector local

- Propósito: abrir contenido local sin perder título, formato, procedencia ni estado de permiso.
- Composición: `PageHeader` + superficie editorial + `Card` lateral de metadatos y privacidad.
- Variantes: texto/Markdown, documento estructurado, hoja tabular, imagen, PDF, permiso
  requerido y error.
- Seguridad: Markdown se presenta como texto plano; no se inyecta HTML del documento.
- Documentos estructurados: EPUB, DOCX, PPTX y XLSX comparten secciones editoriales;
  las hojas usan regiones tabulares desplazables y enfocables con teclado.
- Responsive: el panel lateral pasa debajo de la lectura a 960 px y se simplifican los márgenes
  de papel a 640 px. Las secciones largas usan `content-visibility` para diferir su pintado.
- Tokens: tipografía y espaciado de lectura consumen `--pliegue-reader-*`; superficies,
  bordes, acento, elevación y texto usan exclusivamente el contrato semántico.

El catálogo ejecutable en `/design-system` contiene ejemplos Light/Dark. Las preferencias
de `/app/ajustes` consumen `Field` y `Select`; el lector local documenta la primera
composición de producto multiformato.

## Style frames

El catálogo presenta Light y Dark como marcos completos, no como muestras aisladas. Cada
frame combina rail, jerarquía editorial, métricas, formulario y acciones para revisar:

- coherencia del mismo contrato semántico en ambos temas;
- relación Cormorant/Source Serif/Inter/IBM Plex Mono;
- densidad, espaciado, radios, elevación y objetivos táctiles;
- adaptación 1440 px → 390 px sin cambiar el orden semántico;
- componentes reales de `@pliegue/ui`, nunca duplicados solo para documentación.

La composición deriva del frame Foundations `16:2` de Figma: canvas cálido, secciones
amplias, muestras compactas, un frame Dark contenido y tarjetas tipográficas editoriales.
