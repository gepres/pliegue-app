# Contribuir a Pliegue

## Regla principal de interfaz

Toda pantalla debe consumir los tokens de `@pliegue/tokens` y priorizar componentes de `@pliegue/ui`. No se deben duplicar colores, tipografías, radios, sombras ni componentes base dentro de una aplicación.

Una excepción requiere:

1. explicar por qué el sistema existente no cubre el caso;
2. documentar la decisión;
3. decidir si el patrón debe incorporarse a `@pliegue/ui`;
4. añadir un ejemplo al catálogo `/design-system`.

## Antes de enviar cambios

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```
