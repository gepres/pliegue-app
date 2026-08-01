# Modelo de datos y Área unificada

- Estado: Borrador técnico
- Foundry: `01.4 · Diseñar modelo de datos y Área unificada`
- ERD editable: `docs/architecture/data-model.mmd`
- Depende de la aprobación de `ADR-0002`

## Objetivo

Representar cuenta, Área, fuentes Drive/local, documentos y derivados sin perder
procedencia, sensibilidad o capacidad de borrado. El modelo diferencia claramente la
fuente original, una versión observada y cualquier artefacto regenerable.

## Decisiones del modelo

### Área y mezcla de fuentes

`workspace.index_scope` controla el alcance de descubrimiento:

- `separate`: Drive y local se consultan por separado;
- `unified`: pueden aparecer juntos después de consentimiento explícito;
- `ask`: cada búsqueda o clasificación solicita el alcance.

Cambiar de `separate` a `unified` registra actor, fecha y versión de política. El cambio
no copia originales; solo amplía el conjunto consultable. Una fuente local pertenece a
un dispositivo mediante `bound_device_id` y puede figurar como no disponible en otros.

### Procedencia obligatoria

Todo `document` incluye:

- `origin`: `drive | local | imported_copy`;
- `source_id` y `external_ref` opaco;
- `content_hash` y versión de fuente cuando exista;
- `sensitivity`: `public | internal | confidential | restricted`;
- formato, propietario visible y disponibilidad.

Todo derivado conserva `document_version_id`, versión del procesador y sensibilidad.
Una respuesta de IA o traducción nunca puede quedar sin el fragmento y versión que la
originaron.

### Original, versión y derivado

- `document` es la identidad estable que aparece en Biblioteca.
- `document_version` representa el contenido observado en un momento y permite detectar
  cambios sin destruir notas previas.
- `derivative` contiene texto extraído, OCR, miniatura, tabla, imagen mapeada o chunk.
- `translation` y `embedding` son tipos explícitos porque añaden proveedor/modelo,
  presupuesto, idioma o dimensiones.

Los derivados son regenerables. Si cambia el hash del original o la versión del
procesador, se crea una nueva versión; no se sobrescribe silenciosamente el artefacto.

## Entidades principales

| Entidad | Responsabilidad | Claves de privacidad |
| --- | --- | --- |
| `account` | identidad y locale | no contiene secretos BYOK |
| `device` | plataforma, versión y último acceso | revocable por cuenta |
| `workspace` | Área y alcance de índice | sensibilidad por defecto |
| `source` | Drive, carpeta local o copia | estado y dispositivo vinculado |
| `document` | identidad visible | procedencia y sensibilidad obligatorias |
| `document_version` | snapshot lógico del original | hash y versión de fuente |
| `derivative` | OCR, texto, imagen, tabla, chunk | expiración y procesador |
| `reading_progress` | posición por cuenta/dispositivo | historial para conflictos |
| `annotation` | resaltado, nota o referencia | cita, ancla y tombstone |
| `favorite` | marca global del usuario | operación idempotente |
| `translation` | resultado por alcance/idioma | proveedor y versión |
| `embedding` | vector asociado a un chunk | modelo, dimensiones, sensibilidad |
| `offer` | precio externo asociado a obra | país, moneda, fecha y procedencia |
| `retention_policy` | vida y sincronización por artefacto | auditable |
| `deletion_request` | borrado y verificación | estado por destino |
| `sync_operation` | outbox y resolución offline | idempotency key y base version |

## Preferencias y precedencia

Las preferencias se almacenan como valores parciales por nivel. El resultado efectivo
se calcula en este orden, de menor a mayor prioridad:

```text
valores base → dispositivo → cuenta → Área → documento
```

Tema, idioma, tipografía, tamaño, brillo e interlineado pueden heredarse. Las claves
desconocidas se ignoran y cada payload incluye `schema_version` para migraciones.

## Retención inicial propuesta

| Artefacto | Local-only | Cuenta sincronizada | Al desconectar fuente |
| --- | --- | --- | --- |
| Original local vinculado | nunca se copia | nunca se sube por defecto | se conserva solo la referencia |
| Copia importada | hasta borrado | solo con consentimiento | se conserva según política |
| Metadatos | hasta borrado | mientras exista cuenta/Área | se marca desconectado |
| Texto/OCR | configurable | 30 días por defecto | expira o se borra a pedido |
| Miniaturas | caché LRU | 30 días por defecto | se purgan a pedido |
| Embeddings | configurable | solo con consentimiento | borrado verificable |
| Traducciones | caché configurable | solo si el usuario elige | expiran según política |
| Notas/progreso | hasta borrado | mientras exista cuenta | permanecen con procedencia |

Los plazos son propuestas técnicas y deben validarse en la matriz legal `01.5`.

## Borrado verificable

Una solicitud crea `deletion_request` y enumera destinos: registro principal, versiones,
derivados, objetos, embeddings, cachés de dispositivo y trabajos pendientes. Cada destino
confirma su eliminación o registra un error reintentable. El estado solo pasa a
`verified` cuando no quedan artefactos administrados; las referencias a originales
externos no implican borrar el archivo en Drive o en el sistema del usuario salvo una
acción separada y explícita.

## Reglas de integridad

1. Un documento no existe sin fuente, origen y sensibilidad.
2. Un derivado no existe sin versión de documento y procesador.
3. Una nota conserva ancla, versión, página/posición y cita cuando sea legal.
4. Un embedding referencia un chunk; no un documento ambiguo.
5. Una oferta incluye país, moneda, formato, vendedor y fecha de observación.
6. Un secreto solo aparece como referencia de bóveda, nunca como columna de dominio.
7. Borrados usan tombstones durante la ventana de sincronización para evitar resurrección.
8. RLS limita cada fila a cuenta y Área autorizadas.

## Pendientes antes de migraciones

- Aprobar Postgres/Supabase y región.
- Validar retención por país, tipo de documento y proveedor.
- Definir si una cuenta puede pertenecer a varias Áreas en el MVP.
- Cerrar representación de anclas por PDF, EPUB y documentos reflowable.
- Elegir cifrado local para SQLite y cachés web.
- Definir SLO de borrado y evidencia de verificación.

No se crearán migraciones productivas hasta cerrar esos puntos; el ERD funciona como
contrato de revisión y base para `packages/domain` y `packages/contracts`.
