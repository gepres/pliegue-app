import { readLibraryBaseConfig } from "../../../library-access/access-server";
import { handleBuscalibrePrice } from "../../../library/buscalibre-server";

/** El precio de un libro en la ficha de Buscalibre del país (06.2b). Solo admin. */
export async function GET(request: Request) {
  return handleBuscalibrePrice(request, { config: readLibraryBaseConfig() });
}
