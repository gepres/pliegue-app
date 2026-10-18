import { cookies } from "next/headers";

import {
  accessCodeId,
  findSharedLibrary,
  readGeneralLibraryAccess,
  readLibraryBaseConfig,
  readLibraryServerConfig,
  readSharedLibraryAccess,
} from "./access-server";
import { librarySessionCookieName, sessionCookieName } from "./access-session";
import { generalLibrary } from "./library-slug";

/** Para las páginas de servidor de la biblioteca general: ¿está montada y quién entra? */
export async function generalLibraryPageState() {
  const config = readLibraryServerConfig();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY?.trim() ?? "";
  if (!config || !apiKey) return { access: null, apiKey, configured: false as const };
  const store = await cookies();
  const access = await readGeneralLibraryAccess(store.get(sessionCookieName)?.value, { config });
  return { access, apiKey, configured: true as const };
}

/**
 * Lo mismo para una biblioteca compartida: además, la biblioteca, si existe y está abierta. Con
 * sesión, viene con el acceso; sin ella, se busca aparte.
 */
export async function sharedLibraryPageState(slug: string) {
  const config = readLibraryBaseConfig();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY?.trim() ?? "";
  if (!config || !apiKey) return { access: null, apiKey, library: null };
  const store = await cookies();
  const access = await readSharedLibraryAccess(slug, store.get(librarySessionCookieName(slug))?.value, { config });
  const library = access?.library ?? (await findSharedLibrary(slug, { config }));
  return { access, apiKey, library };
}

/** ¿El código de un enlace es el mismo con el que ya se está dentro? Sin `library`, en la general. */
export async function isCurrentAccessCode(code: string, currentCodeId: string, library: string = generalLibrary) {
  return (await accessCodeId(code, { config: readLibraryBaseConfig() }, library)) === currentCodeId;
}
