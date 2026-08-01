# Pliegue

Base frontend de Pliegue: una biblioteca de conocimiento para reunir, leer y conectar documentos.

## Estado

Esta primera entrega crea una aplicación web ejecutable y dos paquetes compartidos:

- `@pliegue/tokens`: contrato visual Light/Dark derivado de Figma.
- `@pliegue/ui`: componentes React reutilizables y accesibles.
- `@pliegue/web`: aplicación Next.js y catálogo vivo del sistema visual.

El diseño de referencia es [Pliegue — Prototipo de validación v0.1](https://www.figma.com/design/2CFIc5079NMSYinTxXXTpS/Pliegue-%E2%80%94-Prototipo-de-validaci%C3%B3n-v0.1?node-id=0-1&p=f&t=t23Jxpn0Xyc2ouRm-0).

## Requisitos

- Node.js 24 o superior
- pnpm 10.12.4

## Comandos

```bash
pnpm install
pnpm dev
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

Abre `http://localhost:3000` para la portada y `http://localhost:3000/design-system` para el catálogo de estilos y componentes.

Para configurar un entorno local, copia `.env.example` como `.env.local`. El contrato
de variables, flags y secretos se documenta en `docs/environments.md`.

## Estructura

```text
apps/
  web/                 Aplicación web y catálogo del sistema visual
packages/
  tokens/              Primitivos y tokens semánticos
  ui/                  Componentes React compartidos
docs/
  architecture/        ADR, diagrama de plataforma y ERD editables
  data-model.md         Entidades, procedencia, retención y borrado
  environments.md       Entornos, feature flags y secretos
  local-only.md         Importación web, IndexedDB y límites de recuperación
  design-system.md     Reglas de uso y trazabilidad Figma → código
```
