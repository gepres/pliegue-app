# ADR-0003 · Traducción de libros en el dispositivo

- Estado: Propuesto
- Fecha: 2026-09-25
- Foundry: `05.5 · Implementar traducción por selección, bloque, página, vista y documento` y `05.6 · Crear traducción dinámica con precarga y caché`

## Contexto

Se quiere traducir un libro mientras se lee, página a página:
- gratis, sin gastar la clave de IA que se configura para la Biblioteca;
- sin que el texto salga del equipo;
- respetando imágenes y gráficos;
- guardando lo traducido en el dispositivo;
- enseñando el avance y preparando las páginas siguientes.

La doc de producto (`09-ai-translation.md`) proponía LibreTranslate autoalojado como motor gratuito y DeepL como motor rápido. Se escribió antes de que los navegadores trajeran traductor propio.

Se investigó el estado de septiembre de 2026 con fuentes oficiales y mediciones en un equipo de desarrollo. Las mediciones usaron Windows 11, un i7-11800H, Chrome 154 y Edge 153.

## Decisión propuesta

### Motor

**Motor principal: la Translator API integrada del navegador.**
- Se detecta por la API (`'Translator' in self`), no por la marca del navegador.
- Existe en Chrome desde la versión 138 y en Edge desde la 148, solo en escritorio.
- Traduce en el dispositivo, gratis y sin cuotas.
- Es el más rápido de los medidos: unas 600-720 palabras por segundo en Chrome.
- Su calidad iguala a la de los motores locales: chrF2 56 sobre 200 frases de FLORES en→es.
- Descarga un paquete por par de idiomas (unos 80 MB en Chrome), una vez y compartido entre sitios.
- Si el paquete aún no está, crear el traductor exige un gesto: se crea desde el botón «Traducir este libro».

**Idioma de origen.** Se toma, por este orden:
1. la ficha;
2. el idioma detectado al indexar;
3. el detector del navegador, si ya está disponible y sin descargas.

### Qué se traduce

**Unidades.** Una página en un PDF y una sección en un EPUB o un DOCX.

**Cola.** Primero la unidad que se lee; después se preparan cinco páginas por delante, o dos secciones, porque cada sección es un capítulo. La cola se rehace al saltar a otra parte del libro.

**Guardado.**
- IndexedDB `pliegue-translations`, una fila por unidad, con motor y par de idiomas.
- Cada bloque guarda la huella de su original. Si la extracción cambia, se vuelve a traducir.
- Se pide `navigator.storage.persist()` para que el navegador no borre las traducciones.

### Cómo se muestra

**PDF, vista original.** La traducción se pinta encima de la página.
- **Imágenes y gráficos:** cada bloque tapa solo la caja de su texto, así que imágenes, gráficos y filetes quedan a la vista.
- **Color:** el fondo es el color dominante del papel bajo el bloque, y la tinta la que contraste.
- **Letra:** se ajusta a la caja con el interlineado del original. El español ocupa de media un 19 % más que el inglés.

**PDF, vista Lectura.** Muestra los mismos bloques traducidos en el texto recompuesto.

**EPUB y DOCX.** Los bloques se sustituyen por su traducción, incluido el título de la sección.

**Siempre.**
- La traducción se pinta como texto, nunca como HTML.
- «Original» la esconde sin detenerla.
- Con la traducción a la vista no se crean marcas sobre el texto traducido.

## Alternativas

| Alternativa | Por qué no es la principal |
|---|---|
| LibreTranslate público | Ya pide clave de pago. Autoalojarlo exige un servidor. |
| DeepL API Free | Ya no se contrata. El plan de desarrollador da un millón de caracteres en total (unos dos libros) y puede guardar lo enviado. |
| Google Cloud / Azure Translator | Cupos de 0,5 y 2 millones de caracteres al mes, con facturación. El texto sale del equipo. |
| MyMemory | 5000-50 000 caracteres al día. Guarda y puede licenciar lo que recibe. |
| Transformers.js + Opus-MT | Funciona en todos los navegadores, pero va a 25-35 palabras por segundo y pesa unos 119 MB por par. |
| NLLB-200 | Licencia no comercial (CC-BY-NC). |

## Consecuencias

- **Coste y privacidad:** en Chrome y Edge de escritorio la traducción es gratuita y privada y no necesita servidor.
- **Otros navegadores:** en Android, iOS, Firefox y Safari la API no existe hoy. El panel lo explica y el libro se lee en su idioma.
- **Varias descargas:**
  - Cada origen pide un clic la primera vez para un par, aunque el paquete ya esté en disco.
  - Cada puerto de `localhost` es otro origen.
- **Traducción automática frase a frase, sin contexto:** puede fallar en literatura. El panel lo avisa.
- **Uso personal:** la traducción de una obra protegida se queda en el dispositivo como capa de lectura personal. No se exporta ni se comparte.

## Pendiente

- **Respaldo local para móviles, Firefox y Safari:** Bergamot, el motor de Firefox en WASM.
  - Modelos MPL-2.0 de unos 24 MB por dirección, a 210-270 palabras por segundo en Chrome con un worker.
  - Los modelos hay que servirlos desde un origen propio: el bucket de Mozilla no permite CORS a orígenes arbitrarios.
- **Superposición en los PDF:**
  - Detectar imágenes con la lista de operaciones de pdf.js.
  - Usar el color del texto original.
  - Si un bloque tuviera que encoger por debajo del 70 %, leerlo en una ventana emergente.
- **Escaneos sin capa de texto:** esperan al OCR (03.5).
- **Otros motores opcionales:** Ollama local y motores en la nube, activados expresamente y con aviso de que el texto sale del equipo.
- **Otros alcances:** traducir una selección y glosarios por Área.

## Fuentes principales

- Translator API: https://developer.chrome.com/docs/ai/translator-api · https://webmachinelearning.github.io/translation-api/ · https://learn.microsoft.com/en-us/microsoft-edge/web-platform/translator-api
- Estado y plataformas: https://chromestatus.com/feature/5172811302961152 · https://github.com/mozilla/standards-positions/issues/1015 · https://github.com/WebKit/standards-positions/issues/339
- Bergamot: https://github.com/mozilla/translations
- Transformers.js: https://github.com/huggingface/transformers.js
- Maquetación de PDF traducidos: https://github.com/funstory-ai/BabelDOC
- Cupos en la nube: https://support.deepl.com/hc/en-us/articles/360021200939-DeepL-API-plans · https://cloud.google.com/translate/pricing · https://azure.microsoft.com/en-us/pricing/details/translator/ · https://mymemory.translated.net/doc/usagelimits.php
