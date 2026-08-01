# ADR-0001 · Base frontend compartida

- Estado: Propuesto
- Fecha: 2026-07-31
- Foundry: `01.3 · Aprobar arquitectura y ADR multiplataforma`

## Contexto

Pliegue debe funcionar primero en web y escritorio, y después extenderse a móvil. El diseño exige un contrato visual común, temas Light/Dark/System y componentes documentados que no se dupliquen por aplicación.

## Decisión propuesta

Adoptar un monorepo pnpm/Turborepo con:

- Next.js para la primera aplicación web;
- un paquete independiente de tokens CSS;
- un paquete React de componentes compartidos;
- TypeScript estricto en todo el workspace;
- catálogo vivo en `/design-system`;
- CI con lint, type-check, pruebas y build.

La integración de escritorio y móvil queda deliberadamente fuera de esta decisión hasta aprobar el ADR multiplataforma completo. Los tokens se mantienen agnósticos del framework para poder generar adaptadores futuros.

## Consecuencias

- El frontend web puede arrancar sin duplicar el sistema visual.
- Escritorio puede reutilizar la aplicación web o sus paquetes según la decisión posterior.
- React Native necesitará un adaptador de tokens y componentes nativos; no se presupone reutilización directa del DOM.
- Backend, persistencia, autenticación y sincronización no quedan decididos por este ADR.
