# Probar Pliegue con un lector de pantalla

La e2e `apps/web/e2e/lector-pantalla.mjs` comprueba en cada cambio lo que recibe un lector de
pantalla: el árbol de accesibilidad del navegador. Revisa idioma, título, regiones, encabezados,
nombres de los controles, avisos, menús y diálogos. `accesibilidad.mjs` (axe) y `teclado.mjs`
cubren el resto de WCAG 2.2 AA que se puede automatizar.

Lo que ninguna prueba sustituye es **oírlo**: si se entiende, si suena en buen orden y si se puede
leer un libro sin ver la pantalla. Esta guía es para hacerlo a mano, en unos 20 minutos, antes de
una versión importante.

## Preparar

- **Windows:** [NVDA](https://www.nvaccess.org/download/), gratis, con Chrome o Edge.
  - Arrancar o parar: `Ctrl + Alt + N` / `Insert + Q`.
  - Modo exploración o modo foco: `Insert + Espacio`.
- **Mac:** VoiceOver (`Cmd + F5`), con Safari.
- Voz en español. Una biblioteca con dos o tres libros (un EPUB y un PDF con texto).

Teclas de NVDA que se usan abajo: `H` / `1`–`6` (encabezados), `D` (regiones), `K` (enlaces),
`B` (botones), `F` (campos), `Tab`, y `Insert + F7` (lista de elementos).

## Recorrido

Marca cada punto. Si algo falla, apunta la pantalla y lo que se oyó.

### Entrar
- [ ] Al abrir Pliegue se oye el título de la página («Inicio · Pliegue») en español, no deletreado.
- [ ] El primer `Tab` es «Saltar al contenido», que lleva al contenido principal.
- [ ] Con `D` se oyen las regiones: el menú «Secciones de Pliegue», la región principal y las de
      la página.

### Biblioteca
- [ ] Con `H` se oye «Biblioteca» (nivel 1), «Documentos» (nivel 2) y cada libro (nivel 3).
- [ ] Al importar un archivo se anuncia el resultado («1 importado») sin mover el foco.
- [ ] El botón «Más acciones de…» dice que abre un menú; al abrirlo, «expandido», y las flechas
      leen cada opción. `Escape` lo cierra y el foco vuelve al botón.
- [ ] «Sensibilidad: …» abre un diálogo que se anuncia con su nombre. El foco no sale de él, las
      opciones se leen como botones de opción con la marcada, y `Escape` vuelve al libro.

### Lector
- [ ] Se oye el título del libro como nivel 1 y los capítulos como nivel 2.
- [ ] Con `D` aparece «Texto del libro», y una sola región principal.
- [ ] En modo exploración, las flechas leen el libro párrafo a párrafo, en orden.
- [ ] El deslizador de avance se anuncia con su nombre y el porcentaje.
- [ ] «Traducir», «Resumir», «Apariencia» e «Índice y detalles» se oyen con su nombre y abren su
      panel. Al cerrarlo, el foco vuelve al botón.
- [ ] «Volver a Biblioteca» se encuentra con `K`.

### IA y Ajustes
- [ ] En IA, «Buscar en tus libros»: escribir una búsqueda y pulsar Intro anuncia cuántos
      fragmentos salieron. En «Preguntar», la respuesta se anuncia y cada cita es un enlace con el
      texto citado.
- [ ] «Guardar como nota» anuncia «Nota guardada» y dónde quedó.
- [ ] En Ajustes, cada campo dice su nombre (`F`) y los interruptores, si están activados.
- [ ] La clave de la IA no se lee en voz alta al escribirla: el campo está enmascarado.

## Al terminar

- Si todo va bien, apúntalo en la tarjeta 06.5 con la fecha, el lector y el navegador (por
  ejemplo, «NVDA 2026.3 + Chrome 141»).
- Si algo falla, abre una tarjeta con la pantalla, lo que se oyó y lo que se esperaba.
