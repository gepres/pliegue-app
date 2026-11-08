# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

La app es instalable (PWA) desde Chrome y Edge. En el móvil, en Safari y en Firefox funciona en el navegador, importando copias en lugar de vincular carpetas.

## Users

**Lectores con biblioteca propia** (confirmado por el dueño el 8-nov-2026). Son personas que fueron guardando libros y documentos (PDF, EPUB, DOCX, escaneos…) en carpetas de su equipo y en Google Drive. Quieren tenerlos ordenados, leerlos con comodidad, entenderlos y volver a encontrarlos.

Hablan español y a menudo leen en otros idiomas. Algunos comparten su biblioteca con un club, una clase o su familia.

El dossier (`docs/product/01-product-scope.md`) propone empezar con investigadores y consultores. La portada, en cambio, le habla al lector general.

## Product Purpose

Pliegue reúne la biblioteca de una persona en su dispositivo y la vuelve **entendible, legible y conectada**, sin mover, renombrar ni subir sus archivos:
- la indexa y la cataloga;
- la abre en un lector cuidado;
- la traduce junto al original;
- guarda lo que se subraya;
- deja preguntarle y contesta citando los propios libros;
- recomienda qué leer después y dónde conseguirlo.

**Éxito:** que alguien abra su carpeta y al rato esté leyendo, encontrando y entendiendo lo que ya tenía.

## Positioning

> Todo lo que guardaste, por fin entendible, legible y conectado.

- **Local primero:** los archivos nunca se suben. La cuenta es opcional y solo sincroniza lo que se sabe de los libros: fichas, notas, progreso y ajustes.
- **La IA la elige la persona, con su clave:** OpenAI, Anthropic, Gemini u Ollama en su equipo, y una distinta para cada tarea. Contesta citando sus propios libros, con citas comprobadas antes de enseñarlas.
- **Español primero.**
- **Precio:** Pliegue es gratis. Si se usa IA, se le paga al proveedor con la clave propia, o nada con Ollama en el equipo (confirmado el 8-nov-2026).

## Operating Context

- Se usa en el navegador de escritorio: Chrome y Edge permiten vincular carpetas y traducir en el dispositivo. También se instala como app de escritorio.
- En el móvil, Safari y Firefox se importan copias.
- Las fuentes son carpetas locales, carpetas y archivos de Google Drive, y copias importadas.
- Las bibliotecas compartidas son carpetas públicas de Drive. Se leen con un código de acceso y sin cuenta.

## Capabilities and Constraints

Confirmadas en el código a 8-nov-2026:

- **Biblioteca:**
  - vincular carpetas o importar copias;
  - índice local con texto, portada e idioma;
  - fichas (autor, año, categoría, serie y tomo);
  - repetidos señalados;
  - vista previa antes de unificar nombres o importar un índice JSON.
- **Lector:**
  - visor de PDF propio y modo Lectura recompuesto;
  - EPUB y DOCX con sus imágenes y pies de figura;
  - tono del papel (sepia, cálido o gris, con intensidad), atenuar, PDF en modo noche y banda de enfoque;
  - OCR de una zona o de una página escaneada;
  - los escaneos se pueden buscar por lo ya leído;
  - probado con lector de pantalla.
- **Traducción:**
  - página a página, sobre la página o en paralelo;
  - traducir el libro entero con aviso del coste;
  - con el traductor del navegador (gratis y en el equipo) o con la IA propia;
  - las traducciones se pueden guardar en la cuenta, con permiso propio.
- **Marcas:** resaltados en cuatro colores, notas, recortes de zona, notas en Markdown y postales.
- **Pregúntale a tu biblioteca:**
  - búsqueda por palabras (siempre en el equipo) y por significado (embeddings del proveedor);
  - respuestas solo con lo que dicen los libros, con citas comprobadas;
  - «Guardar como nota»;
  - «Resumir» un libro entero, con citas.
- **Para ti:** recomendaciones con su porqué, a partir de gustos declarados y, con permiso, de la biblioteca. Nunca envía títulos ni libros confidenciales.
- **Dónde conseguirlo:**
  - Buscalibre por país, en sus seis tiendas: Perú, Colombia, Chile, México, Argentina, y Estados Unidos y Puerto Rico. Es solo un enlace, sin código de afiliado: Pliegue no gana nada con él;
  - precios digitales de Google Play con la fecha de la consulta;
  - el precio de Buscalibre lo ve solo el admin y **no se anuncia**.
- **IA a tu medida:**
  - proveedor y modelo por tarea;
  - presupuesto mensual y registro de lo enviado;
  - sensibilidad por fuente o por libro: lo confidencial no sale a la nube y lo personal pide permiso;
  - bóveda de claves: solo la pestaña, cifrada en el navegador o en la cuenta con una frase.
- **Cuenta y sincronización:** opcional, con Google o correo; historial de conflictos; borrar la cuenta.
- **Bibliotecas compartidas:** códigos con caducidad y usos, lectores sin cuenta y registro de entradas.
- **Tus datos:** copias en un ZIP, copia de seguridad JSON, notas en Markdown y «Borrar todo en este navegador».
- **Sin rastreo:** la app no lleva analítica ni rastreo de terceros (comprobado en el código el 8-nov-2026).

**Límites que no se deben prometer de más:**
- vincular carpetas no está disponible en el móvil, Safari ni Firefox;
- la traducción en el dispositivo es solo de Chrome y Edge;
- Anthropic no ofrece búsqueda por significado (solo por palabras).

## Brand Commitments

- Nombre: Pliegue.
- Lema: «Todo lo que guardaste, por fin entendible, legible y conectado».
- Voz: española, concreta y honesta, que dice lo que sale del equipo y lo que no.
- No promete compatibilidades ni capacidades inexistentes («todos los formatos» se entrega por niveles).
- Marca en `apps/web/app/components/brand/`.

## Evidence on Hand

- La app funcionando en https://pliegue.genaropretill.com.
- Capturas de la app en las referencias visuales de las e2e (`apps/web/e2e/visual/linux/*.png`).

**No hay** testimonios, cifras de usuarios, prensa ni casos de clientes, y no se deben inventar.

## Product Principles

1. **La fuente manda:** cada afirmación de la IA señala su fuente verificable.
2. **Las fuentes permanecen intactas:** la organización vive en Pliegue, nunca en los archivos.
3. **Primero leer, luego conversar:** la IA complementa al lector y no lo reemplaza.
4. **Privado hasta que la persona decida compartir,** y siempre se dice qué sale del equipo.
5. **Toda automatización se puede explicar y deshacer.**

## Accessibility & Inclusion

- WCAG 2.2 AA como mínimo.
- La app se prueba con lector de pantalla (`docs/lector-de-pantalla.md`) y con teclado.
- Respetar «reducir movimiento».
