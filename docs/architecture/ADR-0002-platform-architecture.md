# ADR-0002 · Arquitectura multiplataforma, datos, colas e IA

- Estado: Aceptado — los cinco gates se resolvieron el 14 de agosto de 2026
- Fecha: 2026-07-31 · aprobado el 2026-08-14
- Foundry: `01.3 · Aprobar arquitectura y ADR multiplataforma`
- Diagrama editable: `docs/architecture/platform-overview.mmd`

## Contexto

Pliegue debe reunir documentos de Drive y del dispositivo, mantener lectura y notas
offline, ofrecer IA BYOK con evidencia y llegar primero a web, Windows y macOS. Android
y iOS siguen después de validar los flujos principales. La privacidad exige separar
originales, derivados, secretos y telemetría, además de conservar procedencia y
sensibilidad en cada operación.

## Decisión propuesta

### Clientes

1. **Web: Next.js App Router.** Continúa siendo la referencia funcional y el catálogo
   del sistema visual. Se despliega como servidor Node o contenedor; la plataforma de
   hosting no debe quedar acoplada al dominio.
2. **Windows/macOS: Tauri 2.** Envuelve la aplicación web y añade APIs nativas con
   permisos mínimos para archivos, SQLite, bóveda, actualizaciones y ventanas. Cada
   capacidad se declara por plataforma y ventana; no se habilitan permisos globales.
3. **Android/iOS: Expo + React Native.** Comparte contratos, dominio, cliente API y
   tokens, pero usa componentes nativos. No se intenta reutilizar directamente el DOM
   del paquete `@pliegue/ui`.

Referencias técnicas verificadas:

