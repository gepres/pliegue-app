# Entornos, secretos y feature flags

## Contrato de entornos

Pliegue reconoce cuatro entornos: `development`, `test`, `staging` y `production`.
La aplicación web lee el entorno público desde `NEXT_PUBLIC_PLIEGUE_APP_ENV`; si el
valor no existe o no es válido, usa `development`.

| Entorno | Propósito | Datos permitidos |
| --- | --- | --- |
| `development` | Trabajo local | Corpus sintético o autorizado |
| `test` | Pruebas automatizadas | Fixtures sin datos personales |
| `staging` | Validación integrada | Datos sintéticos y cuentas de prueba |
| `production` | Uso real | Datos del usuario según consentimiento |

## Feature flags públicas

- `NEXT_PUBLIC_FEATURE_DRIVE`: conector de Google Drive; apagado por defecto.
- `NEXT_PUBLIC_FEATURE_LOCAL_FILES`: flujos de archivos locales; encendido por defecto.
- `NEXT_PUBLIC_FEATURE_AI_PANEL`: superficie de IA; encendida por defecto, sin proveedor conectado.

Las flags se leen a través de `apps/web/app/config/public-config.ts`. No se deben
consultar variables de entorno directamente desde componentes.

## Secretos

El prefijo `NEXT_PUBLIC_` hace visible una variable en el navegador. Por tanto:

- nunca se usa para API keys, tokens OAuth, claves de cifrado ni credenciales;
- los archivos `.env*` permanecen ignorados, salvo `.env.example`;
- CI recibe secretos exclusivamente desde el almacén del proveedor de CI;
- las credenciales BYOK se integrarán mediante la bóveda segura definida en `02.5`;
- logs, telemetría, errores y documentos no deben contener valores secretos.

## CI base

`.github/workflows/ci.yml` instala con lockfile congelado y ejecuta lint, tipos,
pruebas y build en cada pull request y cada push a `main`. Despliegues y promoción
entre `staging` y `production` quedan fuera del workflow hasta elegir proveedor.
