import { cookies } from "next/headers";

import { accessCodeId, readGeneralLibraryAccess, readLibraryServerConfig } from "./access-server";
import { sessionCookieName } from "./access-session";

/** Para las páginas de servidor de la biblioteca general: ¿está montada y quién entra? */
export async function generalLibraryPageState() {
  const config = readLibraryServerConfig();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY?.trim() ?? "";
  if (!config || !apiKey) return { access: null, apiKey, configured: false as const };
  const store = await cookies();
  const access = await readGeneralLibraryAccess(store.get(sessionCookieName)?.value, { config });
  return { access, apiKey, configured: true as const };
}

/** ¿El código de un enlace es el mismo con el que ya se está dentro? */
export async function isCurrentAccessCode(code: string, currentCodeId: string) {
  return (await accessCodeId(code, { config: readLibraryServerConfig() })) === currentCodeId;
}