- [Tauri 2 y plataformas soportadas](https://v2.tauri.app/start/)
- [Capacidades y límites de permisos de Tauri](https://v2.tauri.app/security/capabilities/)
- [Expo en monorepos pnpm](https://docs.expo.dev/guides/monorepos/)
- [EAS Build en monorepos](https://docs.expo.dev/build-reference/build-with-monorepos/)

### Paquetes del monorepo

```text
apps/web             aplicación Next.js y referencia responsive
apps/desktop         shell Tauri; comandos Rust y capabilities
apps/mobile          cliente Expo/React Native
packages/tokens      contrato visual agnóstico
packages/ui          componentes React DOM
packages/ui-native   adaptadores React Native futuros
packages/domain      entidades, reglas y casos de uso puros
packages/contracts   DTO, eventos y esquemas versionados
packages/sync        outbox, cursores y resolución de conflictos
```

Solo se crean `apps/desktop`, `apps/mobile` y los nuevos paquetes al comenzar sus
tareas; este ADR no autoriza todavía dependencias o builds nativos.

### Backend y almacenamiento

- **Postgres** es la fuente de verdad de cuentas, Áreas, fuentes, documentos,
  procedencia, derivados, progreso, notas, favoritos, preferencias y trabajos.
- **Supabase administrado en `sa-east-1` (São Paulo)** provee Postgres, Auth, RLS y
  Storage sobre servicios abiertos y separables (gate 2). Se conserva una capa de
  repositorios para poder pasar a self-hosted sin reescribir el dominio.
- Los **originales locales** no se suben por defecto. Los originales de Drive permanecen
  en Drive; Pliegue guarda identificadores, permisos y versiones. Derivados solo se
  sincronizan con consentimiento explícito y política de retención.
- **Web offline:** IndexedDB para handles opacos de archivos/carpetas, metadatos, un
  índice textual limitado, preferencias y outbox. El binario original se resuelve desde
  la referencia solo al analizar una versión nueva o abrir el documento.
- **Desktop/móvil offline:** SQLite dentro del sandbox de la aplicación. Tauri dispone
  de un plugin SQL con soporte SQLite; se evaluará cifrado de la base antes del MVP.

Referencias:

- [Arquitectura abierta de Supabase](https://supabase.com/docs/guides/getting-started/architecture)
- [Postgres y extensiones en Supabase](https://supabase.com/docs/guides/database/overview)
- [Plugin SQL de Tauri](https://v2.tauri.app/reference/javascript/sql/)

### Colas y procesamiento documental

El MVP usa una tabla transaccional `jobs` en Postgres con leasing, reintentos,
idempotency key y dead-letter state. El cambio de documento y la creación del trabajo
ocurren en una misma transacción. Trabajadores aislados procesan extracción, OCR,
chunking y embeddings; cada resultado incluye versión del extractor, hash del original,
procedencia y sensibilidad.

Se migra a una cola administrada únicamente cuando latencia, volumen o aislamiento lo
justifiquen. Los eventos de dominio se publican mediante outbox; no se promete entrega
exactly-once, sino procesamiento idempotente y al-menos-una-vez.

### IA BYOK y secretos

- El dominio llama a un `AiRouter`; ningún componente invoca proveedores directamente.
- El router elige proveedor por flujo, política, presupuesto, idioma y disponibilidad.
- Escritorio/móvil guardan secretos en una bóveda respaldada por el sistema. Para Tauri
  se evaluará Stronghold con una clave derivada y permisos restringidos.
- Web usa claves de sesión y no recuperables (gate 3). El incremento de catálogo las
  mantiene en memoria de la pestaña y las transmite en headers únicamente a una ruta fija
  de proveedor. Una bóveda web persistente requeriría cifrado cliente, autenticación
  reciente y una decisión explícita de recuperación, y queda fuera del MVP; nunca se
  guardan claves en `localStorage`, variables `NEXT_PUBLIC_`, logs o telemetría.
- Las respuestas conservan citas a fragmentos, versión del documento y proveedor/modelo.
- Ollama puede operar localmente sin enviar contenido a terceros, sujeto a controles de
  origen y red del cliente nativo.

El primer adaptador web comparte un esquema de catálogo entre OpenAI, Anthropic y Ollama.
Solo envía un extracto acotado del índice y persiste el resultado como derivado idempotente;
no implementa todavía el router completo por sensibilidad, presupuesto y disponibilidad.

Referencia: [Stronghold para Tauri](https://v2.tauri.app/plugin/stronghold/).

### Sincronización y conflictos

Cada mutación local crea una operación en outbox con `operation_id`, `entity_id`,
`base_version`, marca temporal y dispositivo. La política depende del dato:

| Dato | Estrategia inicial |
| --- | --- |
| Progreso de lectura | conservar el avance mayor; permitir restaurar historial |
| Notas/resaltados | append + tombstones; conflicto editable |
| Favoritos/etiquetas | conjunto observado con operación idempotente |
| Preferencias | documento → Área → cuenta → dispositivo |
| Derivados | regenerables por hash + versión; no se fusionan |
| Secretos | nunca entran en sincronización documental |

### Despliegue y versionado

- Web: artefacto Next.js desplegable en Node o contenedor. Si se usan varias instancias,
  se configura caché compartida y coordinación de invalidaciones.
- API/worker: imágenes de contenedor inmutables, migraciones previas compatibles y
  despliegue gradual por entorno `development → staging → production`.
- Desktop: canal interno, beta y estable; firma en Windows y notarización en macOS.
- Mobile: builds internos antes de tiendas; EAS es la opción inicial, no una obligación.
- Apps y paquetes usan SemVer. Contratos API y eventos incluyen versión explícita.
- Esquema de datos sigue `expand → migrate → contract`; una app anterior debe seguir
  funcionando durante al menos una ventana de despliegue.
- Extractores, prompts y embeddings se versionan aparte del binario.

Next.js admite despliegue como servidor Node y contenedor; el self-hosting multiinstancia
requiere coordinar caché e invalidación: [guía oficial](https://nextjs.org/docs/app/guides/self-hosting).

## Límites de seguridad

- RLS por cuenta/Área y mínimo privilegio para Drive.
- Separación física o lógica entre originales, derivados y telemetría.
- Trazas solo con identificadores opacos, duración, tamaños y códigos; nunca contenido.
- Permisos nativos declarativos por ventana/plataforma.
- Borrado verificable incluye originales administrados, derivados, caché y embeddings.
- Cada cambio de proveedor, región o retención pasa por la matriz legal de `01.5`.

## Consecuencias

- Web y escritorio pueden compartir la UI React DOM sin obligar a móvil a simular DOM.
- El dominio y los contratos son reutilizables, pero los adaptadores de almacenamiento,
  archivos, bóveda y UI siguen siendo específicos por plataforma.
- Postgres simplifica RLS, relaciones y trazabilidad; los trabajos asíncronos requieren
  disciplina de idempotencia desde el inicio.
- Local-only es un modo de producto real: debe funcionar sin cuenta ni backend, aunque
  no ofrezca sincronización entre dispositivos.

## Gates resueltos · 2026-08-14

1. **Tauri 2 para Windows y macOS.** Pesa unos 10 MB frente a los ~150 MB de Electron,
   declara permisos por ventana y ofrece Stronghold para la bóveda; en un lector que se
   deja abierto, el consumo y la superficie de permisos pesan más que la comodidad de
   embeber Chromium. Consecuencia asumida: WKWebView no expone el File System Access
   API, así que `03.2b` sustituye la vinculación de carpetas del navegador por el plugin
   de archivos nativo. La aplicación web conserva su implementación actual.
2. **Supabase administrado, región `sa-east-1` (São Paulo).** Es la más cercana a Perú
   y deja los datos fuera de jurisdicción estadounidense, que importa en cuanto `01.5`
   clasifique alguno como personal. A la nube solo llegan cuentas, metadatos, progreso,
   notas y preferencias. La capa de repositorios se mantiene para poder pasar a
   despliegue propio sin reescribir el dominio.
3. **Claves web de sesión, no recuperables.** Viven en memoria de la pestaña y nunca en
   `localStorage`, variables `NEXT_PUBLIC_`, logs ni telemetría. Se acepta la fricción
   de volver a pegarlas en cada sesión. Una bóveda web persistente seguiría exigiendo
   cifrado en cliente, autenticación reciente y una decisión explícita de recuperación:
   queda fuera del MVP, no descartada.
4. **Derivados locales por defecto, ámbito sensible aislado.** El texto extraído, el OCR,
   los embeddings y las fichas de IA se quedan en el dispositivo y no se sincronizan sin
   consentimiento explícito por Área. Lo que sí se suba se borra en cascada al desvincular
   el documento, con 90 días de gracia y borrado verificable bajo demanda. Un Área marcada
   como sensible nunca sube derivados ni sale a proveedores de nube: solo Ollama local.
5. **SLO de sincronización: 60 s (p95) con conexión.** Un cambio de progreso o una nota
   aparece en otro dispositivo en menos de un minuto; sin conexión, el outbox garantiza
   convergencia sin pérdida. La cola en la tabla `jobs` se mantiene hasta que se sostengan
   ~50 trabajos por segundo o la latencia p95 de recogida supere los 30 s; por debajo de
   ese umbral, una cola administrada añade una pieza de infraestructura sin justificarla.

Con los cinco resueltos, el documento pasa a **Aceptado** y quedan desbloqueadas la
integración nativa, la autenticación real y el almacenamiento en la nube: `02.4`, `02.5`,
`03.1` y la fase 6.
