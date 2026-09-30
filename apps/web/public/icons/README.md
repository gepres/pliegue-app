# Iconos de la app instalada

- `pliegue-app.svg`: la marca de `../brand/pliegue-mark.svg` (nodo Figma `12:3`), con sus mismos
  trazados, escalada y centrada sobre una tesela de papel. No la redibuja.
- `pliegue-maskable.svg`: igual, con el papel hasta los bordes y la marca dentro de la zona
  segura (el 80 % central), porque el sistema la recorta en círculo, gota o cuadrado.
- Los PNG (`pliegue-192.png`, `pliegue-512.png`, `pliegue-maskable-*.png`, `apple-touch-icon.png`)
  se rasterizan desde esos SVG con Chrome a su tamaño exacto. Si cambia la marca, se vuelven a
  generar; no se editan a mano.
