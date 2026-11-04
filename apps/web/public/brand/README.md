# Activos de marca

`pliegue-mark.svg` se exporta directamente del nodo Figma `12:3`. No debe redibujarse ni sustituirse por un icono aproximado.

**02.8 (4-nov-2026):** se quitaron los dos rectángulos de fondo que arrastró la exportación (el gris del lienzo y el papel del marco), que en el tema oscuro dejaban la marca como un cuadro claro. Los trazados son los del nodo `12:3`, sin cambios. En la app la marca va en línea con `components/brand/brand-mark.tsx` (los mismos trazados), para seguir el tema elegido: el libro en `--pliegue-color-action-primary` y la página en `--pliegue-paper-50`. Este archivo queda para el favicon, y en oscuro se aclara por `prefers-color-scheme`.
